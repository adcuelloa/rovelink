import assert from 'node:assert/strict';
import test from 'node:test';

import { nextVideoViewerState } from './viewer-state.ts';
import type { VideoViewerEvent, VideoViewerState } from './viewer-state.ts';

function run(start: VideoViewerState, events: readonly VideoViewerEvent[]): VideoViewerState {
  return events.reduce(nextVideoViewerState, start);
}

test('full happy path: connect -> ticket -> socket -> register -> waiting -> live', () => {
  const state = run('disconnected', [
    { type: 'connect' },
    { type: 'ticket-ok' },
    { type: 'socket-open' },
    { type: 'stream-state', publisherOnline: false },
    { type: 'stream-state', publisherOnline: true },
  ]);
  assert.equal(state, 'live');
});

test('a frame arriving while registering or waiting is itself proof of life', () => {
  assert.equal(nextVideoViewerState('registering', { type: 'frame' }), 'live');
  assert.equal(nextVideoViewerState('waiting-for-publisher', { type: 'frame' }), 'live');
});

test('ticket failure moves to error, not straight back to disconnected', () => {
  const state = run('disconnected', [{ type: 'connect' }, { type: 'ticket-failed' }]);
  assert.equal(state, 'error');
});

test('a fresh connect from error re-requests a ticket', () => {
  assert.equal(nextVideoViewerState('error', { type: 'connect' }), 'requesting-ticket');
});

test('publisher going offline moves a live viewer back to waiting, not disconnected', () => {
  const state = nextVideoViewerState('live', { type: 'stream-state', publisherOnline: false });
  assert.equal(state, 'waiting-for-publisher');
});

test('socket close with retry intent goes to reconnecting; without, to disconnected', () => {
  assert.equal(nextVideoViewerState('live', { type: 'close', willRetry: true }), 'reconnecting');
  assert.equal(nextVideoViewerState('live', { type: 'close', willRetry: false }), 'disconnected');
});

test('reconnecting resumes the same socket-open -> registering path', () => {
  const state = run('reconnecting', [
    { type: 'socket-open' },
    { type: 'stream-state', publisherOnline: true },
  ]);
  assert.equal(state, 'live');
});

test('explicit disconnect is a sink from any state, including mid-ticket-request', () => {
  for (const start of [
    'disconnected',
    'requesting-ticket',
    'connecting',
    'registering',
    'waiting-for-publisher',
    'live',
    'reconnecting',
    'error',
  ] as const) {
    assert.equal(nextVideoViewerState(start, { type: 'disconnect' }), 'disconnected');
  }
});

test('disconnected is a sink for stray events: only an explicit connect leaves it', () => {
  const state = run('disconnected', [
    { type: 'stream-state', publisherOnline: true },
    { type: 'frame' },
    { type: 'socket-open' },
  ]);
  assert.equal(state, 'disconnected');
});

test('a transport error moves to the error state from any in-flight state', () => {
  for (const start of ['connecting', 'registering', 'waiting-for-publisher', 'live'] as const) {
    assert.equal(nextVideoViewerState(start, { type: 'error' }), 'error');
  }
});
