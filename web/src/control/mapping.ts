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

/** Buttons looked up by a single index. `stop` is handled separately below. */
export type MappedButtonAction = Exclude<ButtonAction, 'stop'>;

const MAPPED_ACTIONS: readonly MappedButtonAction[] = [
  'arm',
  'disarm',
  'openGripper',
  'closeGripper',
];

export interface GamepadMapping {
  readonly name: string;
  /** Index of the horizontal axis used for steering (left stick X). */
  readonly steerAxis: number;
  /**
   * Car-style throttle: R2/L2 analog trigger button indices, read from
   * their `.value` (0..1), not `.pressed`. throttle = forward - reverse.
   */
  readonly throttleTriggers: { readonly forward: number; readonly reverse: number };
  readonly buttons: Readonly<Record<MappedButtonAction, number>>;
  /**
   * Emergency Stop is a two-button chord (both indices held at once), never
   * a single face button — those are hit by accident too easily. This is
   * this milestone's default assignment for a standard-mapped controller,
   * not a fixed hardware-independent standard: it is L3+R3 stick-clicks
   * because L2/R2 are now drive controls (throttle), and should be
   * revisited if the sticks ever gain another role.
   */
  readonly stopChord: readonly [number, number];
}

/**
 * Standard mapping of the Gamepad API (reported by Xbox, DualShock and
 * DualSense in Chrome). Indices verified against a real DualSense over USB
 * — see Problem 5's physical verification.
 */
export const STANDARD_MAPPING: GamepadMapping = {
  name: 'standard',
  steerAxis: 0, // left stick X
  throttleTriggers: { forward: 7, reverse: 6 }, // R2, L2
  buttons: {
    openGripper: 4, // L1
    closeGripper: 5, // R1
    disarm: 8, // share / create
    arm: 9, // options
  },
  stopChord: [10, 11], // L3 + R3 (stick clicks) held together
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

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
  /** Analog magnitude per button index (0..1) — only L2/R2 currently use this. */
  readonly buttonValues?: readonly number[];
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
  const forward = clamp(reading.buttonValues?.[mapping.throttleTriggers.forward] ?? 0, 0, 1);
  const reverse = clamp(reading.buttonValues?.[mapping.throttleTriggers.reverse] ?? 0, 0, 1);
  const throttle = clamp(forward - reverse, -1, 1);
  const buttons: Record<ButtonAction, boolean> = { ...BUTTONS_RELEASED };
  for (const action of MAPPED_ACTIONS) {
    buttons[action] = reading.buttons[mapping.buttons[action]] ?? false;
  }
  const [chordA, chordB] = mapping.stopChord;
  buttons.stop = (reading.buttons[chordA] ?? false) && (reading.buttons[chordB] ?? false);
  return { throttle, steering: steer, buttons };
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

/** Both held at once is ambiguous, not a preference for either direction: idle. */
export function gripperFromButtons(buttons: Readonly<Record<ButtonAction, boolean>>): Gripper {
  if (buttons.closeGripper && buttons.openGripper) return 'idle';
  if (buttons.closeGripper) return 'close';
  if (buttons.openGripper) return 'open';
  return 'idle';
}

// A real DualSense on Linux/Chrome reports as "Sony Interactive
// Entertainment DualSense Wireless Controller (STANDARD GAMEPAD Vendor: …)"
// — a 32-char cap truncated right before "DualSense", the one word that
// actually identifies the controller. 44 keeps that word for this real,
// observed id while still bounding pathological ones.
const MAX_GAMEPAD_NAME_LENGTH = 44;

/**
 * Normalizes a raw `Gamepad.id` for display. Chrome typically reports
 * "<name> (STANDARD GAMEPAD Vendor: xxxx Product: yyyy)" — keep just the
 * name, and hard-cap length for ids that don't follow that shape.
 */
export function normalizeGamepadName(id: string): string {
  const trimmed = id.trim();
  const parenIndex = trimmed.indexOf(' (');
  const name = (parenIndex === -1 ? trimmed : trimmed.slice(0, parenIndex)).trim();
  const base = name.length > 0 ? name : 'Controller';
  return base.length > MAX_GAMEPAD_NAME_LENGTH
    ? `${base.slice(0, MAX_GAMEPAD_NAME_LENGTH - 1)}…`
    : base;
}
