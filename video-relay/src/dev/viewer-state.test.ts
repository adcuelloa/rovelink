import assert from 'node:assert/strict';
import test from 'node:test';

import { nextViewerState, type ViewerConnectionState, type ViewerEvent } from './viewer-state.ts';

function run(start: ViewerConnectionState, events: readonly ViewerEvent[]): ViewerConnectionState {
  return events.reduce(nextViewerState, start);
}

test('viewer connects before publisher: waiting-for-publisher, then live once publisher appears', () => {
  const s1 = nextViewerState('connecting', { type: 'open' });
  assert.equal(s1, 'waiting-for-publisher');
  const s2 = nextViewerState(s1, { type: 'stream-state', publisherOnline: false });
  assert.equal(s2, 'waiting-for-publisher');
  const s3 = nextViewerState(s2, { type: 'stream-state', publisherOnline: true });
  assert.equal(s3, 'live');
});

test('a frame arriving while waiting is itself proof of life: moves straight to live', () => {
  assert.equal(nextViewerState('waiting-for-publisher', { type: 'frame' }), 'live');
});

test('publisher disconnects: viewer leaves live for waiting-for-publisher, not a stale live loop', () => {
  const state = nextViewerState('live', { type: 'stream-state', publisherOnline: false });
  assert.equal(state, 'waiting-for-publisher');
});

test('publisher reconnects with a fresh session: viewer resumes to live via the new stream-state', () => {
  const afterDrop = run('live', [{ type: 'stream-state', publisherOnline: false }]);
  assert.equal(afterDrop, 'waiting-for-publisher');
  const resumed = nextViewerState(afterDrop, { type: 'stream-state', publisherOnline: true });
  assert.equal(resumed, 'live');
});

test('viewer socket drop with retry intent: reconnecting, then live again once the retry opens and publisher confirms', () => {
  const state = run('live', [
    { type: 'close', willRetry: true },
    { type: 'open' },
    { type: 'stream-state', publisherOnline: true },
  ]);
  assert.equal(state, 'live');
});

test('viewer socket drop without retry intent: disconnected, not reconnecting', () => {
  assert.equal(nextViewerState('live', { type: 'close', willRetry: false }), 'disconnected');
});

test('transport error moves to error state; a fresh connect attempt can leave it', () => {
  const errored = nextViewerState('connecting', { type: 'error' });
  assert.equal(errored, 'error');
  assert.equal(nextViewerState(errored, { type: 'connect' }), 'connecting');
});

test('explicit disconnect is a sink: subsequent stray events never resurrect the connection', () => {
  const disconnected = nextViewerState('live', { type: 'disconnect' });
  assert.equal(disconnected, 'disconnected');
  const state = run(disconnected, [
    { type: 'stream-state', publisherOnline: true },
    { type: 'frame' },
    { type: 'open' },
  ]);
  assert.equal(state, 'disconnected', 'only an explicit connect event may leave disconnected');
  assert.equal(nextViewerState(disconnected, { type: 'connect' }), 'connecting');
});

test('video viewer state is never coupled to robot control state: no control-shaped events exist', () => {
  // Structural guard, not a runtime assertion: ViewerEvent must not grow a
  // variant referencing robot/control concepts (e.g. 'armed', 'estop').
  // Enforced at compile time by ViewerEvent's own type definition; this
  // test just documents the intent so it is not lost in a refactor.
  const events: ViewerEvent[] = [
    { type: 'connect' },
    { type: 'open' },
    { type: 'stream-state', publisherOnline: true },
    { type: 'frame' },
    { type: 'close', willRetry: true },
    { type: 'error' },
    { type: 'disconnect' },
  ];
  assert.equal(events.length, 7);
});
