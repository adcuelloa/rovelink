/**
 * Remote control protocol (browser <-> relay <-> ESP32).
 *
 * Versioned in `v` so it can change without breaking firmware already
 * burned. Field names travel in English because firmware and the Worker
 * share them; this repository's code stays in English.
 */

import type { ControlState } from './control.ts';
import { isGripper } from './control.ts';

export const PROTOCOL_VERSION = 1;

/** Who each socket is inside a room. */
export type Role = 'controller' | 'device';

/**
 * Default TTL of a driving frame: after that time it is no longer obeyed.
 *
 * Must stay well above the sender's heartbeat cadence (`DEFAULT_RHYTHM.heartbeatMs`
 * in web/src/transport/rhythm.ts): a tight margin makes the watchdog trip on
 * ordinary Internet/Wi-Fi/Cloudflare jitter, not just on a real link loss.
 */
export const CONTROL_TTL_MS = 500;

interface Envelope {
  readonly v: typeof PROTOCOL_VERSION;
}

export interface DeviceRegistration extends Envelope {
  readonly type: 'device.register';
  readonly robotId: string;
  /** Reserved for device credentials (later phase). */
  readonly token?: string;
  readonly firmware?: string;
}

export interface ControllerRegistration extends Envelope {
  readonly type: 'controller.register';
  readonly robotId: string;
  /** Reserved for operator authentication (later phase). */
  readonly token?: string;
}

/** Driving state. No queue: the highest `seq` wins and old ones are discarded. */
export interface ControlFrame extends Envelope, ControlState {
  readonly type: 'control';
  readonly seq: number;
  readonly sentAt: number;
  readonly ttlMs: number;
}

export interface Telemetry extends Envelope {
  readonly type: 'telemetry';
  readonly sentAt: number;
  /** Last `seq` of control applied by the vehicle. */
  readonly ackSeq?: number;
  readonly rssi?: number;
  readonly battery?: number;
  readonly throttle?: number;
  readonly steering?: number;
  readonly armed?: boolean;
}

export interface Ping extends Envelope {
  readonly type: 'ping';
  readonly id: number;
  readonly sentAt: number;
}

export interface Pong extends Envelope {
  readonly type: 'pong';
  readonly id: number;
  /** `sentAt` from the ping, used to compute RTT without synchronized clocks. */
  readonly sentAt: number;
  readonly echoAt: number;
}

export interface EmergencyStop extends Envelope {
  readonly type: 'emergency-stop';
  readonly sentAt: number;
  readonly reason?: string;
}

/** Room presence: published by the relay to both ends. */
export interface RoomState extends Envelope {
  readonly type: 'room';
  readonly robotId: string;
  readonly deviceOnline: boolean;
  readonly controllerOnline: boolean;
}

export type RemoteMessage =
  | DeviceRegistration
  | ControllerRegistration
  | ControlFrame
  | Telemetry
  | Ping
  | Pong
  | EmergencyStop
  | RoomState;

export type MessageType = RemoteMessage['type'];

function isEnvelope(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'v' in value &&
    value.v === PROTOCOL_VERSION &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isOptionalNumber = (value: unknown): boolean => value === undefined || isNumber(value);

const isOptionalString = (value: unknown): boolean =>
  value === undefined || typeof value === 'string';

function isControlFrame(m: Record<string, unknown>): boolean {
  return (
    isNumber(m.seq) &&
    isNumber(m.sentAt) &&
    isNumber(m.ttlMs) &&
    isNumber(m.throttle) &&
    isNumber(m.steering) &&
    isGripper(m.gripper) &&
    typeof m.armed === 'boolean'
  );
}

/**
 * Validates the shape of a message. Axes are not clamped here: that is done
 * by `normalizeState`, which is the single gateway to the control model.
 */
export function isRemoteMessage(value: unknown): value is RemoteMessage {
  if (!isEnvelope(value)) return false;
  const m = value;

  switch (m.type) {
    case 'device.register':
      return (
        typeof m.robotId === 'string' && isOptionalString(m.token) && isOptionalString(m.firmware)
      );
    case 'controller.register':
      return typeof m.robotId === 'string' && isOptionalString(m.token);
    case 'control':
      return isControlFrame(m);
    case 'telemetry':
      return isNumber(m.sentAt) && isOptionalNumber(m.ackSeq) && isOptionalNumber(m.rssi);
    case 'ping':
      return isNumber(m.id) && isNumber(m.sentAt);
    case 'pong':
      return isNumber(m.id) && isNumber(m.sentAt) && isNumber(m.echoAt);
    case 'emergency-stop':
      return isNumber(m.sentAt) && isOptionalString(m.reason);
    case 'room':
      return (
        typeof m.robotId === 'string' &&
        typeof m.deviceOnline === 'boolean' &&
        typeof m.controllerOnline === 'boolean'
      );
    default:
      return false;
  }
}

export function createControlFrame(
  state: ControlState,
  seq: number,
  now: number,
  ttlMs: number = CONTROL_TTL_MS,
): ControlFrame {
  return {
    v: PROTOCOL_VERSION,
    type: 'control',
    seq,
    sentAt: now,
    ttlMs,
    throttle: state.throttle,
    steering: state.steering,
    gripper: state.gripper,
    armed: state.armed,
  };
}

/**
 * An expired frame is not obeyed: the vehicle falls back to safe state. It is
 * the link watchdog, which is why the TTL travels inside the frame itself.
 */
export const isFrameExpired = (frame: ControlFrame, now: number): boolean =>
  now - frame.sentAt > frame.ttlMs;

/** Discards retransmissions and out-of-order arrivals: only the highest `seq` advances. */
export const isNewerFrame = (frame: ControlFrame, lastSeq: number): boolean => frame.seq > lastSeq;
