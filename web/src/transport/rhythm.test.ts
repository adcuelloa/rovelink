import assert from 'node:assert/strict';
import test from 'node:test';

import type { ControlState } from '@rovelink/protocol';
import { CONTROL_TTL_MS, normalizeState } from '@rovelink/protocol';

import { DEFAULT_RHYTHM, decideSend } from './rhythm.ts';

const state = (partial: Partial<ControlState>): ControlState => normalizeState(partial);

test('rhythm: the first state always goes out', () => {
  assert.equal(decideSend(null, state({}), 0), 'immediate');
});

test('rhythm: braking does not wait for a turn', () => {
  const moving = state({ throttle: 1, armed: true });
  const still = state({ armed: true });
  assert.equal(decideSend(moving, still, 1), 'immediate');
});

test('rhythm: arming, disarming, and gripper do not wait either', () => {
  const base = state({ throttle: 0.5, armed: true });
  assert.equal(decideSend(base, { ...base, armed: false }, 1), 'immediate');
  assert.equal(decideSend(base, { ...base, gripper: 'close' }, 1), 'immediate');
});

test('rhythm: an axis change respects the max frequency', () => {
  const before = state({ throttle: 0.2, armed: true });
  const after = state({ throttle: 0.6, armed: true });
  const period = 1000 / DEFAULT_RHYTHM.hzMax;
  assert.equal(decideSend(before, after, period - 1), 'skip');
  assert.equal(decideSend(before, after, period), 'rate');
});

test('rhythm: standing still does not burn 60 packets per second, only the heartbeat', () => {
  const still = state({ armed: true });
  assert.equal(decideSend(still, still, 10), 'skip');
  assert.equal(decideSend(still, still, DEFAULT_RHYTHM.heartbeatMs), 'heartbeat');
});

test('rhythm: disarmed and still, the link does not send driving packets', () => {
  const stopped = state({});
  assert.equal(decideSend(stopped, stopped, 10_000), 'skip');
});

test('rhythm: the heartbeat leaves enough margin for the vehicle TTL to absorb jitter', () => {
  // A single missed/delayed heartbeat must not trip the watchdog: require at
  // least 2 heartbeat periods of slack before the frame would expire.
  assert.ok(DEFAULT_RHYTHM.heartbeatMs * 2 <= CONTROL_TTL_MS);
});
