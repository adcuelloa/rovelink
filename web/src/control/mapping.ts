/**
 * Pure translation of a gamepad reading to axes and actions.
 *
 * This module does not touch `navigator.getGamepads()`: it receives numbers
 * and returns numbers, so it can be tested without a browser and a
 * DualSense-specific profile can be added later without touching the rest.
 */

import type { Gripper } from '@rovelink/protocol';

export type ButtonAction = 'arm' | 'disarm' | 'stop' | 'openGripper' | 'closeGripper';

export const BUTTON_ACTIONS: readonly ButtonAction[] = [
  'arm',
  'disarm',
  'stop',
  'openGripper',
  'closeGripper',
];

/**
 * Actions that fire on press, not on hold. The gripper is intentionally
 * excluded: it behaves like the keyboard, open or closed while held.
 */
export const INSTANT_ACTIONS: readonly ButtonAction[] = ['arm', 'disarm', 'stop'];

export interface GamepadMapping {
  readonly name: string;
  /** Index of the horizontal axis used for steering. */
  readonly steerAxis: number;
  /** Index of the vertical axis used for throttle. */
  readonly throttleAxis: number;
  /** The Y axis of sticks grows downward in the Gamepad API. */
  readonly invertThrottle: boolean;
  readonly buttons: Readonly<Record<ButtonAction, number>>;
}

/**
 * Standard mapping of the Gamepad API (reported by Xbox, DualShock and
 * DualSense in Chrome). DualSense-specific indices remain to be verified
 * with the real controller.
 */
export const STANDARD_MAPPING: GamepadMapping = {
  name: 'standard',
  steerAxis: 0,
  throttleAxis: 1,
  invertThrottle: true,
  buttons: {
    closeGripper: 0, // cross / A
    stop: 1, // circle / B
    openGripper: 2, // square / X
    disarm: 8, // share / view
    arm: 9, // options / menu
  },
};

export interface Deadzone {
  readonly stick: number;
}

export const DEFAULT_DEADZONE: Deadzone = { stick: 0.12 };

/**
 * Deadzone with rescale: when leaving the zone the axis starts at 0, not at
 * a jump — this is what makes a worn gamepad tolerable to drive.
 */
export function applyDeadzone(value: number, zone: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= zone) return 0;
  const scale = zone >= 1 ? 0 : (magnitude - zone) / (1 - zone);
  return Math.sign(value) * Math.min(1, scale);
}

/** Minimal gamepad reading: just enough to not depend on the Gamepad type. */
export interface GamepadReading {
  readonly axes: readonly number[];
  readonly buttons: readonly boolean[];
}

export interface GamepadInput {
  readonly throttle: number;
  readonly steering: number;
  readonly buttons: Readonly<Record<ButtonAction, boolean>>;
}

export const BUTTONS_RELEASED: Readonly<Record<ButtonAction, boolean>> = {
  arm: false,
  disarm: false,
  stop: false,
  openGripper: false,
  closeGripper: false,
};

export function readGamepad(
  reading: GamepadReading,
  mapping: GamepadMapping = STANDARD_MAPPING,
  deadzone: Deadzone = DEFAULT_DEADZONE,
): GamepadInput {
  const steer = applyDeadzone(reading.axes[mapping.steerAxis] ?? 0, deadzone.stick);
  const raw = applyDeadzone(reading.axes[mapping.throttleAxis] ?? 0, deadzone.stick);
  const buttons: Record<ButtonAction, boolean> = { ...BUTTONS_RELEASED };
  for (const action of BUTTON_ACTIONS) {
    buttons[action] = reading.buttons[mapping.buttons[action]] ?? false;
  }
  return {
    // `-0` adds nothing and pollutes comparisons downstream.
    throttle: mapping.invertThrottle && raw !== 0 ? -raw : raw,
    steering: steer,
    buttons,
  };
}

/**
 * Buttons that just transitioned from released to pressed. Discrete actions
 * (arm, stop, gripper) fire on transition, not on hold.
 */
export function newPresses(
  previous: Readonly<Record<ButtonAction, boolean>>,
  current: Readonly<Record<ButtonAction, boolean>>,
): readonly ButtonAction[] {
  return INSTANT_ACTIONS.filter((action) => current[action] && !previous[action]);
}

/** Closing wins if both are pressed: it is the gesture that grips the object. */
export function gripperFromButtons(buttons: Readonly<Record<ButtonAction, boolean>>): Gripper {
  if (buttons.closeGripper) return 'close';
  if (buttons.openGripper) return 'open';
  return 'idle';
}
