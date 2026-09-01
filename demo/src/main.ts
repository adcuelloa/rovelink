/**
 * `pnpm dev:demo` (Problem 8B): one-command hardwareless RoveLink stack.
 * Spawns the control relay, video relay, robot simulator, simulated camera
 * publisher, and the web dashboard — all as real network peers of each
 * other, all real production auth (§16) — and prints a single READY summary
 * once the whole stack is genuinely usable.
 *
 * Startup order (brief §8): ports free -> ephemeral secrets generated ->
 * relays start -> control relay healthy -> video relay healthy -> robot
 * simulator registered -> camera simulator publishing -> web dev server
 * responding -> READY.
 */

import { fileURLToPath } from 'node:url';

import type { SpawnedChild } from './children.ts';
import { spawnChild, stopAll } from './children.ts';
import { loadConfig } from './config.ts';
import { writeDemoEnvFiles } from './env-file.ts';
import { waitForHealthy, waitForHttpOk } from './health.ts';
import { assertPortsFree, PortInUseError } from './ports.ts';
import { generateDemoSecrets } from './secrets.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const paths = {
  relay: `${repoRoot}/relay`,
  videoRelay: `${repoRoot}/video-relay`,
  web: `${repoRoot}/web`,
  robotSim: `${repoRoot}/robot-sim`,
};

/** Broadcasts every line to the console (prefixed by the child itself, see
 * children.ts) AND to any readiness watcher waiting on a specific line —
 * this is the "startup line from the child process" readiness signal the
 * plan uses for the robot/camera simulators, which have no HTTP endpoint of
 * their own (brief §15). */
function lineBus(): {
  onLine: (line: string) => void;
  waitFor: (predicate: (line: string) => boolean, timeoutMs: number) => Promise<void>;
} {
  let watchers: { predicate: (line: string) => boolean; resolve: () => void }[] = [];
  return {
    onLine: (line: string) => {
      console.log(line);
      const [matched, remaining] = partition(watchers, (w) => w.predicate(line));
      watchers = remaining;
      for (const w of matched) w.resolve();
    },
    waitFor: (predicate, timeoutMs) =>
      new Promise((resolve, reject) => {
        const entry = {
          predicate,
          resolve: (): void => {
            clearTimeout(timer);
            resolve();
          },
        };
        const timer = setTimeout(() => {
          watchers = watchers.filter((w) => w !== entry);
          reject(new Error(`timed out after ${timeoutMs}ms waiting for a matching line`));
        }, timeoutMs);
        watchers.push(entry);
      }),
  };
}

function partition<T>(items: readonly T[], predicate: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (predicate(item) ? yes : no).push(item);
  return [yes, no];
}

function printReady(config: ReturnType<typeof loadConfig>, controllerSecret: string): void {
  console.log('');
  console.log('RoveLink Demo Ready');
  console.log('');
  console.log(`Web:          http://localhost:${config.webPort}`);
  console.log(`Control:      http://localhost:${config.controlPort}`);
  console.log(`Video:        http://localhost:${config.videoPort}`);
  console.log(`Robot:        ${config.robotId} · simulated`);
  console.log(`Camera:       ${config.robotId} · simulated 640x480 @ 10 FPS`);
  console.log('');
  console.log('Demo controller key:');
  console.log(controllerSecret);
  console.log('');
  console.log('Open the Web URL and enter that controller key normally.');
  console.log('');
  console.log('Press Ctrl+C to stop.');
}

async function main(): Promise<void> {
  const config = loadConfig();
  // `wrangler dev` also binds a devtools inspector port (default 9229 for
  // EVERY instance) in addition to --port: two wrangler children in the
  // same demo would otherwise race for that same default and one would
  // fail with "Address already in use" (confirmed empirically). Derived
  // from the main port so it stays deterministic and distinct per relay
  // without adding more user-facing config surface.
  const controlInspectorPort = config.controlPort + 100;
  const videoInspectorPort = config.videoPort + 100;

  console.log('[demo] checking ports...');
  try {
    await assertPortsFree([
      { name: 'control', port: config.controlPort },
      { name: 'video', port: config.videoPort },
      { name: 'web', port: config.webPort },
      { name: 'control-inspector', port: controlInspectorPort },
      { name: 'video-inspector', port: videoInspectorPort },
    ]);
  } catch (err) {
    if (err instanceof PortInUseError) {
      console.error(`[demo] ${err.message}`);
      console.error('[demo] stop whatever is using that port, or override it (see --help ports).');
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log('[demo] generating ephemeral secrets...');
  const secrets = generateDemoSecrets();
  const envFiles = await writeDemoEnvFiles(secrets);

  const children: SpawnedChild[] = [];
  let shuttingDown = false;

  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[demo] shutting down...');
    await stopAll(children);
    await envFiles.cleanup();
    process.exit(exitCode);
  };

  process.on('SIGINT', () => {
    void shutdown(0);
  });
  process.on('SIGTERM', () => {
    void shutdown(0);
  });

  try {
    const relay = spawnChild({
      name: 'relay',
      command: 'npx',
      args: [
        'wrangler',
        'dev',
        '--port',
        String(config.controlPort),
        '--inspector-port',
        String(controlInspectorPort),
        '--env-file',
        envFiles.controlEnvPath,
      ],
      cwd: paths.relay,
      env: process.env,
    });
    children.push(relay);

    const videoRelay = spawnChild({
      name: 'video-relay',
      command: 'npx',
      args: [
        'wrangler',
        'dev',
        '--port',
        String(config.videoPort),
        '--inspector-port',
        String(videoInspectorPort),
        '--env-file',
        envFiles.videoEnvPath,
      ],
      cwd: paths.videoRelay,
      env: process.env,
    });
    children.push(videoRelay);

    console.log('[demo] waiting for control relay to become healthy...');
    await waitForHealthy({
      url: `http://localhost:${config.controlPort}/health`,
      timeoutMs: 30_000,
    });
    console.log('[demo] waiting for video relay to become healthy...');
    await waitForHealthy({ url: `http://localhost:${config.videoPort}/health`, timeoutMs: 30_000 });

    const robotBus = lineBus();
    const robotSim = spawnChild({
      name: 'robot-sim',
      command: process.execPath,
      args: ['--experimental-strip-types', 'src/cli.ts'],
      cwd: paths.robotSim,
      env: {
        ...process.env,
        RELAY_URL: `ws://localhost:${config.controlPort}`,
        ROBOT_ID: config.robotId,
        DEVICE_SECRET: secrets.deviceSecret,
        TELEMETRY_MS: String(config.telemetryMs),
        ACK_DELAY_MS: String(config.robotLatencyMs),
      },
      onLine: robotBus.onLine,
    });
    children.push(robotSim);
    console.log('[demo] waiting for the robot simulator to register...');
    await robotBus.waitFor((line) => line.includes('registered and online'), 20_000);

    const cameraBus = lineBus();
    const cameraSim = spawnChild({
      name: 'camera-sim',
      command: process.execPath,
      args: ['--experimental-strip-types', 'src/dev/publisher-cli.ts'],
      cwd: paths.videoRelay,
      env: {
        ...process.env,
        VIDEO_RELAY_URL: `ws://localhost:${config.videoPort}`,
        ROBOT_ID: config.robotId,
        FPS: '10',
        VIDEO_PUBLISHER_SECRET: secrets.videoPublisherSecret,
      },
      onLine: cameraBus.onLine,
    });
    children.push(cameraSim);
    console.log('[demo] waiting for the simulated camera to start publishing...');
    await cameraBus.waitFor((line) => line.includes('accepted, streamSessionId='), 20_000);

    const web = spawnChild({
      name: 'web',
      command: 'npx',
      // `web/vite.config.ts` sets `server.host: true` (binds every
      // interface) for other workflows (e.g. testing from a phone on the
      // LAN during hardware bring-up); the demo overrides that back to
      // localhost-only on the CLI, matching the relays' own default bind
      // and brief §29's "no wildcard binds" requirement, without touching
      // the tracked config other workflows rely on.
      args: ['vite', '--port', String(config.webPort), '--strictPort', '--host', '127.0.0.1'],
      cwd: paths.web,
      env: {
        ...process.env,
        VITE_RELAY_URL: `ws://localhost:${config.controlPort}`,
        VITE_VIDEO_RELAY_URL: `ws://localhost:${config.videoPort}`,
        VITE_ROBOT_ID: config.robotId,
      },
    });
    children.push(web);
    console.log('[demo] waiting for the web dev server...');
    await waitForHttpOk({ url: `http://localhost:${config.webPort}/`, timeoutMs: 30_000 });

    printReady(config, secrets.controllerSecret);
  } catch (err) {
    console.error('[demo] startup failed:', err instanceof Error ? err.message : err);
    await stopAll(children);
    await envFiles.cleanup();
    process.exitCode = 1;
  }
}

await main();
