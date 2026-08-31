/**
 * Controller profile persistence.
 *
 * Not secret data — plain `localStorage`, entirely separate from the
 * operator credential (sessionStorage, see auth/controller-key.ts).
 * Versioned so a future schema change can detect and migrate/reject old
 * data instead of guessing. Anything that doesn't parse as a complete,
 * valid `ControllerProfile` — corrupted, hand-edited, from a future
 * version, or simply invalid per profile-validate.ts — falls back to
 * Racing rather than ever crashing the controller view or activating an
 * unsafe configuration.
 */

import { isAxisControl, isButtonControl } from './controls.ts';
import type { ControllerProfile, EmergencyStopChord, SteeringMapping, ThrottleMapping } from './profile.ts';
import { RACING_PROFILE, STICK_PROFILE } from './profile.ts';
import { isProfileValid } from './profile-validate.ts';

export const STORAGE_KEY = 'rovelink.controllerProfile.v1';

interface StoredProfileV1 {
  readonly version: 1;
  readonly profile: ControllerProfile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseThrottleMapping(value: unknown): ThrottleMapping | null {
  if (!isRecord(value)) return null;
  const { mode, axis, invert, deadzone, forward, reverse } = value;
  if (mode === 'axis') {
    if (!isAxisControl(axis) || typeof invert !== 'boolean' || typeof deadzone !== 'number') {
      return null;
    }
    return { mode: 'axis', axis, invert, deadzone };
  }
  if (mode === 'split') {
    if (!isButtonControl(forward) || !isButtonControl(reverse)) return null;
    return { mode: 'split', forward, reverse };
  }
  return null;
}

function parseSteeringMapping(value: unknown): SteeringMapping | null {
  if (!isRecord(value)) return null;
  const { axis, invert, deadzone } = value;
  if (!isAxisControl(axis) || typeof invert !== 'boolean' || typeof deadzone !== 'number') {
    return null;
  }
  return { axis, invert, deadzone };
}

function parseEmergencyStopChord(value: unknown): EmergencyStopChord | null {
  if (!isRecord(value)) return null;
  const { a, b } = value;
  if (!isButtonControl(a) || !isButtonControl(b)) return null;
  return { a, b };
}

function isProfileId(value: unknown): value is ControllerProfile['id'] {
  return value === 'racing' || value === 'stick' || value === 'custom';
}

/** Fully validates untrusted data against the exact shape of a
 * `ControllerProfile` — never trusts a bare cast. */
export function parseStoredProfile(value: unknown): ControllerProfile | null {
  if (!isRecord(value)) return null;
  const { version, id, name, gripperOpen, gripperClose, arm, disarm } = value;
  if (version !== 1) return null;
  if (!isProfileId(id)) return null;
  if (typeof name !== 'string' || name.length === 0) return null;

  const throttle = parseThrottleMapping(value.throttle);
  if (throttle === null) return null;
  const steering = parseSteeringMapping(value.steering);
  if (steering === null) return null;
  if (!isButtonControl(gripperOpen)) return null;
  if (!isButtonControl(gripperClose)) return null;
  if (!isButtonControl(arm)) return null;
  if (!isButtonControl(disarm)) return null;
  const emergencyStop = parseEmergencyStopChord(value.emergencyStop);
  if (emergencyStop === null) return null;

  return { version: 1, id, name, throttle, steering, gripperOpen, gripperClose, arm, disarm, emergencyStop };
}

/** Loads the stored profile, or Racing if there is none, it is malformed,
 * it is an unsupported schema version, or it fails safety validation. */
export function loadProfile(storage: Pick<Storage, 'getItem'> = localStorage): ControllerProfile {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return RACING_PROFILE;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) return RACING_PROFILE;
    const profile = parseStoredProfile(parsed.profile);
    if (profile === null || !isProfileValid(profile)) return RACING_PROFILE;
    return profile;
  } catch {
    return RACING_PROFILE;
  }
}

export function saveProfile(
  profile: ControllerProfile,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    const stored: StoredProfileV1 = { version: 1, profile };
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable/full/blocked (private browsing, quota): the
    // profile just won't persist across reloads. Not fatal.
  }
}

export function resetToRacing(storage?: Pick<Storage, 'setItem'>): ControllerProfile {
  saveProfile(RACING_PROFILE, storage);
  return RACING_PROFILE;
}

export function resetToStick(storage?: Pick<Storage, 'setItem'>): ControllerProfile {
  saveProfile(STICK_PROFILE, storage);
  return STICK_PROFILE;
}
