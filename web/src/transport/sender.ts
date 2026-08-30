/**
 * Applies the rhythm from `rhythm.ts` to a `RobotTransport`.
 *
 * The control engine notifies every change; this sender decides whether a
 * packet goes out. It also keeps the heartbeat alive so the vehicle TTL
 * does not expire while the operator holds the stick still.
 */

import type { ControlState } from '@rovelink/protocol';
import { SAFE_STATE } from '@rovelink/protocol';

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

  /**
   * One-shot, unconditional SAFE_STATE send: the device's per-session
   * readiness gate can only be unlocked by an explicit armed=false frame
   * (see rovelink_device.ino's sessionReady), but rhythm.ts's `decideSend`
   * deliberately sends nothing at all while disarmed+idle — the correct
   * steady-state optimization, not a bug — so a freshly-established session
   * could otherwise go silent forever if the operator's first action
   * happens to be Arm rather than an idle tick. Call this exactly once, in
   * direct response to the relay's authoritative session-established
   * notification (never on a bare socket open, a room broadcast, or any
   * client-only signal) — see control-view.ts's 'session-established'
   * handler. It goes through the normal transport.sendControl() path (same
   * seq progression, same encoding, same session stamping downstream at the
   * relay), it just bypasses decideSend for this one frame. #lastSent is
   * updated as if this had gone through the normal rhythm path, so the very
   * next heartbeat tick correctly resumes the idle-skip optimization
   * instead of treating this as a fresh "first send".
   */
  establishSessionBaseline(): void {
    this.#lastSent = SAFE_STATE;
    this.#lastSentMs = this.#now();
    this.#transport.sendControl(SAFE_STATE);
  }
}
