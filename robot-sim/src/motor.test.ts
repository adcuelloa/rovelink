import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SAFE_STATE } from '@rovelink/protocol';

import { wheelsFor } from './motor.ts';

test('disarmed always yields zero wheel power, regardless of stored throttle/steering', () => {
  assert.deepEqual(wheelsFor({ ...SAFE_STATE, throttle: 0.9, steering: 0.5, armed: false }), {
    left: 0,
    right: 0,
  });
});

test('armed straight throttle drives both wheels equally', () => {
  const wheels = wheelsFor({ throttle: 0.6, steering: 0, gripper: 'idle', armed: true });
  assert.equal(wheels.left, 0.6);
  assert.equal(wheels.right, 0.6);
});

test('armed steering differentiates the two wheels', () => {
  const wheels = wheelsFor({ throttle: 0.5, steering: -0.25, gripper: 'idle', armed: true });
  assert.equal(wheels.left, 0.25);
  assert.equal(wheels.right, 0.75);
});
