import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spawnChild, stopAll } from './children.ts';

/** Waits for the child's own "ready" line (printed only after it has
 * registered its signal handler) instead of an arbitrary sleep — avoids a
 * race where stop() signals the child before its handler exists, which
 * would make it die from the OS default action instead of exercising the
 * handler this test is actually about. */
function onReady(child: { name: string }, lines: string[]): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (lines.some((line) => line === `[${child.name}] ready`)) resolve();
    };
    const interval = setInterval(check, 5);
    check();
    setTimeout(() => clearInterval(interval), 5000).unref();
  });
}

test('captures stdout/stderr lines with the [name] prefix', async () => {
  const lines: string[] = [];
  const child = spawnChild({
    name: 'echo-test',
    command: process.execPath,
    args: ['-e', 'console.log("hello"); console.error("uh-oh");'],
    onLine: (line) => lines.push(line),
  });
  await child.exited;
  assert.ok(lines.includes('[echo-test] hello'));
  assert.ok(lines.includes('[echo-test] uh-oh'));
});

test('stop() SIGTERMs a well-behaved child and it exits cleanly', async () => {
  const lines: string[] = [];
  const child = spawnChild({
    name: 'graceful',
    command: process.execPath,
    args: [
      '-e',
      'process.on("SIGTERM", () => process.exit(0)); console.log("ready"); setInterval(() => {}, 1000);',
    ],
    onLine: (line) => lines.push(line),
  });
  await onReady(child, lines);
  await child.stop(2000);
  const result = await child.exited;
  assert.equal(result.signal, null);
  assert.equal(result.code, 0);
});

test('stop() escalates to SIGKILL for a child that ignores SIGTERM', async () => {
  const lines: string[] = [];
  const child = spawnChild({
    name: 'stubborn',
    command: process.execPath,
    args: [
      '-e',
      'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000);',
    ],
    onLine: (line) => lines.push(line),
  });
  await onReady(child, lines);
  const started = Date.now();
  await child.stop(300);
  const elapsed = Date.now() - started;
  const result = await child.exited;
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(
    elapsed >= 290,
    `expected to wait out the graceful timeout (~300ms), took ${elapsed}ms`,
  );
});

test('stop() on an already-exited child resolves without throwing', async () => {
  const child = spawnChild({
    name: 'quick',
    command: process.execPath,
    args: ['-e', 'process.exit(0);'],
    onLine: () => {},
  });
  await child.exited;
  await child.stop(500);
});

test('stopAll() stops every child and does not affect an unrelated process', async () => {
  const survivorLines: string[] = [];
  const survivor = spawnChild({
    name: 'survivor',
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000);'],
    onLine: (line) => survivorLines.push(line),
  });

  const aLines: string[] = [];
  const a = spawnChild({
    name: 'a',
    command: process.execPath,
    args: [
      '-e',
      'process.on("SIGTERM", () => process.exit(0)); console.log("ready"); setInterval(() => {}, 1000);',
    ],
    onLine: (line) => aLines.push(line),
  });
  const bLines: string[] = [];
  const b = spawnChild({
    name: 'b',
    command: process.execPath,
    args: [
      '-e',
      'process.on("SIGTERM", () => process.exit(0)); console.log("ready"); setInterval(() => {}, 1000);',
    ],
    onLine: (line) => bLines.push(line),
  });

  try {
    await Promise.all([onReady(a, aLines), onReady(b, bLines)]);
    await stopAll([a, b], 2000);
    const [resultA, resultB] = await Promise.all([a.exited, b.exited]);
    assert.equal(resultA.code, 0);
    assert.equal(resultB.code, 0);

    // The unrelated "survivor" process (a different process group) must be
    // untouched by stopping a and b. Signal 0 just probes liveness; it
    // throws if the process is gone.
    assert.doesNotThrow(() => process.kill(survivor.pid, 0));
  } finally {
    await survivor.stop(2000);
    void survivorLines;
  }
});
