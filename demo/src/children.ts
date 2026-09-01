/**
 * Child process supervision (Problem 8B §7/§15). Every process the demo
 * starts is spawned `detached: true` on its own process group (POSIX): that
 * group id equals the child's own pid, so stopping it means signaling
 * `-pid` — the child AND anything it forked (e.g. `wrangler dev` forking
 * `workerd`/esbuild) — without ever touching a process this orchestrator
 * did not itself create. This is deliberately NOT `pkill node` / `pkill
 * wrangler`: those match by name across the whole machine and could kill an
 * unrelated process the operator is running; a scoped group signal can only
 * ever reach descendants of a pid this module already knows about.
 *
 * Shutdown is bounded: SIGTERM first, then SIGKILL only if the group hasn't
 * exited within `gracefulTimeoutMs`.
 */

import type { ChildProcessByStdio } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

export interface SpawnChildOptions {
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Called for every stdout/stderr line, already prefixed with `[name] `. */
  readonly onLine?: (line: string) => void;
}

export interface ExitResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface SpawnedChild {
  readonly name: string;
  readonly pid: number;
  readonly exited: Promise<ExitResult>;
  /** Sends SIGTERM to the whole process group, waits up to
   * `gracefulTimeoutMs` for it to exit, then SIGKILLs the group if it
   * hasn't. Resolves once the group is confirmed gone (or already was). */
  stop(gracefulTimeoutMs?: number): Promise<void>;
}

function prefixLines(
  stream: NodeJS.ReadableStream,
  name: string,
  onLine: (line: string) => void,
): void {
  const rl = createInterface({ input: stream });
  rl.on('line', (line) => onLine(`[${name}] ${line}`));
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}

/** True if a signal was actually delivered; false only for ESRCH (group
 * already gone) — anything else re-throws, since that's not "already
 * stopped", it's a real failure to signal. */
function trySignalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ESRCH') return false;
    throw err;
  }
}

export function spawnChild(options: SpawnChildOptions): SpawnedChild {
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    options.command,
    options.args ?? [],
    {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const log = options.onLine ?? ((line: string) => console.log(line));
  prefixLines(child.stdout, options.name, log);
  prefixLines(child.stderr, options.name, log);

  const exited = new Promise<ExitResult>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const pid = child.pid;
  if (pid === undefined) {
    throw new Error(`failed to spawn ${options.name} (${options.command})`);
  }

  return {
    name: options.name,
    pid,
    exited,
    stop: async (gracefulTimeoutMs = 5000) => {
      if (!trySignalGroup(pid, 'SIGTERM')) return;

      const timedOut = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), gracefulTimeoutMs)),
      ]);
      if (!timedOut) return;

      trySignalGroup(pid, 'SIGKILL');
      await exited;
    },
  };
}

/** Stops every child, in reverse start order (last-started-first-stopped),
 * each bounded by `gracefulTimeoutMs`. Stops proceed even if one child's
 * stop() throws, so a single stuck process can't strand the rest. */
export async function stopAll(
  children: readonly SpawnedChild[],
  gracefulTimeoutMs = 5000,
): Promise<void> {
  const reversed = children.toReversed();
  const results = await Promise.allSettled(reversed.map((child) => child.stop(gracefulTimeoutMs)));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const failure of failures) {
    console.error('[demo] error while stopping a child process:', failure.reason);
  }
}
