import type { ConceptNode } from './types.ts';

/**
 * Every concept RoveLink Learn teaches. Four `plain` nodes exist purely as
 * beginner-level aggregates (`aggregates` lists the finer concepts they
 * stand in for); every other node is real, source-backed behavior — see
 * source-map.ts for the evidence and validate.ts for the check that keeps
 * this file honest.
 */
export const CONCEPTS: readonly ConceptNode[] = [
  // --- Plain-level aggregates (visible only at the Plain English level) ---
  {
    id: 'human',
    layer: 'human',
    introducedAt: 'plain',
    aggregates: ['input-device'],
  },
  {
    id: 'browser',
    layer: 'browser',
    introducedAt: 'plain',
    aggregates: [
      'input-device',
      'keyboard-input',
      'gamepad-input',
      'touch-input',
      'input-ownership',
      'controller-profile',
      'control-engine',
      'control-sender',
      'rhythm',
      'websocket-transport',
    ],
  },
  {
    id: 'cloud-relay',
    layer: 'relay',
    introducedAt: 'plain',
    aggregates: [
      'control-protocol',
      'control-relay',
      'robot-room',
      'control-session',
      'emergency-stop',
    ],
  },
  {
    id: 'robot',
    layer: 'hardware',
    introducedAt: 'plain',
    aggregates: [
      'firmware-transport',
      'firmware-control',
      'safe-state',
      'safe-baseline',
      'message-ordering',
      'ttl-watchdog',
      'emergency-stop',
      'differential-mix',
      'robot-hardware',
      'motors',
      'control-ack',
    ],
  },

  // --- Technical/code concepts: the real pipeline ---
  {
    id: 'input-device',
    layer: 'human',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented'],
  },
  {
    id: 'keyboard-input',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented'],
    learnSlug: 'control/browser-input',
    sourceRefs: [
      { path: 'web/src/control/keyboard.ts', symbol: 'listenKeyboard', kind: 'source' },
      { path: 'web/src/control/keyboard.ts', symbol: 'actionForKey', kind: 'source' },
      { path: 'web/src/control/keyboard.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'gamepad-input',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented'],
    learnSlug: 'control/browser-input',
    sourceRefs: [
      { path: 'web/src/control/gamepad.ts', symbol: 'listenGamepad', kind: 'source' },
      { path: 'web/src/control/controls.ts', symbol: 'readSemantic', kind: 'source' },
      { path: 'web/src/control/gamepad.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'touch-input',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented'],
    sourceRefs: [{ path: 'web/src/control-view.ts', kind: 'source' }],
  },
  {
    id: 'input-ownership',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented', 'rationale'],
    learnSlug: 'control/input-ownership',
    sourceRefs: [
      { path: 'web/src/control/ownership.ts', symbol: 'InputOwnership', kind: 'source' },
      { path: 'web/src/control/ownership.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'controller-profile',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented', 'alternative'],
    learnSlug: 'control/controller-profiles',
    sourceRefs: [
      { path: 'web/src/control/profile.ts', symbol: 'evaluateProfile', kind: 'source' },
      { path: 'web/src/control/profile.ts', symbol: 'RACING_PROFILE', kind: 'source' },
      { path: 'web/src/control/profile.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'control-engine',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented'],
    learnSlug: 'control/control-engine',
    sourceRefs: [
      { path: 'web/src/control/engine.ts', symbol: 'ControlEngine', kind: 'source' },
      { path: 'protocol/src/control.ts', symbol: 'normalizeState', kind: 'source' },
      { path: 'web/src/control/engine.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'control-sender',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented'],
    learnSlug: 'control/control-sender',
    sourceRefs: [
      { path: 'web/src/transport/sender.ts', symbol: 'ControlSender', kind: 'source' },
      { path: 'web/src/transport/sender.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'rhythm',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented', 'rationale'],
    learnSlug: 'control/rhythm-heartbeats',
    sourceRefs: [
      { path: 'web/src/transport/rhythm.ts', symbol: 'decideSend', kind: 'source' },
      { path: 'web/src/transport/rhythm.ts', symbol: 'DEFAULT_RHYTHM', kind: 'source' },
      { path: 'web/src/transport/rhythm.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'websocket-transport',
    layer: 'browser',
    introducedAt: 'technical',
    group: 'browser',
    facts: ['implemented'],
    learnSlug: 'network/browser-transport',
    sourceRefs: [
      { path: 'web/src/transport/websocket.ts', symbol: 'WebSocketTransport', kind: 'source' },
    ],
  },
  {
    id: 'control-protocol',
    layer: 'relay',
    introducedAt: 'technical',
    group: 'cloud-relay',
    facts: ['implemented', 'rationale'],
    learnSlug: 'control/control-frames',
    sourceRefs: [
      { path: 'protocol/src/protocol.ts', symbol: 'ControlFrame', kind: 'source' },
      { path: 'protocol/src/protocol.ts', symbol: 'CONTROL_TTL_MS', kind: 'source' },
      { path: 'protocol/src/protocol.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'control-relay',
    layer: 'relay',
    introducedAt: 'technical',
    group: 'cloud-relay',
    facts: ['implemented'],
    learnSlug: 'network/relay-worker',
    sourceRefs: [
      { path: 'relay/src/index.ts', kind: 'source' },
      { path: 'relay/src/route.ts', kind: 'source' },
    ],
  },
  {
    id: 'robot-room',
    layer: 'relay',
    introducedAt: 'technical',
    group: 'cloud-relay',
    facts: ['implemented', 'rationale'],
    learnSlug: 'network/robot-room',
    sourceRefs: [
      { path: 'relay/src/room.ts', symbol: 'RobotRoom', kind: 'source' },
      { path: 'relay/src/room.do.test.ts', kind: 'test' },
    ],
  },
  {
    id: 'control-session',
    layer: 'relay',
    introducedAt: 'technical',
    group: 'cloud-relay',
    facts: ['implemented', 'rationale'],
    learnSlug: 'network/robot-room',
    sourceRefs: [
      { path: 'relay/src/room.ts', symbol: 'controlSessionId', kind: 'source' },
      { path: 'protocol/src/protocol.ts', symbol: 'ControlSession', kind: 'source' },
    ],
  },
  {
    id: 'firmware-transport',
    layer: 'firmware',
    introducedAt: 'technical',
    group: 'robot',
    facts: ['implemented'],
    learnSlug: 'network/reconnection',
    sourceRefs: [{ path: 'firmware/rovelink_device/transport.cpp', kind: 'source' }],
  },
  {
    id: 'firmware-control',
    layer: 'firmware',
    introducedAt: 'technical',
    group: 'robot',
    facts: ['implemented', 'rationale'],
    sourceRefs: [
      {
        path: 'firmware/rovelink_device/rovelink_device.ino',
        symbol: 'applyControlFrame',
        kind: 'source',
      },
      {
        path: 'firmware/rovelink_device/rovelink_device.ino',
        symbol: 'onSessionChanged',
        kind: 'source',
      },
      { path: 'firmware/rovelink_device/rovelink_device.ino', symbol: 'watchTtl', kind: 'source' },
    ],
  },
  {
    id: 'differential-mix',
    layer: 'firmware',
    introducedAt: 'technical',
    group: 'robot',
    facts: ['implemented'],
    learnSlug: 'control/differential-drive',
    sourceRefs: [
      { path: 'protocol/src/mix.ts', symbol: 'differentialMix', kind: 'source' },
      { path: 'protocol/src/mix.test.ts', kind: 'test' },
      {
        path: 'firmware/rovelink_device/rovelink_device.ino',
        symbol: 'applyMotors',
        kind: 'source',
      },
    ],
  },
  {
    id: 'robot-hardware',
    layer: 'hardware',
    introducedAt: 'technical',
    group: 'robot',
    facts: ['implemented', 'simulation'],
    sourceRefs: [{ path: 'firmware/rovelink_device/hardware.h', kind: 'source' }],
  },
  {
    id: 'motors',
    layer: 'hardware',
    introducedAt: 'code',
    group: 'robot',
    facts: ['implemented'],
    sourceRefs: [{ path: 'protocol/src/mix.ts', symbol: 'wheelPwm', kind: 'source' }],
  },
  {
    id: 'control-ack',
    layer: 'firmware',
    introducedAt: 'technical',
    group: 'robot',
    facts: ['implemented'],
    sourceRefs: [
      { path: 'protocol/src/protocol.ts', symbol: 'ControlAck', kind: 'source' },
      { path: 'web/src/transport/pending-acks.ts', symbol: 'PendingAckTracker', kind: 'source' },
    ],
  },
  // --- Safety & Authority concepts ---
  {
    id: 'safe-state',
    layer: 'firmware',
    introducedAt: 'technical',
    facts: ['implemented'],
    learnSlug: 'safety/safe-state',
    sourceRefs: [
      { path: 'protocol/src/control.ts', symbol: 'SAFE_STATE', kind: 'source' },
      {
        path: 'firmware/rovelink_device/rovelink_device.ino',
        symbol: 'enterSafeState',
        kind: 'source',
      },
    ],
  },
  {
    id: 'safe-baseline',
    layer: 'firmware',
    introducedAt: 'technical',
    facts: ['implemented', 'rationale'],
    learnSlug: 'safety/safe-baseline',
    sourceRefs: [
      {
        path: 'firmware/rovelink_device/rovelink_device.ino',
        symbol: 'applyControlFrame',
        kind: 'source',
      },
      { path: 'web/src/transport/sender.ts', symbol: 'establishSessionBaseline', kind: 'source' },
    ],
  },
  {
    id: 'message-ordering',
    layer: 'firmware',
    introducedAt: 'technical',
    facts: ['implemented'],
    learnSlug: 'safety/message-ordering',
    sourceRefs: [
      { path: 'protocol/src/protocol.ts', symbol: 'isNewerFrame', kind: 'source' },
      {
        path: 'firmware/rovelink_device/rovelink_device.ino',
        symbol: 'applyControlFrame',
        kind: 'source',
      },
    ],
  },
  {
    id: 'ttl-watchdog',
    layer: 'firmware',
    introducedAt: 'technical',
    facts: ['implemented', 'rationale'],
    learnSlug: 'safety/ttl-watchdog',
    sourceRefs: [
      { path: 'protocol/src/protocol.ts', symbol: 'CONTROL_TTL_MS', kind: 'source' },
      { path: 'firmware/rovelink_device/rovelink_device.ino', symbol: 'watchTtl', kind: 'source' },
      { path: 'web/src/transport/rhythm.ts', symbol: 'DEFAULT_RHYTHM', kind: 'source' },
    ],
  },
  {
    id: 'emergency-stop',
    layer: 'firmware',
    introducedAt: 'technical',
    facts: ['implemented', 'rationale'],
    learnSlug: 'safety/emergency-stop',
    sourceRefs: [
      { path: 'protocol/src/protocol.ts', symbol: 'EmergencyStop', kind: 'source' },
      {
        path: 'firmware/rovelink_device/rovelink_device.ino',
        symbol: 'onEmergencyStopReceived',
        kind: 'source',
      },
      { path: 'relay/src/room.ts', kind: 'source' },
    ],
  },
];

export const CONCEPT_BY_ID: ReadonlyMap<string, ConceptNode> = new Map(
  CONCEPTS.map((concept) => [concept.id, concept]),
);
