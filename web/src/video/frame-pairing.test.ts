import assert from 'node:assert/strict';
import test from 'node:test';

import type { VideoFrameHeader } from '@rovelink/protocol';

import { INITIAL_FRAME_PAIRING_STATE, reduceFramePairing } from './frame-pairing.ts';

function header(overrides: Partial<VideoFrameHeader> = {}): VideoFrameHeader {
  return {
    v: 1,
    type: 'frame',
    streamSessionId: 's1',
    seq: 1,
    capturedAtMs: 0,
    width: 640,
    height: 480,
    byteLength: 20_000,
    ...overrides,
  };
}

test('a header alone waits for its binary', () => {
  const { state, outcome } = reduceFramePairing(INITIAL_FRAME_PAIRING_STATE, {
    type: 'header',
    header: header(),
  });
  assert.equal(outcome.type, 'awaiting-binary');
  assert.deepEqual(state.pendingHeader, header());
});

test('a matching binary completes the frame and clears pending state', () => {
  const afterHeader = reduceFramePairing(INITIAL_FRAME_PAIRING_STATE, {
    type: 'header',
    header: header(),
  });
  const { state, outcome } = reduceFramePairing(afterHeader.state, {
    type: 'binary',
    byteLength: 20_000,
  });
  assert.equal(outcome.type, 'frame-ready');
  if (outcome.type === 'frame-ready') assert.deepEqual(outcome.header, header());
  assert.equal(state.pendingHeader, null, 'at most one pending header, never a backlog');
});

test('a binary with no preceding header is ignored, state stays empty', () => {
  const { state, outcome } = reduceFramePairing(INITIAL_FRAME_PAIRING_STATE, {
    type: 'binary',
    byteLength: 20_000,
  });
  assert.equal(outcome.type, 'ignored-binary-without-header');
  assert.equal(state.pendingHeader, null);
});

test('a byte-length mismatch drops the frame and clears pending state', () => {
  const afterHeader = reduceFramePairing(INITIAL_FRAME_PAIRING_STATE, {
    type: 'header',
    header: header({ byteLength: 20_000 }),
  });
  const { state, outcome } = reduceFramePairing(afterHeader.state, {
    type: 'binary',
    byteLength: 999,
  });
  assert.equal(outcome.type, 'size-mismatch');
  assert.equal(state.pendingHeader, null);
});

test('a second header before the first binary arrives replaces the pending one, never queues both', () => {
  const first = reduceFramePairing(INITIAL_FRAME_PAIRING_STATE, {
    type: 'header',
    header: header({ seq: 1 }),
  });
  const { state, outcome } = reduceFramePairing(first.state, {
    type: 'header',
    header: header({ seq: 2 }),
  });
  assert.equal(outcome.type, 'header-replaced');
  if (outcome.type === 'header-replaced') assert.equal(outcome.discarded.seq, 1);
  assert.equal(state.pendingHeader?.seq, 2, 'only the newest header is ever kept pending');
});

test('after a header replacement, the binary that arrives pairs with the newest header', () => {
  const first = reduceFramePairing(INITIAL_FRAME_PAIRING_STATE, {
    type: 'header',
    header: header({ seq: 1, byteLength: 111 }),
  });
  const replaced = reduceFramePairing(first.state, {
    type: 'header',
    header: header({ seq: 2, byteLength: 222 }),
  });
  const { outcome } = reduceFramePairing(replaced.state, { type: 'binary', byteLength: 222 });
  assert.equal(outcome.type, 'frame-ready');
  if (outcome.type === 'frame-ready') assert.equal(outcome.header.seq, 2);
});

test('never accumulates more than one pending header across any sequence of events', () => {
  let state = INITIAL_FRAME_PAIRING_STATE;
  for (let seq = 1; seq <= 50; seq += 1) {
    state = reduceFramePairing(state, { type: 'header', header: header({ seq }) }).state;
    // No binary ever arrives for any of these — state must still only ever
    // hold exactly one pending header, never a growing backlog.
    assert.equal(state.pendingHeader?.seq, seq);
  }
});
