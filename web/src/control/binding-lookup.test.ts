import assert from 'node:assert/strict';
import test from 'node:test';

import { actionForControl } from './binding-lookup.ts';
import { RACING_PROFILE, STICK_PROFILE } from './profile.ts';

test('actionForControl: racing profile split-throttle maps both controls to throttle', () => {
  assert.equal(actionForControl(RACING_PROFILE, 'R2'), 'throttle');
  assert.equal(actionForControl(RACING_PROFILE, 'L2'), 'throttle');
});

test('actionForControl: stick profile axis-throttle maps the axis to throttle', () => {
  assert.equal(actionForControl(STICK_PROFILE, 'LeftStickY'), 'throttle');
  // Steering shares the left stick's X axis on Stick, but its own Y axis
  // is throttle-only — never double-counted as steering too.
  assert.equal(actionForControl(STICK_PROFILE, 'LeftStickX'), 'steering');
});

test('actionForControl: buttons resolve to their single action', () => {
  assert.equal(actionForControl(RACING_PROFILE, 'L1'), 'gripperOpen');
  assert.equal(actionForControl(RACING_PROFILE, 'R1'), 'gripperClose');
  assert.equal(actionForControl(RACING_PROFILE, 'Options'), 'arm');
  assert.equal(actionForControl(RACING_PROFILE, 'Create'), 'disarm');
});

test('actionForControl: both emergency-stop chord controls resolve to emergencyStop', () => {
  assert.equal(actionForControl(RACING_PROFILE, 'L3'), 'emergencyStop');
  assert.equal(actionForControl(RACING_PROFILE, 'R3'), 'emergencyStop');
});

test('actionForControl: an unbound control resolves to null', () => {
  assert.equal(actionForControl(RACING_PROFILE, 'Triangle'), null);
  assert.equal(actionForControl(RACING_PROFILE, 'DPadUp'), null);
  assert.equal(actionForControl(RACING_PROFILE, 'RightStickY'), null);
});
