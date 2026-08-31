import assert from 'node:assert/strict';
import test from 'node:test';

import type { ControlState } from '@rovelink/protocol';

import type { RobotTransport, TransportEvent } from '../transport/types.ts';
import { Emitter } from '../transport/types.ts';
import { runHandshake } from './handshake.ts';

/** A hand-rolled fake — not MockTransport, which has no auth concept at all. */
class FakeAuthTransport implements RobotTransport {
  readonly name = 'Fake';
  readonly robotId = 'robot-01';
  readonly #emitter = new Emitter();
  connectCalls = 0;

  subscribe(listener: (event: TransportEvent) => void): () => void {
    return this.#emitter.subscribe(listener);
  }

  connect(): Promise<void> {
    this.connectCalls += 1;
    return Promise.resolve();
  }

  disconnect(): void {}
  sendControl(_state: ControlState): void {}
  emergencyStop(): void {}

  emit(event: TransportEvent): void {
    this.#emitter.emit(event);
  }
}

test('handshake: calling it calls connect() and enters authenticating', () => {
  const transport = new FakeAuthTransport();
  let authenticating = 0;
  runHandshake(transport, {
    onAuthenticating: () => {
      authenticating += 1;
    },
    onAuthenticated: () => {},
    onAuthError: () => {},
  });
  assert.equal(authenticating, 1);
  assert.equal(transport.connectCalls, 1);
});

test('handshake: a bare WebSocket open (state:connected) does not authenticate', () => {
  const transport = new FakeAuthTransport();
  const authenticated: RobotTransport[] = [];
  runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: (t) => authenticated.push(t),
    onAuthError: () => {},
  });

  transport.emit({ kind: 'state', state: 'connecting' });
  transport.emit({ kind: 'state', state: 'connected' });

  assert.equal(authenticated.length, 0, 'a bare WebSocket OPEN must never count as authenticated');
});

test('handshake: generic room/telemetry presence does not authenticate', () => {
  const transport = new FakeAuthTransport();
  const authenticated: RobotTransport[] = [];
  runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: (t) => authenticated.push(t),
    onAuthError: () => {},
  });

  transport.emit({ kind: 'state', state: 'connected' });
  transport.emit({ kind: 'robot', online: true });
  transport.emit({
    kind: 'telemetry',
    data: { v: 1, type: 'telemetry', sentAt: 0, ackSeq: 0, armed: false },
  });

  assert.equal(authenticated.length, 0);
});

test('handshake: controller.session (session-established) authenticates exactly once', () => {
  const transport = new FakeAuthTransport();
  const authenticated: RobotTransport[] = [];
  runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: (t) => authenticated.push(t),
    onAuthError: () => {},
  });

  transport.emit({ kind: 'state', state: 'connected' });
  transport.emit({ kind: 'session-established' });

  assert.deepEqual(authenticated, [transport]);
});

test('handshake: onAuthenticated receives everything that happened before it, in order', () => {
  // A real WebSocket OPEN, a room presence broadcast, telemetry, etc. can
  // all legitimately arrive before authentication finishes — the eventual
  // dashboard's own listener (attached only inside onAuthenticated) never
  // sees them live otherwise, so they must be handed over for replay.
  const transport = new FakeAuthTransport();
  let received: unknown;
  runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: (_t, priorEvents) => {
      received = priorEvents;
    },
    onAuthError: () => {},
  });

  transport.emit({ kind: 'state', state: 'connecting' });
  transport.emit({ kind: 'state', state: 'connected' });
  transport.emit({ kind: 'robot', online: true });
  transport.emit({ kind: 'session-established' });

  assert.deepEqual(received, [
    { kind: 'state', state: 'connecting' },
    { kind: 'state', state: 'connected' },
    { kind: 'robot', online: true },
    { kind: 'session-established' },
  ]);
});

test('handshake: 4003 auth-error before controller.session never authenticates', () => {
  const transport = new FakeAuthTransport();
  const authenticated: RobotTransport[] = [];
  const errors: string[] = [];
  runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: (t) => authenticated.push(t),
    onAuthError: (text) => errors.push(text),
  });

  transport.emit({ kind: 'state', state: 'connected' });
  transport.emit({ kind: 'auth-error', text: 'invalid controller credential' });

  assert.equal(authenticated.length, 0);
  assert.deepEqual(errors, ['invalid controller credential']);
});

test('handshake: a bare socket close (state:disconnected) before controller.session stays unauthenticated', () => {
  // Mirrors WebSocketTransport's own behavior on an ordinary (non-4003)
  // drop: it keeps retrying internally without an auth-error, and this
  // handshake must not treat the drop itself as failure either.
  const transport = new FakeAuthTransport();
  const authenticated: RobotTransport[] = [];
  const errors: string[] = [];
  runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: (t) => authenticated.push(t),
    onAuthError: (text) => errors.push(text),
  });

  transport.emit({ kind: 'state', state: 'connected' });
  transport.emit({ kind: 'state', state: 'disconnected' });
  transport.emit({ kind: 'state', state: 'connecting' });
  transport.emit({ kind: 'state', state: 'connected' });

  assert.equal(authenticated.length, 0);
  assert.equal(errors.length, 0);

  // The eventual session-established still works after those cycles.
  transport.emit({ kind: 'session-established' });
  assert.deepEqual(authenticated, [transport]);
});

test('handshake: once authenticated, later events on the same transport are not re-delivered to this handshake', () => {
  // Proves a reconnect cannot bypass anything through this specific
  // mechanism: this handshake unsubscribes itself after the first
  // terminal event, so a later reconnect's own session-established (or
  // any other event) never reaches these callbacks again. Re-establishing
  // authority after a reconnect is Problem 4's ControlEngine/session
  // machinery (see control-view.ts's own 'session-established' handler
  // and engine.test.ts's "losing the link leaves safe state"), not this
  // one-shot handshake.
  const transport = new FakeAuthTransport();
  let authenticatedCount = 0;
  runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: () => {
      authenticatedCount += 1;
    },
    onAuthError: () => {},
  });

  transport.emit({ kind: 'session-established' });
  assert.equal(authenticatedCount, 1);

  // Simulate a later reconnect cycle on the same transport instance.
  transport.emit({ kind: 'state', state: 'disconnected' });
  transport.emit({ kind: 'state', state: 'connecting' });
  transport.emit({ kind: 'state', state: 'connected' });
  transport.emit({ kind: 'session-established' });

  assert.equal(authenticatedCount, 1, 'a reconnect must not re-trigger this one-shot handshake');
});

test('handshake: calling the returned unsubscribe stops further callbacks', () => {
  const transport = new FakeAuthTransport();
  const authenticated: RobotTransport[] = [];
  const stop = runHandshake(transport, {
    onAuthenticating: () => {},
    onAuthenticated: (t) => authenticated.push(t),
    onAuthError: () => {},
  });

  stop();
  transport.emit({ kind: 'session-established' });

  assert.equal(authenticated.length, 0);
});
