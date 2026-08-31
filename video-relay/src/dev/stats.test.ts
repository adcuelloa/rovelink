import assert from 'node:assert/strict';
import test from 'node:test';

import { VideoViewerStats } from './stats.ts';

function frame(overrides: Partial<Parameters<VideoViewerStats['recordFrame']>[0]> = {}) {
  return {
    streamSessionId: 's1',
    seq: 1,
    capturedAtMs: 0,
    byteLength: 20_000,
    arrivedAtMs: 0,
    ...overrides,
  };
}

test('stats: counts frames and bytes as they are recorded', () => {
  const stats = new VideoViewerStats();
  stats.recordFrame(frame({ seq: 1, arrivedAtMs: 0 }));
  stats.recordFrame(frame({ seq: 2, arrivedAtMs: 100, byteLength: 15_000 }));
  const snap = stats.snapshot(100);
  assert.equal(snap.framesReceived, 2);
  assert.equal(snap.bytesReceived, 35_000);
  assert.equal(snap.lastSeq, 2);
});

test('stats: a seq gap within the same session counts as dropped frames', () => {
  const stats = new VideoViewerStats();
  stats.recordFrame(frame({ seq: 1, arrivedAtMs: 0 }));
  stats.recordFrame(frame({ seq: 5, arrivedAtMs: 100 })); // 2,3,4 never arrived
  assert.equal(stats.snapshot(100).framesDropped, 3);
});

test('stats: a repeated seq in the same session counts as a duplicate, not a drop', () => {
  const stats = new VideoViewerStats();
  stats.recordFrame(frame({ seq: 1, arrivedAtMs: 0 }));
  stats.recordFrame(frame({ seq: 1, arrivedAtMs: 50 }));
  const snap = stats.snapshot(50);
  assert.equal(snap.duplicateFrames, 1);
  assert.equal(snap.framesDropped, 0);
});

test('stats: a lower seq in the same session counts as out-of-order and never rewinds lastSeq', () => {
  const stats = new VideoViewerStats();
  stats.recordFrame(frame({ seq: 5, arrivedAtMs: 0 }));
  stats.recordFrame(frame({ seq: 3, arrivedAtMs: 50 })); // late straggler
  const snap = stats.snapshot(50);
  assert.equal(snap.outOfOrderFrames, 1);
  assert.equal(snap.lastSeq, 5, 'a late straggler must not roll lastSeq backward');
});

test('stats: a new streamSessionId resets seq tracking without counting as a drop', () => {
  const stats = new VideoViewerStats();
  stats.recordFrame(frame({ streamSessionId: 's1', seq: 40, arrivedAtMs: 0 }));
  stats.recordFrame(frame({ streamSessionId: 's2', seq: 1, arrivedAtMs: 100 })); // publisher rebooted
  const snap = stats.snapshot(100);
  assert.equal(snap.framesDropped, 0, 'a session change is not a gap in the old session');
  assert.equal(snap.lastSeq, 1);
  assert.equal(snap.lastStreamSessionId, 's2');
});

test('stats: latency is arrival clock minus the publisher-stamped capture time', () => {
  const stats = new VideoViewerStats();
  stats.recordFrame(frame({ capturedAtMs: 1000, arrivedAtMs: 1080 }));
  assert.equal(stats.snapshot(1080).lastLatencyMs, 80);
});

test('stats: frame age is measured against an explicit "now", never a hidden real clock', () => {
  const stats = new VideoViewerStats();
  stats.recordFrame(frame({ arrivedAtMs: 1000 }));
  assert.equal(stats.frameAgeMs(1000), 0);
  assert.equal(stats.frameAgeMs(1750), 750);
});

test('stats: fps counts only frames inside the rolling window ending at "now"', () => {
  const stats = new VideoViewerStats(1000); // 1s window
  stats.recordFrame(frame({ seq: 1, arrivedAtMs: 0 }));
  stats.recordFrame(frame({ seq: 2, arrivedAtMs: 200 }));
  stats.recordFrame(frame({ seq: 3, arrivedAtMs: 400 }));
  // 3 frames land inside [now-1000, now] at now=400: fps = 3 frames / 1s window
  assert.equal(stats.snapshot(400).fps, 3);
  // by now=1500 the window is [500,1500]: t=0,200,400 have all aged out,
  // leaving only the new arrival at t=1500 itself
  stats.recordFrame(frame({ seq: 4, arrivedAtMs: 1500 }));
  assert.equal(stats.snapshot(1500).fps, 1);
});

test('stats: reconnects are tracked but never counted as frame activity', () => {
  const stats = new VideoViewerStats();
  stats.recordReconnect();
  stats.recordReconnect();
  const snap = stats.snapshot(0);
  assert.equal(snap.reconnectCount, 2);
  assert.equal(snap.framesReceived, 0);
});

test('stats: an empty tracker reports null/zero rather than throwing', () => {
  const stats = new VideoViewerStats();
  const snap = stats.snapshot(0);
  assert.equal(snap.framesReceived, 0);
  assert.equal(snap.lastSeq, null);
  assert.equal(snap.lastStreamSessionId, null);
  assert.equal(snap.lastFrameAtMs, null);
  assert.equal(snap.lastLatencyMs, null);
  assert.equal(snap.fps, 0);
  assert.equal(stats.frameAgeMs(0), null);
});
