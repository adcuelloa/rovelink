/**
 * Ephemeral demo credentials (Problem 8B §10). Generated fresh on every
 * `pnpm dev:demo` run — never read from, or written to, any tracked file.
 *
 * `VIDEO_TICKET_SECRET` MUST be identical between the control relay and the
 * video relay: it's the shared secret the two Workers use to agree a video
 * ticket minted by one is genuine to the other (see
 * `docs/authentication.md`). Generating it once here and handing the same
 * value to both env files is what guarantees that.
 *
 * The only value ever shown to the human operator is `controllerSecret` —
 * they type it into the normal login form (see `client-key.ts` in
 * `web/src/auth/`). Nothing else here is ever printed, logged, or placed in
 * a `VITE_*` variable.
 */

import { randomBytes } from 'node:crypto';

export interface DemoSecrets {
  readonly deviceSecret: string;
  readonly controllerSecret: string;
  readonly videoTicketSecret: string;
  readonly videoPublisherSecret: string;
}

/** Matches the hex format already used by `relay/.dev.vars`/`video-relay/.dev.vars`. */
function randomHex(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function generateDemoSecrets(): DemoSecrets {
  return {
    deviceSecret: randomHex(),
    controllerSecret: randomHex(),
    videoTicketSecret: randomHex(),
    videoPublisherSecret: randomHex(),
  };
}
