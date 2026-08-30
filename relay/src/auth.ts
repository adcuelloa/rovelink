/**
 * Constant-time credential verification for `device.register` /
 * `controller.register`.
 *
 * Both sides are SHA-256'd before comparison: `crypto.subtle.timingSafeEqual`
 * requires equal-length inputs and, unlike a short-circuiting `===`, this
 * hash-first shape means an attacker learns nothing about the length of the
 * real secret either. This is the pattern Cloudflare's own Workers docs
 * recommend for comparing API keys/tokens in a Worker; there is no reason to
 * hand-roll it.
 *
 * The secret itself is not hashed at rest: these are single shared
 * credentials held in Cloudflare's encrypted Worker secret store (see
 * DEVICE_SECRET/CONTROLLER_SECRET in wrangler secret put), not a user
 * database, so there is nothing extra a server-side hash would protect.
 */

const encoder = new TextEncoder();

async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
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
  return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}
