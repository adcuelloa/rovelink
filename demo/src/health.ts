/**
 * Readiness polling (Problem 8B §9/§15). Both relays already exposed a
 * lightweight `GET /health` before this package existed (see
 * `relay/src/index.ts` / video-relay's equivalent) — reused as-is, no new
 * health service. No arbitrary startup sleeps: the orchestrator waits for a
 * real signal before moving on to the next stage.
 */

export interface PollOptions {
  readonly url: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

export class HealthCheckTimeoutError extends Error {
  readonly url: string;

  constructor(url: string, timeoutMs: number) {
    super(`${url} did not become healthy within ${timeoutMs}ms.`);
    this.name = 'HealthCheckTimeoutError';
    this.url = url;
  }
}

function hasOkTrue(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'ok' in value && value.ok === true;
}

async function pollUntil(
  options: PollOptions,
  check: (response: Response) => Promise<boolean>,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const intervalMs = options.intervalMs ?? 250;
  const fetchImpl = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const ready = await fetchImpl(options.url)
      .then(check)
      .catch(() => false); // connection refused (not listening yet), etc.
    if (ready) return;
    if (Date.now() >= deadline) throw new HealthCheckTimeoutError(options.url, timeoutMs);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Polls `url` until it reports `{ ok: true }` (the relays' `/health`
 * shape), or rejects with `HealthCheckTimeoutError` after `timeoutMs`. */
export function waitForHealthy(options: PollOptions): Promise<void> {
  return pollUntil(options, async (response) => {
    if (!response.ok) return false;
    return hasOkTrue(await response.json());
  });
}

/** Polls `url` until it returns any non-error HTTP status — used for the
 * Vite dev server, which has no `/health` endpoint of its own. */
export function waitForHttpOk(options: PollOptions): Promise<void> {
  return pollUntil(options, (response) => Promise.resolve(response.ok));
}
