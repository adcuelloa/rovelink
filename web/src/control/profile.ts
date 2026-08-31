/**
 * Data-driven controller profiles.
 *
 * Replaces Problem 5's hardcoded `STANDARD_MAPPING`/`readGamepad` with a
 * profile you can select and (for Custom) edit — Stick and Racing are data,
 * not branches. `evaluateProfile` produces the exact same `GamepadInput`
 * shape `readGamepad` used to, so gamepad.ts's RAF/publish/baseline
 * machinery (deadzone rescale, edge-triggered actions, gripper
 * resolution) is reused as-is; only what feeds it changes.
 *
 * Safety is enforced at the type level, not just by convention: Arm,
 * Disarm, the gripper actions, and both Emergency Stop chord controls are
 * always a single `ButtonControl` — never an axis mapping — so a
 * configuration where an analog stick threshold arms the robot cannot be
 * constructed through this API at all. `profile-validate.ts` still checks
 * persisted/untrusted data at runtime, since localStorage is not this type
 * system.
 */

import type { AxisControl, ButtonControl, SemanticValues } from './controls.ts';
import { isPressed } from './controls.ts';
import type { ButtonAction, GamepadInput } from './mapping.ts';
import { applyDeadzone, BUTTONS_RELEASED, DEFAULT_DEADZONE } from './mapping.ts';

export type ThrottleMapping =
  | { readonly mode: 'axis'; readonly axis: AxisControl; readonly invert: boolean; readonly deadzone: number }
  | { readonly mode: 'split'; readonly forward: ButtonControl; readonly reverse: ButtonControl };

export interface SteeringMapping {
  readonly axis: AxisControl;
  readonly invert: boolean;
  readonly deadzone: number;
}

/** A deliberate two-button chord. The two controls must differ — see
 * profile-validate.ts, which also forbids either from doing double duty as
 * Arm/Disarm/gripper/throttle. */
export interface EmergencyStopChord {
  readonly a: ButtonControl;
  readonly b: ButtonControl;
}

export type ProfileId = 'racing' | 'stick' | 'custom';

export interface ControllerProfile {
  readonly version: 1;
  readonly id: ProfileId;
  readonly name: string;
  readonly throttle: ThrottleMapping;
  readonly steering: SteeringMapping;
  readonly gripperOpen: ButtonControl;
  readonly gripperClose: ButtonControl;
  readonly arm: ButtonControl;
  readonly disarm: ButtonControl;
  readonly emergencyStop: EmergencyStopChord;
}

/** Preset profiles are immutable definitions — never mutate these. A user
 * edit clones into a `custom` profile instead (see `toCustom`). */
export const RACING_PROFILE: ControllerProfile = {
  version: 1,
  id: 'racing',
  name: 'Racing',
  throttle: { mode: 'split', forward: 'R2', reverse: 'L2' },
  steering: { axis: 'LeftStickX', invert: false, deadzone: DEFAULT_DEADZONE.stick },
  gripperOpen: 'L1',
  gripperClose: 'R1',
  arm: 'Options',
  disarm: 'Create',
  emergencyStop: { a: 'L3', b: 'R3' },
};

export const STICK_PROFILE: ControllerProfile = {
  version: 1,
  id: 'stick',
  name: 'Stick',
  throttle: { mode: 'axis', axis: 'LeftStickY', invert: true, deadzone: DEFAULT_DEADZONE.stick },
  steering: { axis: 'LeftStickX', invert: false, deadzone: DEFAULT_DEADZONE.stick },
  gripperOpen: 'L1',
  gripperClose: 'R1',
  arm: 'Options',
  disarm: 'Create',
  emergencyStop: { a: 'L3', b: 'R3' },
};

export const BUILTIN_PROFILES: readonly ControllerProfile[] = [RACING_PROFILE, STICK_PROFILE];

/** Clones a profile into an editable Custom starting point — Custom can
 * reproduce either preset and then diverge from it. */
export function toCustom(profile: ControllerProfile, name = 'Custom'): ControllerProfile {
  return { ...profile, id: 'custom', name };
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function evaluateThrottle(values: SemanticValues, mapping: ThrottleMapping): number {
  if (mapping.mode === 'axis') {
    const raw = applyDeadzone(values[mapping.axis], mapping.deadzone);
    return mapping.invert && raw !== 0 ? -raw : raw;
  }
  const forward = clamp(values[mapping.forward], 0, 1);
  const reverse = clamp(values[mapping.reverse], 0, 1);
  return clamp(forward - reverse, -1, 1);
}

/** Pure: semantic control values + the active profile -> the same
 * `GamepadInput` shape gamepad.ts's publish/baseline logic already
 * consumes. No browser API, no ControlEngine reference — cannot itself
 * reach the robot. */
export function evaluateProfile(values: SemanticValues, profile: ControllerProfile): GamepadInput {
  const throttle = evaluateThrottle(values, profile.throttle);
  const rawSteer = applyDeadzone(values[profile.steering.axis], profile.steering.deadzone);
  const steering = profile.steering.invert && rawSteer !== 0 ? -rawSteer : rawSteer;

  const buttons: Record<ButtonAction, boolean> = { ...BUTTONS_RELEASED };
  buttons.arm = isPressed(values[profile.arm]);
  buttons.disarm = isPressed(values[profile.disarm]);
  buttons.openGripper = isPressed(values[profile.gripperOpen]);
  buttons.closeGripper = isPressed(values[profile.gripperClose]);
  buttons.stop =
    isPressed(values[profile.emergencyStop.a]) && isPressed(values[profile.emergencyStop.b]);

  return { throttle, steering, buttons };
}
