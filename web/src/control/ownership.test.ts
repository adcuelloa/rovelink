import assert from 'node:assert/strict';
import test from 'node:test';

import type { Gripper } from '@rovelink/protocol';

import type { Axes } from './ownership.ts';
import { InputOwnership } from './ownership.ts';

// These helpers mirror the one-line "meaningful activity" conditional at
// each source's own call site in control-view.ts (see ownership.ts's header
// comment for why that decision lives at the call site, not in the class).
// Using real functions — rather than inlining the `if` in each test — also
// avoids TypeScript narrowing a directly-assigned literal const to a type
// that makes the comparison look tautological.

function gamepadAxes(ownership: InputOwnership, axes: Axes): void {
  ownership.setAxes('gamepad', axes);
  if (axes.throttle !== 0 || axes.steering !== 0) ownership.claim('gamepad');
}

function gamepadGripper(ownership: InputOwnership, gripper: Gripper): void {
  ownership.setGripper('gamepad', gripper);
  if (gripper !== 'idle') ownership.claim('gamepad');
}

test('ownership: idle gamepad polling does not steal activeSource from keyboard', () => {
  const ownership = new InputOwnership();
  ownership.claim('keyboard');
  ownership.setAxes('keyboard', { throttle: 1, steering: 0 });

  gamepadAxes(ownership, { throttle: 0, steering: 0 });

  assert.equal(ownership.active, 'keyboard');
  assert.deepEqual(ownership.axes, { throttle: 1, steering: 0 });
});

test('ownership: sub-deadzone stick noise does not claim gamepad', () => {
  const ownership = new InputOwnership();
  ownership.claim('keyboard');

  // Deadzone rescale already reduced this to exactly 0 before it reaches here.
  gamepadAxes(ownership, { throttle: 0, steering: 0 });

  assert.equal(ownership.active, 'keyboard');
});

test('ownership: meaningful gamepad axis movement claims gamepad', () => {
  const ownership = new InputOwnership();
  ownership.claim('keyboard');

  gamepadAxes(ownership, { throttle: 1, steering: 0 });

  assert.equal(ownership.active, 'gamepad');
  assert.deepEqual(ownership.axes, { throttle: 1, steering: 0 });
});

test('ownership: gamepad gripper press claims gamepad', () => {
  const ownership = new InputOwnership();
  ownership.claim('keyboard');

  gamepadGripper(ownership, 'open');

  assert.equal(ownership.active, 'gamepad');
  assert.equal(ownership.gripper, 'open');
});

test('ownership: gamepad gripper release to idle does not claim', () => {
  const ownership = new InputOwnership();
  ownership.claim('keyboard');

  gamepadGripper(ownership, 'idle');

  assert.equal(ownership.active, 'keyboard');
});

test('ownership: keyboard keydown takes ownership back from gamepad', () => {
  const ownership = new InputOwnership();
  ownership.claim('gamepad');
  ownership.setAxes('gamepad', { throttle: 1, steering: 0 });

  // Mirrors listenKeyboard's onActivity, fired only on keydown.
  ownership.claim('keyboard');

  assert.equal(ownership.active, 'keyboard');
});

test('ownership: touch pointerdown takes ownership back from keyboard or gamepad', () => {
  const ownership = new InputOwnership();
  ownership.claim('gamepad');
  assert.equal(ownership.active, 'gamepad');

  ownership.claim('touch');
  assert.equal(ownership.active, 'touch');

  ownership.claim('keyboard');
  ownership.claim('touch');
  assert.equal(ownership.active, 'touch');
});

test('ownership: values from inactive sources are not summed or applied', () => {
  const ownership = new InputOwnership();
  ownership.claim('keyboard');
  ownership.setAxes('keyboard', { throttle: 0.5, steering: 0 });
  // gamepad's stored axes exist but gamepad never claimed ownership.
  ownership.setAxes('gamepad', { throttle: -0.5, steering: 1 });

  assert.deepEqual(ownership.axes, { throttle: 0.5, steering: 0 });
});

test('ownership: releasing the active source returns its axes to zero', () => {
  const ownership = new InputOwnership();
  ownership.claim('gamepad');
  ownership.setAxes('gamepad', { throttle: 1, steering: 0 });
  assert.deepEqual(ownership.axes, { throttle: 1, steering: 0 });

  // Stick returns to center; gamepad is still the active source.
  ownership.setAxes('gamepad', { throttle: 0, steering: 0 });
  assert.deepEqual(ownership.axes, { throttle: 0, steering: 0 });
});

test('ownership: touch pointerup zeroes touch state without selecting another source', () => {
  const ownership = new InputOwnership();
  ownership.claim('touch');
  ownership.setAxes('touch', { throttle: 1, steering: 0 });

  // Mirrors control-view.ts's release(): zeroes without calling claim().
  ownership.setAxes('touch', { throttle: 0, steering: 0 });

  assert.equal(ownership.active, 'touch');
  assert.deepEqual(ownership.axes, { throttle: 0, steering: 0 });
});

test('ownership: nothing has ever claimed ownership yields idle output', () => {
  const ownership = new InputOwnership();
  assert.equal(ownership.active, null);
  assert.deepEqual(ownership.axes, { throttle: 0, steering: 0 });
  assert.equal(ownership.gripper, 'idle');
});
