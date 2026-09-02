/**
 * SIMULATED relay + firmware control gate.
 *
 * Neither the real relay (a Cloudflare Worker Durable Object) nor the real
 * firmware (C++ on an ESP32) can run inside a static site build, so this is
 * an intentional reimplementation of just the parts that matter for
 * teaching — never a claim to be the production Worker or device. The rules
 * below are transcribed directly from relay/src/room.ts and
 * firmware/rovelink_device/rovelink_device.ino (see the source links each
 * concept passport shows) and pinned down by the equivalence tests in
 * simulated-relay-firmware.test.ts:
 *
 *  - relay/src/room.ts #handleControllerRegister: a fresh connection mints a
 *    brand-new session id and the device is told about it before any frame
 *    from that session can arrive.
 *  - rovelink_device.ino applyControlFrame(): a frame is rejected outright if
 *    its session doesn't match the active one, or if seq <= lastSeq; a fresh
 *    session additionally requires one explicit armed=false frame before any
 *    armed=true frame is honored (the "disarmed baseline").
 *  - rovelink_device.ino watchTtl(): if armed and no accepted frame arrived
 *    within CONTROL_TTL_MS, the vehicle falls back to SAFE_STATE on its own.
 *  - rovelink_device.ino onEmergencyStopReceived(): bypasses session/seq
 *    entirely.
 *
 * Everything else (encoding, differential mix, PWM scaling) is the REAL
 * production function from @rovelink/protocol — never a lookalike.
 */
import type { ControlFrame, ControlState, Wheels } from '@rovelink/protocol';
import {
  CONTROL_TTL_MS,
  SAFE_STATE,
  differentialMix,
  isFrameExpired,
  wheelPwm,
} from '@rovelink/protocol';

export type FrameOutcome =
  | { readonly accepted: true; readonly state: ControlState; readonly wheels: Wheels }
  | {
      readonly accepted: false;
      readonly reason: 'wrong-session' | 'stale-seq' | 'armed-before-baseline' | 'ttl-expired';
    };

/** One RobotRoom's worth of relay state: which session is authoritative. */
export class SimulatedRelay {
  #sessionId: string | null = null;

  get sessionId(): string | null {
    return this.#sessionId;
  }

  /** Mirrors #handleControllerRegister: mints a fresh session id, server-side only. */
  mintSession(): string {
    this.#sessionId = crypto.randomUUID();
    return this.#sessionId;
  }

  /** Mirrors the room stamping `controlSessionId` from its own attachment
   * record onto every forwarded frame — never trusting a client-supplied one. */
  stamp(frame: Omit<ControlFrame, 'controlSessionId'>): ControlFrame {
    return { ...frame, controlSessionId: this.#sessionId ?? undefined };
  }
}

/** One robot's worth of firmware control-gate state. */
export class SimulatedFirmware {
  #activeSession = '';
  #lastSeq = -1;
  #sessionReady = false;
  #lastAcceptedAt = -Infinity;
  #state: ControlState = SAFE_STATE;

  get state(): ControlState {
    return this.#state;
  }

  get sessionReady(): boolean {
    return this.#sessionReady;
  }

  get lastSeq(): number {
    return this.#lastSeq;
  }

  /** Mirrors onSessionChanged(): forces safe state, resets seq + readiness. */
  onSessionChanged(sessionId: string): void {
    this.#state = SAFE_STATE;
    this.#activeSession = sessionId;
    this.#lastSeq = -1;
    this.#sessionReady = false;
  }

  /** Mirrors onEmergencyStopReceived(): unconditional, session/seq-independent. */
  emergencyStop(): void {
    this.#state = SAFE_STATE;
  }

  /** Mirrors watchTtl(): only trips while armed. */
  checkTtl(now: number): boolean {
    if (!this.#state.armed) return false;
    if (now - this.#lastAcceptedAt > CONTROL_TTL_MS) {
      this.#state = SAFE_STATE;
      return true;
    }
    return false;
  }

  /** Mirrors applyControlFrame(). `now` is when this frame reaches the
   * (simulated) device — after whatever latency the lab experiment applies. */
  applyFrame(frame: ControlFrame, now: number): FrameOutcome {
    if ((frame.controlSessionId ?? '') !== this.#activeSession) {
      return { accepted: false, reason: 'wrong-session' };
    }
    if (frame.seq <= this.#lastSeq) {
      return { accepted: false, reason: 'stale-seq' };
    }
    if (isFrameExpired(frame, now)) {
      return { accepted: false, reason: 'ttl-expired' };
    }
    this.#lastSeq = frame.seq;
    this.#lastAcceptedAt = now;

    if (!this.#sessionReady) {
      if (frame.armed) return { accepted: false, reason: 'armed-before-baseline' };
      this.#sessionReady = true;
    }

    this.#state = frame.armed
      ? { throttle: frame.throttle, steering: frame.steering, gripper: frame.gripper, armed: true }
      : SAFE_STATE;

    const wheels = differentialMix(this.#state.throttle, this.#state.steering);
    return { accepted: true, state: this.#state, wheels };
  }
}

export { wheelPwm };
