/**
 * Durable Object `VideoRoom`: a JPEG-frame relay and nothing more.
 *
 * Deliberately separate from `RobotRoom` (the control relay, a different
 * package/Worker entirely — see wrangler.jsonc). Video is continuous,
 * high-bandwidth, and disposable; control is sparse, small, and must never
 * be delayed by a slow video viewer. This class shares no code, no
 * Durable Object binding, and no message type with `@rovelink/relay`; the
 * only thing they have in common is the same hibernation-based WebSocket
 * pattern, because it is the right tool for both.
 *
 * AUTHENTICATION (Problem 7C) — a socket is "pending" from the moment it
 * connects until it completes registration; a pending socket owns no role
 * slot, is invisible to presence/occupancy, and cannot publish or view
 * anything:
 *
 *   - PUBLISHER: sends `publisher.register { robotId, token }`. `token` is
 *     verified against `VIDEO_PUBLISHER_SECRET` (constant-time, via
 *     `@rovelink/protocol`'s `verifyCredential` — the same mechanism the
 *     control relay uses for `device.register`). A validly authenticated
 *     publisher MAY replace an already-live one (authenticated takeover,
 *     mirroring Problem 3's device-replacement model) — an invalid one can
 *     never evict the incumbent.
 *   - VIEWER: sends `viewer.register { robotId, ticket }`. `ticket` is a
 *     short-lived signed token minted by the CONTROL relay for an already
 *     authenticated controller (`@rovelink/protocol`'s
 *     `verifyVideoTicket`) — this Worker never sees `CONTROLLER_SECRET`
 *     and never mints tickets itself, only verifies them with
 *     `VIDEO_TICKET_SECRET`, a secret shared only between the two relays.
 *
 * A pending socket that never completes registration is evicted by the
 * same alarm-driven sweep that handles ack-timeout (below), bounded by
 * REGISTRATION_TIMEOUT_MS.
 *
 * BACKPRESSURE (Problem 7B.1 hardening) — the Cloudflare Workers
 * `WebSocket` type (checked against @cloudflare/workers-types 5.20260829.1)
 * exposes `send()` returning `void` and no `bufferedAmount`, no
 * send-completion callback, and no other introspection into how much is
 * still queued to a client. Relying on the runtime's own internal send
 * buffer as the backpressure mechanism was rejected: `ws.send()` calls can
 * still be accepted into that buffer, one after another, before a slow
 * socket is ever closed — exactly the stale-frame pileup RoveLink's
 * low-latency driving requirement cannot tolerate. Instead this room
 * implements EXPLICIT application-level flow control:
 *
 *   - The room still keeps NO frame queue anywhere: `#latestFrame` is a
 *     single slot per room, always overwritten by the newest frame.
 *   - Each VIEWER (not the room) tracks at most one `inFlight` frame
 *     identifier at a time — the credit for "you may be sent one frame".
 *     A viewer with a frame already in flight is skipped (not queued) when
 *     a new one arrives; see #trySendFrameToViewer.
 *   - A viewer proves it consumed its in-flight frame with a `viewer.ack`
 *     message (`@rovelink/protocol`'s `ViewerAck` + `isMatchingAck`),
 *     which releases its credit and — if a newer frame already exists —
 *     immediately hands over the NEWEST one, never anything queued in
 *     between (see #handleViewerAck).
 *   - A viewer that never acks is not left as a zombie: the same
 *     alarm-driven sweep evicts it (ACK_TIMEOUT_MS), durable across DO
 *     hibernation (see `@rovelink/relay`'s room.ts STALE_MS/alarm(), the
 *     same pattern).
 *
 * STORAGE — frames are ephemeral by design (Problem 7B brief §13), and
 * secrets/tickets are NEVER persisted (Problem 7C brief §17): nothing in
 * this file ever calls `this.#state.storage.put/sql.exec`. `#latestFrame`
 * and every socket's `inFlight`/`framesSkipped`/`pendingSince` live only in
 * `serializeAttachment`-backed socket attachments (which DO survive
 * hibernation — a registered/pending socket's status is never lost across
 * a sleep cycle) and a plain class property for `#latestFrame` (which does
 * NOT survive hibernation — a newly-woken room simply has no cached frame
 * until the next one arrives, which is fine: stale imagery is worth less
 * than a moment's wait for a fresh one).
 */

import type { VideoFrameHeader, VideoRole } from '@rovelink/protocol';
import {
  isJpeg,
  isMatchingAck,
  isVideoMessage,
  MAX_JPEG_BYTES,
  VIDEO_CLOSE_CODE,
  VIDEO_PROTOCOL_VERSION,
  verifyCredential,
  verifyVideoTicket,
} from '@rovelink/protocol';

import type { Env } from './index.ts';
import { parseVideoRoute } from './route.ts';

/** How long a viewer's `inFlight` frame may go unacknowledged before the
 * room gives up on it (Problem 7B.1 §7). Deliberately a few seconds, not
 * milliseconds: a viewer's browser tab backgrounded for a moment, or a dev
 * CLI momentarily busy, should not be evicted for an ordinary hiccup — only
 * a genuinely stalled/gone viewer. Chosen to be well above any real frame
 * interval (100ms at 10 fps) so it only fires for a viewer that has truly
 * stopped acknowledging, not one that is merely a bit slow. */
const ACK_TIMEOUT_MS = 5000;

/** How long a pending (not-yet-registered) publisher or viewer socket may
 * sit before the room gives up on it (Problem 7C brief §14). Matches the
 * control relay's own REGISTER_TIMEOUT_MS. */
const REGISTRATION_TIMEOUT_MS = 5000;

/** How often the alarm re-checks for a timed-out in-flight frame or an
 * expired registration window, while any socket is attached. Mirrors the
 * control relay's SWEEP_INTERVAL_MS pattern (`@rovelink/relay`'s room.ts). */
const SWEEP_INTERVAL_MS = 2000;

/** Standard WebSocket readyState value for OPEN. Used to filter
 * `state.getWebSockets()` results: the Hibernation API keeps a socket in
 * that list for the duration of its OWN `webSocketClose`/`webSocketError`
 * handler, so re-deriving room state (e.g. "is a publisher online") from
 * inside a close handler without this filter finds the very socket that
 * is closing and reports it as still present. */
const WS_READY_STATE_OPEN = 1;

interface InFlight {
  readonly streamSessionId: string;
  readonly seq: number;
  /** `Date.now()` when this frame was sent — what ACK_TIMEOUT_MS is
   * measured against, not when it was captured or when the viewer connected. */
  readonly sentAt: number;
}

interface Attachment {
  readonly robotId: string;
  readonly role: VideoRole;
  /** True once this socket has completed `publisher.register` /
   * `viewer.register` — before that it is "pending": invisible to
   * presence/occupancy, and cannot publish or view anything (Problem 7C
   * brief §10/§14/§15). */
  readonly registered: boolean;
  /** `Date.now()` when this socket connected. Only meaningful while
   * `registered` is false — what REGISTRATION_TIMEOUT_MS is measured
   * against. Irrelevant once registered (an established socket has its own
   * liveness story: `inFlight`/ACK_TIMEOUT_MS for viewers, its own
   * close/error events for publishers). */
  readonly pendingSince: number;
  /** Publisher only, set once at registration; never client-supplied. */
  readonly streamSessionId?: string;
  /** Publisher only: a `frame` header already received, awaiting its
   * binary payload (the very next message on this socket). Cleared the
   * instant the binary arrives (matched or not) — see webSocketMessage. */
  readonly pendingHeader?: VideoFrameHeader;
  /** Viewer only: the one frame this viewer has been sent but not yet
   * acknowledged. `undefined` means the viewer has credit and may be sent
   * the next available frame immediately (Problem 7B.1 §2). */
  readonly inFlight?: InFlight;
  /** Viewer only: how many frames were NOT sent to this viewer because it
   * had no credit (an unacknowledged inFlight frame already) when a new one
   * arrived. Expected, congestion-driven behavior, never a network error —
   * see Problem 7B.1 §14. */
  readonly framesSkipped?: number;
}

function isInFlight(value: unknown): value is InFlight {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<InFlight>;
  return (
    typeof v.streamSessionId === 'string' &&
    typeof v.seq === 'number' &&
    typeof v.sentAt === 'number'
  );
}

function readAttachment(ws: WebSocket): Attachment | null {
  const attachment: unknown = ws.deserializeAttachment();
  if (typeof attachment !== 'object' || attachment === null) return null;
  const possible = attachment as Partial<Attachment>;
  if (typeof possible.robotId !== 'string') return null;
  if (possible.role !== 'publisher' && possible.role !== 'viewer') return null;
  return {
    robotId: possible.robotId,
    role: possible.role,
    registered: possible.registered === true,
    pendingSince: typeof possible.pendingSince === 'number' ? possible.pendingSince : 0,
    streamSessionId:
      typeof possible.streamSessionId === 'string' ? possible.streamSessionId : undefined,
    pendingHeader: possible.pendingHeader,
    inFlight: isInFlight(possible.inFlight) ? possible.inFlight : undefined,
    framesSkipped: typeof possible.framesSkipped === 'number' ? possible.framesSkipped : undefined,
  };
}

interface CachedFrame {
  readonly header: VideoFrameHeader;
  readonly jpeg: ArrayBuffer;
}

export class VideoRoom implements DurableObject {
  readonly #state: DurableObjectState;
  readonly #env: Env;

  /** The single most recent complete frame for this room, or none. Class
   * property, not storage: see the module doc comment above. */
  #latestFrame: CachedFrame | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.#state = state;
    this.#env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const route = parseVideoRoute(new URL(request.url).pathname);
    if (route === null) return new Response('unknown route', { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.#state.acceptWebSocket(server, [route.role]);
    // Every socket starts pending: neither role sends/receives anything
    // real until it registers (see webSocketMessage's dispatch below).
    server.serializeAttachment({
      robotId: route.robotId,
      role: route.role,
      registered: false,
      pendingSince: Date.now(),
    } satisfies Attachment);

    // The alarm is how a stalled registration or an unacknowledged
    // in-flight frame gets noticed even if the socket never sends anything
    // else again — see alarm() below. setAlarm() is a no-op if one is
    // already scheduled at or before this time, so this stays cheap.
    await this.#ensureSweepScheduled();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const attachment = readAttachment(ws);
    if (attachment === null) return;

    if (typeof data !== 'string') {
      // Binary: only ever meaningful from an already-registered publisher
      // (Problem 7C brief §10 — a pending publisher's frames are ignored).
      if (attachment.registered && attachment.role === 'publisher') {
        this.#handleFrameBinary(ws, attachment, data);
      }
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!isVideoMessage(parsed)) return;

    if (parsed.type === 'publisher.register' && attachment.role === 'publisher') {
      await this.#handlePublisherRegister(ws, attachment, parsed);
      return;
    }
    if (parsed.type === 'viewer.register' && attachment.role === 'viewer') {
      await this.#handleViewerRegister(ws, attachment, parsed);
      return;
    }

    // Everything else requires an already-registered socket: a pending
    // publisher's frame headers and a pending viewer's acks are both
    // ignored (Problem 7C brief §10/§15).
    if (!attachment.registered) return;

    if (parsed.type === 'frame' && attachment.role === 'publisher') {
      this.#handleFrameHeader(ws, attachment, parsed);
      return;
    }
    if (parsed.type === 'viewer.ack' && attachment.role === 'viewer') {
      this.#handleViewerAck(ws, attachment, parsed);
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const attachment = readAttachment(ws);
    console.log(
      `[video-room] close role=${attachment?.role ?? 'unknown'} robot=${attachment?.robotId ?? 'unknown'} code=${code} reason=${reason}`,
    );
    this.#closeQuietly(ws, code, reason);
    if (attachment === null) return;

    if (attachment.role === 'publisher' && attachment.registered) {
      // No producer left: stale cached imagery is worth less than telling
      // viewers honestly that the stream is down (Problem 7B brief §11).
      this.#latestFrame = null;
      this.#broadcastStreamState(attachment.robotId);
    }
    // A viewer disconnecting affects nobody else: no broadcast needed, and
    // its inFlight/framesSkipped state disappears with its attachment.
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws, 1011, 'websocket error');
  }

  /**
   * Periodic liveness sweep covering TWO independent timeouts, both
   * durable across DO hibernation via the same alarm:
   *
   *   - a PENDING socket (publisher or viewer) that never completed
   *     registration within REGISTRATION_TIMEOUT_MS (Problem 7C §14)
   *   - a REGISTERED viewer whose `inFlight` frame has gone unacknowledged
   *     past ACK_TIMEOUT_MS (Problem 7B.1 §7)
   *
   * Neither case is buffered for or retried: both are evicted outright.
   */
  async alarm(): Promise<void> {
    let anySockets = false;
    const now = Date.now();

    for (const role of ['publisher', 'viewer'] as const) {
      for (const ws of this.#getSockets(role)) {
        anySockets = true;
        const attachment = readAttachment(ws);
        if (attachment === null) continue;

        if (!attachment.registered) {
          if (now - attachment.pendingSince < REGISTRATION_TIMEOUT_MS) continue;
          console.log(
            `[video-room] registration-timeout-evict role=${role} robot=${attachment.robotId}`,
          );
          this.#closeQuietly(ws, VIDEO_CLOSE_CODE.REGISTRATION_TIMEOUT, 'registration-timeout');
          continue;
        }

        if (role !== 'viewer' || attachment.inFlight === undefined) continue;
        if (now - attachment.inFlight.sentAt < ACK_TIMEOUT_MS) continue;
        console.log(`[video-room] ack-timeout-evict robot=${attachment.robotId}`);
        this.#closeQuietly(ws, VIDEO_CLOSE_CODE.ACK_TIMEOUT, 'ack-timeout');
      }
    }

    if (anySockets) await this.#state.storage.setAlarm(now + SWEEP_INTERVAL_MS);
  }

  /**
   * Validates the publisher's credential, then applies Problem 7C's
   * authenticated-takeover policy (§13): a validly authenticated new
   * publisher MAY replace an already-live one — the old one is demoted and
   * closed with PUBLISHER_REPLACED, the new one gets a fresh
   * streamSessionId, and viewers are told the stream changed. An INVALID
   * publisher can never evict the incumbent: only the new (invalid) socket
   * is closed, with the generic AUTH_FAILED code — the same
   * never-reveal-which-check-failed policy as the control relay's own
   * device/controller auth failures.
   *
   * Preferred over 7B's unconditional reject because the realistic failure
   * mode for a single physical camera is a REBOOT — the old socket often
   * doesn't close cleanly (power loss, watchdog reset), and requiring a
   * human to notice and manually clear a stale publisher slot would block
   * recovery for no security benefit: only a credential holder can ever
   * trigger a takeover in the first place.
   */
  async #handlePublisherRegister(
    ws: WebSocket,
    attachment: Attachment,
    message: { readonly robotId: string; readonly token: string },
  ): Promise<void> {
    if (message.robotId !== attachment.robotId) {
      this.#closeQuietly(ws, VIDEO_CLOSE_CODE.AUTH_FAILED, 'auth-failed');
      return;
    }
    const ok = await verifyCredential(message.token, this.#env.VIDEO_PUBLISHER_SECRET);
    if (!ok) {
      console.log(`[video-room] auth-failed role=publisher robot=${attachment.robotId}`);
      this.#send(ws, {
        v: VIDEO_PROTOCOL_VERSION,
        type: 'publisher.rejected',
        robotId: attachment.robotId,
        reason: 'auth-failed',
      });
      this.#closeQuietly(ws, VIDEO_CLOSE_CODE.AUTH_FAILED, 'auth-failed');
      return;
    }

    const others = this.#getSockets('publisher').filter((other) => other !== ws);
    const live = others.filter((other) => readAttachment(other)?.registered === true);
    for (const other of live) this.#demote(other);

    const streamSessionId = crypto.randomUUID();
    ws.serializeAttachment({
      ...attachment,
      registered: true,
      streamSessionId,
    } satisfies Attachment);
    // A brand new publisher session invalidates whatever was cached from a
    // previous one: a late-joining viewer must never be handed a frame
    // stamped with a session id it will never see confirmed.
    this.#latestFrame = null;
    this.#send(ws, {
      v: VIDEO_PROTOCOL_VERSION,
      type: 'publisher.accepted',
      robotId: attachment.robotId,
      streamSessionId,
    });
    this.#broadcastStreamState(attachment.robotId);

    for (const other of live) {
      this.#closeQuietly(
        other,
        VIDEO_CLOSE_CODE.PUBLISHER_REPLACED,
        'replaced-by-authenticated-publisher',
      );
    }
  }

  /**
   * Verifies the viewer's ticket (minted only by the control relay — see
   * @rovelink/protocol's video-ticket.ts) against `VIDEO_TICKET_SECRET`.
   * Only on success is the socket promoted to registered, and only THEN is
   * it told the current stream state and handed the cached latest frame if
   * one exists (consuming its first unit of credit, exactly like any other
   * frame delivery — see #trySendFrameToViewer) — an unauthenticated
   * viewer is never shown so much as a single cached frame (Problem 7C
   * brief §15).
   */
  async #handleViewerRegister(
    ws: WebSocket,
    attachment: Attachment,
    message: { readonly robotId: string; readonly ticket: string },
  ): Promise<void> {
    if (message.robotId !== attachment.robotId) {
      this.#closeQuietly(ws, VIDEO_CLOSE_CODE.AUTH_FAILED, 'auth-failed');
      return;
    }
    const result = await verifyVideoTicket(
      message.ticket,
      this.#env.VIDEO_TICKET_SECRET,
      { robotId: attachment.robotId, role: 'viewer' },
      Date.now(),
    );
    if (!result.ok) {
      console.log(
        `[video-room] auth-failed role=viewer robot=${attachment.robotId} reason=${result.reason}`,
      );
      const code =
        result.reason === 'expired'
          ? VIDEO_CLOSE_CODE.TICKET_EXPIRED
          : VIDEO_CLOSE_CODE.AUTH_FAILED;
      this.#closeQuietly(ws, code, result.reason === 'expired' ? 'ticket-expired' : 'auth-failed');
      return;
    }

    ws.serializeAttachment({ ...attachment, registered: true } satisfies Attachment);
    this.#send(ws, this.#currentStreamState(attachment.robotId));
    if (this.#latestFrame !== null) {
      this.#trySendFrameToViewer(ws, this.#latestFrame.header, this.#latestFrame.jpeg);
    }
  }

  /**
   * A `frame` header arrives as its own JSON text message, immediately
   * before the binary payload it describes (see protocol/src/video.ts).
   * Anything that doesn't parse as a valid `frame` header for THIS
   * publisher's own session is safely ignored — chosen over closing the
   * connection, per §16's "rejected or safely ignored": a stray malformed
   * message should not cost an already-authenticated publisher its whole
   * connection. An oversized declared length is the one case that DOES
   * close the connection, because forwarding it was never going to succeed
   * anyway and there is no reason to let the publisher keep trying.
   */
  #handleFrameHeader(ws: WebSocket, attachment: Attachment, message: VideoFrameHeader): void {
    if (message.streamSessionId !== attachment.streamSessionId) return;

    if (message.byteLength > MAX_JPEG_BYTES) {
      this.#closeQuietly(ws, VIDEO_CLOSE_CODE.OVERSIZED_FRAME, 'oversized-frame');
      return;
    }
    ws.serializeAttachment({ ...attachment, pendingHeader: message } satisfies Attachment);
  }

  /**
   * The binary payload completing a frame. A binary message with no
   * pending header, or whose length doesn't match what the header
   * declared, is a corrupt/out-of-protocol pair: dropped, connection left
   * open (same lenient policy as #handleFrameHeader).
   */
  #handleFrameBinary(ws: WebSocket, attachment: Attachment, data: ArrayBuffer): void {
    const pending = attachment.pendingHeader;
    // Always clear pendingHeader on this path: whether this binary matches
    // or not, it can never be paired with again.
    ws.serializeAttachment({ ...attachment, pendingHeader: undefined } satisfies Attachment);
    if (pending === undefined) return;
    if (data.byteLength !== pending.byteLength) return;
    if (!isJpeg(new Uint8Array(data))) return;

    this.#latestFrame = { header: pending, jpeg: data };
    this.#forwardFrameToViewers(pending, data);
  }

  /**
   * A viewer's proof it consumed the frame currently recorded as in-flight
   * for it (Problem 7B.1 §1/§5). Anything that doesn't exactly match —
   * wrong streamSessionId, wrong seq (older, newer, or simply not what was
   * actually sent), or no frame in flight at all (including a duplicate ack
   * arriving after the first one already released credit) — is ignored:
   * never allowed to release credit it didn't earn. A match releases
   * credit and, if a strictly newer frame already exists, hands it over
   * immediately — this is the "40 in flight, viewer acks 40, latest is
   * already 44, viewer gets 44 (not 41/42/43)" behavior from §3.
   */
  #handleViewerAck(
    ws: WebSocket,
    attachment: Attachment,
    message: { readonly streamSessionId: string; readonly seq: number },
  ): void {
    const inFlight = attachment.inFlight;
    if (inFlight === undefined || !isMatchingAck(message, inFlight)) return;

    ws.serializeAttachment({ ...attachment, inFlight: undefined } satisfies Attachment);

    const latest = this.#latestFrame;
    if (latest === null) return;
    const isWhatWasJustAcked =
      latest.header.streamSessionId === inFlight.streamSessionId &&
      latest.header.seq === inFlight.seq;
    // Nothing new since the frame just acked: leave this viewer WITH
    // credit (inFlight already cleared above) rather than resend the same
    // bytes — it will be sent the next genuinely new frame the instant one
    // arrives, via #forwardFrameToViewers.
    if (!isWhatWasJustAcked) this.#trySendFrameToViewer(ws, latest.header, latest.jpeg);
  }

  #currentStreamState(robotId: string): {
    v: 1;
    type: 'stream';
    robotId: string;
    publisherOnline: boolean;
    streamSessionId?: string;
  } {
    const publisher = this.#getRegisteredSockets('publisher')[0];
    const attachment = publisher ? readAttachment(publisher) : null;
    return {
      v: VIDEO_PROTOCOL_VERSION,
      type: 'stream',
      robotId,
      publisherOnline: attachment !== null,
      streamSessionId: attachment?.streamSessionId,
    };
  }

  #broadcastStreamState(robotId: string): void {
    const state = this.#currentStreamState(robotId);
    for (const viewer of this.#getRegisteredSockets('viewer')) this.#send(viewer, state);
  }

  /** No robotId parameter: every socket `getWebSockets('viewer')` returns
   * already belongs to THIS room, i.e. this one robotId — a DO instance is
   * already scoped to a single robot (see index.ts's idFromName routing). */
  #forwardFrameToViewers(header: VideoFrameHeader, jpeg: ArrayBuffer): void {
    for (const viewer of this.#getRegisteredSockets('viewer')) {
      this.#trySendFrameToViewer(viewer, header, jpeg);
    }
  }

  /**
   * The single chokepoint for "may this viewer be sent a frame right now."
   * A viewer with no `inFlight` frame has credit: it is sent this one and
   * marked in-flight. A viewer that already has one outstanding is
   * skipped — not queued — and its `framesSkipped` counter (Problem 7B.1
   * §14, expected/congestion behavior, not an error) is incremented
   * instead. This is the one place that enforces "at most one frame in
   * flight per viewer" at the application level, independent of whatever
   * the WebSocket transport underneath is doing with `ws.send()`. Not
   * reachable for an unregistered viewer: every call site either already
   * checked `registered` or is #handleViewerRegister itself, right after
   * promoting the socket.
   */
  #trySendFrameToViewer(ws: WebSocket, header: VideoFrameHeader, jpeg: ArrayBuffer): void {
    const attachment = readAttachment(ws);
    if (attachment === null || attachment.role !== 'viewer') return;

    if (attachment.inFlight !== undefined) {
      ws.serializeAttachment({
        ...attachment,
        framesSkipped: (attachment.framesSkipped ?? 0) + 1,
      } satisfies Attachment);
      return;
    }

    ws.serializeAttachment({
      ...attachment,
      inFlight: { streamSessionId: header.streamSessionId, seq: header.seq, sentAt: Date.now() },
    } satisfies Attachment);
    this.#sendFrame(ws, header, jpeg);
  }

  /** Header then binary, in that order, on one connection: WebSocket
   * delivers a single connection's messages in order, so the viewer can
   * always pair them positionally. Wrapped in try/catch: a viewer whose
   * socket is already closing has this throw — nothing to save or retry;
   * its `inFlight` credit (already marked by the caller) simply times out
   * via the ack-timeout sweep like any other unresponsive viewer. */
  #sendFrame(ws: WebSocket, header: VideoFrameHeader, jpeg: ArrayBuffer): void {
    try {
      ws.send(JSON.stringify(header));
      ws.send(jpeg);
    } catch {
      // Socket full or already closing: nothing to save or retry.
    }
  }

  #send(
    ws: WebSocket,
    message: { readonly v: 1; readonly type: string; readonly [key: string]: unknown },
  ): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Already closed/closing: nothing to do.
    }
  }

  #closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed/closing: nothing to do.
    }
  }

  /** Strips authority from a publisher socket without closing it: used to
   * make an authenticated takeover atomic (demote before close) so the old
   * socket stops being forwarded to or counted in presence the instant the
   * new one is promoted, regardless of when its close actually completes —
   * same pattern as the control relay's own #demote. */
  #demote(ws: WebSocket): void {
    const attachment = readAttachment(ws);
    if (attachment === null) return;
    ws.serializeAttachment({ ...attachment, registered: false } satisfies Attachment);
  }

  async #ensureSweepScheduled(): Promise<void> {
    const current = await this.#state.storage.getAlarm();
    if (current === null) await this.#state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  #getSockets(role: VideoRole): WebSocket[] {
    // Excludes a socket still mid-close: the Hibernation API's
    // getWebSockets() keeps it in the list for the duration of its OWN
    // webSocketClose/webSocketError handler (see WS_READY_STATE_OPEN),
    // so without this filter a publisher's own close handler would find
    // itself here and report the stream as still online.
    return this.#state.getWebSockets(role).filter((ws) => ws.readyState === WS_READY_STATE_OPEN);
  }

  #getRegisteredSockets(role: VideoRole): WebSocket[] {
    return this.#getSockets(role).filter((ws) => readAttachment(ws)?.registered === true);
  }
}
