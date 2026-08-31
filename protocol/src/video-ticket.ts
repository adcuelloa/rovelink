/**
 * Short-lived signed video viewer tickets (Problem 7C).
 *
 * A browser controller is already authenticated to the CONTROL relay
 * (`controller.register` + `CONTROLLER_SECRET` — see protocol.ts /
 * relay/src/room.ts). The video relay is a completely separate Worker that
 * must never see `CONTROLLER_SECRET`: instead, the control relay mints a
 * short-lived ticket for a controller it has already authenticated, and the
 * video relay verifies that ticket using a secret shared ONLY between the
 * two relays (`VIDEO_TICKET_SECRET`) — never sent to, or knowable by, the
 * browser. Video authorization therefore derives entirely from "this
 * controller is already authenticated to control," not from any
 * independent video credential the browser holds.
 *
 * Format: a compact, hand-rolled HMAC-SHA-256-signed token —
 * `base64url(JSON payload) + '.' + base64url(signature)` — deliberately
 * NOT a JWT library: the algorithm is fixed (no `alg` field to negotiate,
 * so the classic "alg:none" JWT footgun doesn't exist here by
 * construction) and the whole implementation is a few WebCrypto calls.
 * Verification always checks the signature FIRST, over the raw payload
 * segment bytes, before ever parsing or trusting the decoded JSON for any
 * authorization decision.
 *
 * Lives in `@rovelink/protocol` (not the relay package) because both the
 * control relay (mints) and the video relay (verifies) need to agree on
 * the exact same format and algorithm — sharing the code is what
 * guarantees that, rather than two hand-written implementations staying in
 * sync by convention.
 */

const VIDEO_TICKET_VERSION = 1;

/** The ticket only authorizes ESTABLISHING a video viewer connection
 * (Problem 7C brief §5): once registered, the video relay does not
 * re-check ticket expiry against an already-live socket. 30-60s was the
 * suggested range; 45s sits in the middle — long enough to cover a normal
 * "request ticket, then dial the video WSS" round trip with margin, short
 * enough that a leaked/logged ticket is worthless within a minute. */
export const VIDEO_TICKET_TTL_MS = 45_000;

/** Tolerance for a ticket whose `issuedAt` appears slightly in the future
 * relative to the verifier's own clock (ordinary clock drift between the
 * control relay and video relay, both Cloudflare Workers but not
 * guaranteed to observe identical `Date.now()` to the millisecond). Beyond
 * this, a future-issued ticket is rejected outright rather than accepted
 * "early" — see verifyVideoTicket's not-yet-valid case. */
export const VIDEO_TICKET_CLOCK_SKEW_MS = 5_000;

export interface VideoTicketClaim {
  readonly robotId: string;
  readonly role: 'viewer';
  /** Optional, audit/debugging only (Problem 7C brief §4) — never used for
   * an authorization decision by verifyVideoTicket. */
  readonly controllerSessionId?: string;
}

export interface VideoTicketPayload extends VideoTicketClaim {
  readonly v: typeof VIDEO_TICKET_VERSION;
  readonly issuedAt: number;
  readonly expiresAt: number;
  /** Nonce distinguishing otherwise-identical tickets minted for the same
   * claim at the same instant. Not used for one-use/replay enforcement in
   * 7C (see the module doc's replay-policy note in room.ts) — present so a
   * future revocation list could target one ticket without ambiguity. */
  readonly ticketId: string;
}

export interface MintedTicket {
  readonly token: string;
  readonly expiresAt: number;
}

export type VideoTicketRejection =
  | 'malformed'
  | 'bad-signature'
  | 'wrong-robot'
  | 'wrong-role'
  | 'expired'
  | 'not-yet-valid';

export type VideoTicketResult =
  | { readonly ok: true; readonly payload: VideoTicketPayload }
  | { readonly ok: false; readonly reason: VideoTicketRejection };

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns `null` instead of throwing on invalid base64url input — callers
 * treat that identically to any other malformed-ticket case. */
function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const padded = value
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function mintVideoTicket(
  claim: VideoTicketClaim,
  secret: string,
  issuedAtMs: number,
  ttlMs: number = VIDEO_TICKET_TTL_MS,
): Promise<MintedTicket> {
  const expiresAt = issuedAtMs + ttlMs;
  const payload: VideoTicketPayload = {
    v: VIDEO_TICKET_VERSION,
    robotId: claim.robotId,
    role: claim.role,
    issuedAt: issuedAtMs,
    expiresAt,
    ticketId: crypto.randomUUID(),
    controllerSessionId: claim.controllerSessionId,
  };

  const payloadSegment = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payloadSegment));
  const signatureSegment = base64UrlEncode(new Uint8Array(signature));

  return { token: `${payloadSegment}.${signatureSegment}`, expiresAt };
}

function isVideoTicketPayload(value: unknown): value is VideoTicketPayload {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<VideoTicketPayload>;
  return (
    p.v === VIDEO_TICKET_VERSION &&
    typeof p.robotId === 'string' &&
    typeof p.role === 'string' &&
    typeof p.issuedAt === 'number' &&
    typeof p.expiresAt === 'number' &&
    typeof p.ticketId === 'string' &&
    (p.controllerSessionId === undefined || typeof p.controllerSessionId === 'string')
  );
}

/**
 * Verifies signature FIRST — over the raw payload segment bytes, using
 * WebCrypto's own `crypto.subtle.verify` (a standard, portable HMAC
 * verification primitive; no manual byte comparison needed here, unlike
 * auth.ts's `verifyCredential`, because `subtle.verify` for HMAC already
 * is the correct, constant-time-by-design operation for this exact case).
 * Only once the signature checks out is the payload parsed and its claims
 * compared against what the caller expects — an attacker can never
 * influence which rejection reason comes back by crafting the JSON, since
 * a bad signature is caught before the JSON is ever looked at.
 */
export async function verifyVideoTicket(
  token: string,
  secret: string,
  expected: { readonly robotId: string; readonly role: 'viewer' },
  nowMs: number,
  skewMs: number = VIDEO_TICKET_CLOCK_SKEW_MS,
): Promise<VideoTicketResult> {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [payloadSegment, signatureSegment] = parts;
  if (payloadSegment === undefined || payloadSegment.length === 0)
    return { ok: false, reason: 'malformed' };
  if (signatureSegment === undefined || signatureSegment.length === 0)
    return { ok: false, reason: 'malformed' };

  const signatureBytes = base64UrlDecode(signatureSegment);
  if (signatureBytes === null) return { ok: false, reason: 'malformed' };

  const key = await importHmacKey(secret, 'verify');
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes.slice(),
    textEncoder.encode(payloadSegment),
  );
  if (!verified) return { ok: false, reason: 'bad-signature' };

  const payloadBytes = base64UrlDecode(payloadSegment);
  if (payloadBytes === null) return { ok: false, reason: 'malformed' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(payloadBytes));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isVideoTicketPayload(parsed)) return { ok: false, reason: 'malformed' };

  if (parsed.robotId !== expected.robotId) return { ok: false, reason: 'wrong-robot' };
  if (parsed.role !== expected.role) return { ok: false, reason: 'wrong-role' };
  if (nowMs >= parsed.expiresAt) return { ok: false, reason: 'expired' };
  if (parsed.issuedAt - nowMs > skewMs) return { ok: false, reason: 'not-yet-valid' };

  return { ok: true, payload: parsed };
}
