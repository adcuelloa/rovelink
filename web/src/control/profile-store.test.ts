import assert from 'node:assert/strict';
import test from 'node:test';

import type { ControllerProfile } from './profile.ts';
import { RACING_PROFILE, STICK_PROFILE, toCustom } from './profile.ts';
import {
  loadProfile,
  parseStoredProfile,
  resetToRacing,
  resetToStick,
  saveProfile,
  STORAGE_KEY,
} from './profile-store.ts';

/** A minimal in-memory Storage stand-in — no jsdom/localStorage needed. */
class FakeStorage {
  #data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.#data.set(key, value);
  }
  set raw(value: string) {
    this.#data.set(STORAGE_KEY, value);
  }
}

test('profile-store: no stored data falls back to Racing', () => {
  const storage = new FakeStorage();
  assert.deepEqual(loadProfile(storage), RACING_PROFILE);
});

test('profile-store: save then reload round-trips a custom profile exactly', () => {
  const storage = new FakeStorage();
  const custom = { ...toCustom(RACING_PROFILE), gripperOpen: 'Square' as const };
  saveProfile(custom, storage);
  assert.deepEqual(loadProfile(storage), custom);
});

test('profile-store: malformed JSON falls back to Racing, does not throw', () => {
  const storage = new FakeStorage();
  storage.raw = '{ not json';
  assert.deepEqual(loadProfile(storage), RACING_PROFILE);
});

test('profile-store: well-formed JSON with the wrong shape falls back to Racing', () => {
  const storage = new FakeStorage();
  storage.raw = JSON.stringify({ version: 1, profile: { hello: 'world' } });
  assert.deepEqual(loadProfile(storage), RACING_PROFILE);
});

test('profile-store: an unsupported schema version falls back to Racing', () => {
  const storage = new FakeStorage();
  storage.raw = JSON.stringify({ version: 2, profile: RACING_PROFILE });
  assert.deepEqual(loadProfile(storage), RACING_PROFILE);
});

test('profile-store: a structurally valid but unsafe profile (e.g. E-stop conflict) falls back to Racing', () => {
  const storage = new FakeStorage();
  const unsafe: ControllerProfile = { ...toCustom(RACING_PROFILE), emergencyStop: { a: 'Options', b: 'R3' } };
  storage.raw = JSON.stringify({ version: 1, profile: unsafe });
  assert.deepEqual(loadProfile(storage), RACING_PROFILE);
});

test('profile-store: parseStoredProfile rejects a control name that is not in the standard layout', () => {
  const bad = { ...RACING_PROFILE, arm: 'NotARealButton' };
  assert.equal(parseStoredProfile(bad), null);
});

test('profile-store: parseStoredProfile rejects a non-object and null', () => {
  assert.equal(parseStoredProfile(null), null);
  assert.equal(parseStoredProfile('racing'), null);
  assert.equal(parseStoredProfile(42), null);
});

test('profile-store: resetToRacing persists and returns the Racing preset', () => {
  const storage = new FakeStorage();
  const custom = toCustom(STICK_PROFILE);
  saveProfile(custom, storage);
  assert.deepEqual(loadProfile(storage), custom);

  const result = resetToRacing(storage);
  assert.deepEqual(result, RACING_PROFILE);
  assert.deepEqual(loadProfile(storage), RACING_PROFILE);
});

test('profile-store: resetToStick persists and returns the Stick preset', () => {
  const storage = new FakeStorage();
  const result = resetToStick(storage);
  assert.deepEqual(result, STICK_PROFILE);
  assert.deepEqual(loadProfile(storage), STICK_PROFILE);
});
