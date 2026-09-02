import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createControlFrame, SAFE_STATE } from '@rovelink/protocol';
import type { ControlState } from '@rovelink/protocol';

import { SimulatedFirmware, SimulatedRelay } from './simulated-relay-firmware.ts';

const DRIVING: ControlState = { throttle: 0.8, steering: 0, gripper: 'idle', armed: true };
const DISARMED: ControlState = { throttle: 0, steering: 0, gripper: 'idle', armed: false };

test('a fresh session rejects an armed frame before its disarmed baseline', () => {
  const relay = new SimulatedRelay();
  const firmware = new SimulatedFirmware();
  const sessionId = relay.mintSession();
  firmware.onSessionChanged(sessionId);

  const armedFirst = relay.stamp(createControlFrame(DRIVING, 1, 0));
  const rejected = firmware.applyFrame(armedFirst, 0);
  assert.deepEqual(rejected, { accepted: false, reason: 'armed-before-baseline' });
  assert.equal(firmware.sessionReady, false);

  const baseline = relay.stamp(createControlFrame(DISARMED, 2, 10));
  const accepted = firmware.applyFrame(baseline, 10);
  assert.equal(accepted.accepted, true);
  assert.equal(firmware.sessionReady, true);

  const nowArmed = relay.stamp(createControlFrame(DRIVING, 3, 20));
  const result = firmware.applyFrame(nowArmed, 20);
  assert.equal(result.accepted, true);
});

test('sequence reorder: a lower seq than the last accepted one is dropped, not replayed', () => {
  const relay = new SimulatedRelay();
  const firmware = new SimulatedFirmware();
  firmware.onSessionChanged(relay.mintSession());
  firmware.applyFrame(relay.stamp(createControlFrame(DISARMED, 101, 0)), 0);

  const outcome103 = firmware.applyFrame(relay.stamp(createControlFrame(DISARMED, 103, 10)), 10);
  const outcome102 = firmware.applyFrame(relay.stamp(createControlFrame(DISARMED, 102, 20)), 20);
  const outcome104 = firmware.applyFrame(relay.stamp(createControlFrame(DISARMED, 104, 30)), 30);

  assert.equal(outcome103.accepted, true);
  assert.deepEqual(outcome102, { accepted: false, reason: 'stale-seq' });
  assert.equal(outcome104.accepted, true);
  assert.equal(firmware.lastSeq, 104);
});

test('duplicate packet: resending the same seq is dropped the second time', () => {
  const relay = new SimulatedRelay();
  const firmware = new SimulatedFirmware();
  firmware.onSessionChanged(relay.mintSession());
  const frame = relay.stamp(createControlFrame(DISARMED, 5, 0));

  const first = firmware.applyFrame(frame, 0);
  const second = firmware.applyFrame(frame, 5);

  assert.equal(first.accepted, true);
  assert.deepEqual(second, { accepted: false, reason: 'stale-seq' });
});

test('controller reconnect: a delayed frame from the old session is dropped against the new one', () => {
  const relay = new SimulatedRelay();
  const firmware = new SimulatedFirmware();
  const sessionA = relay.mintSession();
  firmware.onSessionChanged(sessionA);
  const delayedFrameFromA = relay.stamp(createControlFrame(DISARMED, 1, 0));

  const sessionB = relay.mintSession();
  firmware.onSessionChanged(sessionB);

  // The delayed session-A frame finally arrives after B has already taken over.
  const outcome = firmware.applyFrame(delayedFrameFromA, 50);
  assert.deepEqual(outcome, { accepted: false, reason: 'wrong-session' });

  // Session B still needs its own disarmed baseline before it can be armed.
  const armedUnderB = relay.stamp(createControlFrame(DRIVING, 1, 60));
  assert.deepEqual(firmware.applyFrame(armedUnderB, 60), {
    accepted: false,
    reason: 'armed-before-baseline',
  });
});

test('TTL watchdog: an armed vehicle falls back to safe state once frames stop arriving', () => {
  const relay = new SimulatedRelay();
  const firmware = new SimulatedFirmware();
  firmware.onSessionChanged(relay.mintSession());
  firmware.applyFrame(relay.stamp(createControlFrame(DISARMED, 1, 0)), 0);
  firmware.applyFrame(relay.stamp(createControlFrame(DRIVING, 2, 10)), 10);
  assert.equal(firmware.state.armed, true);

  assert.equal(firmware.checkTtl(200), false);
  assert.equal(firmware.checkTtl(10 + 501), true);
  assert.deepEqual(firmware.state, SAFE_STATE);
});

test('emergency stop is unconditional, independent of session or sequence', () => {
  const firmware = new SimulatedFirmware();
  firmware.emergencyStop();
  assert.deepEqual(firmware.state, SAFE_STATE);
});

test('differential mix on an accepted frame matches @rovelink/protocol exactly', () => {
  const relay = new SimulatedRelay();
  const firmware = new SimulatedFirmware();
  firmware.onSessionChanged(relay.mintSession());
  firmware.applyFrame(relay.stamp(createControlFrame(DISARMED, 1, 0)), 0);
  const outcome = firmware.applyFrame(
    relay.stamp(
      createControlFrame({ throttle: 0.6, steering: 0.2, gripper: 'idle', armed: true }, 2, 10),
    ),
    10,
  );
  assert.equal(outcome.accepted, true);
  if (outcome.accepted) {
    assert.ok(Math.abs(outcome.wheels.left - 0.8) < 1e-9);
    assert.ok(Math.abs(outcome.wheels.right - 0.4) < 1e-9);
  }
});
