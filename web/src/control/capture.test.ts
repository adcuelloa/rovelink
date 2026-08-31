import assert from 'node:assert/strict';
import test from 'node:test';

import { ZERO_SEMANTIC_VALUES } from './controls.ts';
import type { SemanticValues } from './controls.ts';
import { detectActivation } from './capture.ts';

function values(overrides: Partial<SemanticValues>): SemanticValues {
  return { ...ZERO_SEMANTIC_VALUES, ...overrides };
}

test('capture: a fresh button press is detected', () => {
  const control = detectActivation(values({}), values({ Square: 1 }));
  assert.equal(control, 'Square');
});

test('capture: a held button (no transition) is not re-detected', () => {
  const held = values({ Square: 1 });
  assert.equal(detectActivation(held, held), null);
});

test('capture: a released button is not detected as an activation', () => {
  const control = detectActivation(values({ Square: 1 }), values({}));
  assert.equal(control, null);
});

test('capture: a small trigger nudge below the digital press threshold is not detected', () => {
  const control = detectActivation(values({}), values({ R2: 0.3 }));
  assert.equal(control, null);
});

test('capture: a trigger squeezed past the press threshold is detected', () => {
  const control = detectActivation(values({}), values({ R2: 0.7 }));
  assert.equal(control, 'R2');
});

test('capture: a light stick nudge below the capture threshold is not detected', () => {
  const control = detectActivation(values({}), values({ LeftStickX: 0.2 }));
  assert.equal(control, null, 'a light touch must not accidentally bind the stick');
});

test('capture: a hard stick push past the capture threshold is detected', () => {
  const control = detectActivation(values({}), values({ LeftStickX: 0.9 }));
  assert.equal(control, 'LeftStickX');
});

test('capture: a hard push in the negative direction is also detected', () => {
  const control = detectActivation(values({}), values({ RightStickY: -0.9 }));
  assert.equal(control, 'RightStickY');
});

test('capture: idle stick drift within the driving deadzone never triggers capture', () => {
  const control = detectActivation(values({}), values({ LeftStickX: 0.05 }));
  assert.equal(control, null);
});

test('capture: nothing active in either reading yields null', () => {
  assert.equal(detectActivation(values({}), values({})), null);
});
