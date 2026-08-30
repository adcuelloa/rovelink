/**
 * Durable Object `RobotRoom`: a relay and nothing more.
 *
 * It does not interpret the robot's physics, does not store driving state and
 * does not keep queues: a frame that cannot be delivered is useless, because by
 * the time it arrived there would be a newer one. Uses the WebSocket Hibernation
 * API, so the room can sleep between packets without closing connections.
 */

import type { RemoteMessage, Role } from '@rovelink/protocol';
import { JSON_CODEC, PROTOCOL_VERSION } from '@rovelink/protocol';

import { parseRoute } from './route.ts';

/** A role slot changed hands: either a live duplicate was never in play and the
 * closing socket lost its slot to a reclaim, or the server is completing a
 * client-initiated close. */
const CLOSE_OCCUPIED = 4001;

/**
 * How long a socket may stay silent before it is treated as dead rather than
 * a live peer. This is what makes reclaiming a role safe without
 * authentication: staleness is an objective fact about the OLD connection
 * (nothing arrived for this long), not a claim made by the new one, so a live
 * peer can never be evicted by a competing connection attempt — only one that
 * has already gone silent past its bound.
 *
 * The two roles need very different bounds:
 *
 * - `device`: firmware sends `telemetry` every ~300ms
 *   (rovelink_device.ino `TELEMETRY_MS`) with no reason to ever fall behind
 *   that; a short bound is what turns "several minutes stuck behind 409"
 *   into a few seconds.
 * - `controller`: the browser tab pings every ~2s (websocket.ts `pingMs`),
 *   but confirmed live (via a real backgrounded tab during testing) that
 *   Chrome throttles a hidden tab's timers down to as little as one firing
 *   per minute, well past any bound sized around the nominal 2s cadence. A
 *   short bound there doesn't detect a dead browser faster — closes and
 *   errors already release the role near-instantly (see webSocketClose) — it
 *   only risks silently kicking a genuine, still-open operator. So this side
 *   is sized to tolerate that throttling instead, at the cost of a slower
 *   bound on reclaiming a truly abandoned controller.
 */
const STALE_MS: Record<Role, number> = {
  device: 6000,
  controller: 90_000,
};

/** How often the alarm re-checks liveness while any socket is attached. */
const SWEEP_INTERVAL_MS = 3000;

/** Coalesces attachment rewrites on high-frequency traffic (control frames
 * can arrive up to 30/s): at most one write per socket per this window. */
const TOUCH_THROTTLE_MS = 1000;

interface Attachment {
  readonly robotId: string;
  readonly role: Role;
  /** True once `device.register` / `controller.register` has been seen on
   * this socket: an accepted-but-unregistered socket still occupies its role
   * slot (nothing else may claim it) but is not a "usable peer" yet. */
  readonly registered: boolean;
  /** `Date.now()` of the last inbound message, throttled (see
   * TOUCH_THROTTLE_MS). Drives staleness detection. */
  readonly lastSeenAt: number;
}

function readAttachment(ws: WebSocket): Attachment | null {
  const attachment: unknown = ws.deserializeAttachment();
  if (typeof attachment !== 'object' || attachment === null) return null;
  const possible = attachment as Partial<Attachment>;
  if (typeof possible.robotId !== 'string') return null;
  if (possible.role !== 'controller' && possible.role !== 'device') return null;
  return {
    robotId: possible.robotId,
    role: possible.role,
    // Sockets attached before these fields existed (mid-deploy) are treated
    // as already registered and freshly seen, so shipping this change never
    // evicts a peer that was already connected.
    registered: typeof possible.registered === 'boolean' ? possible.registered : true,
    lastSeenAt: typeof possible.lastSeenAt === 'number' ? possible.lastSeenAt : Date.now(),
  };
}

export class RobotRoom implements DurableObject {
  readonly #state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.#state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const route = parseRoute(new URL(request.url).pathname);
    if (route === null) return new Response('unknown route', { status: 404 });

    // One device per robot and, for now, one active controller — but a
    // socket that has gone silent past STALE_MS does not count as occupying
    // the role: it is presumed dead (e.g. the ESP32 lost power) rather than a
    // live duplicate, and its slot is reclaimed instead of blocking the new
    // connection with 409.
    const existing = this.#getSockets(route.role);
    const stale = existing.filter((ws) => this.#isStale(ws));
    if (stale.length < existing.length) {
      console.log(
        `[room] 409 role=${route.role} robot=${route.robotId} existing=${existing.length} stale=${stale.length}`,
      );
      return new Response(`there is already a ${route.role} in ${route.robotId}`, { status: 409 });
    }
    for (const ws of stale) {
      console.log(`[room] reclaim role=${route.role} robot=${route.robotId} (stale)`);
      this.#closeQuietly(ws, CLOSE_OCCUPIED, 'stale-role-reclaimed');
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // With `acceptWebSocket` (not `accept`) the room can hibernate: the tags
    // and the attachment survive the sleep, instance variables do not.
    this.#state.acceptWebSocket(server, [route.role]);
    server.serializeAttachment({
      robotId: route.robotId,
      role: route.role,
      registered: false,
      lastSeenAt: Date.now(),
    } satisfies Attachment);
    console.log(`[room] accept role=${route.role} robot=${route.robotId}`);
    this.#announceRoom(route.robotId);

    // The alarm is how staleness gets noticed even if nobody ever attempts a
    // competing connection (e.g. a controller tab left open after the robot
    // vanishes for good): see alarm() below. setAlarm() is a no-op if one is
    // already scheduled at or before this time, so this stays cheap.
    await this.#ensureSweepScheduled();

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    const attachment = readAttachment(ws);
    if (attachment === null) return;

    const message = JSON_CODEC.decode(data);
    // Anything that is not protocol is not forwarded: the other end would not
    // understand it.
    if (message === null) return;

    if (message.type === 'ping') {
      // The pong is answered by the relay: it measures the RTT to the edge,
      // which is what decides whether the link is usable for driving.
      this.#send(ws, {
        v: PROTOCOL_VERSION,
        type: 'pong',
        id: message.id,
        sentAt: message.sentAt,
        echoAt: Date.now(),
      });
      return;
    }

    const isRegistration =
      (attachment.role === 'controller' && message.type === 'controller.register') ||
      (attachment.role === 'device' && message.type === 'device.register');
    this.#touch(ws, attachment, isRegistration);

    if (attachment.role === 'controller') {
      if (message.type === 'controller.register') {
        this.#announceRoom(attachment.robotId);
        return;
      }
      if (message.type === 'control' || message.type === 'emergency-stop') {
        this.#forward('device', message);
      }
      return;
    }

    if (message.type === 'device.register') {
      this.#announceRoom(attachment.robotId);
      return;
    }
    if (message.type === 'telemetry') this.#forward('controller', message);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const attachment = readAttachment(ws);
    console.log(
      `[room] close role=${attachment?.role ?? 'unknown'} robot=${attachment?.robotId ?? 'unknown'} code=${code} reason=${reason}`,
    );
    // Required by the Hibernation API contract: completes the closing
    // handshake for a close the client initiated. Guarded because this
    // handler also runs for closes *we* initiated (stale-role reclaim, sweep)
    // where the socket may already be closing.
    this.#closeQuietly(ws, code === CLOSE_OCCUPIED ? code : 1000, reason);
    if (attachment === null) return;

    // Without a controller there is no one to drive: the vehicle must brake
    // on its own, without waiting for its TTL to expire.
    if (attachment.role === 'controller') {
      this.#forward('device', {
        v: PROTOCOL_VERSION,
        type: 'emergency-stop',
        sentAt: Date.now(),
        reason: 'controller-disconnected',
      });
    }
    this.#announceRoom(attachment.robotId, ws);
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws, 1011, 'websocket error');
  }

  /**
   * Periodic liveness sweep: DO hibernation means there is no in-memory timer
   * that could survive the room going to sleep between packets, so staleness
   * is only re-checked (a) reactively, when a new connection contends for an
   * occupied role in fetch(), or (b) here, on a durable alarm that persists
   * across hibernation. (b) is what corrects `deviceOnline`/`controllerOnline`
   * even when nobody ever attempts to reconnect.
   */
  async alarm(): Promise<void> {
    let anySockets = false;
    const robotIds = new Set<string>();
    for (const role of ['controller', 'device'] as const) {
      for (const ws of this.#getSockets(role)) {
        anySockets = true;
        if (!this.#isStale(ws)) continue;
        const attachment = readAttachment(ws);
        if (attachment !== null) robotIds.add(attachment.robotId);
        console.log(`[room] sweep-evict role=${role}`);
        this.#closeQuietly(ws, CLOSE_OCCUPIED, 'stale-heartbeat-timeout');
      }
    }
    // webSocketClose() (triggered by the close above) already re-announces
    // presence for each evicted socket; nothing else to publish here.
    if (anySockets) await this.#state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  async #ensureSweepScheduled(): Promise<void> {
    const current = await this.#state.storage.getAlarm();
    if (current === null) await this.#state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  #isStale(ws: WebSocket, now: number = Date.now()): boolean {
    const attachment = readAttachment(ws);
    if (attachment === null) return true;
    return now - attachment.lastSeenAt >= STALE_MS[attachment.role];
  }

  /** Refreshes the liveness timestamp. Registration always writes immediately
   * (rare, and other logic keys off `registered` right away); anything else
   * is coalesced to at most once per TOUCH_THROTTLE_MS. */
  #touch(ws: WebSocket, attachment: Attachment, registration: boolean): void {
    const now = Date.now();
    if (!registration && attachment.registered && now - attachment.lastSeenAt < TOUCH_THROTTLE_MS) {
      return;
    }
    ws.serializeAttachment({
      robotId: attachment.robotId,
      role: attachment.role,
      registered: attachment.registered || registration,
      lastSeenAt: now,
    } satisfies Attachment);
  }

  #getSockets(role: Role): WebSocket[] {
    return this.#state.getWebSockets(role);
  }

  /** Registered peers only: an accepted-but-unregistered socket occupies its
   * role slot (see fetch()) but must not receive traffic meant for a usable
   * peer, and must not count toward presence. */
  #getRegisteredSockets(role: Role): WebSocket[] {
    return this.#getSockets(role).filter((ws) => readAttachment(ws)?.registered === true);
  }

  #forward(role: Role, message: RemoteMessage): void {
    for (const target of this.#getRegisteredSockets(role)) this.#send(target, message);
  }

  #send(ws: WebSocket, message: RemoteMessage): void {
    try {
      ws.send(JSON_CODEC.encode(message));
    } catch {
      // Socket already closed: nothing to save or retry.
    }
  }

  #closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed/closing: nothing to do.
    }
  }

  /** Publishes presence to both ends, skipping the one that is leaving. */
  #announceRoom(robotId: string, leaving?: WebSocket): void {
    const alive = (role: Role): WebSocket[] =>
      this.#getRegisteredSockets(role).filter((ws) => ws !== leaving);

    const message: RemoteMessage = {
      v: PROTOCOL_VERSION,
      type: 'room',
      robotId,
      deviceOnline: alive('device').length > 0,
      controllerOnline: alive('controller').length > 0,
    };

    for (const ws of [...alive('controller'), ...alive('device')]) this.#send(ws, message);
  }
}
