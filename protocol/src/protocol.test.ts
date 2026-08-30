import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeState } from './control.ts';
import {
  CONTROL_TTL_MS,
  PROTOCOL_VERSION,
  createControlFrame,
  isRemoteMessage,
  isNewerFrame,
  isFrameExpired,
} from './protocol.ts';

const state = normalizeState({ throttle: 0.5, steering: -0.25, gripper: 'open', armed: true });

test('protocol: a control frame carries seq, clock, and TTL', () => {
  const frame = createControlFrame(state, 7, 1000);
  assert.deepEqual(frame, {
    v: PROTOCOL_VERSION,
    type: 'control',
    seq: 7,
    sentAt: 1000,
    ttlMs: CONTROL_TTL_MS,
    throttle: 0.5,
    steering: -0.25,
    gripper: 'open',
    armed: true,
  });
  assert.equal(isRemoteMessage(frame), true);
});

test('protocol: TTL expires old frames', () => {
  const frame = createControlFrame(state, 1, 1000, 250);
  assert.equal(isFrameExpired(frame, 1200), false);
  assert.equal(isFrameExpired(frame, 1251), true);
});

test('protocol: newer state wins, retransmission is never accepted', () => {
  const frame = createControlFrame(state, 5, 1000);
  assert.equal(isNewerFrame(frame, 4), true);
  assert.equal(isNewerFrame(frame, 5), false);
  assert.equal(isNewerFrame(frame, 9), false);
});

test('protocol: rejects non-protocol messages', () => {
  assert.equal(isRemoteMessage(null), false);
  assert.equal(isRemoteMessage({ type: 'control' }), false);
  assert.equal(isRemoteMessage({ v: 99, type: 'ping', id: 1, sentAt: 0 }), false);
  assert.equal(isRemoteMessage({ v: 1, type: 'invented' }), false);
  assert.equal(isRemoteMessage({ v: 1, type: 'control', seq: 1, sentAt: 0, ttlMs: 250 }), false);
  assert.equal(isRemoteMessage({ v: 1, type: 'ping', id: Number.NaN, sentAt: 0 }), false);
});

test('protocol: registration, telemetry, pong, emergency stop, and room', () => {
  assert.equal(isRemoteMessage({ v: 1, type: 'device.register', robotId: 'robot-01' }), true);
  assert.equal(isRemoteMessage({ v: 1, type: 'controller.register', robotId: 'robot-01' }), true);
  assert.equal(isRemoteMessage({ v: 1, type: 'telemetry', sentAt: 5, rssi: -55 }), true);
  assert.equal(isRemoteMessage({ v: 1, type: 'pong', id: 2, sentAt: 1, echoAt: 3 }), true);
  assert.equal(isRemoteMessage({ v: 1, type: 'emergency-stop', sentAt: 9 }), true);
  assert.equal(
    isRemoteMessage({
      v: 1,
      type: 'room',
      robotId: 'robot-01',
      deviceOnline: false,
      controllerOnline: true,
    }),
    true,
  );
  assert.equal(isRemoteMessage({ v: 1, type: 'device.register' }), false);
});
