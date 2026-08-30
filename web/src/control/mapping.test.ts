import assert from 'node:assert/strict';
import test from 'node:test';

import type { GamepadReading } from './mapping.ts';
import {
  BUTTONS_RELEASED,
  STANDARD_MAPPING,
  applyDeadzone,
  readGamepad,
  gripperFromButtons,
  newPresses,
  normalizeGamepadName,
} from './mapping.ts';

test('gamepad: deadzone rescales instead of jumping', () => {
  assert.equal(applyDeadzone(0.05, 0.12), 0);
  assert.equal(applyDeadzone(-0.12, 0.12), 0);
  assert.equal(applyDeadzone(1, 0.12), 1);
  assert.equal(applyDeadzone(-1, 0.12), -1);
  assert.ok(Math.abs(applyDeadzone(0.13, 0.12)) < 0.02);
  assert.equal(applyDeadzone(Number.NaN, 0.12), 0);
});

// Car-style throttle: R2 (forward) minus L2 (reverse), each normalized 0..1.
// See STANDARD_MAPPING.throttleTriggers for the actual button indices.
const { forward: R2, reverse: L2 } = STANDARD_MAPPING.throttleTriggers;

function triggerReading(r2: number, l2: number): GamepadReading {
  const buttonValues: number[] = [];
  buttonValues[R2] = r2;
  buttonValues[L2] = l2;
  return { axes: [0, 0], buttons: [], buttonValues };
}

test('gamepad: R2=1, L2=0 means throttle=+1', () => {
  assert.equal(readGamepad(triggerReading(1, 0)).throttle, 1);
});

test('gamepad: R2=0, L2=1 means throttle=-1', () => {
  assert.equal(readGamepad(triggerReading(0, 1)).throttle, -1);
});

test('gamepad: R2=0.5, L2=0 means throttle≈+0.5', () => {
  assert.equal(readGamepad(triggerReading(0.5, 0)).throttle, 0.5);
});

test('gamepad: R2=0, L2=0.5 means throttle≈-0.5', () => {
  assert.equal(readGamepad(triggerReading(0, 0.5)).throttle, -0.5);
});

test('gamepad: R2 and L2 equally pressed means throttle≈0', () => {
  assert.equal(readGamepad(triggerReading(0.7, 0.7)).throttle, 0);
  assert.equal(readGamepad(triggerReading(0, 0)).throttle, 0);
});

test('gamepad: throttle clamps to -1..1 even with out-of-range trigger values', () => {
  assert.equal(readGamepad(triggerReading(1.5, 0)).throttle, 1);
  assert.equal(readGamepad(triggerReading(0, 1.5)).throttle, -1);
  assert.equal(readGamepad(triggerReading(-0.3, 0)).throttle, 0);
});

test('gamepad: left stick means steering -1', () => {
  const input = readGamepad({ axes: [-1, 0], buttons: [] });
  assert.equal(input.steering, -1);
});

test('gamepad: right stick means steering +1', () => {
  const input = readGamepad({ axes: [1, 0], buttons: [] });
  assert.equal(input.steering, 1);
});

test('gamepad: centered stick and neutral triggers mean 0', () => {
  const input = readGamepad({ axes: [0, 0], buttons: [] });
  assert.equal(input.throttle, 0);
  assert.equal(input.steering, 0);
});

test('gamepad: steering never exceeds the -1..1 clamp', () => {
  const input = readGamepad({ axes: [1, -1], buttons: [] });
  assert.ok(input.steering <= 1 && input.steering >= -1);
});

test('gamepad: missing axes/buttonValues do not break the reading', () => {
  const input = readGamepad({ axes: [], buttons: [] });
  assert.equal(input.throttle, 0);
  assert.equal(input.steering, 0);
  assert.deepEqual(input.buttons, BUTTONS_RELEASED);
});

test('gamepad: mapped buttons are read from the standard mapping', () => {
  const buttons: boolean[] = Array.from({ length: 16 }, () => false);
  buttons[STANDARD_MAPPING.buttons.arm] = true;
  const input = readGamepad({ axes: [0, 0], buttons });
  assert.equal(input.buttons.arm, true);
  assert.equal(input.buttons.disarm, false);
});

test('gamepad: E-stop is a chord — neither trigger alone fires it', () => {
  const [chordA, chordB] = STANDARD_MAPPING.stopChord;
  const onlyA: boolean[] = Array.from({ length: 16 }, () => false);
  onlyA[chordA] = true;
  assert.equal(readGamepad({ axes: [0, 0], buttons: onlyA }).buttons.stop, false);

  const onlyB: boolean[] = Array.from({ length: 16 }, () => false);
  onlyB[chordB] = true;
  assert.equal(readGamepad({ axes: [0, 0], buttons: onlyB }).buttons.stop, false);

  const both: boolean[] = Array.from({ length: 16 }, () => false);
  both[chordA] = true;
  both[chordB] = true;
  assert.equal(readGamepad({ axes: [0, 0], buttons: both }).buttons.stop, true);
});

test('gamepad: E-stop chord fires once on entry, not every held frame', () => {
  const [chordA, chordB] = STANDARD_MAPPING.stopChord;
  const both: boolean[] = Array.from({ length: 16 }, () => false);
  both[chordA] = true;
  both[chordB] = true;
  const first = readGamepad({ axes: [0, 0], buttons: both }).buttons;
  const second = readGamepad({ axes: [0, 0], buttons: both }).buttons;
  assert.deepEqual(newPresses(BUTTONS_RELEASED, first), ['stop']);
  assert.deepEqual(newPresses(first, second), []);
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
