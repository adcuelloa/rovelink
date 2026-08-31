/**
 * "Press a control to bind" detection for the Steam-style rebind flow.
 *
 * Pure: given two consecutive semantic readings, returns the first control
 * that just crossed into "clearly activated." This has nothing to do with
 * driving — the settings UI polls `navigator.getGamepads()` on its own,
 * independent of the driving `listenGamepad` instance (see
 * ui/controller-settings.ts), so a captured control cannot reach
 * ControlEngine no matter what.
 */

import { ALL_CONTROLS, AXIS_CONTROLS, isPressed } from './controls.ts';
import type { PhysicalControl, SemanticValues } from './controls.ts';

const AXIS_CONTROL_SET = new Set<string>(AXIS_CONTROLS);

/** Deliberately higher than the driving deadzone: a light touch or idle
 * drift must never look like "the operator is trying to bind this stick." */
export const CAPTURE_AXIS_THRESHOLD = 0.6;

function isActive(control: PhysicalControl, value: number): boolean {
  return AXIS_CONTROL_SET.has(control) ? Math.abs(value) >= CAPTURE_AXIS_THRESHOLD : isPressed(value);
}

/**
 * The first control (in `ALL_CONTROLS` order) that was inactive in
 * `previous` and active in `current`, or `null` if nothing newly
 * activated. Order is stable, so a simultaneous multi-control press always
 * resolves to the same candidate rather than depending on iteration luck.
 */
export function detectActivation(
  previous: SemanticValues,
  current: SemanticValues,
): PhysicalControl | null {
  for (const control of ALL_CONTROLS) {
    if (!isActive(control, previous[control]) && isActive(control, current[control])) return control;
  }
  return null;
}
