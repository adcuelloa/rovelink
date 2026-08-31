import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVideoRoute } from './route.ts';

test('video route: publisher and viewer enter through the same robot room', () => {
  assert.deepEqual(parseVideoRoute('/video/robot-01/publisher'), {
    robotId: 'robot-01',
    role: 'publisher',
  });
  assert.deepEqual(parseVideoRoute('/video/robot-01/viewer'), {
    robotId: 'robot-01',
    role: 'viewer',
  });
  assert.deepEqual(parseVideoRoute('/video/robot-01/viewer/'), {
    robotId: 'robot-01',
    role: 'viewer',
  });
});

test('video route: never overlaps with control route semantics', () => {
  // /robot/<id>/<role> is the CONTROL relay's route shape (see
  // relay/src/route.ts). A video route must never parse that shape, and a
  // control-shaped role name ('controller'/'device') must never parse as a
  // video role either — the two protocols must stay unambiguous even if
  // someone points a client at the wrong relay.
  assert.equal(parseVideoRoute('/robot/robot-01/device'), null);
  assert.equal(parseVideoRoute('/video/robot-01/controller'), null);
  assert.equal(parseVideoRoute('/video/robot-01/device'), null);
});

test('video route: anything else is rejected', () => {
  assert.equal(parseVideoRoute('/'), null);
  assert.equal(parseVideoRoute('/video/robot-01'), null);
  assert.equal(parseVideoRoute('/video/robot-01/spy'), null);
  assert.equal(parseVideoRoute('/other/robot-01/publisher'), null);
  assert.equal(parseVideoRoute('/video/Robot 01/publisher'), null);
  assert.equal(parseVideoRoute('/video/../publisher'), null);
});
