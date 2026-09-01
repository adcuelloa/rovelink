/**
 * Frontend device-freshness model (Problem 8A).
 *
 * The relay's own authoritative presence (`deviceOnline` in `room`) only
 * flips false once the device has been silent past `STALE_MS.device`
 * (6000ms, `relay/src/room.ts`) — a deliberately generous bound so the
 * relay never falsely evicts a device over ordinary network jitter. That
 * leaves a gap: the relay can still consider a device "registered" for
 * several seconds after it has gone physically silent (power loss, radio
 * drop). This module distinguishes that gap from genuine responsiveness by
 * tracking real device-originated activity locally, entirely client-side —
 * it never sends a network message just to support this.
 *
 * Pure and dependency-free by design: no DOM, no transport, no clock of
 * its own — the caller supplies `now` and `lastActivityAt` explicitly.
 */

export type DeviceHealth = 'online' | 'unresponsive' | 'offline';

/**
 * How stale the last real device-originated evidence may get, while the
 * relay still reports the device present, before the operator sees
 * "Unresponsive" instead of "Online".
 *
 * Healthy telemetry arrives roughly every 300ms (`TELEMETRY_MS` in
 * `firmware/rovelink_device/rovelink_device.ino`); physical testing during
 * Problem 8A measured a live control/relay RTT around 250ms even over a
 * real WiFi link. 1500ms is ~5x that healthy cadence — comfortably above
 * ordinary jitter or a single dropped telemetry frame, while staying far
 * below the relay's own authoritative `STALE_MS.device` (6000ms), so the
 * operator sees a responsiveness warning several seconds before the relay
 * itself would ever declare the device offline.
 */
export const UI_UNRESPONSIVE_THRESHOLD_MS = 1500;

/**
 * `deviceOnline` is the relay's own authoritative presence (`room`
 * broadcast); `lastActivityAt`/`now` must both be the same clock
 * (`performance.now()` throughout this app — never mix with `Date.now()`).
 *
 * - `offline`: the relay has declared the device absent. Authoritative;
 *   nothing local can override it.
 * - `unresponsive`: the relay still considers the device registered, but
 *   local evidence of real device activity is older than the threshold (or
 *   there has never been any activity yet on this connection).
 * - `online`: recent real device-originated activity.
 */
export function computeDeviceHealth(
  deviceOnline: boolean,
  lastActivityAt: number | null,
  now: number,
  unresponsiveThresholdMs: number = UI_UNRESPONSIVE_THRESHOLD_MS,
): DeviceHealth {
  if (!deviceOnline) return 'offline';
  if (lastActivityAt === null) return 'unresponsive';
  return now - lastActivityAt <= unresponsiveThresholdMs ? 'online' : 'unresponsive';
}

/**
 * "Last seen" display text. `null` before any device-originated activity
 * has ever been observed on this connection — rendered as "—", never a
 * fabricated "0.0 s".
 */
export function formatLastSeen(lastActivityAt: number | null, now: number): string {
  if (lastActivityAt === null) return '—';
  const ms = Math.max(0, now - lastActivityAt);
  return `${(ms / 1000).toFixed(1)} s`;
}
