/**
 * Pure conflict/safety validation for a `ControllerProfile`.
 *
 * The type system already makes some unsafe configurations impossible to
 * construct at all (Arm/Disarm/gripper/E-stop are always a single
 * `ButtonControl`, never an axis — see profile.ts). What remains here is
 * what the type system cannot rule out: two *different* actions bound to
 * the *same* control, and an Emergency Stop chord that either repeats a
 * control or overlaps a safety-sensitive action. A profile must have zero
 * issues before it can become active.
 */

import type { ButtonControl } from './controls.ts';
import type { ControllerProfile } from './profile.ts';

export type DigitalAction =
  | 'arm'
  | 'disarm'
  | 'gripperOpen'
  | 'gripperClose'
  | 'throttleForward'
  | 'throttleReverse';

export type ValidationIssue =
  | {
      readonly kind: 'duplicate-digital-action';
      readonly control: ButtonControl;
      readonly actions: readonly DigitalAction[];
    }
  | { readonly kind: 'estop-chord-same-control'; readonly control: ButtonControl }
  | {
      readonly kind: 'estop-safety-conflict';
      readonly control: ButtonControl;
      readonly conflictingAction: DigitalAction;
    };

interface DigitalAssignment {
  readonly action: DigitalAction;
  readonly control: ButtonControl;
}

/** Every single-control digital action this profile assigns — the ones
 * that could conflict with each other or with the E-stop chord. Steering
 * (always an axis) is never part of this: it is continuous, not a digital
 * action, so it cannot collide with anything here. */
function digitalAssignments(profile: ControllerProfile): readonly DigitalAssignment[] {
  const assignments: DigitalAssignment[] = [
    { action: 'arm', control: profile.arm },
    { action: 'disarm', control: profile.disarm },
    { action: 'gripperOpen', control: profile.gripperOpen },
    { action: 'gripperClose', control: profile.gripperClose },
  ];
  if (profile.throttle.mode === 'split') {
    assignments.push({ action: 'throttleForward', control: profile.throttle.forward });
    assignments.push({ action: 'throttleReverse', control: profile.throttle.reverse });
  }
  return assignments;
}

export function validateProfile(profile: ControllerProfile): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const assignments = digitalAssignments(profile);

  const byControl = new Map<ButtonControl, DigitalAction[]>();
  for (const { action, control } of assignments) {
    const list = byControl.get(control);
    if (list) list.push(action);
    else byControl.set(control, [action]);
  }
  for (const [control, actions] of byControl) {
    if (actions.length > 1) issues.push({ kind: 'duplicate-digital-action', control, actions });
  }

  const { a, b } = profile.emergencyStop;
  if (a === b) {
    issues.push({ kind: 'estop-chord-same-control', control: a });
  } else {
    for (const chordControl of [a, b]) {
      const conflicting = assignments.find((assignment) => assignment.control === chordControl);
      if (conflicting) {
        issues.push({
          kind: 'estop-safety-conflict',
          control: chordControl,
          conflictingAction: conflicting.action,
        });
      }
    }
  }

  return issues;
}

export const isProfileValid = (profile: ControllerProfile): boolean =>
  validateProfile(profile).length === 0;

/** A short, UI-ready description of one issue — no raw indices, no JSON. */
export function describeIssue(issue: ValidationIssue): string {
  switch (issue.kind) {
    case 'duplicate-digital-action':
      return `${issue.control} is bound to more than one action: ${issue.actions.join(', ')}`;
    case 'estop-chord-same-control':
      return `Emergency Stop needs two different controls, not ${issue.control} twice`;
    case 'estop-safety-conflict':
      return `${issue.control} is part of the Emergency Stop chord and cannot also be ${issue.conflictingAction}`;
    default: {
      const exhaustive: never = issue;
      return exhaustive;
    }
  }
}
