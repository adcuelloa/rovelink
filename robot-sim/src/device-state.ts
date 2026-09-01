/**
 * Pure device-side state machine (Problem 8B): the externally observable
 * subset of `firmware/rovelink_device/rovelink_device.ino`'s
 * `applyControlFrame()` / `onSessionChanged()` / E-stop handling, ported to
 * TypeScript so a desktop simulator can reproduce the same session/seq/safety
 * semantics without an ESP32.
 *
 * Deliberately dependency-free (no WebSocket, no clock of its own — callers
 * pass `now`/frames in) so it is unit-testable exactly like the firmware
 * logic it mirrors. `client.ts` is the only thing that wires this to a real
 * socket.
 *
 * Intentional fidelity boundary (documented, not accidental): this ports
 * only the session/seq/safety state machine and the TTL watchdog — not
 * WiFi/GPIO/RSSI hardware behavior, which does not exist in a desktop
 * process. See `docs/demo.md` for the full real-vs-simulated boundary.
 */

import type { ControlState, Gripper } from '@rovelink/protocol';
import { clampAxis, SAFE_STATE } from '@rovelink/protocol';

export interface DeviceState {
  /** `null` before any `controller.session` has ever been adopted —
   * equivalent to firmware's `activeSession == ""`. */
  readonly activeSessionId: string | null;
  /** False until the active session's first accepted disarmed frame
   * establishes its baseline (see `applyControlFrame`). */
  readonly sessionReady: boolean;
  /** -1 before any frame has been accepted for the active session, matching
   * firmware's `lastSeq` initial value. */
  readonly lastSeq: number;
  readonly control: ControlState;
}

/** Equivalent of firmware globals at boot: no session, no seq, safe state. */
export const INITIAL_DEVICE_STATE: DeviceState = {
  activeSessionId: null,
  sessionReady: false,
  lastSeq: -1,
  control: SAFE_STATE,
};

/**
 * The ONLY thing allowed to change `activeSessionId` — driven exclusively by
 * a relay-authored `controller.session` message, never by a control frame
 * (see `applyControlFrame`'s session check). Forces safe state and resets
 * both the seq baseline and the readiness gate, exactly like
 * `onSessionChanged()` in firmware.
 */
export function onSessionChanged(sessionId: string): DeviceState {
  return {
    activeSessionId: sessionId,
    sessionReady: false,
    lastSeq: -1,
    control: SAFE_STATE,
  };
}

export interface ControlFrameInput {
  readonly seq: number;
  /** Absent only on a malformed/pre-session frame; a real relay always
   * stamps this before forwarding to the device. */
  readonly controlSessionId: string | undefined;
  readonly throttle: number;
  readonly steering: number;
  readonly gripper: Gripper;
  readonly armed: boolean;
}

export interface ApplyControlFrameResult {
  readonly state: DeviceState;
  /** Non-null only when the resulting logical control state was actually
   * applied — never for a frame rejected outright (wrong session,
   * stale/duplicate seq, or armed=true before the session's disarmed
   * baseline), matching firmware's `transportSendControlAck` call sites. */
  readonly ack: { readonly seq: number; readonly controlSessionId: string } | null;
}

/**
 * Applies one decoded control frame. Ported line-for-line from firmware's
 * `applyControlFrame()`:
 *
 * - a frame for any session other than the active one is silently dropped
 *   and can never roll `activeSessionId` backward
 * - `seq <= lastSeq` is dropped (retransmission/reorder)
 * - a frame that passes both checks always advances `lastSeq`, even if it
 *   is then rejected for arriving armed=true before the baseline — that
 *   frame still "consumes" its seq, it just never acks (matches firmware:
 *   `lastSeq = seq` happens before the baseline check)
 * - the first accepted frame for a fresh session establishes its disarmed
 *   baseline; only a LATER armed=true frame can actually arm the vehicle
 * - a baseline-establishing frame is itself safely appliable and acked,
 *   same as any other disarmed frame
 */
export function applyControlFrame(
  state: DeviceState,
  frame: ControlFrameInput,
): ApplyControlFrameResult {
  const incomingSession = frame.controlSessionId ?? '';
  const activeSession = state.activeSessionId ?? '';
  if (incomingSession !== activeSession) return { state, ack: null };
  if (frame.seq <= state.lastSeq) return { state, ack: null };

  let next: DeviceState = { ...state, lastSeq: frame.seq };

  if (!next.sessionReady) {
    if (frame.armed) {
      // A fresh session can never be armed by its first accepted frame.
      return { state: next, ack: null };
    }
    next = { ...next, sessionReady: true };
    // Falls through: the disarmed frame that established the baseline is
    // itself safely appliable below, exactly like firmware.
  }

  if (!frame.armed) {
    return {
      state: { ...next, control: SAFE_STATE },
      ack: { seq: frame.seq, controlSessionId: incomingSession },
    };
  }

  return {
    state: {
      ...next,
      control: {
        throttle: clampAxis(frame.throttle),
        steering: clampAxis(frame.steering),
        gripper: frame.gripper,
        armed: true,
      },
    },
    ack: { seq: frame.seq, controlSessionId: incomingSession },
  };
}

export interface EmergencyStopResult {
  readonly state: DeviceState;
  /** Echoes the triggering message's own `sentAt` — E-stop is deliberately
   * session/seq-independent, so it has nothing else to correlate by. */
  readonly ack: { readonly sentAt: number };
}

/**
 * Deliberately untouched by session/seq (matches firmware's
 * `onEmergencyStopReceived`): a safety action must never be filterable by
 * ordering logic that exists only to arbitrate normal driving frames.
 * Session/seq/readiness fields are preserved — only `control` resets.
 */
export function applyEmergencyStop(state: DeviceState, sentAt: number): EmergencyStopResult {
  return { state: { ...state, control: SAFE_STATE }, ack: { sentAt } };
}

/**
 * Link/TTL watchdog (`docs/safety.md` "TTL Watchdog"): if the vehicle is
 * armed and no accepted frame has refreshed `lastFrameAt` within `ttlMs`, it
 * falls back to safe state on its own — matching firmware's `watchTtl()`.
 * No ack is sent for this (firmware's `enterSafeState()` never acks); the
 * caller is expected to call this periodically with real frame-arrival
 * timestamps it tracks itself (this module has no clock of its own).
 */
export function applyTtlWatchdog(
  state: DeviceState,
  now: number,
  lastFrameAt: number,
  ttlMs: number,
): DeviceState {
  if (!state.control.armed) return state;
  if (now - lastFrameAt <= ttlMs) return state;
  return { ...state, control: SAFE_STATE };
}
