/**
 * Pure header/binary pairing state machine for the browser video viewer
 * (Problem 7D §9). Mirrors the relay's own pairing rule (video-relay's
 * room.ts #handleFrameHeader/#handleFrameBinary) on the receiving end: a
 * `VideoFrameHeader` JSON message is immediately followed, on the same
 * connection, by one binary JPEG message — this tracks AT MOST ONE pending
 * header at a time, by construction, so malformed sequencing can never
 * grow an unbounded buffer.
 *
 * Pure and DOM-free: no WebSocket, no canvas, no timers — just event in,
 * (state, outcome) out.
 */

import type { VideoFrameHeader } from '@rovelink/protocol';

export interface FramePairingState {
  readonly pendingHeader: VideoFrameHeader | null;
}

export const INITIAL_FRAME_PAIRING_STATE: FramePairingState = { pendingHeader: null };

export type FramePairingEvent =
  | { readonly type: 'header'; readonly header: VideoFrameHeader }
  | { readonly type: 'binary'; readonly byteLength: number };

export type FramePairingOutcome =
  | { readonly type: 'awaiting-binary' }
  | { readonly type: 'frame-ready'; readonly header: VideoFrameHeader }
  | { readonly type: 'ignored-binary-without-header' }
  | { readonly type: 'size-mismatch'; readonly header: VideoFrameHeader }
  | { readonly type: 'header-replaced'; readonly discarded: VideoFrameHeader };

export interface FramePairingResult {
  readonly state: FramePairingState;
  readonly outcome: FramePairingOutcome;
}

export function reduceFramePairing(
  state: FramePairingState,
  event: FramePairingEvent,
): FramePairingResult {
  if (event.type === 'header') {
    if (state.pendingHeader !== null) {
      // A second header arrived before the first one's binary did: the old
      // header can never be completed correctly now (the very next binary
      // belongs to the NEWEST header, per the wire protocol's own ordering
      // guarantee), so it is replaced, not queued alongside the new one —
      // "latest wins" applies to pairing state exactly like everywhere
      // else in this system.
      return {
        state: { pendingHeader: event.header },
        outcome: { type: 'header-replaced', discarded: state.pendingHeader },
      };
    }
    return { state: { pendingHeader: event.header }, outcome: { type: 'awaiting-binary' } };
  }

  if (state.pendingHeader === null) {
    return { state, outcome: { type: 'ignored-binary-without-header' } };
  }
  const header = state.pendingHeader;
  if (event.byteLength !== header.byteLength) {
    return { state: { pendingHeader: null }, outcome: { type: 'size-mismatch', header } };
  }
  return { state: { pendingHeader: null }, outcome: { type: 'frame-ready', header } };
}
