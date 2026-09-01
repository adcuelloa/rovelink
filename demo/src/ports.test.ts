import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';

import { assertPortsFree, isPortFree, PortInUseError } from './ports.ts';

async function withOccupiedPort<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('unexpected address');
  try {
    return await fn(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('isPortFree resolves true for an unbound port', async () => {
  // Bind-then-release to get a genuinely free ephemeral port, then check it.
  const port = await withOccupiedPort((p) => Promise.resolve(p));
  assert.equal(await isPortFree(port), true);
});

test('isPortFree resolves false for an already-bound port', async () => {
  await withOccupiedPort(async (port) => {
    assert.equal(await isPortFree(port), false);
  });
});

test('assertPortsFree throws PortInUseError naming the occupied port', async () => {
  await withOccupiedPort(async (port) => {
    await assert.rejects(
      () => assertPortsFree([{ name: 'control', port }]),
      (err: unknown) => {
        assert.ok(err instanceof PortInUseError);
        assert.equal(err.port, port);
        assert.match(err.message, new RegExp(`Port ${port} is already in use\\.`));
        return true;
      },
    );
  });
});

test('assertPortsFree resolves when every port is free', async () => {
  const port = await withOccupiedPort((p) => Promise.resolve(p));
  await assertPortsFree([{ name: 'x', port }]);
});
