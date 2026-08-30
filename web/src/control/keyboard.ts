/**
 * Keyboard control: allows developing and testing without a gamepad connected.
 *
 * The gripper and arm keys are provisional; driving keys are final.
 */

import type { Gripper } from '@rovelink/protocol';

export type KeyAction =
  | 'forward'
  | 'backward'
  | 'left'
  | 'right'
  | 'stop'
  | 'openGripper'
  | 'closeGripper'
  | 'toggleArm';

const KEY_MAP: Readonly<Record<string, KeyAction>> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'backward',
  ArrowDown: 'backward',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'stop',
  KeyQ: 'openGripper',
  KeyE: 'closeGripper',
  KeyZ: 'toggleArm',
};

/** Actions that are valid while the key is held. */
const HELD_KEYS = new Set<KeyAction>([
  'forward',
  'backward',
  'left',
  'right',
  'openGripper',
  'closeGripper',
]);

export const actionForKey = (code: string): KeyAction | null => KEY_MAP[code] ?? null;

export const isHeld = (action: KeyAction): boolean => HELD_KEYS.has(action);

export interface Axes {
  readonly throttle: number;
  readonly steering: number;
}

/**
 * Keys → axes. Forward and backward at the same time cancel out, as do left
 * and right: this is the most predictable digital→analog translation for
 * driving.
 */
export function gripperFromKeys(active: ReadonlySet<KeyAction>): Gripper {
  if (active.has('closeGripper')) return 'close';
  if (active.has('openGripper')) return 'open';
  return 'idle';
}

export function axesFromKeys(active: ReadonlySet<KeyAction>): Axes {
  const axis = (plus: KeyAction, minus: KeyAction): number =>
    (active.has(plus) ? 1 : 0) - (active.has(minus) ? 1 : 0);
  return { throttle: axis('forward', 'backward'), steering: axis('right', 'left') };
}

/**
 * Typing in a field must never drive the robot. This is decided with plain
 * data so it can be tested without a DOM.
 */
export function isInField(tagName: string, editable: boolean): boolean {
  if (editable) return true;
  const name = tagName.toUpperCase();
  return name === 'INPUT' || name === 'TEXTAREA' || name === 'SELECT';
}

const isField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && isInField(target.tagName, target.isContentEditable);

export interface KeyboardHandlers {
  readonly onAxes: (axes: Axes) => void;
  readonly onGripper: (gripper: Gripper) => void;
  readonly onAction: (action: KeyAction) => void;
  /**
   * Fired once per relevant keydown (held or instant), never on keyup. This
   * exists purely so a caller can tell "keyboard was just used" apart from
   * "the axes were recomputed because a key was released" — see
   * control-view.ts's input-source ownership.
   */
  readonly onActivity?: () => void;
}

/** Listens to the keyboard and translates to axes and actions. Returns an unsubscribe function. */
export function listenKeyboard(target: Window, handlers: KeyboardHandlers): () => void {
  const active = new Set<KeyAction>();
  const abort = new AbortController();
  const { signal } = abort;

  const publish = (): void => {
    handlers.onAxes(axesFromKeys(active));
    handlers.onGripper(gripperFromKeys(active));
  };

  target.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.repeat || isField(event.target)) return;
      const action = actionForKey(event.code);
      if (action === null) return;
      event.preventDefault();
      handlers.onActivity?.();
      if (isHeld(action)) {
        active.add(action);
        publish();
        return;
      }
      handlers.onAction(action);
    },
    { signal },
  );

  target.addEventListener(
    'keyup',
    (event: KeyboardEvent) => {
      const action = actionForKey(event.code);
      if (action === null || !isHeld(action)) return;
      active.delete(action);
      publish();
    },
    { signal },
  );

  // Changing tab with a key held would leave the robot driving on its own.
  const releaseAll = (): void => {
    if (active.size === 0) return;
    active.clear();
    publish();
  };
  target.addEventListener('blur', releaseAll, { signal });
  target.document.addEventListener('visibilitychange', releaseAll, { signal });

  return () => abort.abort();
}
