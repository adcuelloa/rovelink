/**
 * Differential mix: from `throttle`/`steering` to the two wheels.
 *
 * This is the same calculation the firmware does in `applyMotors()`. It lives
 * here so the dashboard can show exactly what the robot will apply, instead of
 * a pretty approximation: if this changes, it changes in both places at once.
 */

import { clampAxis } from './control.ts';

export interface Wheels {
  /** Power of the left side, -1..1. */
  readonly left: number;
  readonly right: number;
}

export function differentialMix(throttle: number, steering: number): Wheels {
  return {
    left: clampAxis(throttle + steering),
    right: clampAxis(throttle - steering),
  };
}

/** Minimum PWM that actually moves the car; below that the motor just hums. */
export const PWM_MIN = 90;
export const PWM_MAX = 255;
/** Below this the motor is considered stopped and is not energized. */
export const MOTOR_THRESHOLD = 0.02;

/**
 * Byte the firmware would write to `ENA`/`ENB` for that power. The motor
 * does not start at 0: the scale starts at `PWM_MIN`.
 */
export function wheelPwm(value: number): number {
  const magnitude = Math.abs(clampAxis(value));
  if (magnitude < MOTOR_THRESHOLD) return 0;
  return Math.round(PWM_MIN + magnitude * (PWM_MAX - PWM_MIN));
}
