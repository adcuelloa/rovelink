import assert from 'node:assert/strict';
import test from 'node:test';

import { ALL_CONTROLS, ZERO_SEMANTIC_VALUES } from '../control/controls.ts';
import {
  CONTROLLER_DIAGRAM_SVG,
  isControlActive,
  stickCapOffset,
  triggerFillRect,
} from './controller-diagram.ts';
import { STICK_TRAVEL, TRIGGER_BOTTOM, TRIGGER_TOP } from './dualsense-paths.ts';

const close = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

test('every physical control has exactly one interactive region', () => {
  for (const control of ALL_CONTROLS) {
    const matches = CONTROLLER_DIAGRAM_SVG.split(`id="ctrl-${control}"`).length - 1;
    // Y axes share their X axis's stick outline (STICK_AXIS_PAIRS).
    const expected = control === 'LeftStickY' || control === 'RightStickY' ? 0 : 1;
    assert.equal(matches, expected, control);
  }
});

test('no manufacturer logo path is embedded', () => {
  // First coordinates of the logo path in the upstream source.
  assert.equal(CONTROLLER_DIAGRAM_SVG.includes('M525.1,538.049'), false);
});

test('stick cap: centred at rest, full travel at a cardinal', () => {
  assert.deepEqual(stickCapOffset(0, 0), { dx: 0, dy: 0 });
  const right = stickCapOffset(1, 0);
  assert.ok(close(right.dx, STICK_TRAVEL) && close(right.dy, 0));
  const half = stickCapOffset(0, -0.5);
  assert.ok(close(half.dy, -STICK_TRAVEL / 2));
});

test('stick cap: a square-gate diagonal is clamped to the travel circle', () => {
  const { dx, dy } = stickCapOffset(1, 1);
  assert.ok(close(Math.hypot(dx, dy), STICK_TRAVEL));
});

test('trigger fill rises from the base and clamps to 0..1', () => {
  assert.deepEqual(triggerFillRect(0), { y: TRIGGER_BOTTOM, height: 0 });
  const full = triggerFillRect(1);
  assert.ok(close(full.y, TRIGGER_TOP) && close(full.height, TRIGGER_BOTTOM - TRIGGER_TOP));
  assert.deepEqual(triggerFillRect(2), full);
  assert.deepEqual(triggerFillRect(-1), triggerFillRect(0));
});

test('active: buttons past the press threshold, sticks past the deadzone on either axis', () => {
  assert.equal(isControlActive(ZERO_SEMANTIC_VALUES, 'Cross'), false);
  assert.equal(isControlActive({ ...ZERO_SEMANTIC_VALUES, Cross: 1 }, 'Cross'), true);
  assert.equal(isControlActive({ ...ZERO_SEMANTIC_VALUES, R2: 0.3 }, 'R2'), false);
  assert.equal(isControlActive({ ...ZERO_SEMANTIC_VALUES, LeftStickX: 0.05 }, 'LeftStickX'), false);
  assert.equal(isControlActive({ ...ZERO_SEMANTIC_VALUES, LeftStickY: 0.5 }, 'LeftStickX'), true);
});
