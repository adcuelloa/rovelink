/**
 * Semantic physical controller identifiers.
 *
 * Raw standard-Gamepad axis/button indices are mapped to these names in
 * exactly one place — `STANDARD_AXES`/`STANDARD_BUTTONS` below. Nothing
 * else in the app (profile.ts, gamepad.ts, the settings UI) ever touches a
 * raw index again; they deal only in `AxisControl`/`ButtonControl` names.
 * This does not depend on any particular USB vendor/product id — a
 * DualSense is the primary physical test target, but any controller Chrome
 * reports as `mapping: "standard"` uses the same layout.
 */

import type { GamepadReading } from './mapping.ts';

export type AxisControl = 'LeftStickX' | 'LeftStickY' | 'RightStickX' | 'RightStickY';

export type ButtonControl =
  | 'L1'
  | 'R1'
  | 'L2'
  | 'R2'
  | 'L3'
  | 'R3'
  | 'DPadUp'
  | 'DPadDown'
  | 'DPadLeft'
  | 'DPadRight'
  | 'Cross'
  | 'Circle'
  | 'Square'
  | 'Triangle'
  | 'Create'
  | 'Options';

/** Any physical control, axis or button. Used only where both are valid —
 * profile bindings use the narrower `AxisControl`/`ButtonControl` types so
 * an invalid pairing (e.g. a stick bound to Arm) cannot be constructed. */
export type PhysicalControl = AxisControl | ButtonControl;

export const AXIS_CONTROLS: readonly AxisControl[] = [
  'LeftStickX',
  'LeftStickY',
  'RightStickX',
  'RightStickY',
];

export const BUTTON_CONTROLS: readonly ButtonControl[] = [
  'Cross',
  'Circle',
  'Square',
  'Triangle',
  'L1',
  'R1',
  'L2',
  'R2',
  'Create',
  'Options',
  'L3',
  'R3',
  'DPadUp',
  'DPadDown',
  'DPadLeft',
  'DPadRight',
];

export const ALL_CONTROLS: readonly PhysicalControl[] = [...AXIS_CONTROLS, ...BUTTON_CONTROLS];

/** Standard Gamepad API axis indices — verified against a real DualSense. */
export const STANDARD_AXES: Readonly<Record<AxisControl, number>> = {
  LeftStickX: 0,
  LeftStickY: 1,
  RightStickX: 2,
  RightStickY: 3,
};

/** Standard Gamepad API button indices — verified against a real DualSense
 * (see Problem 5's physical verification for L1/R1/L2/R2/L3/R3; the rest
 * follow the same W3C Standard Gamepad layout). */
export const STANDARD_BUTTONS: Readonly<Record<ButtonControl, number>> = {
  Cross: 0,
  Circle: 1,
  Square: 2,
  Triangle: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  Create: 8,
  Options: 9,
  L3: 10,
  R3: 11,
  DPadUp: 12,
  DPadDown: 13,
  DPadLeft: 14,
  DPadRight: 15,
};

export const isAxisControl = (control: unknown): control is AxisControl =>
  typeof control === 'string' && Object.hasOwn(STANDARD_AXES, control);

export const isButtonControl = (control: unknown): control is ButtonControl =>
  typeof control === 'string' && Object.hasOwn(STANDARD_BUTTONS, control);

/** One number per named control per frame: an axis's raw value (-1..1), or
 * a button's analog depth (0..1) — 0/1 for a purely digital button, a
 * continuum for a trigger. Missing hardware reads as 0 either way. */
export type SemanticValues = Readonly<Record<PhysicalControl, number>>;

const PRESS_THRESHOLD = 0.5;

/** Above this, a button (digital or a trigger used as one) reads as held. */
export const isPressed = (value: number): boolean => value > PRESS_THRESHOLD;

/** A fully-typed zero baseline. Spread into a fresh mutable copy in
 * `readSemantic` below — avoids ever casting an empty object into the full
 * record shape. Also handy as a base for tests and for capture-mode idle
 * state. */
export const ZERO_SEMANTIC_VALUES: SemanticValues = {
  LeftStickX: 0,
  LeftStickY: 0,
  RightStickX: 0,
  RightStickY: 0,
  Cross: 0,
  Circle: 0,
  Square: 0,
  Triangle: 0,
  L1: 0,
  R1: 0,
  L2: 0,
  R2: 0,
  Create: 0,
  Options: 0,
  L3: 0,
  R3: 0,
  DPadUp: 0,
  DPadDown: 0,
  DPadLeft: 0,
  DPadRight: 0,
};

/**
 * Reduces a raw gamepad reading to semantic control values. Pure — takes
 * the same plain `{ axes, buttons, buttonValues }` shape gamepad.ts
 * already samples into, so it needs no browser API of its own.
 */
export function readSemantic(reading: GamepadReading): SemanticValues {
  const values = { ...ZERO_SEMANTIC_VALUES };
  for (const control of AXIS_CONTROLS) {
    values[control] = reading.axes[STANDARD_AXES[control]] ?? 0;
  }
  for (const control of BUTTON_CONTROLS) {
    const index = STANDARD_BUTTONS[control];
    values[control] = reading.buttonValues?.[index] ?? (reading.buttons[index] ? 1 : 0);
  }
  return values;
}
