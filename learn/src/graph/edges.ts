import type { ConceptEdge } from './types.ts';

function flow(from: string, to: string): ConceptEdge {
  return { id: `${from}->${to}`, from, to, kind: 'flow' };
}

export const EDGES: readonly ConceptEdge[] = [
  // Plain-level aggregate chain (only visible when both endpoints are, i.e.
  // at the Plain English level).
  flow('human', 'browser'),
  flow('browser', 'cloud-relay'),
  flow('cloud-relay', 'robot'),

  // R2 -> motors, technical/code detail.
  flow('human', 'input-device'),
  flow('input-device', 'keyboard-input'),
  flow('input-device', 'gamepad-input'),
  flow('input-device', 'touch-input'),
  flow('gamepad-input', 'controller-profile'),
  flow('controller-profile', 'input-ownership'),
  flow('keyboard-input', 'input-ownership'),
  flow('touch-input', 'input-ownership'),
  flow('input-ownership', 'control-engine'),
  flow('control-engine', 'control-sender'),
  { id: 'rhythm->control-sender', from: 'rhythm', to: 'control-sender', kind: 'informs' },
  flow('control-sender', 'control-protocol'),
  flow('control-protocol', 'websocket-transport'),
  flow('websocket-transport', 'control-relay'),
  flow('control-relay', 'robot-room'),
  flow('robot-room', 'control-session'),
  flow('control-session', 'firmware-transport'),
  flow('firmware-transport', 'firmware-control'),
  flow('firmware-control', 'differential-mix'),
  flow('differential-mix', 'robot-hardware'),
  flow('robot-hardware', 'motors'),
  { id: 'firmware-control->control-ack', from: 'firmware-control', to: 'control-ack', kind: 'ack' },
  { id: 'control-ack->control-sender', from: 'control-ack', to: 'control-sender', kind: 'ack' },
];
