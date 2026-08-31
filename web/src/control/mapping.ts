/**
 * Pure shared building blocks for gamepad input: button-action edge
 * detection, gripper resolution, deadzone rescale, and reading/input
 * shapes. What used to be a hardcoded standard-Gamepad mapping now lives
 * in controls.ts (semantic control names + raw index layout) and
 * profile.ts (data-driven bindings, `evaluateProfile`) — see Problem 6.
 * This module does not touch `navigator.getGamepads()`: it receives
 * numbers and returns numbers, so it can be tested without a browser.
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
