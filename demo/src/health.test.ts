import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { test } from 'node:test';

import { HealthCheckTimeoutError, waitForHealthy, waitForHttpOk } from './health.ts';

async function startServer(handler: (path: string) => { status: number; body: unknown }): Promise<{
  url: string;
  server: Server;
}> {
  const server = createServer((req, res) => {
    const { status, body } = handler(req.url ?? '/');
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('unexpected address');
  return { url: `http://127.0.0.1:${address.port}/health`, server };
}

test('resolves as soon as the endpoint reports {ok:true}', async () => {
  const { url, server } = await startServer(() => ({ status: 200, body: { ok: true } }));
  try {
    await waitForHealthy({ url, timeoutMs: 1000, intervalMs: 20 });
  } finally {
    server.close();
  }
});

test('keeps polling through connection refusals until the server starts', async () => {
  // A URL nothing is listening on yet, then start the server mid-poll.
  const { url, server } = await startServer(() => ({ status: 200, body: { ok: true } }));
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 50));

  let relisten: (() => void) | null = null;
  const relistenPromise = new Promise<void>((resolve) => {
    relisten = resolve;
  });
  const port = Number(new URL(url).port);
  setTimeout(() => {
    server.listen(port, '127.0.0.1', () => relisten?.());
  }, 100);

  await waitForHealthy({ url, timeoutMs: 3000, intervalMs: 30 });
  await relistenPromise;
  server.close();
});

test('rejects with HealthCheckTimeoutError once the timeout elapses', async () => {
  const { url, server } = await startServer(() => ({ status: 503, body: { ok: false } }));
  try {
    await assert.rejects(
      () => waitForHealthy({ url, timeoutMs: 150, intervalMs: 30 }),
      (err: unknown) => {
        assert.ok(err instanceof HealthCheckTimeoutError);
        assert.equal(err.url, url);
        return true;
      },
    );
  } finally {
    server.close();
  }
});

test('waitForHttpOk resolves on any non-error status, without requiring {ok:true}', async () => {
  const { url, server } = await startServer(() => ({ status: 200, body: '<html></html>' }));
  try {
    await waitForHttpOk({ url, timeoutMs: 500, intervalMs: 20 });
  } finally {
    server.close();
  }
});

test('waitForHttpOk times out on a persistent error status', async () => {
  const { url, server } = await startServer(() => ({ status: 500, body: 'boom' }));
  try {
    await assert.rejects(() => waitForHttpOk({ url, timeoutMs: 100, intervalMs: 20 }));
  } finally {
    server.close();
  }
});

test('a 200 without ok:true is treated as not-yet-healthy', async () => {
  const { url, server } = await startServer(() => ({ status: 200, body: { status: 'starting' } }));
  try {
    await assert.rejects(() => waitForHealthy({ url, timeoutMs: 100, intervalMs: 20 }));
  } finally {
    server.close();
  }
});
