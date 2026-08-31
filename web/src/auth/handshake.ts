/**
 * The frontend authentication lifecycle: unauthenticated -> authenticating
 * -> authenticated | auth-error.
 *
 * A plain WebSocket OPEN (`TransportEvent` kind `'state'`) is never treated
 * as authentication success, and neither is generic room presence (`'robot'`,
 * `'telemetry'`, `'rtt'`, `'counters'`, `'alert'`). The only event that
 * advances to `authenticated` is the relay-authored `controller.session`
 * (`'session-established'`) — rejected/unauthenticated controllers never
 * receive one (see room.ts #handleControllerRegister). This module owns
 * exactly that rule so it can be tested without a DOM or a real socket; the
 * actual UI mounting is injected as callbacks by the caller (main.ts).
 */

import type { RobotTransport, TransportEvent } from '../transport/types.ts';

export interface HandshakeCallbacks {
  /** Fires once, synchronously, before `transport.connect()` is called. */
  readonly onAuthenticating: () => void;
  /**
   * Fires exactly once, only in direct response to `controller.session`.
   * `priorEvents` is every event this transport emitted during the
   * handshake, in order, `controller.session` itself included — a real
   * WebSocket OPEN, a `room` presence broadcast, telemetry, counters, and
   * so on can all legitimately arrive before authentication finishes, and
   * the eventual dashboard's own transport listener (attached only after
   * this fires) never sees them live otherwise. The caller is expected to
   * replay these through that same listener once it exists, so the first
   * paint reflects reality instead of a stale "just mounted" default.
   */
  readonly onAuthenticated: (
    transport: RobotTransport,
    priorEvents: readonly TransportEvent[],
  ) => void;
  /** Fires exactly once, only in direct response to an explicit auth
   * rejection (or a missing credential — see WebSocketTransport.connect()). */
  readonly onAuthError: (text: string) => void;
}

/**
 * Starts a connection attempt and watches for the one event that means
 * "this controller is now authenticated." Returns an unsubscribe function;
 * the handshake also unsubscribes itself the moment either terminal
 * callback fires, so nothing about a later reconnect on this same
 * transport can retrigger `onAuthenticated`/`onAuthError` through this
 * function again — a fresh handshake is required for a fresh attempt.
 */
export function runHandshake(transport: RobotTransport, callbacks: HandshakeCallbacks): () => void {
  callbacks.onAuthenticating();
  const priorEvents: TransportEvent[] = [];
  const unsubscribe = transport.subscribe((event: TransportEvent) => {
    if (event.kind === 'auth-error') {
      unsubscribe();
      callbacks.onAuthError(event.text);
      return;
    }
    // Every other kind — 'state' (including a bare WebSocket OPEN),
    // 'robot', 'telemetry', 'rtt', 'counters', 'alert', and
    // 'session-established' itself — is recorded for replay. None but
    // 'session-established' ends the wait on its own: WebSocketTransport's
    // own reconnect logic (Problem 2) may cycle 'state' through
    // connecting/connected/disconnected any number of times here without
    // this ever authenticating.
    priorEvents.push(event);
    if (event.kind === 'session-established') {
      unsubscribe();
      callbacks.onAuthenticated(transport, priorEvents);
    }
  });
  void transport.connect();
  return unsubscribe;
}
