/**
 * Video transport protocol (camera publisher <-> video relay <-> browser
 * viewer). Deliberately a SEPARATE wire protocol from `protocol.ts`
 * (control): a video connection never speaks `RemoteMessage`, and a control
 * connection never speaks `VideoMessage`. Problem 7A found that control and
 * video already run over independent WebSocket connections on the ESP32
 * side today (robot vs. camera are different boards); this keeps that
 * separation true in software too, so nothing here can leak into
 * `room.ts`'s forwarding logic.
 *
 * Wire shape per frame: one small JSON text message (`VideoFrameHeader`)
 * immediately followed, on the same connection, by one binary message
 * containing the raw JPEG bytes. Chosen over a packed binary header because
 * (a) it costs an ESP32 publisher nothing beyond what it already needs for
 * `esp_camera_fb_get()` — build a small JSON string, send it, send the
 * framebuffer — with no manual struct packing/endianness to get right, and
 * (b) WebSocket delivers messages on one connection in order, so header and
 * binary can never arrive interleaved with a DIFFERENT frame's header/binary
 * as long as sender and relay never reorder their own writes (they don't;
 * see room.ts).
 */

export const VIDEO_PROTOCOL_VERSION = 1;

/** Who each socket is inside a video room. Distinct from control's `Role`
 * ('controller' | 'device') on purpose: reusing those names would blur two
 * protocols that must stay independently readable. */
export type VideoRole = 'publisher' | 'viewer';

/**
 * Private application WebSocket close codes for the video relay, in a
 * distinct numeric range (4100s) from control's CLOSE_CODE (4000s, see
 * protocol.ts) purely so a mixed log/trace never has to guess which relay
 * emitted a given code.
 *
 * NUMERIC STABILITY: the three codes that already existed before Problem
 * 7C (PROTOCOL_VIOLATION, OVERSIZED_FRAME, ACK_TIMEOUT) keep their
 * original Problem 7B/7B.1 numbers — their meaning never changed, so there
 * is no reason to renumber them. New 7C concepts get freshly allocated
 * numbers (4105+) rather than reusing anything. 4101 was
 * `PUBLISHER_OCCUPIED` in 7B (a second publisher was unconditionally
 * rejected, no auth existing yet); 7C replaced that behavior entirely with
 * authenticated takeover (see PUBLISHER_REPLACED below and room.ts
 * #handlePublisherRegister), so the code is RETIRED, not reused — the room
 * never emits 4101 anymore, and 4101 is deliberately left unassigned
 * rather than given a new, different meaning that old logs/clients could
 * misread.
 *
 * Deliberately never reused between different failure kinds, and
 * deliberately generic where a more specific reason would leak useful
 * information to an attacker (Problem 7C brief §16): AUTH_FAILED covers
 * every publisher-token or viewer-ticket rejection EXCEPT expiry — wrong
 * secret, bad signature, tampered payload, wrong robot, wrong role, and
 * malformed input all collapse to the same code and the same generic close
 * reason string. TICKET_EXPIRED is split out on purpose: it is the one
 * case an ordinary, legitimate client hits often (a ticket that simply
 * aged past its short TTL) and the correct client behavior differs — ask
 * the control relay for a fresh ticket and retry — where every other
 * AUTH_FAILED case means something is actually wrong and retrying with the
 * same credential will only fail again.
 */
export const VIDEO_CLOSE_CODE = {
  // --- Established in Problem 7B/7B.1: numbers unchanged. ---
  /** A publisher sent a binary frame with no preceding header, a header
   * with no following binary, or a binary whose length did not match its
   * header's declared `byteLength`. */
  PROTOCOL_VIOLATION: 4102,
  /** A frame header declared a `byteLength` over MAX_JPEG_BYTES. Rejected
   * at the header, before the relay ever buffers the (possibly enormous)
   * binary that would follow. */
  OVERSIZED_FRAME: 4103,
  /** A viewer's in-flight frame (see ViewerAck) went unacknowledged past
   * ACK_TIMEOUT_MS (room.ts). Releases the room resources that viewer was
   * holding rather than letting it sit as a zombie forever. */
  ACK_TIMEOUT: 4104,

  // --- New in Problem 7C: freshly allocated numbers. ---
  /** A publisher's token, or a viewer's ticket, failed verification for any
   * reason other than the ticket having simply expired (see
   * TICKET_EXPIRED). Deliberately unspecific: never reveals which check
   * failed. */
  AUTH_FAILED: 4105,
  /** A viewer's ticket verified as well-formed and correctly signed but had
   * already passed its `expiresAt` — the one auth failure worth telling a
   * legitimate client apart from all others, since the correct response is
   * simply "ask for a new ticket and retry", not "something is wrong". */
  TICKET_EXPIRED: 4106,
  /** A pending (not-yet-registered) publisher or viewer socket did not
   * complete `publisher.register` / `viewer.register` within
   * REGISTRATION_TIMEOUT_MS (room.ts). */
  REGISTRATION_TIMEOUT: 4107,
  /** An authenticated publisher registered while a different, already
   * authenticated publisher was live for the same robot — Problem 7C's
   * authenticated takeover (see room.ts #handlePublisherRegister). Sent to
   * the OLD (displaced) publisher; the new one gets `publisher.accepted`
   * as normal. */
  PUBLISHER_REPLACED: 4108,
} as const;

/**
 * Upper bound on a single JPEG frame the relay will accept.
 *
 * The Problem 7A audit estimated ~15-30 KB/frame at VGA/quality-12 on the
 * professor's AI-Thinker ESP32-CAM. This is roughly 8x that ceiling: enough
 * headroom for a misconfigured resolution/quality during development
 * without silently accepting a runaway publisher. It is also comfortably
 * under the Workers WebSocket message limit (32 MiB as of the Cloudflare
 * 2025-10-31 changelog), so this bound is a deliberate application-level
 * choice, not something forced by the platform.
 */
export const MAX_JPEG_BYTES = 256 * 1024;

interface VideoEnvelope {
  readonly v: typeof VIDEO_PROTOCOL_VERSION;
}

/**
 * Publisher -> relay: the FIRST message a publisher socket may ever send
 * (Problem 7C brief §10/§11). A socket that has connected but not yet sent
 * a valid `publisher.register` is "pending" — not counted as the room's
 * publisher, and any `frame` header or binary it sends is ignored (see
 * room.ts). `token` is the static provisioned camera credential
 * (`VIDEO_PUBLISHER_SECRET`), verified the same constant-time way control's
 * `device.register` verifies `DEVICE_SECRET` (see @rovelink/protocol's
 * auth.ts).
 */
export interface PublisherRegister extends VideoEnvelope {
  readonly type: 'publisher.register';
  readonly robotId: string;
  readonly token: string;
}

/**
 * Viewer -> relay: the FIRST message a viewer socket may ever send (Problem
 * 7C brief §15). A pending (not yet registered) viewer receives no stream
 * state, no cached frame, and its `viewer.ack` is ignored — nothing about
 * the stream is ever handed to a socket that hasn't proven it holds a
 * valid, currently-live ticket. `ticket` is the short-lived signed token
 * minted by the CONTROL relay (see @rovelink/protocol's video-ticket.ts);
 * the video relay never issues these itself, only verifies them.
 */
export interface ViewerRegister extends VideoEnvelope {
  readonly type: 'viewer.register';
  readonly robotId: string;
  readonly ticket: string;
}

/** Relay -> publisher: sent the instant a publisher becomes authoritative
 * for `robotId`. `streamSessionId` is minted here, server-side — never
 * client-supplied — mirroring `ControlSession` in protocol.ts. */
export interface PublisherAccepted extends VideoEnvelope {
  readonly type: 'publisher.accepted';
  readonly robotId: string;
  readonly streamSessionId: string;
}

/** Relay -> publisher: sent instead of `publisher.accepted` when another
 * publisher is already live for `robotId`. The relay closes the socket with
 * `VIDEO_CLOSE_CODE.PUBLISHER_OCCUPIED` immediately after. */
export interface PublisherRejected extends VideoEnvelope {
  readonly type: 'publisher.rejected';
  readonly robotId: string;
  readonly reason: string;
}

/**
 * Publisher -> relay, immediately followed by one binary message carrying
 * exactly `byteLength` bytes of JPEG data. The relay never fragments or
 * reassembles frames: each JPEG is already a complete image from
 * `esp_camera_fb_get()`.
 */
export interface VideoFrameHeader extends VideoEnvelope {
  readonly type: 'frame';
  /** Echoes the id this publisher received in `publisher.accepted`. Lets a
   * viewer (or the relay) tell a frame from a fresh publisher connection
   * apart from a stale one — see isNewerSession in the viewer-side stats
   * helper, and REQUIRED-OUTPUT §8 in the Problem 7B brief. */
  readonly streamSessionId: string;
  /** Monotonically increasing within one streamSessionId, starting at 1. A
   * new streamSessionId may safely reuse seq=1: it is never confused with
   * an old session's seq=1 because the session id differs. */
  readonly seq: number;
  /** Publisher's own clock (`Date.now()` in the Node simulator; would be
   * `millis()`-derived on real firmware). NOT synchronized with the relay's
   * or a viewer's clock — see stats.ts: only meaningful as an
   * end-to-end-latency estimate when publisher and viewer share a clock
   * domain (e.g. same dev machine), which is true for 7B's simulator and
   * will NOT be true once a real ESP32 publishes over the Internet. */
  readonly capturedAtMs: number;
  readonly width: number;
  readonly height: number;
  /** Length, in bytes, of the binary message that follows. Validated by the
   * relay before it is used for anything: an oversized declared length is
   * rejected at the header (VIDEO_CLOSE_CODE.OVERSIZED_FRAME) without ever
   * waiting for or buffering the binary. */
  readonly byteLength: number;
}

/**
 * Viewer -> relay: explicit application-level flow control (Problem 7B.1
 * hardening). Cloudflare's Workers `WebSocket` exposes neither
 * `bufferedAmount` nor a send-completion callback (verified against
 * @cloudflare/workers-types — see room.ts), so the runtime's own internal
 * send buffer cannot be trusted as the backpressure mechanism: several
 * `ws.send()` calls can be accepted into that buffer before a slow socket
 * is ever closed, which is exactly the stale-frame pileup RoveLink's
 * low-latency driving requirement cannot tolerate. This message is how a
 * viewer proves it has actually consumed a frame (see room.ts's per-viewer
 * `inFlight` credit — at most one frame outstanding per viewer at the
 * APPLICATION level, independent of whatever the transport is doing
 * underneath). This is flow control, not reliable delivery: an old frame
 * is never retransmitted because it was never acked; only the newest one
 * ever is (see isMatchingAck / room.ts #handleViewerAck).
 */
export interface ViewerAck extends VideoEnvelope {
  readonly type: 'viewer.ack';
  readonly streamSessionId: string;
  readonly seq: number;
}

/** Relay -> viewer: published whenever publisher presence changes for
 * `robotId`, and once immediately on a viewer's own connect so it never has
 * to guess the current state. `streamSessionId` is present only while
 * `publisherOnline` is true. */
export interface StreamState extends VideoEnvelope {
  readonly type: 'stream';
  readonly robotId: string;
  readonly publisherOnline: boolean;
  readonly streamSessionId?: string;
}

export type VideoMessage =
  | PublisherRegister
  | ViewerRegister
  | PublisherAccepted
  | PublisherRejected
  | VideoFrameHeader
  | ViewerAck
  | StreamState;

export type VideoMessageType = VideoMessage['type'];

function isVideoEnvelope(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'v' in value &&
    value.v === VIDEO_PROTOCOL_VERSION &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

function isVideoFrameHeader(m: Record<string, unknown>): boolean {
  return (
    typeof m.streamSessionId === 'string' &&
    isFiniteNumber(m.seq) &&
    m.seq >= 0 &&
    isFiniteNumber(m.capturedAtMs) &&
    isFiniteNumber(m.width) &&
    m.width > 0 &&
    isFiniteNumber(m.height) &&
    m.height > 0 &&
    isFiniteNumber(m.byteLength) &&
    m.byteLength > 0
  );
}

/** Validates the shape of a decoded JSON video message. Does not validate
 * `byteLength` against MAX_JPEG_BYTES — that is a relay policy decision
 * (see room.ts), not a shape question. */
export function isVideoMessage(value: unknown): value is VideoMessage {
  if (!isVideoEnvelope(value)) return false;
  const m = value;

  switch (m.type) {
    case 'publisher.register':
      return typeof m.robotId === 'string' && typeof m.token === 'string';
    case 'viewer.register':
      return typeof m.robotId === 'string' && typeof m.ticket === 'string';
    case 'publisher.accepted':
      return typeof m.robotId === 'string' && typeof m.streamSessionId === 'string';
    case 'publisher.rejected':
      return typeof m.robotId === 'string' && typeof m.reason === 'string';
    case 'frame':
      return isVideoFrameHeader(m);
    case 'viewer.ack':
      return typeof m.streamSessionId === 'string' && isFiniteNumber(m.seq) && m.seq >= 0;
    case 'stream':
      return (
        typeof m.robotId === 'string' &&
        typeof m.publisherOnline === 'boolean' &&
        isOptionalString(m.streamSessionId)
      );
    default:
      return false;
  }
}

/**
 * True only when `ack` exactly matches the frame currently recorded as
 * in-flight for a viewer — not "newer or equal", exactly equal on both
 * fields. A viewer's ack is flow-control credit for ONE specific frame, not
 * a watermark: an ack for any other seq (higher, lower, or a different
 * streamSessionId — including one from a publisher that has since been
 * replaced) proves nothing about whether the CURRENT in-flight frame was
 * actually received, so it must be ignored rather than accepted (Problem
 * 7B.1 §5). Deliberately does not compare against "the current publisher
 * session": an ack for an old session's in-flight frame is still valid
 * credit-release for that viewer if it matches what that viewer was
 * actually holding (§6) — the relay decides what to send next from its own
 * current `latestFrame`, not from the session named in the ack.
 */
export function isMatchingAck(
  ack: Pick<ViewerAck, 'streamSessionId' | 'seq'>,
  inFlight: { readonly streamSessionId: string; readonly seq: number } | null,
): boolean {
  return (
    inFlight !== null &&
    ack.streamSessionId === inFlight.streamSessionId &&
    ack.seq === inFlight.seq
  );
}

/**
 * Cheap structural sanity check, not a decoder: a JPEG file/stream always
 * begins with the SOI marker (0xFFD8) and ends with the EOI marker
 * (0xFFD9). This catches garbage, truncated, or wrong-format payloads
 * (§16's "malformed/non-JPEG frame") without the cost of actually decoding
 * the image on every frame the relay forwards.
 */
export function isJpeg(bytes: Uint8Array | ArrayBuffer): boolean {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  return (
    view.length >= 4 &&
    view[0] === 0xff &&
    view[1] === 0xd8 &&
    view[view.length - 2] === 0xff &&
    view[view.length - 1] === 0xd9
  );
}
