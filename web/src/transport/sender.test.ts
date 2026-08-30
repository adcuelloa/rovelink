import assert from 'node:assert/strict';
import test from 'node:test';

import type { ControlState } from '@rovelink/protocol';
import { SAFE_STATE } from '@rovelink/protocol';

import { ControlSender } from './sender.ts';
import type { RobotTransport } from './types.ts';

/** Records every state actually handed to sendControl(), with no real
 * network/WebSocket involved — establishSessionBaseline() must go through
 * this exact same path, not a parallel one. */
function fakeTransport(): { transport: RobotTransport; sent: ControlState[] } {
  const sent: ControlState[] = [];
  const transport: RobotTransport = {
    name: 'fake',
    robotId: 'robot-01',
    connect: () => Promise.resolve(),
    disconnect: () => {},
    sendControl: (state) => sent.push(state),
    emergencyStop: () => {},
    subscribe: () => () => {},
  };
  return { transport, sent };
}

test('sender: establishSessionBaseline forces a send even when disarmed+idle, where normal rhythm would skip', () => {
  const { transport, sent } = fakeTransport();
  const sender = new ControlSender(transport, { now: () => 1000 });

  // Reach steady-state disarmed+idle first, exactly like rhythm.ts's own
  // "disarmed and still, the link does not send driving packets" case:
  // the first call always goes out, a second identical one does not.
  sender.update(SAFE_STATE);
  sender.update(SAFE_STATE);
  assert.equal(sent.length, 1, 'sanity check: normal rhythm must still skip the repeat');

  sender.establishSessionBaseline();
  assert.equal(sent.length, 2, 'the forced baseline must go out despite matching skip conditions');
  assert.deepEqual(sent[1], SAFE_STATE);
});

test('sender: establishSessionBaseline sends unconditionally even as the very first call', () => {
  const { transport, sent } = fakeTransport();
  const sender = new ControlSender(transport, { now: () => 1000 });

  sender.establishSessionBaseline();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], SAFE_STATE);
});

test('sender: after a forced baseline, steady disarmed+idle state resumes skipping (no bandwidth regression)', () => {
  const { transport, sent } = fakeTransport();
  const sender = new ControlSender(transport, { now: () => 1000 });

  sender.establishSessionBaseline();
  sender.update(SAFE_STATE); // same instant, same state: must be treated as a repeat, not a fresh first-send
  assert.equal(
    sent.length,
    1,
    'the baseline must count as #lastSent, not leave the sender thinking nothing was ever sent',
  );
});

test('sender: a later explicit Arm after the baseline still produces its own armed=true send', () => {
  const { transport, sent } = fakeTransport();
  const sender = new ControlSender(transport, { now: () => 1000 });

  sender.establishSessionBaseline();
  sender.update({ ...SAFE_STATE, armed: true });

  assert.equal(sent.length, 2);
  assert.equal(sent[0]?.armed, false);
  assert.equal(sent[1]?.armed, true);
});
