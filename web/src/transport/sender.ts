/**
 * Applies the rhythm from `rhythm.ts` to a `RobotTransport`.
 *
 * The control engine notifies every change; this sender decides whether a
 * packet goes out. It also keeps the heartbeat alive so the vehicle TTL
 * does not expire while the operator holds the stick still.
 */

import type { ControlState } from '@rovelink/protocol';

import type { RhythmOptions } from './rhythm.ts';
import { DEFAULT_RHYTHM, decideSend } from './rhythm.ts';
import type { RobotTransport } from './types.ts';

export interface SenderOptions extends Partial<RhythmOptions> {
  readonly now?: () => number;
}

export class ControlSender {
  readonly #transport: RobotTransport;
  readonly #rhythm: RhythmOptions;
  readonly #now: () => number;
  #lastSent: ControlState | null = null;
  #lastSentMs = 0;
  #heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(transport: RobotTransport, options: SenderOptions = {}) {
    this.#transport = transport;
    this.#rhythm = { ...DEFAULT_RHYTHM, ...options };
    this.#now = options.now ?? (() => performance.now());
  }

  /** Start the heartbeat by reading the current state from the control engine. */
  start(readState: () => ControlState): void {
    this.stop();
    this.#heartbeat = setInterval(() => this.update(readState()), this.#rhythm.heartbeatMs);
  }

  stop(): void {
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  /** Reset the rhythm: after reconnecting, the first state goes out without waiting. */
  reset(): void {
    this.#lastSent = null;
    this.#lastSentMs = 0;
  }

  update(state: ControlState): void {
    const now = this.#now();
    const decision = decideSend(this.#lastSent, state, now - this.#lastSentMs, this.#rhythm);
    if (decision === 'skip') return;
    this.#lastSent = state;
    this.#lastSentMs = now;
    this.#transport.sendControl(state);
  }

  emergencyStop(): void {
    this.reset();
    this.#transport.emergencyStop();
  }
}
