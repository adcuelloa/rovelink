/**
 * Reverse lookup: given a profile and a physical control, which bound
 * action (if any) currently uses it. Backs click-to-rebind (Problem 9
 * §13) — clicking a control on the diagram needs to know what it's
 * currently bound to before it can start that action's rebind capture.
 *
 * Pure and dependency-free, like profile-validate.ts: no DOM, no
 * ControlEngine reference, so it carries no path to the robot.
 */

import type { PhysicalControl } from './controls.ts';
import type { ControllerProfile } from './profile.ts';

export type BindingAction =
  | 'throttle'
  | 'steering'
  | 'gripperOpen'
  | 'gripperClose'
  | 'arm'
  | 'disarm'
  | 'emergencyStop';

export const BINDING_ACTIONS: readonly BindingAction[] = [
  'throttle',
  'steering',
  'gripperOpen',
  'gripperClose',
  'arm',
  'disarm',
  'emergencyStop',
];

/**
 * The action bound to `control` in `profile`, or `null` if nothing in the
 * profile currently uses it. A valid profile (see profile-validate.ts)
 * never binds more than one action to the same control, so this always
 * has at most one answer.
 */
export function actionForControl(
  profile: ControllerProfile,
  control: PhysicalControl,
): BindingAction | null {
  if (profile.throttle.mode === 'axis') {
    if (control === profile.throttle.axis) return 'throttle';
  } else if (control === profile.throttle.forward || control === profile.throttle.reverse) {
    return 'throttle';
  }
  if (control === profile.steering.axis) return 'steering';
  if (control === profile.gripperOpen) return 'gripperOpen';
  if (control === profile.gripperClose) return 'gripperClose';
  if (control === profile.arm) return 'arm';
  if (control === profile.disarm) return 'disarm';
  if (control === profile.emergencyStop.a || control === profile.emergencyStop.b) {
    return 'emergencyStop';
  }
  return null;
}
