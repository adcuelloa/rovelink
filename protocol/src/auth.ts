/**
 * Constant-time shared-credential verification, used wherever a Worker
 * checks a bearer secret against a Cloudflare-secret-configured expected
 * value: the control relay's `device.register`/`controller.register`, and
 * the video relay's `publisher.register` (Problem 7C). Lives in
 * `@rovelink/protocol` — not duplicated per-relay — specifically so both
 * Workers verify credentials the exact same way.
 *
 * Both sides are SHA-256'd before comparison: hashing first fixes both
 * inputs at the same 32-byte length, so an attacker learns nothing about
 * the length of the real secret from comparison timing either.
 *
 * The digests are then compared with a manual constant-time XOR-accumulate
 * loop rather than `crypto.subtle.timingSafeEqual` — that method exists
 * only as a Cloudflare Workers runtime extension to `SubtleCrypto`, not
 * standard WebCrypto (confirmed absent under plain Node — this was caught
 * by this module's own test, which runs under `node --test`, not workerd).
 * `@rovelink/protocol` is shared, backend-portable code (video-relay's
 * publisher auth and any future self-hosted relay use this too — see
 * Problem 7B.1 brief §15's same portability principle applied here), so it
 * cannot depend on a platform-specific API. The manual loop below is the
 * standard technique `timingSafeEqual` itself implements: every byte pair
 * is compared and XORed into an accumulator regardless of any earlier
 * mismatch, so the loop's running time never depends on where (or whether)
 * the inputs first differ.
 *
 * The secret itself is not hashed at rest: these are single shared
 * credentials held in Cloudflare's encrypted Worker secret store (see
 * `wrangler secret put`), not a user database, so there is nothing extra a
 * server-side hash would protect.
 */

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/** Equal-length inputs only (both are SHA-256 digests here, always 32
 * bytes): a length mismatch would itself leak information through an
 * early return, so callers must guarantee equal length instead. */
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * `expected` missing/empty (a misconfigured deploy with no secret set) fails
 * closed: it never matches, even against an empty `provided`.
 */
export async function verifyCredential(
  provided: string | undefined,
  expected: string | undefined,
): Promise<boolean> {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  const [providedHash, expectedHash] = await Promise.all([
    digest(provided ?? ''),
    digest(expected),
  ]);
  return timingSafeEqualBytes(providedHash, expectedHash);
}
