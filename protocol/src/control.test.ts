import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SAFE_STATE,
  applyArmed,
  significantChange,
  isIdle,
  stoppedState,
  normalizeState,
  clampAxis,
} from './control.ts';

test('control: axes are always between -1 and 1', () => {
  assert.equal(clampAxis(2), 1);
  assert.equal(clampAxis(-7.5), -1);
  assert.equal(clampAxis(0.4), 0.4);
  assert.equal(clampAxis(Number.NaN), 0);
  // An infinite axis is broken data, not "full throttle": treated as 0.
  assert.equal(clampAxis(Number.POSITIVE_INFINITY), 0);
  assert.equal(Object.is(clampAxis(-0), 0), true);
});

test('control: normalize accepts unverified data', () => {
  assert.deepEqual(normalizeState({}), SAFE_STATE);
  assert.deepEqual(normalizeState({ throttle: 3, steering: -3, gripper: 'open', armed: true }), {
    throttle: 1,
    steering: -1,
    gripper: 'open',
    armed: true,
  });
  assert.equal(normalizeState({ gripper: 'zzz' }).gripper, 'idle');
  assert.equal(normalizeState({ throttle: 'fast' }).throttle, 0);
});

test('control: stopping preserves armed state, disarming stops', () => {
  const driving = normalizeState({ throttle: 1, steering: 0.5, armed: true });
  assert.deepEqual(stoppedState(driving), {
    throttle: 0,
    steering: 0,
    gripper: 'idle',
    armed: true,
  });
  assert.deepEqual(applyArmed({ ...driving, armed: false }), SAFE_STATE);
  assert.deepEqual(applyArmed(driving), driving);
});

test('control: stick noise does not count as a change', () => {
  const base = normalizeState({ throttle: 0.5, armed: true });
  assert.equal(significantChange(base, { ...base, throttle: 0.505 }), false);
  assert.equal(significantChange(base, { ...base, throttle: 0.6 }), true);
  assert.equal(significantChange(base, { ...base, armed: false }), true);
  assert.equal(significantChange(base, { ...base, gripper: 'close' }), true);
});

test('control: idle ignores armed state', () => {
  assert.equal(isIdle(SAFE_STATE), true);
  assert.equal(isIdle(normalizeState({ armed: true })), true);
  assert.equal(isIdle(normalizeState({ steering: 0.2 })), false);
});
