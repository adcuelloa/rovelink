import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SAFE_STATE } from '@rovelink/protocol';

import {
  applyControlFrame,
  applyEmergencyStop,
  applyTtlWatchdog,
  INITIAL_DEVICE_STATE,
  onSessionChanged,
} from './device-state.ts';
import type { ControlFrameInput } from './device-state.ts';

const frame = (overrides: Partial<ControlFrameInput> = {}): ControlFrameInput => ({
  seq: 1,
  controlSessionId: 'session-a',
  throttle: 0.5,
  steering: 0,
  gripper: 'idle',
  armed: false,
  ...overrides,
});

test('boots with no session, no seq, and safe control state', () => {
  assert.equal(INITIAL_DEVICE_STATE.activeSessionId, null);
  assert.equal(INITIAL_DEVICE_STATE.sessionReady, false);
  assert.equal(INITIAL_DEVICE_STATE.lastSeq, -1);
  assert.deepEqual(INITIAL_DEVICE_STATE.control, SAFE_STATE);
});

test('a control frame before any session is adopted is rejected outright', () => {
  const { state, ack } = applyControlFrame(INITIAL_DEVICE_STATE, frame({ controlSessionId: 'x' }));
  assert.equal(ack, null);
  assert.deepEqual(state, INITIAL_DEVICE_STATE);
});

test('onSessionChanged adopts the session, resets seq, and clears readiness', () => {
  const state = onSessionChanged('session-a');
  assert.equal(state.activeSessionId, 'session-a');
  assert.equal(state.sessionReady, false);
  assert.equal(state.lastSeq, -1);
  assert.deepEqual(state.control, SAFE_STATE);
});

test('a frame for the wrong session is dropped and cannot roll activeSessionId backward', () => {
  const withSession = onSessionChanged('session-a');
  const { state, ack } = applyControlFrame(
    withSession,
    frame({ controlSessionId: 'stale-session' }),
  );
  assert.equal(ack, null);
  assert.deepEqual(state, withSession);
});

test('armed=true before the disarmed baseline is rejected, but still consumes the seq', () => {
  const withSession = onSessionChanged('session-a');
  const { state, ack } = applyControlFrame(withSession, frame({ seq: 5, armed: true }));
  assert.equal(ack, null);
  assert.equal(state.sessionReady, false);
  assert.equal(state.lastSeq, 5, 'seq must advance even though the frame was rejected');
  assert.deepEqual(state.control, SAFE_STATE);

  // A retransmission/duplicate of that same consumed seq is also rejected.
  const retry = applyControlFrame(state, frame({ seq: 5, armed: true }));
  assert.equal(retry.ack, null);
  assert.equal(retry.state.sessionReady, false);
});

test('the first disarmed frame establishes the baseline and is itself acked', () => {
  const withSession = onSessionChanged('session-a');
  const { state, ack } = applyControlFrame(withSession, frame({ seq: 1, armed: false }));
  assert.deepEqual(ack, { seq: 1, controlSessionId: 'session-a' });
  assert.equal(state.sessionReady, true);
  assert.deepEqual(state.control, SAFE_STATE);
});

test('after the baseline, an armed frame drives the vehicle and is acked', () => {
  let state = onSessionChanged('session-a');
  state = applyControlFrame(state, frame({ seq: 1, armed: false })).state;

  const { state: driven, ack } = applyControlFrame(
    state,
    frame({ seq: 2, armed: true, throttle: 0.75, steering: -0.25, gripper: 'open' }),
  );
  assert.deepEqual(ack, { seq: 2, controlSessionId: 'session-a' });
  assert.deepEqual(driven.control, {
    throttle: 0.75,
    steering: -0.25,
    gripper: 'open',
    armed: true,
  });
});

test('throttle/steering are clamped to -1..1', () => {
  let state = onSessionChanged('session-a');
  state = applyControlFrame(state, frame({ seq: 1, armed: false })).state;
  const { state: driven } = applyControlFrame(
    state,
    frame({ seq: 2, armed: true, throttle: 5, steering: -5 }),
  );
  assert.equal(driven.control.throttle, 1);
  assert.equal(driven.control.steering, -1);
});

test('a stale or duplicate seq is rejected once armed and driving', () => {
  let state = onSessionChanged('session-a');
  state = applyControlFrame(state, frame({ seq: 1, armed: false })).state;
  state = applyControlFrame(state, frame({ seq: 2, armed: true, throttle: 0.5 })).state;

  const { state: unchanged, ack } = applyControlFrame(
    state,
    frame({ seq: 2, armed: true, throttle: 0.9 }),
  );
  assert.equal(ack, null);
  assert.equal(unchanged.control.throttle, 0.5, 'stale frame must not overwrite driving state');
});

test('an armed=false frame after driving disarms and is acked', () => {
  let state = onSessionChanged('session-a');
  state = applyControlFrame(state, frame({ seq: 1, armed: false })).state;
  state = applyControlFrame(state, frame({ seq: 2, armed: true, throttle: 0.5 })).state;

  const { state: disarmed, ack } = applyControlFrame(state, frame({ seq: 3, armed: false }));
  assert.deepEqual(ack, { seq: 3, controlSessionId: 'session-a' });
  assert.deepEqual(disarmed.control, SAFE_STATE);
});

test('a new controller.session forces safe state and resets the baseline gate', () => {
  let state = onSessionChanged('session-a');
  state = applyControlFrame(state, frame({ seq: 1, armed: false })).state;
  state = applyControlFrame(state, frame({ seq: 2, armed: true, throttle: 0.5 })).state;
  assert.equal(state.control.armed, true);

  const resumed = onSessionChanged('session-b');
  assert.equal(resumed.activeSessionId, 'session-b');
  assert.equal(resumed.sessionReady, false);
  assert.equal(resumed.lastSeq, -1);
  assert.deepEqual(resumed.control, SAFE_STATE);

  // The old session's frames are now rejected outright.
  const { ack } = applyControlFrame(resumed, frame({ seq: 3, controlSessionId: 'session-a' }));
  assert.equal(ack, null);
});

test('emergency-stop resets control to safe state regardless of session/seq, and always acks', () => {
  let state = onSessionChanged('session-a');
  state = applyControlFrame(state, frame({ seq: 1, armed: false })).state;
  state = applyControlFrame(state, frame({ seq: 2, armed: true, throttle: 0.5 })).state;

  const { state: stopped, ack } = applyEmergencyStop(state, 123456);
  assert.deepEqual(ack, { sentAt: 123456 });
  assert.deepEqual(stopped.control, SAFE_STATE);
  // Session/seq are untouched by E-stop.
  assert.equal(stopped.activeSessionId, 'session-a');
  assert.equal(stopped.sessionReady, true);
  assert.equal(stopped.lastSeq, 2);
});

test('emergency-stop works even before any session has been established', () => {
  const { state, ack } = applyEmergencyStop(INITIAL_DEVICE_STATE, 42);
  assert.deepEqual(ack, { sentAt: 42 });
  assert.deepEqual(state.control, SAFE_STATE);
});

test('TTL watchdog does nothing while disarmed', () => {
  const state = onSessionChanged('session-a');
  const watched = applyTtlWatchdog(state, 10_000, 0, 500);
  assert.deepEqual(watched, state);
});

test('TTL watchdog enters safe state once armed and silent past ttlMs', () => {
  let state = onSessionChanged('session-a');
  state = applyControlFrame(state, frame({ seq: 1, armed: false })).state;
  state = applyControlFrame(state, frame({ seq: 2, armed: true, throttle: 0.5 })).state;

  const stillFresh = applyTtlWatchdog(state, 1_000_400, 1_000_000, 500);
  assert.equal(stillFresh.control.armed, true, 'within ttl: no change');

  const stale = applyTtlWatchdog(state, 1_000_600, 1_000_000, 500);
  assert.deepEqual(stale.control, SAFE_STATE);
});
