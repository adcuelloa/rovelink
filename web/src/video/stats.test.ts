import assert from 'node:assert/strict';
import test from 'node:test';

import { VideoStats } from './stats.ts';

function arrival(overrides: Partial<Parameters<VideoStats['recordReceived']>[0]> = {}) {
  return {
    streamSessionId: 's1',
    seq: 1,
    capturedAtMs: 0,
    byteLength: 20_000,
    arrivedAtMs: 0,
    ...overrides,
  };
}

test('counts received frames and bytes', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ seq: 1, arrivedAtMs: 0 }));
  stats.recordReceived(arrival({ seq: 2, arrivedAtMs: 100, byteLength: 15_000 }));
  const snap = stats.snapshot(100);
  assert.equal(snap.framesReceived, 2);
  assert.equal(snap.bytesReceived, 35_000);
  assert.equal(snap.lastSeq, 2);
});

test('a seq gap within the same session counts as missing frames', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ seq: 1, arrivedAtMs: 0 }));
  stats.recordReceived(arrival({ seq: 5, arrivedAtMs: 100 }));
  assert.equal(stats.snapshot(100).framesMissing, 3);
});

test('a new streamSessionId resets seq tracking without counting as missing', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ streamSessionId: 's1', seq: 40, arrivedAtMs: 0 }));
  stats.recordReceived(arrival({ streamSessionId: 's2', seq: 1, arrivedAtMs: 100 }));
  const snap = stats.snapshot(100);
  assert.equal(snap.framesMissing, 0, 'a session change is not a gap in the old session');
  assert.equal(snap.lastSeq, 1);
  assert.equal(snap.lastStreamSessionId, 's2');
});

test('rendered frames are tracked separately from received frames', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ seq: 1, arrivedAtMs: 0 }));
  stats.recordRendered(10);
  const snap = stats.snapshot(10);
  assert.equal(snap.framesReceived, 1);
  assert.equal(snap.framesRendered, 1);
  assert.equal(snap.framesFailedDecode, 0);
});

test('a decode failure is tracked without counting as rendered', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ seq: 1, arrivedAtMs: 0 }));
  stats.recordDecodeFailure();
  const snap = stats.snapshot(0);
  assert.equal(snap.framesFailedDecode, 1);
  assert.equal(snap.framesRendered, 0);
});

test('latency is the arrival clock minus the publisher-stamped capture time', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ capturedAtMs: 1000, arrivedAtMs: 1080 }));
  assert.equal(stats.snapshot(1080).lastLatencyMs, 80);
});

test('frame age is measured against an explicit "now", never a hidden clock', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ arrivedAtMs: 1000 }));
  assert.equal(stats.frameAgeMs(1000), 0);
  assert.equal(stats.frameAgeMs(1750), 750);
  assert.equal(new VideoStats().frameAgeMs(1000), null);
});

test('rendered fps counts only renders inside the rolling window ending at "now"', () => {
  const stats = new VideoStats(1000);
  stats.recordRendered(0);
  stats.recordRendered(200);
  stats.recordRendered(400);
  assert.equal(stats.snapshot(400).fps, 3);
  stats.recordRendered(1500);
  assert.equal(stats.snapshot(1500).fps, 1);
});

test('reconnects are tracked but never counted as frame activity', () => {
  const stats = new VideoStats();
  stats.recordReconnect();
  stats.recordReconnect();
  const snap = stats.snapshot(0);
  assert.equal(snap.reconnectCount, 2);
  assert.equal(snap.framesReceived, 0);
});

test('an empty tracker reports null/zero rather than throwing', () => {
  const stats = new VideoStats();
  const snap = stats.snapshot(0);
  assert.equal(snap.framesReceived, 0);
  assert.equal(snap.framesRendered, 0);
  assert.equal(snap.framesFailedDecode, 0);
  assert.equal(snap.framesMissing, 0);
  assert.equal(snap.lastSeq, null);
  assert.equal(snap.lastStreamSessionId, null);
  assert.equal(snap.lastLatencyMs, null);
  assert.equal(snap.fps, 0);
});

test('reset() clears seq/session tracking for a fresh streamSessionId, keeping cumulative counters', () => {
  const stats = new VideoStats();
  stats.recordReceived(arrival({ streamSessionId: 's1', seq: 40, arrivedAtMs: 0 }));
  stats.reset();
  stats.recordReceived(arrival({ streamSessionId: 's2', seq: 1, arrivedAtMs: 100 }));
  const snap = stats.snapshot(100);
  assert.equal(snap.framesMissing, 0);
  assert.equal(snap.framesReceived, 2, 'reset does not zero cumulative received count');
});
