import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRoute } from './route.ts';

test('route: controller and device enter through the same room', () => {
  assert.deepEqual(parseRoute('/robot/robot-01/controller'), {
    robotId: 'robot-01',
    role: 'controller',
  });
  assert.deepEqual(parseRoute('/robot/robot-01/device'), {
    robotId: 'robot-01',
    role: 'device',
  });
  assert.deepEqual(parseRoute('/robot/robot-01/device/'), {
    robotId: 'robot-01',
    role: 'device',
  });
});

test('route: anything else is rejected', () => {
  assert.equal(parseRoute('/'), null);
  assert.equal(parseRoute('/robot/robot-01'), null);
  assert.equal(parseRoute('/robot/robot-01/spy'), null);
  assert.equal(parseRoute('/other/robot-01/device'), null);
  assert.equal(parseRoute('/robot/Robot 01/device'), null);
  assert.equal(parseRoute('/robot/../device'), null);
});

test('boundary: this package declares no dependency on the video relay (Problem 7C brief §9)', async () => {
  // The control relay may mint video tickets (see room.ts
  // #handleVideoTicketRequest) but must never import the video relay's
  // room, forward JPEG frames, or otherwise couple to it — a workspace
  // dependency on @rovelink/video-relay would be the first sign that
  // boundary had been crossed.
  const pkg = await import('../package.json', { with: { type: 'json' } });
  assert.equal('@rovelink/video-relay' in pkg.default.dependencies, false);
});
