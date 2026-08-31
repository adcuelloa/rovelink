import assert from 'node:assert/strict';
import test from 'node:test';

import { isJpeg } from '@rovelink/protocol';

import { buildSimulatedFrame } from './simulated-frame.ts';

test('buildSimulatedFrame: header matches the jpeg it was built for', () => {
  const { header, jpeg } = buildSimulatedFrame({
    streamSessionId: 'session-1',
    seq: 7,
    capturedAtMs: 123456,
  });

  assert.equal(header.type, 'frame');
  assert.equal(header.streamSessionId, 'session-1');
  assert.equal(header.seq, 7);
  assert.equal(header.capturedAtMs, 123456);
  assert.equal(header.byteLength, jpeg.byteLength);
  assert.equal(header.width, 640);
  assert.equal(header.height, 480);
  assert.ok(isJpeg(jpeg));
});

test('buildSimulatedFrame: successive frames from the same fixture are byte-identical, only header changes', () => {
  const a = buildSimulatedFrame({ streamSessionId: 's', seq: 1, capturedAtMs: 0 });
  const b = buildSimulatedFrame({ streamSessionId: 's', seq: 2, capturedAtMs: 10 });
  assert.deepEqual(a.jpeg, b.jpeg);
  assert.notEqual(a.header.seq, b.header.seq);
});
