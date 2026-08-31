import assert from 'node:assert/strict';
import test from 'node:test';

import type { SemanticValues } from './controls.ts';
import { ZERO_SEMANTIC_VALUES } from './controls.ts';
import { gripperFromButtons } from './mapping.ts';
import type { ControllerProfile } from './profile.ts';
import { evaluateProfile, RACING_PROFILE, STICK_PROFILE, toCustom } from './profile.ts';

function values(overrides: Partial<Record<keyof SemanticValues, number>>): SemanticValues {
  return { ...ZERO_SEMANTIC_VALUES, ...overrides };
}

// --- Racing preset ----------------------------------------------------------

test('profile: Racing — R2 alone produces positive throttle', () => {
  const input = evaluateProfile(values({ R2: 1 }), RACING_PROFILE);
  assert.equal(input.throttle, 1);
});

test('profile: Racing — L2 alone produces negative throttle', () => {
  const input = evaluateProfile(values({ L2: 1 }), RACING_PROFILE);
  assert.equal(input.throttle, -1);
});

test('profile: Racing — R2/L2 equally pressed produces zero throttle', () => {
  const input = evaluateProfile(values({ R2: 0.7, L2: 0.7 }), RACING_PROFILE);
  assert.equal(input.throttle, 0);
});

test('profile: Racing — LeftStickX drives steering', () => {
  const input = evaluateProfile(values({ LeftStickX: 1 }), RACING_PROFILE);
  assert.equal(input.steering, 1);
  const left = evaluateProfile(values({ LeftStickX: -1 }), RACING_PROFILE);
  assert.equal(left.steering, -1);
});

// --- Stick preset ------------------------------------------------------------

test('profile: Stick — LeftStickY forward produces positive throttle', () => {
  // Gamepad API: up is -1 on the Y axis.
  const input = evaluateProfile(values({ LeftStickY: -1 }), STICK_PROFILE);
  assert.equal(input.throttle, 1);
});

test('profile: Stick — LeftStickY backward produces negative throttle', () => {
  const input = evaluateProfile(values({ LeftStickY: 1 }), STICK_PROFILE);
  assert.equal(input.throttle, -1);
});

test('profile: Stick — LeftStickX drives steering', () => {
  const input = evaluateProfile(values({ LeftStickX: 1 }), STICK_PROFILE);
  assert.equal(input.steering, 1);
});

test('profile: Stick — throttle deadzone matches the driving stick default', () => {
  const input = evaluateProfile(values({ LeftStickY: -0.05 }), STICK_PROFILE);
  assert.equal(input.throttle, 0);
});

// --- shared button/chord behavior (both presets use the same bindings) -----

for (const profile of [RACING_PROFILE, STICK_PROFILE]) {
  test(`profile: ${profile.name} — Options arms, Create disarms`, () => {
    assert.equal(evaluateProfile(values({ Options: 1 }), profile).buttons.arm, true);
    assert.equal(evaluateProfile(values({ Create: 1 }), profile).buttons.disarm, true);
  });

  test(`profile: ${profile.name} — L1 opens, R1 closes, both held resolves to idle`, () => {
    assert.equal(gripperFromButtons(evaluateProfile(values({ L1: 1 }), profile).buttons), 'open');
    assert.equal(gripperFromButtons(evaluateProfile(values({ R1: 1 }), profile).buttons), 'close');
    assert.equal(
      gripperFromButtons(evaluateProfile(values({ L1: 1, R1: 1 }), profile).buttons),
      'idle',
    );
  });

  test(`profile: ${profile.name} — L3+R3 is the Emergency Stop chord`, () => {
    assert.equal(evaluateProfile(values({ L3: 1 }), profile).buttons.stop, false);
    assert.equal(evaluateProfile(values({ R3: 1 }), profile).buttons.stop, false);
    assert.equal(evaluateProfile(values({ L3: 1, R3: 1 }), profile).buttons.stop, true);
  });

  test(`profile: ${profile.name} — an unrelated control never arms`, () => {
    // Structural safety check: Arm can only ever read from profile.arm
    // (always a ButtonControl by the type system), so pushing an axis hard
    // must never set buttons.arm regardless of magnitude.
    const input = evaluateProfile(values({ LeftStickX: 1, RightStickY: -1 }), profile);
    assert.equal(input.buttons.arm, false);
    assert.equal(input.buttons.disarm, false);
  });
}

// --- toCustom -----------------------------------------------------------

test('profile: toCustom clones without mutating the preset', () => {
  const custom = toCustom(RACING_PROFILE);
  assert.equal(custom.id, 'custom');
  assert.notEqual(custom, RACING_PROFILE);
  assert.equal(RACING_PROFILE.id, 'racing', 'the built-in preset must stay untouched');
});

test('profile: toCustom followed by a rebind reproduces the source profile otherwise', () => {
  const custom: ControllerProfile = { ...toCustom(STICK_PROFILE), gripperOpen: 'Square' };
  assert.equal(evaluateProfile(values({ Square: 1 }), custom).buttons.openGripper, true);
  // Everything else about Stick's behavior is preserved.
  assert.equal(evaluateProfile(values({ LeftStickY: -1 }), custom).throttle, 1);
});
