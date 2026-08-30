/**
 * When to send a control packet.
 *
 * Pure function so rhythm can be tested without a network: decides between
 * sending now (safety), sending respecting the max frequency, sending on
 * heartbeat, or staying silent. With the stick still the link should not
 * burn 60 packets per second.
 */

import type { ControlState } from '@rovelink/protocol';
import { significantChange, isIdle } from '@rovelink/protocol';

export type SendDecision = 'immediate' | 'rate' | 'heartbeat' | 'skip';

export interface RhythmOptions {
  /** Max driving packets per second. */
  readonly hzMax: number;
  /** Periodic re-send to feed the vehicle watchdog/TTL. */
  readonly heartbeatMs: number;
  /** Minimum axis change that justifies a packet. */
  readonly threshold: number;
}

export const DEFAULT_RHYTHM: RhythmOptions = {
  hzMax: 30,
  heartbeatMs: 150,
  threshold: 0.02,
};

export function decideSend(
  previous: ControlState | null,
  current: ControlState,
  sinceLastMs: number,
  options: RhythmOptions = DEFAULT_RHYTHM,
): SendDecision {
  if (previous === null) return 'immediate';

  if (previous.armed !== current.armed) return 'immediate';
  if (previous.gripper !== current.gripper) return 'immediate';
  if (!isIdle(previous) && isIdle(current)) return 'immediate';

  if (significantChange(previous, current, options.threshold)) {
    return sinceLastMs >= 1000 / options.hzMax ? 'rate' : 'skip';
  }

  if (!current.armed && isIdle(current)) return 'skip';

  return sinceLastMs >= options.heartbeatMs ? 'heartbeat' : 'skip';
}
