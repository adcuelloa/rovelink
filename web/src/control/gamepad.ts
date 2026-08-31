/**
 * Gamepad API layer. Samples with requestAnimationFrame and only publishes
 * when something actually changed: the UI and transport must not be bothered
 * with 60 samples per second of a still stick.
 */

import type { Gripper } from '@rovelink/protocol';

import { readSemantic } from './controls.ts';
import type { ButtonAction, GamepadInput } from './mapping.ts';
import { BUTTONS_RELEASED, gripperFromButtons, newPresses } from './mapping.ts';
import { evaluateProfile, RACING_PROFILE } from './profile.ts';
import type { ControllerProfile } from './profile.ts';

export interface GamepadState {
  readonly connected: boolean;
  readonly id: string;
  /** `standard` means controls.ts's STANDARD_AXES/STANDARD_BUTTONS indices
   * are valid for this controller. */
  readonly mapping: string;
}

export const NO_GAMEPAD: GamepadState = { connected: false, id: '', mapping: '' };

export interface GamepadHandlers {
  readonly onAxes: (throttle: number, steering: number) => void;
  readonly onGripper: (gripper: Gripper) => void;
  readonly onAction: (action: ButtonAction) => void;
  readonly onState: (state: GamepadState) => void;
}

/** The subset of a `Gamepad` this module actually reads. */
export interface GamepadLike {
  readonly index: number;
  readonly id: string;
  readonly mapping: string;
  readonly axes: readonly number[];
  /** `value` (0..1) is the analog trigger depth — used for R2/L2 throttle. */
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

interface GamepadLikeEvent {
  readonly gamepad: GamepadLike;
}

/**
 * The subset of `window` this module actually needs — not the whole DOM
 * `Window` — so a test can fake it without touching a real browser global.
 */
export interface GamepadTarget {
  readonly navigator: { getGamepads(): readonly (GamepadLike | null)[] };
  addEventListener(
    type: 'gamepadconnected' | 'gamepaddisconnected',
    listener: (event: GamepadLikeEvent) => void,
    options: { signal: AbortSignal },
  ): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

export interface GamepadOptions {
  /** The active controller profile — deadzone, inversion, and every
   * binding live here now (see profile.ts), not as separate options. A
   * profile change is never applied to a running instance; the caller
   * stops this listener and starts a fresh one instead (see Problem 6's
   * profile-switch and settings-open/close safety sequence). */
  readonly profile?: ControllerProfile;
  /** Minimum axis change to publish. */
  readonly threshold?: number;
}

function copyAxes(dest: number[], src: readonly number[]): boolean {
  let changed = dest.length !== src.length;
  dest.length = src.length;
  for (const [i, value] of src.entries()) {
    if (dest[i] !== value) {
      dest[i] = value;
      changed = true;
    }
  }
  return changed;
}

function copyButtons(
  destPressed: boolean[],
  destValues: number[],
  src: GamepadLike['buttons'],
): boolean {
  let changed = destPressed.length !== src.length;
  destPressed.length = src.length;
  destValues.length = src.length;
  for (const [i, button] of src.entries()) {
    if (destPressed[i] !== button.pressed) {
      destPressed[i] = button.pressed;
      changed = true;
    }
    // Analog trigger depth can change without crossing the `pressed`
    // threshold — that continuous value drives throttle, so a value-only
    // change must still count as "changed" and get published.
    if (destValues[i] !== button.value) {
      destValues[i] = button.value;
      changed = true;
    }
  }
  return changed;
}

/**
 * Starts sampling when a gamepad connects and stops when all disconnect, so
 * the animation loop does not spin idle. Returns an unsubscribe function.
 */
export function listenGamepad(
  target: GamepadTarget,
  handlers: GamepadHandlers,
  options: GamepadOptions = {},
): () => void {
  const profile = options.profile ?? RACING_PROFILE;
  const threshold = options.threshold ?? 0.02;

  // Reused each frame: the loop must not allocate per frame.
  const rawAxes: number[] = [];
  const rawButtons: boolean[] = [];
  const rawButtonValues: number[] = [];
  const reading = { axes: rawAxes, buttons: rawButtons, buttonValues: rawButtonValues };

  let prevButtons: Readonly<Record<ButtonAction, boolean>> = BUTTONS_RELEASED;
  let publishedGripper: Gripper = 'idle';
  let publishedThrottle = 0;
  let publishedSteering = 0;
  let index: number | null = null;
  let animation: number | null = null;
  const abort = new AbortController();

  const active = (): GamepadLike | null => {
    if (index === null) return null;
    return target.navigator.getGamepads()[index] ?? null;
  };

  function publish(input: GamepadInput): void {
    if (
      Math.abs(input.throttle - publishedThrottle) >= threshold ||
      Math.abs(input.steering - publishedSteering) >= threshold ||
      // Returning exactly to zero is always published: it is the brake.
      (input.throttle === 0 && publishedThrottle !== 0) ||
      (input.steering === 0 && publishedSteering !== 0)
    ) {
      publishedThrottle = input.throttle;
      publishedSteering = input.steering;
      handlers.onAxes(input.throttle, input.steering);
    }
    for (const action of newPresses(prevButtons, input.buttons)) {
      handlers.onAction(action);
    }
    const gripper = gripperFromButtons(input.buttons);
    if (gripper !== publishedGripper) {
      publishedGripper = gripper;
      handlers.onGripper(gripper);
    }
    prevButtons = input.buttons;
  }

  function sample(): void {
    animation = target.requestAnimationFrame(sample);
    const gamepad = active();
    if (gamepad === null) return;
    const axesChanged = copyAxes(rawAxes, gamepad.axes);
    const buttonsChanged = copyButtons(rawButtons, rawButtonValues, gamepad.buttons);
    if (!axesChanged && !buttonsChanged) return;
    publish(evaluateProfile(readSemantic(reading), profile));
  }

  function start(gamepad: GamepadLike): void {
    index = gamepad.index;
    handlers.onState({ connected: true, id: gamepad.id, mapping: gamepad.mapping });
    // Baseline whatever the stick/buttons read at the instant of connection
    // — including a button that happens to already be held, or an axis
    // that happens to already be off-center — so it is never itself
    // reported as movement or a fresh button edge. Only a *change* from
    // this baseline publishes. Without this, the reused rawAxes/rawButtons
    // buffers start empty, so the very first sample always looks "changed"
    // purely from array-length mismatch, regardless of the actual reading.
    copyAxes(rawAxes, gamepad.axes);
    copyButtons(rawButtons, rawButtonValues, gamepad.buttons);
    const baseline = evaluateProfile(readSemantic(reading), profile);
    prevButtons = baseline.buttons;
    publishedThrottle = baseline.throttle;
    publishedSteering = baseline.steering;
    publishedGripper = gripperFromButtons(baseline.buttons);
    if (animation === null) animation = target.requestAnimationFrame(sample);
  }

  function stop(): void {
    index = null;
    if (animation !== null) target.cancelAnimationFrame(animation);
    animation = null;
    prevButtons = BUTTONS_RELEASED;
    publishedGripper = 'idle';
    publishedThrottle = 0;
    publishedSteering = 0;
    handlers.onState(NO_GAMEPAD);
    handlers.onAxes(0, 0);
    handlers.onGripper('idle');
  }

  target.addEventListener(
    'gamepadconnected',
    (event) => {
      if (index === null) start(event.gamepad);
    },
    { signal: abort.signal },
  );

  target.addEventListener(
    'gamepaddisconnected',
    (event) => {
      if (event.gamepad.index === index) stop();
    },
    { signal: abort.signal },
  );

  // A gamepad connected before page load does not fire the event until the
  // user touches it; if already visible, pick it up immediately.
  for (const gamepad of target.navigator.getGamepads()) {
    if (gamepad !== null) {
      start(gamepad);
      break;
    }
  }

  return () => {
    abort.abort();
    if (animation !== null) target.cancelAnimationFrame(animation);
    animation = null;
    index = null;
  };
}
