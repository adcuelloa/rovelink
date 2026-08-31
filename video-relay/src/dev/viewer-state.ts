/**
 * Pure viewer connection-state machine (Problem 7B brief §11).
 *
 * Deliberately knows nothing about robot/control state (armed, E-Stop,
 * telemetry, sessions): a viewer showing `VIDEO: OFFLINE` while
 * `CONTROL: ONLINE` (or vice versa) must be an ordinary, expected state,
 * never something this reducer has to reconcile. It also knows nothing
 * about WebSocket, Cloudflare, or any particular transport — a browser
 * `WebSocket` wrapper and a Node `ws`-based dev CLI can both drive the same
 * reducer with the same event shapes.
 */

export type ViewerConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'waiting-for-publisher'
  | 'live'
  | 'reconnecting'
  | 'error';

export type ViewerEvent =
  | { readonly type: 'connect' }
  | { readonly type: 'open' }
  | { readonly type: 'stream-state'; readonly publisherOnline: boolean }
  | { readonly type: 'frame' }
  | { readonly type: 'close'; readonly willRetry: boolean }
  | { readonly type: 'error' }
  | { readonly type: 'disconnect' };

/**
 * Single transition step. `disconnect` always wins immediately, from any
 * state: an operator-requested stop must never be overridden by a message
 * that happened to already be in flight.
 */
export function nextViewerState(
  current: ViewerConnectionState,
  event: ViewerEvent,
): ViewerConnectionState {
  if (event.type === 'disconnect') return 'disconnected';

  switch (current) {
    case 'disconnected':
      return event.type === 'connect' ? 'connecting' : 'disconnected';

    case 'connecting':
    case 'reconnecting':
      if (event.type === 'open') return 'waiting-for-publisher';
      if (event.type === 'close') return event.willRetry ? 'reconnecting' : 'disconnected';
      if (event.type === 'error') return 'error';
      return current;

    case 'waiting-for-publisher':
      if (event.type === 'stream-state') return event.publisherOnline ? 'live' : current;
      if (event.type === 'frame') return 'live';
      if (event.type === 'close') return event.willRetry ? 'reconnecting' : 'disconnected';
      if (event.type === 'error') return 'error';
      return current;

    case 'live':
      // A live connection stays live on its own heartbeat (frame /
      // stream-state{true}); only losing the publisher or the socket
      // itself moves it out.
      if (event.type === 'stream-state' && !event.publisherOnline) return 'waiting-for-publisher';
      if (event.type === 'close') return event.willRetry ? 'reconnecting' : 'disconnected';
      if (event.type === 'error') return 'error';
      return current;

    case 'error':
      if (event.type === 'connect') return 'connecting';
      if (event.type === 'close') return event.willRetry ? 'reconnecting' : 'disconnected';
      return current;

    default:
      // Exhaustive over ViewerConnectionState above; kept only so a linter
      // that cannot prove switch-exhaustiveness itself still sees every
      // path return.
      return current;
  }
}
