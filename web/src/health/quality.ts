/**
 * Plain-language quality bands for Control RTT and RSSI (Problem 9 §6/§18).
 *
 * These are a *reading aid* for an operator who doesn't know networking —
 * never a replacement for the raw number, which the UI always shows
 * alongside this label — and never a claim of scientific/universal
 * accuracy. Thresholds are documented here, not hidden behind a color.
 */

export type SignalQuality = 'excellent' | 'good' | 'fair' | 'poor';

export const SIGNAL_QUALITY_LABEL: Readonly<Record<SignalQuality, string>> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
};

/**
 * Control RTT (command round trip, browser -> relay -> robot -> relay ->
 * browser) quality bands, in milliseconds. A live WiFi link measured
 * during Problem 8A's physical testing sat around 250ms, so "Good" is
 * generous enough to cover ordinary operation rather than flagging every
 * normal session as degraded.
 */
export function rttQuality(ms: number): SignalQuality {
  if (ms <= 80) return 'excellent';
  if (ms <= 200) return 'good';
  if (ms <= 400) return 'fair';
  return 'poor';
}

/**
 * WiFi RSSI quality bands, in dBm (closer to 0 is stronger). Follows the
 * commonly-used consumer WiFi ranges — not a guarantee for every radio or
 * environment, only a rough reading aid alongside the raw dBm value.
 */
export function rssiQuality(dbm: number): SignalQuality {
  if (dbm >= -60) return 'excellent';
  if (dbm >= -70) return 'good';
  if (dbm >= -80) return 'fair';
  return 'poor';
}
