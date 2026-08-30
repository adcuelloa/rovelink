/**
 * ControlEngine: single source of truth for the driving state.
 *
 * Keyboard and gamepad write here; transport and UI read from here. The engine
 * stores the CURRENT STATE, never a queue: if two values arrive in a row the
 * last one wins (latest state wins).
 */

import type { ControlState, Gripper } from '@rovelink/protocol';
import {
  SAFE_STATE,
  applyArmed,
  significantChange,
  stoppedState,
  normalizeState,
} from '@rovelink/protocol';

export type ChangeReason = 'input' | 'arm' | 'stop' | 'disconnect';

export interface ControlChange {
  readonly state: ControlState;
  readonly reason: ChangeReason;
}

export type ControlListener = (change: ControlChange) => void;

export interface EngineOptions {
  /** Minimum axis change to notify listeners. */
  readonly threshold?: number;
}

export class ControlEngine {
  #state: ControlState = SAFE_STATE;
  #notified: ControlState = SAFE_STATE;
  readonly #listeners = new Set<ControlListener>();
  readonly #threshold: number;

  constructor(options: EngineOptions = {}) {
    this.#threshold = options.threshold ?? 0.02;
  }

  get state(): ControlState {
    return this.#state;
  }

  subscribe(listener: ControlListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Driving axes. Without arming they are stored but never reach the vehicle. */
  axes(throttle: number, steering: number): void {
    this.#set({ ...this.#state, throttle, steering }, 'input');
  }

  gripper(gripper: Gripper): void {
    this.#set({ ...this.#state, gripper }, 'input');
  }

  arm(armed: boolean): void {
    if (this.#state.armed === armed) return;
    this.#set({ ...stoppedState(this.#state), armed }, 'arm');
  }

  toggleArm(): void {
    this.arm(!this.#state.armed);
  }

  /** Emergency stop: disarms and zeroes everything immediately. */
  emergencyStop(): void {
    this.#set(SAFE_STATE, 'stop', true);
  }

  /** Safe state on link or controller loss. */
  safeState(reason: ChangeReason = 'disconnect'): void {
    this.#set(SAFE_STATE, reason, true);
  }

  #set(raw: ControlState, reason: ChangeReason, force = false): void {
    const state = normalizeState(raw);
    this.#state = state;
    if (!force && !significantChange(this.#notified, state, this.#threshold)) return;
    this.#notified = state;
    const change: ControlChange = { state, reason };
    for (const listener of this.#listeners) listener(change);
  }
}

/** What the vehicle must actually obey with the current arming state. */
export const effectiveState = (state: ControlState): ControlState => applyArmed(state);
