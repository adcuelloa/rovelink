import assert from 'node:assert/strict';
import test from 'node:test';

import { SAFE_STATE } from '@rovelink/protocol';

import type { ControlChange } from './engine.ts';
import { ControlEngine } from './engine.ts';

function record(engine: ControlEngine): ControlChange[] {
  const changes: ControlChange[] = [];
  engine.subscribe((change) => changes.push(change));
  return changes;
}

test('engine: axes are clamped to -1..1', () => {
  const engine = new ControlEngine();
  engine.axes(2, -3);
  assert.equal(engine.state.throttle, 1);
  assert.equal(engine.state.steering, -1);
});

test('engine: last state wins, no queue accumulates', () => {
  const engine = new ControlEngine();
  const changes = record(engine);
  engine.axes(1, 0);
  engine.axes(0.5, 0);
  engine.axes(0, 0);
  assert.deepEqual(engine.state, SAFE_STATE);
  assert.equal(changes.at(-1)?.state.throttle, 0);
});

test('engine: noise below threshold does not notify anyone', () => {
  const engine = new ControlEngine();
  engine.axes(0.5, 0);
  const changes = record(engine);
  engine.axes(0.505, 0);
  assert.equal(changes.length, 0);
  engine.axes(0.7, 0);
  assert.equal(changes.length, 1);
});

test('engine: arm and disarm never start with an axis pressed', () => {
  const engine = new ControlEngine();
  engine.axes(1, 1);
  engine.arm(true);
  assert.deepEqual(engine.state, { throttle: 0, steering: 0, gripper: 'idle', armed: true });
  engine.axes(1, 0);
  engine.arm(false);
  assert.deepEqual(engine.state, SAFE_STATE);
});

test('engine: emergency stop always notifies, even if already idle', () => {
  const engine = new ControlEngine();
  const changes = record(engine);
  engine.emergencyStop();
  engine.emergencyStop();
  assert.equal(changes.length, 2);
  assert.equal(changes[0]?.reason, 'stop');
  assert.deepEqual(engine.state, SAFE_STATE);
});

test('engine: losing the link leaves safe state', () => {
  const engine = new ControlEngine();
  engine.arm(true);
  engine.axes(1, 0.4);
  const changes = record(engine);
  engine.safeState();
  assert.deepEqual(engine.state, SAFE_STATE);
  assert.equal(changes.at(-1)?.reason, 'disconnect');
});
