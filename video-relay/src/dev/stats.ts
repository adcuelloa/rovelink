/**
 * Viewer-side transport statistics (Problem 7B brief §12).
 *
 * Pure bookkeeping: takes explicit `arrivedAtMs`/`nowMs` from the caller
 * instead of reading a hidden clock, so it is deterministically testable
 * and so a caller can plug in a fake clock in tests versus `Date.now()` in
 * a real viewer. `capturedAtMs` (the publisher's own clock) is only ever
 * compared against `arrivedAtMs` from the SAME caller's clock domain — real
 * during 7B's same-machine dev testing, meaningless once a real ESP32 on a
 * different clock publishes over the Internet. Never pretend otherwise: see
 * VideoFrameHeader.capturedAtMs in protocol/src/video.ts.
 */

export interface FrameArrival {
  readonly streamSessionId: string;
  readonly seq: number;
  readonly capturedAtMs: number;
  readonly byteLength: number;
  readonly arrivedAtMs: number;
}

export interface VideoViewerStatsSnapshot {
  readonly framesReceived: number;
  readonly framesDropped: number;
  readonly duplicateFrames: number;
  readonly outOfOrderFrames: number;
  readonly bytesReceived: number;
  readonly lastSeq: number | null;
  readonly lastStreamSessionId: string | null;
  readonly lastFrameAtMs: number | null;
  /** `arrivedAtMs - capturedAtMs` of the most recent frame. See the
   * clock-domain caveat in the module doc comment above. */
  readonly lastLatencyMs: number | null;
  /** Frames observed within the trailing `windowMs` ending at the `nowMs`
   * passed to `snapshot()`. */
  readonly fps: number;
  readonly reconnectCount: number;
}

export class VideoViewerStats {
  readonly #windowMs: number;
  #arrivals: number[] = [];

  #framesReceived = 0;
  #framesDropped = 0;
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

  recordFrame(arrival: FrameArrival): void {
    this.#framesReceived += 1;
    this.#bytesReceived += arrival.byteLength;
    this.#lastFrameAtMs = arrival.arrivedAtMs;
    this.#lastLatencyMs = arrival.arrivedAtMs - arrival.capturedAtMs;
    this.#arrivals.push(arrival.arrivedAtMs);

    const sameSession = arrival.streamSessionId === this.#lastStreamSessionId;
    this.#lastStreamSessionId = arrival.streamSessionId;

    if (!sameSession || this.#lastSeq === null) {
      // A new (or first) publisher session: seq restarts, and that restart
      // is never mistaken for a gap in the OLD session (see VideoFrameHeader
      // in protocol/src/video.ts and the Problem 7B brief §8).
      this.#lastSeq = arrival.seq;
      return;
    }

    if (arrival.seq === this.#lastSeq) {
      this.#duplicateFrames += 1;
    } else if (arrival.seq > this.#lastSeq) {
      this.#framesDropped += Math.max(0, arrival.seq - this.#lastSeq - 1);
      this.#lastSeq = arrival.seq;
    } else {
      // A late straggler behind the newest seq already seen: counted, but
      // never allowed to roll lastSeq backward — "latest wins" applies to
      // our notion of freshness too, not just to what we render.
      this.#outOfOrderFrames += 1;
    }
  }

  recordReconnect(): void {
    this.#reconnectCount += 1;
  }

  /** `null` before any frame has ever arrived: there is nothing to age. */
  frameAgeMs(nowMs: number): number | null {
    return this.#lastFrameAtMs === null ? null : nowMs - this.#lastFrameAtMs;
  }

  snapshot(nowMs: number): VideoViewerStatsSnapshot {
    const windowStart = nowMs - this.#windowMs;
    this.#arrivals = this.#arrivals.filter((t) => t >= windowStart && t <= nowMs);
    const fps = this.#arrivals.length / (this.#windowMs / 1000);

    return {
      framesReceived: this.#framesReceived,
      framesDropped: this.#framesDropped,
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
