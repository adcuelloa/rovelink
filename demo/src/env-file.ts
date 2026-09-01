/**
 * Ephemeral `--env-file` files for `wrangler dev` (Problem 8B §10/§11).
 *
 * `wrangler dev --env-file <path>` was confirmed (empirically, against a
 * real `wrangler dev` instance) to inject plain env vars into `env.*`
 * exactly like `.dev.vars` does, without requiring — or touching — a
 * `.dev.vars` file in `relay/` or `video-relay/` at all. That is the whole
 * point of this module: the developer's own real `relay/.dev.vars` /
 * `video-relay/.dev.vars` (which hold their own long-lived local secrets)
 * are never read, written, or overwritten by the demo.
 *
 * Lives entirely under a fresh `os.tmpdir()` directory (never inside the
 * repo), mode 0700, with each file mode 0600. Removed recursively — and
 * ONLY the directory this module itself created — on `cleanup()`, which the
 * orchestrator calls on both clean shutdown and startup failure.
 */

import { randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { DemoSecrets } from './secrets.ts';

export interface DemoEnvFiles {
  readonly dir: string;
  readonly controlEnvPath: string;
  readonly videoEnvPath: string;
  cleanup(): Promise<void>;
}

function formatEnv(vars: Readonly<Record<string, string>>): string {
  return `${Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

/**
 * Writes the two relays' temp env files. Each file contains ONLY what that
 * relay needs (brief §10/Refinement 1) — the control relay never sees
 * `VIDEO_PUBLISHER_SECRET`, the video relay never sees `DEVICE_SECRET` or
 * `CONTROLLER_SECRET`. `VIDEO_TICKET_SECRET` is the one value written to
 * both, byte-for-byte identical, matching the constraint documented in both
 * relays' own `.dev.vars.example`.
 */
export async function writeDemoEnvFiles(secrets: DemoSecrets): Promise<DemoEnvFiles> {
  const dir = await mkdtemp(join(tmpdir(), `rovelink-demo-${randomBytes(4).toString('hex')}-`));
  await chmod(dir, 0o700);

  const controlEnvPath = join(dir, 'control.env');
  const videoEnvPath = join(dir, 'video.env');

  await writeFile(
    controlEnvPath,
    formatEnv({
      DEVICE_SECRET: secrets.deviceSecret,
      CONTROLLER_SECRET: secrets.controllerSecret,
      VIDEO_TICKET_SECRET: secrets.videoTicketSecret,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    videoEnvPath,
    formatEnv({
      VIDEO_PUBLISHER_SECRET: secrets.videoPublisherSecret,
      VIDEO_TICKET_SECRET: secrets.videoTicketSecret,
    }),
    { mode: 0o600 },
  );
  // Belt-and-suspenders: `mode` on writeFile only applies to a NEW file, and
  // umask can still widen it on some platforms — set it explicitly too.
  await chmod(controlEnvPath, 0o600);
  await chmod(videoEnvPath, 0o600);

  return {
    dir,
    controlEnvPath,
    videoEnvPath,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
