import assert from 'node:assert/strict';
import { test } from 'node:test';

import { generateDemoSecrets } from './secrets.ts';

const HEX_64 = /^[0-9a-f]{64}$/;

test('generates four distinct hex secrets', () => {
  const secrets = generateDemoSecrets();
  assert.match(secrets.deviceSecret, HEX_64);
  assert.match(secrets.controllerSecret, HEX_64);
  assert.match(secrets.videoTicketSecret, HEX_64);
  assert.match(secrets.videoPublisherSecret, HEX_64);

  const values = Object.values(secrets);
  assert.equal(new Set(values).size, values.length, 'all four secrets must be distinct');
});

test('two calls never produce the same secrets', () => {
  const a = generateDemoSecrets();
  const b = generateDemoSecrets();
  assert.notEqual(a.deviceSecret, b.deviceSecret);
  assert.notEqual(a.controllerSecret, b.controllerSecret);
  assert.notEqual(a.videoTicketSecret, b.videoTicketSecret);
  assert.notEqual(a.videoPublisherSecret, b.videoPublisherSecret);
});
