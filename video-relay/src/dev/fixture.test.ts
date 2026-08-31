import assert from 'node:assert/strict';
import test from 'node:test';

import { isJpeg } from '@rovelink/protocol';

import { loadFixtureFrame } from './fixture.ts';

test('fixture: is a real, decodable-shaped JPEG in the Problem 7A target size range', () => {
  const bytes = loadFixtureFrame();
  assert.ok(isJpeg(bytes), 'must start with SOI (0xFFD8) and end with EOI (0xFFD9)');
  // Problem 7A estimated ~15-30 KB/frame at VGA/quality-12; the checked-in
  // fixture was generated to land inside that range (see fixtures/frame.jpg).
  assert.ok(bytes.byteLength > 10 * 1024, `expected >10 KB, got ${bytes.byteLength}`);
  assert.ok(bytes.byteLength < 40 * 1024, `expected <40 KB, got ${bytes.byteLength}`);
});

test('fixture: loading twice returns equal, independently-owned buffers', () => {
  const a = loadFixtureFrame();
  const b = loadFixtureFrame();
  assert.deepEqual(a, b);
  a[0] = 0; // mutating one must never affect the other or the cached source
  assert.notDeepEqual(a, b);
});
