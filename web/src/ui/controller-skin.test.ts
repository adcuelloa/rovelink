import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SKIN,
  inkFor,
  isHexColor,
  loadSkin,
  presetFor,
  saveSkin,
  SKIN_PRESETS,
  skinProperties,
} from './controller-skin.ts';

function fakeStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test('default skin when nothing is stored', () => {
  assert.deepEqual(loadSkin(fakeStorage()), DEFAULT_SKIN);
});

test('save then load round-trips a custom skin', () => {
  const storage = fakeStorage();
  saveSkin({ shell: '#123456', core: '#abcdef' }, storage);
  assert.deepEqual(loadSkin(storage), { shell: '#123456', core: '#abcdef' });
});

test('malformed or hostile stored values fall back to the default', () => {
  for (const raw of [
    'not json',
    'null',
    '42',
    '{"shell":"red","core":"#000000"}',
    '{"shell":"#000000"}',
    '{"shell":"#000000;background:url(x)","core":"#000000"}',
  ]) {
    assert.deepEqual(loadSkin(fakeStorage({ 'rovelink.controllerSkin.v1': raw })), DEFAULT_SKIN);
  }
});

test('a storage that throws never crashes', () => {
  const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
    getItem: () => {
      throw new Error('storage disabled');
    },
    setItem: () => {
      throw new Error('storage disabled');
    },
  };
  assert.deepEqual(loadSkin(throwing), DEFAULT_SKIN);
  assert.doesNotThrow(() => saveSkin(DEFAULT_SKIN, throwing));
});

test('isHexColor accepts only #rrggbb', () => {
  assert.equal(isHexColor('#a1B2c3'), true);
  assert.equal(isHexColor('#abc'), false);
  assert.equal(isHexColor('a1b2c3'), false);
  assert.equal(isHexColor(null), false);
});

test('ink is dark on light shells and light on dark shells', () => {
  assert.equal(inkFor('#ffffff'), '#15151a');
  assert.equal(inkFor('#eceef0'), '#15151a');
  assert.equal(inkFor('#000000'), '#f4f5f7');
  assert.equal(inkFor('#2a2c33'), '#f4f5f7');
});

test('every preset is valid and identifiable', () => {
  const ids = new Set(SKIN_PRESETS.map((p) => p.id));
  assert.equal(ids.size, SKIN_PRESETS.length);
  for (const preset of SKIN_PRESETS) {
    assert.ok(isHexColor(preset.skin.shell) && isHexColor(preset.skin.core), preset.id);
    assert.equal(presetFor(preset.skin)?.id, preset.id);
  }
  assert.equal(presetFor({ shell: '#010203', core: '#040506' }), null);
});

test('skinProperties exposes shell/core and derived inks', () => {
  assert.deepEqual(skinProperties({ shell: '#ffffff', core: '#000000' }), {
    '--pad-shell': '#ffffff',
    '--pad-core': '#000000',
    '--pad-ink': '#15151a',
    '--pad-core-ink': '#f4f5f7',
  });
});
