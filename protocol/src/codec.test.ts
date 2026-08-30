import assert from 'node:assert/strict';
import test from 'node:test';

import { JSON_CODEC } from './codec.ts';
import { normalizeState } from './control.ts';
import { createControlFrame } from './protocol.ts';

const frame = createControlFrame(normalizeState({ throttle: 1, armed: true }), 3, 42);

test('codec: round-trip without loss', () => {
  const raw = JSON_CODEC.encode(frame);
  assert.equal(typeof raw, 'string');
  assert.deepEqual(JSON_CODEC.decode(raw), frame);
});

test('codec: accepts binary because WebSocket may deliver it that way', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(frame));
  assert.deepEqual(JSON_CODEC.decode(bytes), frame);
  assert.deepEqual(JSON_CODEC.decode(bytes.buffer), frame);
});

test('codec: garbage and foreign messages return null, not an exception', () => {
  assert.equal(JSON_CODEC.decode('not json'), null);
  assert.equal(JSON_CODEC.decode('{"v":1}'), null);
  assert.equal(JSON_CODEC.decode('{"v":2,"type":"ping","id":1,"sentAt":0}'), null);
});
