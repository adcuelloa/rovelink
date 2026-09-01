/**
 * Port-conflict pre-checks (Problem 8B §13). Never kills whatever is
 * already listening — only reports it, clearly, before spawning anything.
 */

import { createServer } from 'node:net';

export class PortInUseError extends Error {
  readonly port: number;

  constructor(port: number) {
    super(`Port ${port} is already in use.`);
    this.name = 'PortInUseError';
    this.port = port;
  }
}

/** Resolves `true` if `port` is free to bind on localhost, `false` if
 * something is already listening on it. Never binds to 0.0.0.0 (brief §29). */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/** Throws `PortInUseError` for the first occupied port found, so the
 * orchestrator can fail fast with a clear message before spawning anything. */
export async function assertPortsFree(
  ports: readonly { readonly name: string; readonly port: number }[],
): Promise<void> {
  // Sequential and awaited one at a time: the list is small and fixed, and
  // failing on the FIRST occupied port (in order) gives a deterministic,
  // easy-to-read error instead of a nondeterministic race between checks.
  for (const { port } of ports) {
    const free = await isPortFree(port);
    if (!free) throw new PortInUseError(port);
  }
}
