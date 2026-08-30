import assert from 'node:assert/strict';
import test from 'node:test';

import type { KeyAction } from './keyboard.ts';
import { actionForKey, axesFromKeys, isInField, gripperFromKeys } from './keyboard.ts';

const active = (...actions: KeyAction[]): ReadonlySet<KeyAction> => new Set(actions);

test('keyboard: WASD and arrow keys drive', () => {
  assert.equal(actionForKey('KeyW'), 'forward');
  assert.equal(actionForKey('ArrowUp'), 'forward');
  assert.equal(actionForKey('KeyS'), 'backward');
  assert.equal(actionForKey('ArrowLeft'), 'left');
  assert.equal(actionForKey('KeyD'), 'right');
  assert.equal(actionForKey('Space'), 'stop');
  assert.equal(actionForKey('KeyJ'), null);
});

test('keyboard: keys are converted to axes from -1 to 1', () => {
  assert.deepEqual(axesFromKeys(active()), { throttle: 0, steering: 0 });
  assert.deepEqual(axesFromKeys(active('forward')), { throttle: 1, steering: 0 });
  assert.deepEqual(axesFromKeys(active('backward', 'left')), { throttle: -1, steering: -1 });
  assert.deepEqual(axesFromKeys(active('forward', 'backward')), { throttle: 0, steering: 0 });
});

test('keyboard: gripper is held while the key is pressed', () => {
  assert.equal(gripperFromKeys(active()), 'idle');
  assert.equal(gripperFromKeys(active('openGripper')), 'open');
  assert.equal(gripperFromKeys(active('openGripper', 'closeGripper')), 'close');
});

test('keyboard: typing in a field does not drive the cart', () => {
  assert.equal(isInField('INPUT', false), true);
  assert.equal(isInField('textarea', false), true);
  assert.equal(isInField('SELECT', false), true);
  assert.equal(isInField('DIV', true), true);
  assert.equal(isInField('DIV', false), false);
  assert.equal(isInField('BUTTON', false), false);
});
