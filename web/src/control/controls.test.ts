import assert from 'node:assert/strict';
import test from 'node:test';

import type { GamepadReading } from './mapping.ts';
import { ALL_CONTROLS, isAxisControl, isButtonControl, readSemantic, ZERO_SEMANTIC_VALUES } from './controls.ts';

function reading(overrides: Partial<GamepadReading> = {}): GamepadReading {
  return {
    axes: [0, 0, 0, 0],
    buttons: Array.from<boolean>({ length: 17 }).fill(false),
    buttonValues: Array.from<number>({ length: 17 }).fill(0),
    ...overrides,
  };
}

test('controls: readSemantic reads every axis by its standard index', () => {
  const values = readSemantic(reading({ axes: [0.5, -0.5, 0.25, -0.25] }));
  assert.equal(values.LeftStickX, 0.5);
  assert.equal(values.LeftStickY, -0.5);
  assert.equal(values.RightStickX, 0.25);
  assert.equal(values.RightStickY, -0.25);
});

test('controls: readSemantic reads a trigger analog value, not just pressed', () => {
  const buttonValues = Array.from<number>({ length: 17 }).fill(0);
  buttonValues[7] = 0.42; // R2
  const values = readSemantic(reading({ buttonValues }));
  assert.equal(values.R2, 0.42);
});

test('controls: readSemantic falls back to 1/0 from pressed when buttonValues is absent', () => {
  const buttons = Array.from<boolean>({ length: 17 }).fill(false);
  buttons[4] = true; // L1
  const values = readSemantic({ axes: [0, 0, 0, 0], buttons });
  assert.equal(values.L1, 1);
  assert.equal(values.R1, 0);
});

test('controls: readSemantic tolerates a short/missing axes or buttons array', () => {
  const values = readSemantic({ axes: [], buttons: [] });
  for (const control of ALL_CONTROLS) assert.equal(values[control], 0, control);
});

test('controls: isAxisControl/isButtonControl are disjoint and cover ALL_CONTROLS', () => {
  for (const control of ALL_CONTROLS) {
    assert.notEqual(isAxisControl(control), isButtonControl(control), control);
  }
  assert.equal(isAxisControl('LeftStickX'), true);
  assert.equal(isButtonControl('LeftStickX'), false);
  assert.equal(isButtonControl('Options'), true);
  assert.equal(isAxisControl('Options'), false);
});

test('controls: isAxisControl/isButtonControl reject non-strings and unknown names', () => {
  assert.equal(isAxisControl(42), false);
  assert.equal(isAxisControl(null), false);
  assert.equal(isAxisControl('NotAControl'), false);
  assert.equal(isButtonControl(undefined), false);
});

test('controls: ZERO_SEMANTIC_VALUES has every control at exactly 0', () => {
  for (const control of ALL_CONTROLS) assert.equal(ZERO_SEMANTIC_VALUES[control], 0, control);
});
