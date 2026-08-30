import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUTTONS_RELEASED,
  STANDARD_MAPPING,
  applyDeadzone,
  readGamepad,
  gripperFromButtons,
  newPresses,
} from './mapping.ts';

test('gamepad: deadzone rescales instead of jumping', () => {
  assert.equal(applyDeadzone(0.05, 0.12), 0);
  assert.equal(applyDeadzone(-0.12, 0.12), 0);
  assert.equal(applyDeadzone(1, 0.12), 1);
  assert.equal(applyDeadzone(-1, 0.12), -1);
  assert.ok(Math.abs(applyDeadzone(0.13, 0.12)) < 0.02);
  assert.equal(applyDeadzone(Number.NaN, 0.12), 0);
});

test('gamepad: vertical axis is inverted so up means forward', () => {
  const input = readGamepad({ axes: [0, -1], buttons: [] });
  assert.equal(input.throttle, 1);
  assert.equal(input.steering, 0);
});

test('gamepad: missing axes do not break the reading', () => {
  const input = readGamepad({ axes: [], buttons: [] });
  assert.equal(input.throttle, 0);
  assert.equal(input.steering, 0);
  assert.deepEqual(input.buttons, BUTTONS_RELEASED);
});

test('gamepad: buttons are read from the standard mapping', () => {
  const buttons: boolean[] = Array.from({ length: 16 }, () => false);
  buttons[STANDARD_MAPPING.buttons.stop] = true;
  const input = readGamepad({ axes: [0, 0], buttons });
  assert.equal(input.buttons.stop, true);
  assert.equal(input.buttons.arm, false);
});

test('gamepad: only transitions fire, not hold', () => {
  const released = BUTTONS_RELEASED;
  const pressed = { ...BUTTONS_RELEASED, arm: true };
  assert.deepEqual(newPresses(released, pressed), ['arm']);
  assert.deepEqual(newPresses(pressed, pressed), []);
  assert.deepEqual(newPresses(released, { ...BUTTONS_RELEASED, closeGripper: true }), []);
});

test('gamepad: close gripper wins over open gripper', () => {
  assert.equal(gripperFromButtons(BUTTONS_RELEASED), 'idle');
  assert.equal(gripperFromButtons({ ...BUTTONS_RELEASED, openGripper: true }), 'open');
  assert.equal(
    gripperFromButtons({ ...BUTTONS_RELEASED, openGripper: true, closeGripper: true }),
    'close',
  );
});
