import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeDeviceHealth,
  formatLastSeen,
  UI_UNRESPONSIVE_THRESHOLD_MS,
} from './device-health.ts';

test('device-health: offline is authoritative regardless of local activity', () => {
  assert.equal(computeDeviceHealth(false, 0, 0), 'offline');
  assert.equal(computeDeviceHealth(false, 1000, 1000), 'offline');
  assert.equal(computeDeviceHealth(false, null, 1000), 'offline');
});

test('device-health: recent activity while relay-present is online', () => {
  const now = 10_000;
  assert.equal(computeDeviceHealth(true, now, now), 'online');
  assert.equal(computeDeviceHealth(true, now - UI_UNRESPONSIVE_THRESHOLD_MS, now), 'online');
});

test('device-health: stale local activity while relay-present is unresponsive', () => {
  const now = 10_000;
  assert.equal(
    computeDeviceHealth(true, now - UI_UNRESPONSIVE_THRESHOLD_MS - 1, now),
    'unresponsive',
  );
  assert.equal(computeDeviceHealth(true, now - 60_000, now), 'unresponsive');
});

test('device-health: relay-present with no activity ever observed is unresponsive, not online', () => {
  // A fresh connection/reconnect before the first telemetry has arrived
  // must never read as "Online" purely because the relay says registered.
  assert.equal(computeDeviceHealth(true, null, 10_000), 'unresponsive');
});

test('device-health: a custom threshold is honored', () => {
  const now = 10_000;
  assert.equal(computeDeviceHealth(true, now - 500, now, 400), 'unresponsive');
  assert.equal(computeDeviceHealth(true, now - 300, now, 400), 'online');
});

test('last-seen: null activity renders as an em dash, never a fabricated zero', () => {
  assert.equal(formatLastSeen(null, 10_000), '—');
});

test('last-seen: formats elapsed seconds to one decimal place', () => {
  assert.equal(formatLastSeen(9700, 10_000), '0.3 s');
  assert.equal(formatLastSeen(5000, 10_000), '5.0 s');
});

test('last-seen: never goes negative for a slightly-in-the-future timestamp (clock skew)', () => {
  assert.equal(formatLastSeen(10_050, 10_000), '0.0 s');
});
