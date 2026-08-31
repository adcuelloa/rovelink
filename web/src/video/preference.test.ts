import assert from 'node:assert/strict';
import test from 'node:test';

import { loadVideoEnabled, saveVideoEnabled } from './preference.ts';

/** Narrowed to exactly what loadVideoEnabled/saveVideoEnabled need — no
 * cast to the full `Storage` interface required. */
function fakeStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test('default is ON when nothing is stored yet', () => {
  assert.equal(loadVideoEnabled(fakeStorage()), true);
});

test('save then load round-trips false', () => {
  const storage = fakeStorage();
  saveVideoEnabled(false, storage);
  assert.equal(loadVideoEnabled(storage), false);
});

test('save then load round-trips true explicitly', () => {
  const storage = fakeStorage();
  saveVideoEnabled(false, storage);
  saveVideoEnabled(true, storage);
  assert.equal(loadVideoEnabled(storage), true);
});

test('a storage that throws (private browsing) falls back to ON, never crashes', () => {
  const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('storage disabled');
    },
  };
  assert.equal(loadVideoEnabled(throwing), true);
  assert.doesNotThrow(() => saveVideoEnabled(false, throwing));
});
