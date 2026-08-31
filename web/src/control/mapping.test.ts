import assert from 'node:assert/strict';
import test from 'node:test';

import { BUTTONS_RELEASED, applyDeadzone, gripperFromButtons, newPresses, normalizeGamepadName } from './mapping.ts';

test('gamepad: deadzone rescales instead of jumping', () => {
  assert.equal(applyDeadzone(0.05, 0.12), 0);
  assert.equal(applyDeadzone(-0.12, 0.12), 0);
  assert.equal(applyDeadzone(1, 0.12), 1);
  assert.equal(applyDeadzone(-1, 0.12), -1);
  assert.ok(Math.abs(applyDeadzone(0.13, 0.12)) < 0.02);
  assert.equal(applyDeadzone(Number.NaN, 0.12), 0);
});

test('gamepad: only transitions fire, not hold', () => {
  const released = BUTTONS_RELEASED;
  const pressed = { ...BUTTONS_RELEASED, arm: true };
  assert.deepEqual(newPresses(released, pressed), ['arm']);
  assert.deepEqual(newPresses(pressed, pressed), []);
  assert.deepEqual(newPresses(released, { ...BUTTONS_RELEASED, closeGripper: true }), []);
});

test('gamepad: gripper open', () => {
  assert.equal(gripperFromButtons({ ...BUTTONS_RELEASED, openGripper: true }), 'open');
});

test('gamepad: gripper close', () => {
  assert.equal(gripperFromButtons({ ...BUTTONS_RELEASED, closeGripper: true }), 'close');
});

test('gamepad: neither button held is idle', () => {
  assert.equal(gripperFromButtons(BUTTONS_RELEASED), 'idle');
});

test('gamepad: both gripper buttons held at once is idle, not a preference', () => {
  assert.equal(
    gripperFromButtons({ ...BUTTONS_RELEASED, openGripper: true, closeGripper: true }),
    'idle',
  );
});

test('gamepad: name normalization strips the vendor/product suffix', () => {
  assert.equal(
    normalizeGamepadName(
      'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
    ),
    'DualSense Wireless Controller',
  );
  assert.equal(normalizeGamepadName('  Xbox Wireless Controller  '), 'Xbox Wireless Controller');
});

test('gamepad: name normalization keeps "DualSense" for the real physical id observed on Linux/Chrome', () => {
  // Measured live from an actual DualSense over USB (see Problem 5's
  // physical verification): Chrome prefixes the manufacturer name, which a
  // naive 32-char cap truncated right before the one word that identifies
  // the controller at all.
  const real =
    'Sony Interactive Entertainment DualSense Wireless Controller ' +
    '(STANDARD GAMEPAD Vendor: 054c Product: 0ce6)';
  const normalized = normalizeGamepadName(real);
  assert.ok(normalized.includes('DualSense'), `expected "DualSense" in ${normalized}`);
});

test('gamepad: name normalization caps very long ids', () => {
  const long = 'A'.repeat(80);
  const normalized = normalizeGamepadName(long);
  assert.ok(normalized.length <= 44);
  assert.ok(normalized.endsWith('…'));
});

test('gamepad: name normalization handles an empty id', () => {
  assert.equal(normalizeGamepadName(''), 'Controller');
});
