/**
 * Pure browser video viewer connection-state machine (Problem 7D §2).
 *
 * Deliberately never reuses or is derived from robot control's connected/
 * armed state: `CONTROL: ONLINE` + `VIDEO: OFFLINE` and `CONTROL: ONLINE` +
 * `VIDEO: LIVE` must both be ordinary, independently representable states
 * (see ui/video-panel.ts). Knows nothing about WebSocket, tickets, or
 * canvases — `video-transport.ts` drives it with plain events.
 */

export type VideoViewerState =
  | 'disconnected'
  | 'requesting-ticket'
  | 'connecting'
  | 'registering'
  | 'waiting-for-publisher'
  | 'live'
  | 'reconnecting'
  | 'error';

export type VideoViewerEvent =
  | { readonly type: 'connect' }
  | { readonly type: 'ticket-ok' }
  | { readonly type: 'ticket-failed' }
  | { readonly type: 'socket-open' }
  | { readonly type: 'stream-state'; readonly publisherOnline: boolean }
  | { readonly type: 'frame' }
  | { readonly type: 'close'; readonly willRetry: boolean }
  | { readonly type: 'error' }
  | { readonly type: 'disconnect' };

/** Single transition step. `disconnect` always wins immediately, from any
 * state: an operator turning video off (or control being lost — see
 * video-transport.ts) must never be overridden by a message already in
 * flight. */
export function nextVideoViewerState(
  current: VideoViewerState,
  event: VideoViewerEvent,
): VideoViewerState {
  if (event.type === 'disconnect') return 'disconnected';

  switch (current) {
    case 'disconnected':
      return event.type === 'connect' ? 'requesting-ticket' : 'disconnected';

    case 'requesting-ticket':
      if (event.type === 'ticket-ok') return 'connecting';
      if (event.type === 'ticket-failed') return 'error';
      return current;

    case 'connecting':
    case 'reconnecting':
      if (event.type === 'socket-open') return 'registering';
      if (event.type === 'close') return event.willRetry ? 'reconnecting' : 'disconnected';
      if (event.type === 'error') return 'error';
      return current;

    case 'registering':
      if (event.type === 'stream-state')
        return event.publisherOnline ? 'live' : 'waiting-for-publisher';
      if (event.type === 'frame') return 'live';
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
      if (event.type === 'stream-state' && !event.publisherOnline) return 'waiting-for-publisher';
      if (event.type === 'close') return event.willRetry ? 'reconnecting' : 'disconnected';
      if (event.type === 'error') return 'error';
      return current;

    case 'error':
      if (event.type === 'connect') return 'requesting-ticket';
      if (event.type === 'close') return event.willRetry ? 'reconnecting' : 'disconnected';
      return current;

    default:
      // Exhaustive over VideoViewerState above; kept only so a linter that
      // cannot itself prove switch-exhaustiveness still sees every path
      // return.
      return current;
  }
}
