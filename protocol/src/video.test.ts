import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isJpeg,
  isMatchingAck,
  isVideoMessage,
  MAX_JPEG_BYTES,
  VIDEO_CLOSE_CODE,
  VIDEO_PROTOCOL_VERSION,
} from './video.ts';

const v = VIDEO_PROTOCOL_VERSION;

test('video message: publisher.accepted valid/invalid shapes', () => {
  assert.equal(
    isVideoMessage({ v, type: 'publisher.accepted', robotId: 'robot-01', streamSessionId: 's1' }),
    true,
  );
  assert.equal(isVideoMessage({ v, type: 'publisher.accepted', robotId: 'robot-01' }), false);
  assert.equal(
    isVideoMessage({
      v: v + 1,
      type: 'publisher.accepted',
      robotId: 'robot-01',
      streamSessionId: 's1',
    }),
    false,
  );
});

test('video message: publisher.rejected valid/invalid shapes', () => {
  assert.equal(
    isVideoMessage({ v, type: 'publisher.rejected', robotId: 'robot-01', reason: 'occupied' }),
    true,
  );
  assert.equal(isVideoMessage({ v, type: 'publisher.rejected', robotId: 'robot-01' }), false);
});

test('video message: frame header valid/invalid shapes', () => {
  const validFrame = {
    v,
    type: 'frame',
    streamSessionId: 's1',
    seq: 1,
    capturedAtMs: 1000,
    width: 640,
    height: 480,
    byteLength: 19253,
  };
  assert.equal(isVideoMessage(validFrame), true);
  assert.equal(isVideoMessage({ ...validFrame, seq: -1 }), false);
  assert.equal(isVideoMessage({ ...validFrame, width: 0 }), false);
  assert.equal(isVideoMessage({ ...validFrame, height: 0 }), false);
  assert.equal(isVideoMessage({ ...validFrame, byteLength: 0 }), false);
  assert.equal(isVideoMessage({ ...validFrame, streamSessionId: undefined }), false);
  assert.equal(isVideoMessage({ ...validFrame, capturedAtMs: 'now' }), false);
});

test('video message: stream state valid/invalid shapes', () => {
  assert.equal(
    isVideoMessage({
      v,
      type: 'stream',
      robotId: 'robot-01',
      publisherOnline: true,
      streamSessionId: 's1',
    }),
    true,
  );
  assert.equal(
    isVideoMessage({ v, type: 'stream', robotId: 'robot-01', publisherOnline: false }),
    true,
  );
  assert.equal(
    isVideoMessage({ v, type: 'stream', robotId: 'robot-01', publisherOnline: 'yes' }),
    false,
  );
});

test('video message: viewer.ack valid/invalid shapes', () => {
  assert.equal(isVideoMessage({ v, type: 'viewer.ack', streamSessionId: 's1', seq: 40 }), true);
  assert.equal(isVideoMessage({ v, type: 'viewer.ack', streamSessionId: 's1', seq: 0 }), true);
  assert.equal(isVideoMessage({ v, type: 'viewer.ack', streamSessionId: 's1' }), false);
  assert.equal(isVideoMessage({ v, type: 'viewer.ack', seq: 40 }), false);
  assert.equal(isVideoMessage({ v, type: 'viewer.ack', streamSessionId: 's1', seq: -1 }), false);
  assert.equal(
    isVideoMessage({ v, type: 'viewer.ack', streamSessionId: 's1', seq: 'forty' }),
    false,
  );
});

test('video message: publisher.register valid/invalid shapes', () => {
  assert.equal(
    isVideoMessage({ v, type: 'publisher.register', robotId: 'robot-01', token: 'secret' }),
    true,
  );
  assert.equal(isVideoMessage({ v, type: 'publisher.register', robotId: 'robot-01' }), false);
  assert.equal(isVideoMessage({ v, type: 'publisher.register', token: 'secret' }), false);
});

test('video message: viewer.register valid/invalid shapes', () => {
  assert.equal(
    isVideoMessage({ v, type: 'viewer.register', robotId: 'robot-01', ticket: 'a.b' }),
    true,
  );
  assert.equal(isVideoMessage({ v, type: 'viewer.register', robotId: 'robot-01' }), false);
  assert.equal(isVideoMessage({ v, type: 'viewer.register', ticket: 'a.b' }), false);
});

test('VIDEO_CLOSE_CODE: distinct 4100-range values, one per name', () => {
  const codes = Object.values(VIDEO_CLOSE_CODE);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.ok(code >= 4100 && code < 4200);
  // Auth-related codes introduced in Problem 7C.
  assert.ok(Number.isInteger(VIDEO_CLOSE_CODE.AUTH_FAILED));
  assert.ok(Number.isInteger(VIDEO_CLOSE_CODE.TICKET_EXPIRED));
  assert.ok(Number.isInteger(VIDEO_CLOSE_CODE.REGISTRATION_TIMEOUT));
  assert.ok(Number.isInteger(VIDEO_CLOSE_CODE.PUBLISHER_REPLACED));
});

test('video message: rejects non-envelopes and unknown types', () => {
  assert.equal(isVideoMessage(null), false);
  assert.equal(isVideoMessage('frame'), false);
  assert.equal(isVideoMessage({ v, type: 'unknown-type' }), false);
  assert.equal(isVideoMessage({ type: 'frame' }), false);
});

test('isJpeg: accepts SOI..EOI byte-bracketed buffers', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0x03, 0xff, 0xd9]);
  assert.equal(isJpeg(jpeg), true);
  assert.equal(isJpeg(jpeg.buffer), true);
});

test('isJpeg: rejects non-JPEG or truncated buffers', () => {
  assert.equal(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false); // PNG magic
  assert.equal(isJpeg(new Uint8Array([0xff, 0xd8])), false); // too short, no EOI
  assert.equal(isJpeg(new Uint8Array([])), false);
});

test('isMatchingAck: exact match on session and seq is the only accepted case', () => {
  const inFlight = { streamSessionId: 's1', seq: 40 };
  assert.equal(isMatchingAck({ streamSessionId: 's1', seq: 40 }, inFlight), true);
});

test('isMatchingAck: no in-flight frame never matches', () => {
  assert.equal(isMatchingAck({ streamSessionId: 's1', seq: 40 }, null), false);
});

test('isMatchingAck: a stale ack for an older seq is rejected', () => {
  const inFlight = { streamSessionId: 's1', seq: 44 };
  assert.equal(isMatchingAck({ streamSessionId: 's1', seq: 40 }, inFlight), false);
});

test('isMatchingAck: an ack for a future/not-yet-sent seq is rejected', () => {
  const inFlight = { streamSessionId: 's1', seq: 40 };
  assert.equal(isMatchingAck({ streamSessionId: 's1', seq: 41 }, inFlight), false);
});

test('isMatchingAck: matching seq but a different streamSessionId is rejected', () => {
  const inFlight = { streamSessionId: 's1', seq: 40 };
  assert.equal(isMatchingAck({ streamSessionId: 's2', seq: 40 }, inFlight), false);
});

test('isMatchingAck: a duplicate ack (same seq, already released) is rejected once inFlight is null', () => {
  // Simulates: viewer acks 40 (releases credit, inFlight -> null), then the
  // same ack arrives again (network duplicate) — must not re-release.
  assert.equal(isMatchingAck({ streamSessionId: 's1', seq: 40 }, null), false);
});

test('MAX_JPEG_BYTES: sized well above the Problem 7A target but bounded', () => {
  assert.ok(MAX_JPEG_BYTES > 30 * 1024, 'must exceed the ~30 KB/frame target');
  assert.ok(MAX_JPEG_BYTES < 1024 * 1024, 'must stay well under multi-MB territory');
});
