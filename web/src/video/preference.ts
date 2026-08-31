/**
 * "Video On/Off" operator preference (Problem 7D §17). Plain `localStorage`
 * boolean, same pattern as control/profile-store.ts: not secret data, so
 * persisting it is fine, unlike a video ticket (see ticket-source.ts).
 * Defaults ON to match RoveLink's remote-driving use case — the operator
 * usually wants to see the robot.
 */

const STORAGE_KEY = 'rovelink.videoEnabled';

export function loadVideoEnabled(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    // Private-browsing/storage-disabled: default ON, same as a first visit.
    return true;
  }
}

export function saveVideoEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Storage unavailable: the preference just won't survive a reload.
  }
}
