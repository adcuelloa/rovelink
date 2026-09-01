/**
 * Bounded request/response correlation tracker (Problem 8A).
 *
 * Records a `performance.now()` timestamp keyed by an arbitrary key (a
 * control frame's seq+session, an emergency-stop's `sentAt`, ...) and
 * resolves it back to an elapsed time once the matching reply arrives.
 * Used for Control RTT and E-stop RTT — never for Relay RTT, which needs no
 * correlation beyond the relay's own ping `id` (see websocket.ts).
 *
 * Bounded on both axes so a lost reply, a dropped connection, or a flood of
 * sends can never grow this without limit: entries older than `maxAgeMs`
 * are swept on every `record()` call, and the oldest entry is evicted
 * outright if `record()` would exceed `maxSize`. Pure and dependency-free:
 * the caller supplies `now` explicitly, so it is trivially testable with a
 * fake clock and carries no timer of its own.
 */
export class PendingAckTracker<K> {
  readonly #maxAgeMs: number;
  readonly #maxSize: number;
  readonly #pending = new Map<K, number>();

  constructor(options: { readonly maxAgeMs: number; readonly maxSize: number }) {
    this.#maxAgeMs = options.maxAgeMs;
    this.#maxSize = options.maxSize;
  }

  get size(): number {
    return this.#pending.size;
  }

  record(key: K, now: number): void {
    for (const [pendingKey, sentAt] of this.#pending) {
      if (now - sentAt > this.#maxAgeMs) this.#pending.delete(pendingKey);
    }
    if (this.#pending.size >= this.#maxSize) {
      // Map iteration order is insertion order: the first key is the oldest.
      const oldestKey = this.#pending.keys().next().value;
      if (oldestKey !== undefined) this.#pending.delete(oldestKey);
    }
    this.#pending.set(key, now);
  }

  /**
   * Resolves and removes the entry for `key`, returning the elapsed time
   * since it was recorded — or `null` for an unknown, already-resolved
   * (duplicate ack), or expired (stale ack) key. A `null` result must never
   * be treated as a zero-latency sample.
   */
  resolve(key: K, now: number): number | null {
    const sentAt = this.#pending.get(key);
    if (sentAt === undefined) return null;
    this.#pending.delete(key);
    if (now - sentAt > this.#maxAgeMs) return null;
    return now - sentAt;
  }

  /** Discards all in-flight entries: used on reconnect and on session
   * change, where nothing still pending can ever legitimately resolve. */
  clear(): void {
    this.#pending.clear();
  }
}
