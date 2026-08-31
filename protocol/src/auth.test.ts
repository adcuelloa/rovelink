import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyCredential } from './auth.ts';

test('verifyCredential: matching provided/expected verifies true', async () => {
  assert.equal(await verifyCredential('secret-123', 'secret-123'), true);
});

test('verifyCredential: mismatched credential verifies false', async () => {
  assert.equal(await verifyCredential('wrong', 'secret-123'), false);
});

test('verifyCredential: missing expected fails closed even against an empty provided', async () => {
  assert.equal(await verifyCredential('', undefined), false);
  assert.equal(await verifyCredential(undefined, undefined), false);
});

test('verifyCredential: empty expected fails closed', async () => {
  assert.equal(await verifyCredential('anything', ''), false);
});

test('verifyCredential: undefined provided never matches a real secret', async () => {
  assert.equal(await verifyCredential(undefined, 'secret-123'), false);
});
