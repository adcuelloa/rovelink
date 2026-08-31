/**
 * Durable Object `RobotRoom`: a relay and nothing more.
 *
 * It does not interpret the robot's physics, does not store driving state and
 * does not keep queues: a frame that cannot be delivered is useless, because by
 * the time it arrived there would be a newer one. Uses the WebSocket Hibernation
 * API, so the room can sleep between packets without closing connections.
 */

import type {
  ControllerRegistration,
  DeviceRegistration,
  RemoteMessage,
  Role,
} from '@rovelink/protocol';
import { CLOSE_CODE, JSON_CODEC, mintVideoTicket, PROTOCOL_VERSION } from '@rovelink/protocol';

import { verifyCredential } from './auth.ts';
import type { Env } from './index.ts';
import { parseRoute } from './route.ts';

/**
 * How long a *registered* socket may stay silent before it is treated as
 * dead rather than a live peer. Staleness is an objective fact about the
 * OLD connection (nothing arrived for this long), not a claim made by a new
 * one, so a live registered peer can never be evicted by a competing
 * connection attempt — only one that has already gone silent past its
 * bound, or one that proves it holds the right credential (see
 * #handleDeviceRegister's authenticated takeover).
 *
 * The two roles need very different bounds:
 *
 * - `device`: firmware sends `telemetry` every ~300ms
 *   (rovelink_device.ino `TELEMETRY_MS`) with no reason to ever fall behind
 *   that; a short bound is what turns "several minutes stuck behind a taken
 *   role" into a few seconds.
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

/**
 * How long an accepted-but-*unregistered* socket may sit before it is
 * evicted, regardless of role. A pending socket owns no role slot (see
 * #isStale/#handleDeviceRegister/#handleControllerRegister — only a
 * registered socket ever occupies one), so this bound is purely about
 * capping how long an unauthenticated client can hold a connection open:
 * without it, an attacker could open a socket to /controller and idle
 * forever, and — before this bound existed — an old code path let that idle
 * socket block a legitimate operator for the full 90s controller staleness
 * window.
 */
const REGISTER_TIMEOUT_MS = 5000;

/** How often the alarm re-checks liveness while any socket is attached. */
const SWEEP_INTERVAL_MS = 3000;

/** Coalesces attachment rewrites on high-frequency traffic (control frames
 * can arrive up to 30/s): at most one write per socket per this window. */
const TOUCH_THROTTLE_MS = 1000;

interface Attachment {
  readonly robotId: string;
  readonly role: Role;
  /** True once a *validated* `device.register` / `controller.register` has
   * been seen on this socket. An accepted-but-unregistered socket is not a
   * "usable peer": it occupies nothing, is invisible to presence, and never
   * receives forwarded traffic (see #getRegisteredSockets). */
  readonly registered: boolean;
  /** `Date.now()` of the last inbound message, throttled (see
   * TOUCH_THROTTLE_MS). Drives staleness detection. */
  readonly lastSeenAt: number;
  /** Controller-role only: the relay-minted identity of this controller's
   * control session, set once at #promote() time and never client-supplied
   * (see #handleControllerRegister). This is what #handleDeviceRegister and
   * the control-forwarding path in webSocketMessage use to tell the device
   * which session is authoritative — the device itself never decides this
   * from a ControlFrame alone. */
  readonly controlSessionId?: string;
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
    registered: possible.registered === true,
    lastSeenAt: typeof possible.lastSeenAt === 'number' ? possible.lastSeenAt : Date.now(),
    controlSessionId:
      typeof possible.controlSessionId === 'string' ? possible.controlSessionId : undefined,
  };
}

export class RobotRoom implements DurableObject {
  readonly #state: DurableObjectState;
  readonly #env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const route = parseRoute(new URL(request.url).pathname);
    if (route === null) return new Response('unknown route', { status: 404 });

    // Both roles are accepted unconditionally at the transport layer: an
    // accepted-but-unregistered socket owns no role slot (see #isStale /
    // REGISTER_TIMEOUT_MS), so there is nothing to gate here. Occupancy,
    // duplicate-rejection, and authenticated takeover are decided entirely
    // at `device.register` / `controller.register` time, once a connection
    // has proven it holds the right credential (see #handleDeviceRegister /
    // #handleControllerRegister). Rejecting here based on raw socket
    // presence — the old behavior — would let an unauthenticated probe
    // occupy a role for free, and would block a legitimate authenticated
    // device reconnect behind a 409 before it ever got a chance to prove
    // itself.
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

    // The alarm is how staleness/registration-timeout gets noticed even if
    // nobody ever attempts a competing connection: see alarm() below.
    // setAlarm() is a no-op if one is already scheduled at or before this
    // time, so this stays cheap.
    await this.#ensureSweepScheduled();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const attachment = readAttachment(ws);
    if (attachment === null) return;

    const message = JSON_CODEC.decode(data);
    // Anything that is not protocol is not forwarded: the other end would not
    // understand it.
    if (message === null) return;

    if (message.type === 'ping') {
      // The pong is answered by the relay: it measures the RTT to the edge,
      // which is what decides whether the link is usable for driving. Not
      // gated on registration: it carries no control/telemetry.
      this.#send(ws, {
        v: PROTOCOL_VERSION,
        type: 'pong',
        id: message.id,
        sentAt: message.sentAt,
        echoAt: Date.now(),
      });
      return;
    }

    if (attachment.role === 'device' && message.type === 'device.register') {
      await this.#handleDeviceRegister(ws, attachment, message);
      return;
    }
    if (attachment.role === 'controller' && message.type === 'controller.register') {
      await this.#handleControllerRegister(ws, attachment, message);
      return;
    }

    // Everything else requires an already-registered, authenticated socket:
    // an accepted-but-unregistered connection must never drive or observe
    // the room. (It will be evicted on its own by REGISTER_TIMEOUT_MS if it
    // never registers — see alarm().)
    if (!attachment.registered) return;
    this.#touch(ws, attachment);

    if (attachment.role === 'controller') {
      if (message.type === 'control') {
        // Stamped from the room's own record of this socket's session, not
        // from anything the client sent: the browser has no authority to
        // declare its own session (see Attachment.controlSessionId). Any
        // client-supplied controlSessionId on the incoming frame is
        // discarded here, not forwarded.
        this.#forward('device', { ...message, controlSessionId: attachment.controlSessionId });
        return;
      }
      if (message.type === 'emergency-stop') {
        // Deliberately NOT session-stamped: emergency-stop must work
        // regardless of seq/session on the device side, so it carries no
        // session identity to check.
        this.#forward('device', message);
        return;
      }
      if (message.type === 'controller.videoTicket.request') {
        await this.#handleVideoTicketRequest(ws, attachment);
      }
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
    // handler also runs for closes *we* initiated (auth failure, takeover,
    // reclaim, sweep) where the socket may already be closing.
    this.#closeQuietly(ws, ROOM_CLOSE_CODES.has(code) ? code : 1000, reason);
    if (attachment === null) return;

    // Without a registered controller there is no one driving: the vehicle
    // must brake on its own, without waiting for its TTL to expire. Gated on
    // `registered` so an unauthenticated probe that opens /controller and
    // immediately disconnects cannot force a spurious emergency stop on a
    // robot it was never allowed to touch in the first place.
    if (attachment.role === 'controller' && attachment.registered) {
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
   * is only re-checked (a) reactively, when a new registration contends for
   * an occupied role in #handleControllerRegister, or (b) here, on a durable
   * alarm that persists across hibernation. (b) is what corrects
   * `deviceOnline`/`controllerOnline` even when nobody ever attempts to
   * reconnect, and is also what bounds how long an unregistered socket may
   * sit idle (REGISTER_TIMEOUT_MS).
   */
  async alarm(): Promise<void> {
    let anySockets = false;
    for (const role of ['controller', 'device'] as const) {
      for (const ws of this.#getSockets(role)) {
        anySockets = true;
        if (!this.#isStale(ws)) continue;
        const attachment = readAttachment(ws);
        const wasRegistered = attachment?.registered === true;
        console.log(`[room] sweep-evict role=${role} registered=${wasRegistered}`);
        if (wasRegistered) {
          this.#closeQuietly(ws, CLOSE_CODE.OCCUPIED, 'stale-heartbeat-timeout');
        } else {
          this.#closeQuietly(ws, CLOSE_CODE.REGISTRATION_TIMEOUT, 'registration-timeout');
        }
      }
    }
    // webSocketClose() (triggered by the close above) already re-announces
    // presence for each evicted socket; nothing else to publish here.
    if (anySockets) await this.#state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  /**
   * Validates the credential, then performs an authenticated takeover: every
   * *other* device socket for this robot — registered or still pending — is
   * demoted and the new one promoted before anything is closed, so
   * #getRegisteredSockets('device') never returns two entries and
   * forwarding/presence see only the new device from this point on. Closing
   * the incumbent afterwards is cleanup, not part of what makes the new
   * socket authoritative — the transition itself is already complete by
   * then. An invalid/missing token only ever closes the *new* socket: it can
   * never evict the current device.
   */
  async #handleDeviceRegister(
    ws: WebSocket,
    attachment: Attachment,
    message: DeviceRegistration,
  ): Promise<void> {
    const ok = await verifyCredential(message.token, this.#env.DEVICE_SECRET);
    if (!ok) {
      console.log(`[room] auth-failed role=device robot=${attachment.robotId}`);
      this.#closeQuietly(ws, CLOSE_CODE.AUTH_FAILED, 'auth-failed');
      return;
    }

    const others = this.#getSockets('device').filter((other) => other !== ws);
    for (const other of others) this.#demote(other);
    this.#promote(ws, attachment);

    console.log(
      `[room] register role=device robot=${attachment.robotId} replaced=${others.length}`,
    );
    this.#announceRoom(attachment.robotId);

    // This device did not witness whatever controller registration is
    // currently authoritative (it may have just booted, reconnected, or
    // taken over from another device) — tell it explicitly, the same
    // relay-authored way a controller promotion would, so it never has to
    // infer session identity from a ControlFrame alone.
    const currentController = this.#getRegisteredSockets('controller')[0];
    const currentSessionId = currentController
      ? readAttachment(currentController)?.controlSessionId
      : undefined;
    if (currentSessionId !== undefined) {
      this.#sendControlSession([ws], attachment.robotId, currentSessionId);
    }

    for (const other of others) {
      this.#closeQuietly(other, CLOSE_CODE.DEVICE_REPLACED, 'replaced-by-authenticated-device');
    }
  }

  /**
   * Validates the credential, then applies the no-silent-takeover policy: if
   * another *registered, live* controller already holds the role, the
   * newcomer — despite being authenticated — is rejected and the incumbent
   * is left untouched. Only a *stale* registered controller is reclaimed
   * (same liveness rule as Problem 2, now checked at registration time
   * instead of at connect time). Unregistered/pending controller sockets
   * never occupy the role, so they play no part in this check and are left
   * alone; they expire on their own via REGISTER_TIMEOUT_MS.
   */
  async #handleControllerRegister(
    ws: WebSocket,
    attachment: Attachment,
    message: ControllerRegistration,
  ): Promise<void> {
    const ok = await verifyCredential(message.token, this.#env.CONTROLLER_SECRET);
    if (!ok) {
      console.log(`[room] auth-failed role=controller robot=${attachment.robotId}`);
      this.#closeQuietly(ws, CLOSE_CODE.AUTH_FAILED, 'auth-failed');
      return;
    }

    const registeredOthers = this.#getSockets('controller')
      .filter((other) => other !== ws)
      .filter((other) => readAttachment(other)?.registered === true);
    const live = registeredOthers.filter((other) => !this.#isStale(other));
    const stale = registeredOthers.filter((other) => this.#isStale(other));

    if (live.length > 0) {
      console.log(`[room] controller-occupied robot=${attachment.robotId}`);
      this.#closeQuietly(ws, CLOSE_CODE.OCCUPIED, 'controller-occupied');
      return;
    }

    // Minted here, server-side, the moment this controller becomes
    // authoritative — never something the client supplies. This is the
    // session identity #handleDeviceRegister and the control-forwarding
    // path stamp onto every frame the device sees from this controller;
    // the device only ever learns of a session change through the explicit
    // `controller.session` message below, never by inspecting a
    // ControlFrame, so a delayed frame from a previous session can never
    // roll the device's active session backward.
    const controlSessionId = crypto.randomUUID();

    for (const other of stale) this.#demote(other);
    this.#promote(ws, attachment, controlSessionId);

    console.log(
      `[room] register role=controller robot=${attachment.robotId} reclaimed=${stale.length} session=${controlSessionId}`,
    );
    this.#announceRoom(attachment.robotId);

    // Sent to the device before returning, i.e. strictly before this
    // connection's first `control` frame can possibly be processed by a
    // later webSocketMessage() call: WebSocket sends on one connection are
    // delivered in order, and this DO handles one message at a time, so the
    // device is guaranteed to see `controller.session` before any frame
    // belonging to it.
    //
    // Also sent to the controller itself (`ws`): this is what lets the
    // browser know its registration is actually authoritative, rather than
    // merely accepted — see ControlSender.establishSessionBaseline(), which
    // only ever fires in direct response to this message. The controller's
    // own copy still has to make a full round trip (relay -> controller ->
    // browser reacts -> forced baseline -> relay -> device) before its
    // baseline frame can reach the device, so it can never arrive at the
    // device ahead of the copy sent directly above.
    this.#sendControlSession(
      [...this.#getRegisteredSockets('device'), ws],
      attachment.robotId,
      controlSessionId,
    );

    for (const other of stale) {
      this.#closeQuietly(other, CLOSE_CODE.OCCUPIED, 'stale-role-reclaimed');
    }
  }

  /**
   * Mints a short-lived video viewer ticket for the ALREADY authenticated
   * controller that asked for it, and sends it back to that socket only
   * (Problem 7C). Reachable only from inside the `attachment.role ===
   * 'controller'` branch of webSocketMessage, itself only reachable after
   * `!attachment.registered` has already returned — so an unauthenticated
   * or pending socket can never reach this method, and neither can a
   * device. The request carries no robotId of its own to trust: the
   * ticket is minted for `attachment.robotId`, i.e. exactly the room this
   * controller is already authenticated to — there is no path by which a
   * controller authenticated to one robot could ask for a ticket to
   * another. This is a pure side-channel: it never touches seq, control
   * session, TTL, or any other control-path state, and forwards nothing to
   * the device.
   */
  async #handleVideoTicketRequest(ws: WebSocket, attachment: Attachment): Promise<void> {
    const minted = await mintVideoTicket(
      {
        robotId: attachment.robotId,
        role: 'viewer',
        controllerSessionId: attachment.controlSessionId,
      },
      this.#env.VIDEO_TICKET_SECRET,
      Date.now(),
    );
    this.#send(ws, {
      v: PROTOCOL_VERSION,
      type: 'controller.videoTicket',
      robotId: attachment.robotId,
      ticket: minted.token,
      expiresAt: minted.expiresAt,
    });
  }

  /** Relay-authored only — see Attachment.controlSessionId and
   * ControlSession in protocol.ts. Never triggered by anything a client
   * sends; only #handleControllerRegister and #handleDeviceRegister call
   * this, both from the room's own server-side session record. */
  #sendControlSession(targets: readonly WebSocket[], robotId: string, sessionId: string): void {
    for (const target of targets) {
      this.#send(target, {
        v: PROTOCOL_VERSION,
        type: 'controller.session',
        robotId,
        sessionId,
      });
    }
  }

  /** Marks a socket authoritative: registered, freshly seen. `controlSessionId`
   * is only meaningful for the controller role — device promotion leaves it
   * unset. */
  #promote(ws: WebSocket, attachment: Attachment, controlSessionId?: string): void {
    ws.serializeAttachment({
      robotId: attachment.robotId,
      role: attachment.role,
      registered: true,
      lastSeenAt: Date.now(),
      controlSessionId,
    } satisfies Attachment);
  }

  /** Strips authority from a socket without closing it: used to make a
   * takeover/reclaim atomic (demote before close) so the old socket stops
   * being forwarded to or counted in presence the instant the new one is
   * promoted, regardless of when its close actually completes. */
  #demote(ws: WebSocket): void {
    const attachment = readAttachment(ws);
    if (attachment === null) return;
    ws.serializeAttachment({ ...attachment, registered: false } satisfies Attachment);
  }

  async #ensureSweepScheduled(): Promise<void> {
    const current = await this.#state.storage.getAlarm();
    if (current === null) await this.#state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  #isStale(ws: WebSocket, now: number = Date.now()): boolean {
    const attachment = readAttachment(ws);
    if (attachment === null) return true;
    const bound = attachment.registered ? STALE_MS[attachment.role] : REGISTER_TIMEOUT_MS;
    return now - attachment.lastSeenAt >= bound;
  }

  /** Refreshes the liveness timestamp for an already-registered socket,
   * coalesced to at most once per TOUCH_THROTTLE_MS. Registration itself
   * writes the attachment directly (see #promote) since it also flips
   * `registered`. */
  #touch(ws: WebSocket, attachment: Attachment): void {
    const now = Date.now();
    if (now - attachment.lastSeenAt < TOUCH_THROTTLE_MS) return;
    ws.serializeAttachment({ ...attachment, lastSeenAt: now } satisfies Attachment);
  }

  #getSockets(role: Role): WebSocket[] {
    return this.#state.getWebSockets(role);
  }

  /** Registered peers only: an accepted-but-unregistered socket occupies no
   * role slot (see fetch()) and must not receive traffic meant for a usable
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

/** Every code the room itself ever passes to `ws.close()`: used by
 * webSocketClose to tell "we closed this on purpose, with a specific
 * reason" apart from "the client closed and reason should pass through
 * unchanged" — a client-initiated close is always finalized as 1000. */
const ROOM_CLOSE_CODES = new Set<number>(Object.values(CLOSE_CODE));
