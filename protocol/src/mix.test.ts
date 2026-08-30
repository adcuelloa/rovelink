import assert from 'node:assert/strict';
import test from 'node:test';

import { PWM_MAX, PWM_MIN, differentialMix, wheelPwm } from './mix.ts';

test('mix: straight distributes equally to both sides', () => {
  assert.deepEqual(differentialMix(1, 0), { left: 1, right: 1 });
  assert.deepEqual(differentialMix(-0.5, 0), { left: -0.5, right: -0.5 });
  assert.deepEqual(differentialMix(0, 0), { left: 0, right: 0 });
});

test('mix: spinning in place sends wheels in opposite directions', () => {
  assert.deepEqual(differentialMix(0, 1), { left: 1, right: -1 });
  assert.deepEqual(differentialMix(0, -1), { left: -1, right: 1 });
});

test('mix: accelerating and turning at the same time does not overflow', () => {
  assert.deepEqual(differentialMix(1, 0.5), { left: 1, right: 0.5 });
  assert.deepEqual(differentialMix(-1, -0.5), { left: -1, right: -0.5 });
});

test('mix: PWM starts at the minimum that moves the motor', () => {
  assert.equal(wheelPwm(0), 0);
  assert.equal(wheelPwm(0.01), 0);
  assert.equal(wheelPwm(1), PWM_MAX);
  assert.equal(wheelPwm(-1), PWM_MAX);
  assert.ok(wheelPwm(0.05) >= PWM_MIN);
});
