import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mintVideoTicket,
  verifyVideoTicket,
  VIDEO_TICKET_CLOCK_SKEW_MS,
  VIDEO_TICKET_TTL_MS,
} from './video-ticket.ts';
import type { VideoTicketClaim } from './video-ticket.ts';

const SECRET = 'test-video-ticket-secret';
const OTHER_SECRET = 'a-completely-different-secret';
const claim: VideoTicketClaim = { robotId: 'robot-01', role: 'viewer' };

/** Decodes a base64url payload segment into a plain, mutable JSON object
 * for tests that need to tamper with it — bypasses VideoTicketClaim/
 * VideoTicketPayload's own types entirely, since a test tampering with a
 * ticket is deliberately not constrained by the shapes real callers use.
 * Spreading into a fresh object literal (rather than casting the decoded
 * `object`) is what gives the result an index-signature-compatible type
 * without an assertion. */
function decodeSegmentAsPlainObject(segment: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
}

/** Signs an arbitrary plain object as a ticket-shaped token, the same way
 * mintVideoTicket does internally — used only to construct a ticket whose
 * claims (e.g. `role`) fall outside what VideoTicketClaim's own types
 * allow a real caller to express, so the runtime rejection path can be
 * exercised directly rather than fought past with a type assertion. */
async function signTestPayload(payload: Record<string, unknown>, secret: string): Promise<string> {
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadSegment));
  const signatureSegment = Buffer.from(signature).toString('base64url');
  return `${payloadSegment}.${signatureSegment}`;
}

test('mint then verify: a freshly minted ticket verifies and carries the right claims', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now);
  const result = await verifyVideoTicket(minted.token, SECRET, claim, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.robotId, 'robot-01');
    assert.equal(result.payload.role, 'viewer');
    assert.equal(result.payload.issuedAt, now);
    assert.equal(result.payload.expiresAt, minted.expiresAt);
    assert.equal(typeof result.payload.ticketId, 'string');
    assert.ok(result.payload.ticketId.length > 0);
  }
});

test('mint: expiresAt is issuedAt + the requested TTL, defaulting to VIDEO_TICKET_TTL_MS', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now);
  assert.equal(minted.expiresAt, now + VIDEO_TICKET_TTL_MS);

  const custom = await mintVideoTicket(claim, SECRET, now, 10_000);
  assert.equal(custom.expiresAt, now + 10_000);
});

test('mint: an optional controllerSessionId is carried through for audit', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(
    { ...claim, controllerSessionId: 'session-abc' },
    SECRET,
    now,
  );
  const result = await verifyVideoTicket(minted.token, SECRET, claim, now);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.payload.controllerSessionId, 'session-abc');
});

test('verify: wrong signing secret is rejected', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now);
  const result = await verifyVideoTicket(minted.token, OTHER_SECRET, claim, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'bad-signature');
});

test('verify: a tampered payload segment is rejected even with the right secret', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now);
  const [payloadSegment, signatureSegment] = minted.token.split('.');
  // Flip the robotId claim inside the payload segment without re-signing.
  const decoded = decodeSegmentAsPlainObject(payloadSegment ?? '');
  decoded.robotId = 'robot-99';
  const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
  const tampered = `${tamperedPayload}.${signatureSegment}`;

  const result = await verifyVideoTicket(tampered, SECRET, claim, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'bad-signature');
});

test('verify: an expired ticket is rejected with reason "expired"', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now, 1000);
  const result = await verifyVideoTicket(minted.token, SECRET, claim, now + 1000 + 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'expired');
});

test('verify: a ticket at the exact expiry instant is still rejected (expiresAt is exclusive)', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now, 1000);
  const result = await verifyVideoTicket(minted.token, SECRET, claim, now + 1000);
  assert.equal(result.ok, false);
});

test('verify: a not-yet-valid (future-issued) ticket beyond clock skew is rejected', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now + VIDEO_TICKET_CLOCK_SKEW_MS + 1000);
  const result = await verifyVideoTicket(minted.token, SECRET, claim, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'not-yet-valid');
});

test('verify: a future issuedAt WITHIN the clock skew tolerance is accepted', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now + VIDEO_TICKET_CLOCK_SKEW_MS - 1);
  const result = await verifyVideoTicket(minted.token, SECRET, claim, now);
  assert.equal(result.ok, true);
});

test('verify: a ticket minted for a different robotId is rejected', async () => {
  const now = 1_000_000;
  const minted = await mintVideoTicket(claim, SECRET, now);
  const result = await verifyVideoTicket(
    minted.token,
    SECRET,
    { robotId: 'robot-99', role: 'viewer' },
    now,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'wrong-robot');
});

test('verify: a ticket minted for a different role is rejected', async () => {
  const now = 1_000_000;
  // role: 'controller' is not an expressible VideoTicketClaim for any real
  // caller (mintVideoTicket only ever mints 'viewer' tickets) — signed
  // directly to exercise the verifier's own defensive role check, in case
  // a future ticket kind ever shares this same secret/signing scheme.
  const token = await signTestPayload(
    {
      v: 1,
      robotId: claim.robotId,
      role: 'controller',
      issuedAt: now,
      expiresAt: now + VIDEO_TICKET_TTL_MS,
      ticketId: crypto.randomUUID(),
    },
    SECRET,
  );
  const result = await verifyVideoTicket(token, SECRET, claim, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'wrong-role');
});

test('verify: structurally malformed tokens are rejected as "malformed" without throwing', async () => {
  const now = 1_000_000;
  // Each of these fails before signature verification is even reached:
  // wrong segment count, an empty segment, or characters outside the
  // base64url alphabet.
  for (const bad of ['', 'not-a-ticket', 'only-one-segment', '..', 'a.b.c', '   ', '!!!.!!!']) {
    const result = await verifyVideoTicket(bad, SECRET, claim, now);
    assert.equal(result.ok, false, `expected "${bad}" to be rejected`);
    if (!result.ok)
      assert.equal(
        result.reason,
        'malformed',
        `expected "${bad}" -> malformed, got ${result.reason}`,
      );
  }
});

test('verify: a well-formed but bogus token fails signature verification, not "malformed"', async () => {
  // Structurally valid (two base64url segments) but not a real ticket:
  // this is a signature failure, not a parsing failure.
  const result = await verifyVideoTicket('null.null', SECRET, claim, 1_000_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'bad-signature');
});

test('verify: a payload segment that is valid base64url but not valid JSON is malformed, not a crash', async () => {
  const now = 1_000_000;
  const payloadSegment = Buffer.from('not json {{{', 'utf8').toString('base64url');
  const result = await verifyVideoTicket(`${payloadSegment}.somesignature`, SECRET, claim, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'malformed');
});

test('two tickets minted for the same claim have different ticketIds (nonce)', async () => {
  const now = 1_000_000;
  const a = await mintVideoTicket(claim, SECRET, now);
  const b = await mintVideoTicket(claim, SECRET, now);
  const resultA = await verifyVideoTicket(a.token, SECRET, claim, now);
  const resultB = await verifyVideoTicket(b.token, SECRET, claim, now);
  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  if (resultA.ok && resultB.ok) assert.notEqual(resultA.payload.ticketId, resultB.payload.ticketId);
});
