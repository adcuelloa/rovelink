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
 *   - A viewer that never acks is not left as a zombie: an alarm-driven
 *     sweep (ACK_TIMEOUT_MS) evicts it, the same durable-across-hibernation
 *     mechanism the control relay uses for its own staleness sweep (see
 *     `@rovelink/relay`'s room.ts STALE_MS/alarm()).
 *
 * The runtime's own auto-close-on-full-buffer behavior still exists as a
 * transport-level backstop, but it is no longer load-bearing for
 * correctness: the ack/credit protocol is what actually guarantees "at
 * most one frame in flight per viewer," independent of whatever the
 * WebSocket implementation does underneath.
 *
 * STORAGE — frames are ephemeral by design (Problem 7B brief §13): nothing
 * in this file ever calls `this.#state.storage.put/sql.exec`. `#latestFrame`
 * and every viewer's `inFlight`/`framesSkipped` live only in
 * `serializeAttachment`-backed socket attachments and a plain class
 * property — bounded (one frame per room, one in-flight id per viewer), and
 * `#latestFrame` does NOT survive hibernation (a newly-woken room simply
 * has no cached frame until the next one arrives, which is fine: stale
 * imagery is worth less than a moment's wait for a fresh one). Attachments
 * DO survive hibernation, which is why `inFlight`/`framesSkipped` live
 * there rather than in a class property — an ack arriving after the room
 * hibernated and woke back up must still be checked against the same
 * credit state it was issued against.
 */

import type { VideoFrameHeader, VideoRole } from '@rovelink/protocol';
import {
  isJpeg,
  isMatchingAck,
  isVideoMessage,
  MAX_JPEG_BYTES,
  VIDEO_CLOSE_CODE,
  VIDEO_PROTOCOL_VERSION,
} from '@rovelink/protocol';

import { parseVideoRoute } from './route.ts';

/** How long a viewer's `inFlight` frame may go unacknowledged before the
 * room gives up on it (Problem 7B.1 §7). Deliberately a few seconds, not
 * milliseconds: a viewer's browser tab backgrounded for a moment, or a dev
 * CLI momentarily busy, should not be evicted for an ordinary hiccup — only
 * a genuinely stalled/gone viewer. Chosen to be well above any real frame
 * interval (100ms at 10 fps) so it only fires for a viewer that has truly
 * stopped acknowledging, not one that is merely a bit slow. */
const ACK_TIMEOUT_MS = 5000;

/** How often the alarm re-checks for a timed-out in-flight frame while any
 * socket is attached. Mirrors the control relay's SWEEP_INTERVAL_MS
 * pattern (`@rovelink/relay`'s room.ts). */
const SWEEP_INTERVAL_MS = 2000;

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
  /** Publisher: true once accepted as the room's authoritative publisher
   * (see #handlePublisherConnect). Viewer: always true immediately — 7B has
   * no viewer auth/capacity limit to gate on. */
  readonly registered: boolean;
  /** Publisher only, set once at accept time; never client-supplied. */
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

  /** The single most recent complete frame for this room, or none. Class
   * property, not storage: see the module doc comment above. */
  #latestFrame: CachedFrame | null = null;

  constructor(state: DurableObjectState) {
    this.#state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const route = parseVideoRoute(new URL(request.url).pathname);
    if (route === null) return new Response('unknown route', { status: 404 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.#state.acceptWebSocket(server, [route.role]);

    if (route.role === 'publisher') {
      this.#handlePublisherConnect(server, route.robotId);
    } else {
      this.#handleViewerConnect(server, route.robotId);
    }

    // The alarm is how an unacknowledged in-flight frame gets noticed even
    // if the viewer never sends anything else again — see alarm() below.
    // setAlarm() is a no-op if one is already scheduled at or before this
    // time, so this stays cheap.
    await this.#ensureSweepScheduled();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const attachment = readAttachment(ws);
    if (attachment === null || !attachment.registered) return;

    if (attachment.role === 'viewer') {
      // A viewer never sends binary frame data in 7B: only a text
      // `viewer.ack` is meaningful from this side.
      if (typeof data === 'string') this.#handleViewerAck(ws, attachment, data);
      return;
    }

    if (typeof data === 'string') {
      this.#handleFrameHeader(ws, attachment, data);
      return;
    }
    this.#handleFrameBinary(ws, attachment, data);
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
   * Periodic liveness sweep for the ack/credit protocol (Problem 7B.1 §7):
   * a viewer whose `inFlight` frame has gone unacknowledged past
   * ACK_TIMEOUT_MS is evicted outright — never buffered for, never given a
   * second frame while the first is still outstanding. Mirrors the control
   * relay's alarm-based sweep (`@rovelink/relay`'s room.ts): using a durable
   * alarm rather than an in-memory timer is what makes this survive
   * hibernation between checks.
   */
  async alarm(): Promise<void> {
    let anySockets = false;
    for (const ws of this.#getSockets('viewer')) {
      anySockets = true;
      const attachment = readAttachment(ws);
      if (attachment?.inFlight === undefined) continue;
      if (Date.now() - attachment.inFlight.sentAt < ACK_TIMEOUT_MS) continue;
      console.log(`[video-room] ack-timeout-evict robot=${attachment.robotId}`);
      this.#closeQuietly(ws, VIDEO_CLOSE_CODE.ACK_TIMEOUT, 'ack-timeout');
    }
    for (const ws of this.#getSockets('publisher')) {
      // A connected publisher alone should keep the sweep alive too, so a
      // viewer that joins later is still covered without a gap.
      void ws;
      anySockets = true;
    }
    if (anySockets) await this.#state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  /**
   * Occupancy is decided synchronously, right here, against sockets already
   * registered for this robotId — not deferred to a later "register"
   * message, unlike the control relay's device/controller flow. 7B has no
   * credential to wait for (see Problem 7B brief §19), so there is nothing
   * to gain by delaying the decision, and conservative-reject is the
   * explicitly requested behavior (§9): a second live publisher never
   * displaces the first.
   */
  #handlePublisherConnect(ws: WebSocket, robotId: string): void {
    const others = this.#getSockets('publisher').filter((other) => other !== ws);
    const live = others.filter((other) => readAttachment(other)?.registered === true);

    if (live.length > 0) {
      ws.serializeAttachment({
        robotId,
        role: 'publisher',
        registered: false,
      } satisfies Attachment);
      this.#send(ws, {
        v: VIDEO_PROTOCOL_VERSION,
        type: 'publisher.rejected',
        robotId,
        reason: 'publisher-occupied',
      });
      this.#closeQuietly(ws, VIDEO_CLOSE_CODE.PUBLISHER_OCCUPIED, 'publisher-occupied');
      return;
    }

    const streamSessionId = crypto.randomUUID();
    ws.serializeAttachment({
      robotId,
      role: 'publisher',
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
      robotId,
      streamSessionId,
    });
    this.#broadcastStreamState(robotId);
  }

  /** A viewer is always accepted in 7B (no auth, no capacity limit yet —
   * see brief §10/§19): it is told the current state immediately, plus
   * whatever frame is cached (consuming its first unit of credit, exactly
   * like any other frame delivery — see #trySendFrameToViewer), so it never
   * has to guess or wait a full frame interval for its first image. */
  #handleViewerConnect(ws: WebSocket, robotId: string): void {
    ws.serializeAttachment({ robotId, role: 'viewer', registered: true } satisfies Attachment);
    this.#send(ws, this.#currentStreamState(robotId));
    if (this.#latestFrame !== null) {
      this.#trySendFrameToViewer(ws, this.#latestFrame.header, this.#latestFrame.jpeg);
    }
  }

  /**
   * A `frame` header arrives as its own JSON text message, immediately
   * before the binary payload it describes (see protocol/src/video.ts).
   * Anything that doesn't parse as a valid `frame` header for THIS
   * publisher's own session is safely ignored — chosen over closing the
   * connection, per §16's "rejected or safely ignored", because 7B is
   * explicitly unauthenticated transport prototyping, not a hardened
   * boundary: a stray malformed message should not cost the publisher its
   * whole connection. An oversized declared length is the one case that
   * DOES close the connection, because forwarding it was never going to
   * succeed anyway and there is no reason to let the publisher keep trying.
   */
  #handleFrameHeader(ws: WebSocket, attachment: Attachment, data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!isVideoMessage(parsed) || parsed.type !== 'frame') return;
    if (parsed.streamSessionId !== attachment.streamSessionId) return;

    if (parsed.byteLength > MAX_JPEG_BYTES) {
      this.#closeQuietly(ws, VIDEO_CLOSE_CODE.OVERSIZED_FRAME, 'oversized-frame');
      return;
    }
    ws.serializeAttachment({ ...attachment, pendingHeader: parsed } satisfies Attachment);
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
  #handleViewerAck(ws: WebSocket, attachment: Attachment, data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!isVideoMessage(parsed) || parsed.type !== 'viewer.ack') return;

    const inFlight = attachment.inFlight;
    if (inFlight === undefined || !isMatchingAck(parsed, inFlight)) return;

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
   * the WebSocket transport underneath is doing with `ws.send()`.
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

  async #ensureSweepScheduled(): Promise<void> {
    const current = await this.#state.storage.getAlarm();
    if (current === null) await this.#state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  #getSockets(role: VideoRole): WebSocket[] {
    return this.#state.getWebSockets(role);
  }

  #getRegisteredSockets(role: VideoRole): WebSocket[] {
    return this.#getSockets(role).filter((ws) => readAttachment(ws)?.registered === true);
  }
}
