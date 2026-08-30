/**
 * Deterministic single-owner arbitration between keyboard, touch, and
 * gamepad input. Exactly one source's axes/gripper reach the vehicle at a
 * time — never a sum of several, never a fixed priority list.
 *
 * This class only tracks state; it does not decide *when* a source deserves
 * ownership. That decision differs by source (a gamepad's stick crossing
 * its deadzone vs. a keyboard keydown vs. a touch pointerdown) and is made
 * by the caller — see control-view.ts — one line at each call site, so the
 * "meaningful activity" rule for each source stays visible and auditable
 * rather than hidden in here.
 */

import type { Gripper } from '@rovelink/protocol';

export type InputSource = 'keyboard' | 'touch' | 'gamepad';

export interface Axes {
  readonly throttle: number;
  readonly steering: number;
}

const IDLE_AXES: Axes = { throttle: 0, steering: 0 };

export class InputOwnership {
  #active: InputSource | null = null;
  readonly #axes: Record<InputSource, Axes> = {
    keyboard: IDLE_AXES,
    touch: IDLE_AXES,
    gamepad: IDLE_AXES,
  };
  readonly #grippers: Record<InputSource, Gripper> = {
    keyboard: 'idle',
    touch: 'idle',
    gamepad: 'idle',
  };

  get active(): InputSource | null {
    return this.#active;
  }

  /** The active source's axes, or (0, 0) if nothing has ever claimed ownership. */
  get axes(): Axes {
    return this.#active === null ? IDLE_AXES : this.#axes[this.#active];
  }

  /** The active source's gripper, or `idle` if nothing has ever claimed ownership. */
  get gripper(): Gripper {
    return this.#active === null ? 'idle' : this.#grippers[this.#active];
  }

  /** Explicit hand-off of ownership. Idempotent if `source` already owns it. */
  claim(source: InputSource): void {
    this.#active = source;
  }

  /** Records a source's current axes without changing who owns the output. */
  setAxes(source: InputSource, axes: Axes): void {
    this.#axes[source] = axes;
  }

  /** Records a source's current gripper without changing who owns the output. */
  setGripper(source: InputSource, gripper: Gripper): void {
    this.#grippers[source] = gripper;
  }
}
