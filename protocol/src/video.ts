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

/** Private application WebSocket close codes for the video relay, in a
 * distinct numeric range (4100s) from control's CLOSE_CODE (4000s, see
 * protocol.ts) purely so a mixed log/trace never has to guess which relay
 * emitted a given code. */
export const VIDEO_CLOSE_CODE = {
  /** A second publisher tried to register while one was already live. 7B
   * has no authentication, so this is unconditional: see room.ts. */
  PUBLISHER_OCCUPIED: 4101,
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
