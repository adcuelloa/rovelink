/**
 * The operator's controller credential, held only at runtime.
 *
 * This is deliberately NOT a `VITE_*` value: anything read through
 * `import.meta.env` is baked into the public JS bundle at build time and
 * shipped to every visitor, so it cannot be a secret. The key exists only
 * in this tab's `sessionStorage` (cleared when the tab closes) plus an
 * in-memory mirror for synchronous reads; it is typed in by the operator
 * and sent only inside the WSS `controller.register` message.
 */

const STORAGE_KEY = 'rovelink.controllerKey';

let memoryKey: string | null = null;

function readSessionStorage(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-browsing/storage-disabled: fall back to memory only.
    return null;
  }
}

/** Loads whatever this tab already has (e.g. after a same-tab reload). */
export function getControllerKey(): string | null {
  if (memoryKey !== null) return memoryKey;
  memoryKey = readSessionStorage();
  return memoryKey;
}

export function setControllerKey(key: string): void {
  memoryKey = key;
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Storage unavailable: memory mirror still works for this page life.
  }
}

/** Called on explicit logout and whenever the relay reports the key as
 * invalid (auth-failed): never keep retrying a credential known to be bad. */
export function clearControllerKey(): void {
  memoryKey = null;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored, or storage unavailable: nothing to clear.
  }
}
