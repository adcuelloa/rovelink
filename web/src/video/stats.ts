/**
 * Browser video viewer transport/render statistics (Problem 7D §14).
 *
 * Pure bookkeeping, no DOM/timers: `arrivedAtMs`/`atMs`/`nowMs` are always
 * caller-supplied, never read from a hidden clock, so this is
 * deterministically testable. `capturedAtMs` (the publisher's own clock) is
 * only ever meaningfully comparable against `arrivedAtMs` from the SAME
 * clock domain — real during same-machine dev testing, not a claim of true
 * Internet latency once a real ESP32-CAM on a different clock publishes
 * over the Internet (see @rovelink/protocol's VideoFrameHeader doc and the
 * Problem 7A/7B audits this carries forward). Callers must label
 * `lastLatencyMs` as "publisher timestamp / approximate age" in the UI,
 * never as a precise, synchronized latency figure.
 */

export interface FrameArrival {
  readonly streamSessionId: string;
  readonly seq: number;
  readonly capturedAtMs: number;
  readonly byteLength: number;
  readonly arrivedAtMs: number;
}

export interface VideoStatsSnapshot {
  readonly framesReceived: number;
  readonly framesRendered: number;
  readonly framesFailedDecode: number;
  /** Frames that never arrived at all — a seq gap within one
   * streamSessionId. Distinct from `framesFailedDecode` (arrived, but the
   * browser couldn't decode/paint it). */
  readonly framesMissing: number;
  readonly duplicateFrames: number;
  readonly outOfOrderFrames: number;
  readonly bytesReceived: number;
  readonly lastSeq: number | null;
  readonly lastStreamSessionId: string | null;
  readonly lastFrameAtMs: number | null;
  readonly lastLatencyMs: number | null;
  /** Rendered frames observed within the trailing `windowMs` ending at the
   * `nowMs` passed to `snapshot()` — this is RENDERED fps, not received
   * fps: a decode failure or a frame the relay never sent both show up
   * here as a dip, which is the honest "what did the operator actually
   * see" number. */
  readonly fps: number;
  readonly reconnectCount: number;
}

export class VideoStats {
  readonly #windowMs: number;
  #renderTimestamps: number[] = [];

  #framesReceived = 0;
  #framesRendered = 0;
  #framesFailedDecode = 0;
  #framesMissing = 0;
  #duplicateFrames = 0;
  #outOfOrderFrames = 0;
  #bytesReceived = 0;
  #lastSeq: number | null = null;
  #lastStreamSessionId: string | null = null;
  #lastFrameAtMs: number | null = null;
  #lastLatencyMs: number | null = null;
  #reconnectCount = 0;

  constructor(windowMs = 2000) {
    this.#windowMs = windowMs;
  }

  recordReceived(arrival: FrameArrival): void {
    this.#framesReceived += 1;
    this.#bytesReceived += arrival.byteLength;
    this.#lastFrameAtMs = arrival.arrivedAtMs;
    this.#lastLatencyMs = arrival.arrivedAtMs - arrival.capturedAtMs;

    const sameSession = arrival.streamSessionId === this.#lastStreamSessionId;
    this.#lastStreamSessionId = arrival.streamSessionId;

    if (!sameSession || this.#lastSeq === null) {
      // A new (or first) publisher session: seq restarts, and that restart
      // is never mistaken for a gap in the OLD session (Problem 7D §19).
      this.#lastSeq = arrival.seq;
      return;
    }

    if (arrival.seq === this.#lastSeq) {
      this.#duplicateFrames += 1;
    } else if (arrival.seq > this.#lastSeq) {
      this.#framesMissing += Math.max(0, arrival.seq - this.#lastSeq - 1);
      this.#lastSeq = arrival.seq;
    } else {
      this.#outOfOrderFrames += 1;
    }
  }

  recordRendered(atMs: number): void {
    this.#framesRendered += 1;
    this.#renderTimestamps.push(atMs);
  }

  recordDecodeFailure(): void {
    this.#framesFailedDecode += 1;
  }

  recordReconnect(): void {
    this.#reconnectCount += 1;
  }

  /** Clears seq/session tracking (and the rolling fps window) without
   * zeroing cumulative counters — called on a known reconnect so the UI
   * reflects "no current session" immediately rather than stale numbers
   * from before the disconnect (Problem 7D §19). */
  reset(): void {
    this.#lastSeq = null;
    this.#lastStreamSessionId = null;
    this.#renderTimestamps = [];
  }

  frameAgeMs(nowMs: number): number | null {
    return this.#lastFrameAtMs === null ? null : nowMs - this.#lastFrameAtMs;
  }

  snapshot(nowMs: number): VideoStatsSnapshot {
    const windowStart = nowMs - this.#windowMs;
    this.#renderTimestamps = this.#renderTimestamps.filter((t) => t >= windowStart && t <= nowMs);
    const fps = this.#renderTimestamps.length / (this.#windowMs / 1000);

    return {
      framesReceived: this.#framesReceived,
      framesRendered: this.#framesRendered,
      framesFailedDecode: this.#framesFailedDecode,
      framesMissing: this.#framesMissing,
      duplicateFrames: this.#duplicateFrames,
      outOfOrderFrames: this.#outOfOrderFrames,
      bytesReceived: this.#bytesReceived,
      lastSeq: this.#lastSeq,
      lastStreamSessionId: this.#lastStreamSessionId,
      lastFrameAtMs: this.#lastFrameAtMs,
      lastLatencyMs: this.#lastLatencyMs,
      fps,
      reconnectCount: this.#reconnectCount,
    };
  }
}
