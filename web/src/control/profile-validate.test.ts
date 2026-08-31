import assert from 'node:assert/strict';
import test from 'node:test';

import { isProfileValid, validateProfile } from './profile-validate.ts';
import type { ControllerProfile } from './profile.ts';
import { RACING_PROFILE, STICK_PROFILE } from './profile.ts';

test('validate: the built-in Racing and Stick presets are valid', () => {
  assert.deepEqual(validateProfile(RACING_PROFILE), []);
  assert.deepEqual(validateProfile(STICK_PROFILE), []);
  assert.equal(isProfileValid(RACING_PROFILE), true);
  assert.equal(isProfileValid(STICK_PROFILE), true);
});

test('validate: Square bound to both gripper actions is a duplicate-action conflict', () => {
  const profile: ControllerProfile = {
    ...RACING_PROFILE,
    gripperOpen: 'Square',
    gripperClose: 'Square',
  };
  const issues = validateProfile(profile);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.kind, 'duplicate-digital-action');
  assert.equal(isProfileValid(profile), false);
});

test('validate: Options bound to both Arm and Disarm is a conflict', () => {
  const profile: ControllerProfile = { ...RACING_PROFILE, arm: 'Options', disarm: 'Options' };
  const issues = validateProfile(profile);
  assert.equal(
    issues.some((i) => i.kind === 'duplicate-digital-action' && i.control === 'Options'),
    true,
  );
});

test('validate: an Emergency Stop chord with the same control twice is invalid', () => {
  const profile: ControllerProfile = { ...RACING_PROFILE, emergencyStop: { a: 'L3', b: 'L3' } };
  const issues = validateProfile(profile);
  assert.equal(
    issues.some((i) => i.kind === 'estop-chord-same-control'),
    true,
  );
  assert.equal(isProfileValid(profile), false);
});

test('validate: an Emergency Stop control cannot also be Arm', () => {
  const profile: ControllerProfile = {
    ...RACING_PROFILE,
    emergencyStop: { a: 'Options', b: 'R3' },
  };
  const issues = validateProfile(profile);
  assert.equal(
    issues.some(
      (i) =>
        i.kind === 'estop-safety-conflict' &&
        i.control === 'Options' &&
        i.conflictingAction === 'arm',
    ),
    true,
  );
});

test('validate: an Emergency Stop control cannot also be a gripper action', () => {
  const profile: ControllerProfile = { ...RACING_PROFILE, emergencyStop: { a: 'L1', b: 'R3' } };
  const issues = validateProfile(profile);
  assert.equal(
    issues.some((i) => i.kind === 'estop-safety-conflict' && i.control === 'L1'),
    true,
  );
});

test('validate: an Emergency Stop control cannot also be a split-throttle forward/reverse control', () => {
  // Racing's own throttle triggers (R2/L2) reassigned as the chord.
  const profile: ControllerProfile = { ...RACING_PROFILE, emergencyStop: { a: 'R2', b: 'L2' } };
  const issues = validateProfile(profile);
  assert.equal(
    issues.some(
      (i) =>
        i.kind === 'estop-safety-conflict' &&
        (i.conflictingAction === 'throttleForward' || i.conflictingAction === 'throttleReverse'),
    ),
    true,
  );
});

test('validate: an unrelated remap (Square -> gripper open) alone stays valid', () => {
  const profile: ControllerProfile = { ...RACING_PROFILE, gripperOpen: 'Square' };
  assert.deepEqual(validateProfile(profile), []);
});
