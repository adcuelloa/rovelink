/**
 * Gamepad API layer. Samples with requestAnimationFrame and only publishes
 * when something actually changed: the UI and transport must not be bothered
 * with 60 samples per second of a still stick.
 */

import type { Gripper } from '@rovelink/protocol';

import type { ButtonAction, Deadzone, GamepadInput, GamepadMapping } from './mapping.ts';
import {
  BUTTONS_RELEASED,
  DEFAULT_DEADZONE,
  STANDARD_MAPPING,
  readGamepad,
  gripperFromButtons,
  newPresses,
} from './mapping.ts';

export interface GamepadState {
  readonly connected: boolean;
  readonly id: string;
  /** `standard` means the STANDARD_MAPPING indices are valid. */
  readonly mapping: string;
}

export const NO_GAMEPAD: GamepadState = { connected: false, id: '', mapping: '' };

export interface GamepadHandlers {
  readonly onAxes: (throttle: number, steering: number) => void;
  readonly onGripper: (gripper: Gripper) => void;
  readonly onAction: (action: ButtonAction) => void;
  readonly onState: (state: GamepadState) => void;
}

export interface GamepadOptions {
  readonly mapping?: GamepadMapping;
  readonly deadzone?: Deadzone;
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

function copyButtons(dest: boolean[], src: readonly GamepadButton[]): boolean {
  let changed = dest.length !== src.length;
  dest.length = src.length;
  for (const [i, button] of src.entries()) {
    if (dest[i] !== button.pressed) {
      dest[i] = button.pressed;
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
  target: Window,
  handlers: GamepadHandlers,
  options: GamepadOptions = {},
): () => void {
  const mapping = options.mapping ?? STANDARD_MAPPING;
  const deadzone = options.deadzone ?? DEFAULT_DEADZONE;
  const threshold = options.threshold ?? 0.02;

  // Reused each frame: the loop must not allocate per frame.
  const rawAxes: number[] = [];
  const rawButtons: boolean[] = [];
  const reading = { axes: rawAxes, buttons: rawButtons };

  let prevButtons: Readonly<Record<ButtonAction, boolean>> = BUTTONS_RELEASED;
  let publishedGripper: Gripper = 'idle';
  let publishedThrottle = 0;
  let publishedSteering = 0;
  let index: number | null = null;
  let animation: number | null = null;
  const abort = new AbortController();

  const active = (): Gamepad | null => {
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
    const buttonsChanged = copyButtons(rawButtons, gamepad.buttons);
    if (!axesChanged && !buttonsChanged) return;
    publish(readGamepad(reading, mapping, deadzone));
  }

  function start(gamepad: Gamepad): void {
    index = gamepad.index;
    handlers.onState({ connected: true, id: gamepad.id, mapping: gamepad.mapping });
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
    (event: GamepadEvent) => {
      if (index === null) start(event.gamepad);
    },
    { signal: abort.signal },
  );

  target.addEventListener(
    'gamepaddisconnected',
    (event: GamepadEvent) => {
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
