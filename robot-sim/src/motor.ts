/**
 * Synthetic motor model (Problem 8B §3): derives left/right wheel power from
 * `throttle`/`steering` using the SAME mixing convention the firmware and
 * dashboard already share (`@rovelink/protocol`'s `differentialMix`) —
 * deliberately not reimplemented here, so the simulator can never drift from
 * what the real vehicle would do.
 */

import type { ControlState, Wheels } from '@rovelink/protocol';
import { differentialMix } from '@rovelink/protocol';

/** `left`/`right` are 0 whenever disarmed — an unarmed vehicle applies no
 * motor power regardless of whatever throttle/steering the frame carried. */
export function wheelsFor(control: ControlState): Wheels {
  if (!control.armed) return { left: 0, right: 0 };
  return differentialMix(control.throttle, control.steering);
}
