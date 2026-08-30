/**
 * Real-time remote control model.
 *
 * `ControlState` is the CURRENT state of the vehicle, not a command queue:
 * if two states arrive in sequence, the last one wins and the previous one is
 * discarded (LATEST STATE WINS). Old movements are never replayed.
 */

export type Gripper = 'idle' | 'open' | 'close';

export interface ControlState {
  /** -1 (reverse) .. 1 (forward) */
  readonly throttle: number;
  /** -1 (left) .. 1 (right) */
  readonly steering: number;
  readonly gripper: Gripper;
  /** Without `armed` the vehicle ignores throttle and steering. */
  readonly armed: boolean;
}

/** State the vehicle falls back to on disconnect, emergency stop, or expired TTL. */
export const SAFE_STATE: ControlState = {
  throttle: 0,
  steering: 0,
  gripper: 'idle',
  armed: false,
};

const GRIPPER_VALUES = new Set<string>(['idle', 'open', 'close']);

export const isGripper = (value: unknown): value is Gripper =>
  typeof value === 'string' && GRIPPER_VALUES.has(value);

/** Clamps an axis to -1..1. Non-finite values are treated as 0. */
export function clampAxis(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return 1;
  if (value < -1) return -1;
  // Prevents -0 from sneaking into comparisons and JSON.
  return value === 0 ? 0 : value;
}

/** State as it arrives from outside: every field is still unverified. */
export interface PartialState {
  readonly throttle?: unknown;
  readonly steering?: unknown;
  readonly gripper?: unknown;
  readonly armed?: unknown;
}

const toNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

/** Builds a valid `ControlState` from unverified data. */
export function normalizeState(partial: PartialState): ControlState {
  return {
    throttle: clampAxis(toNumber(partial.throttle)),
    steering: clampAxis(toNumber(partial.steering)),
    gripper: isGripper(partial.gripper) ? partial.gripper : 'idle',
    armed: partial.armed === true,
  };
}

/** Stops movement while preserving armed state (soft stop, no disarm). */
export function stoppedState(state: ControlState): ControlState {
  return { throttle: 0, steering: 0, gripper: 'idle', armed: state.armed };
}

/**
 * Makes the state ready for the vehicle: without armed there is no movement.
 * Applied on both the sending end and the executing end.
 */
export function applyArmed(state: ControlState): ControlState {
  return state.armed ? state : SAFE_STATE;
}

/**
 * A change worth transmitting or re-rendering. The threshold avoids wasting
 * packets and renders with analog stick noise.
 */
export function significantChange(
  previous: ControlState,
  next: ControlState,
  threshold = 0.02,
): boolean {
  return (
    previous.armed !== next.armed ||
    previous.gripper !== next.gripper ||
    Math.abs(previous.throttle - next.throttle) >= threshold ||
    Math.abs(previous.steering - next.steering) >= threshold
  );
}

/** The state sends nothing to the vehicle: used to skip the movement heartbeat. */
export const isIdle = (state: ControlState): boolean =>
  state.throttle === 0 && state.steering === 0 && state.gripper === 'idle';
