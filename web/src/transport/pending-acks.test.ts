import assert from 'node:assert/strict';
import test from 'node:test';

import { PendingAckTracker } from './pending-acks.ts';

function tracker(maxAgeMs = 5000, maxSize = 64): PendingAckTracker<string> {
  return new PendingAckTracker<string>({ maxAgeMs, maxSize });
}

test('pending-acks: a recorded key resolves to the elapsed time', () => {
  const t = tracker();
  t.record('a', 1000);
  assert.equal(t.resolve('a', 1250), 250);
});

test('pending-acks: resolving removes the entry — a duplicate ack is ignored', () => {
  const t = tracker();
  t.record('a', 1000);
  assert.equal(t.resolve('a', 1100), 100);
  assert.equal(t.resolve('a', 1200), null);
});

test('pending-acks: an unknown key never resolves', () => {
  const t = tracker();
  assert.equal(t.resolve('missing', 1000), null);
});

test('pending-acks: a stale ack past maxAgeMs resolves to null, not a huge fabricated RTT', () => {
  const t = tracker(500);
  t.record('a', 1000);
  assert.equal(t.resolve('a', 1600), null);
});

test('pending-acks: recording sweeps entries already older than maxAgeMs', () => {
  const t = tracker(500, 64);
  t.record('old', 1000);
  t.record('new', 2000); // 1000ms later: 'old' is now well past its 500ms bound
  assert.equal(t.size, 1);
  assert.equal(t.resolve('old', 2000), null);
  assert.equal(t.resolve('new', 2100), 100);
});

test('pending-acks: never grows past maxSize — the oldest entry is evicted first', () => {
  const t = tracker(60_000, 3);
  t.record('a', 1000);
  t.record('b', 1001);
  t.record('c', 1002);
  t.record('d', 1003); // pushes size to 4 momentarily; 'a' must be evicted
  assert.equal(t.size, 3);
  assert.equal(t.resolve('a', 2000), null);
  assert.equal(t.resolve('d', 2000), 997);
});

test('pending-acks: clear() discards every in-flight entry (reconnect / session change)', () => {
  const t = tracker();
  t.record('a', 1000);
  t.record('b', 1001);
  t.clear();
  assert.equal(t.size, 0);
  assert.equal(t.resolve('a', 2000), null);
  assert.equal(t.resolve('b', 2000), null);
});

test('pending-acks: numeric keys work the same as string keys', () => {
  const t = new PendingAckTracker<number>({ maxAgeMs: 5000, maxSize: 8 });
  t.record(1700000000000, 1000);
  assert.equal(t.resolve(1700000000000, 1042), 42);
});
