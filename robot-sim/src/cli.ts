/**
 * Robot simulator entrypoint (Problem 8B). Connects to a REAL control relay
 * as a normal device peer — no shortcuts, no relay-internal calls (see
 * `client.ts`'s doc comment / Refinement 4).
 *
 * Env vars: RELAY_URL (default ws://localhost:8787), ROBOT_ID (default
 * robot-01), DEVICE_SECRET (required), TELEMETRY_MS (default 300),
 * ACK_DELAY_MS (default 0 — normal `control.ack` only, never
 * `emergency-stop.ack`, see client.ts), DROP_ACK_PERCENT (default 0), SEED
 * (optional, makes DROP_ACK_PERCENT deterministic).
 *
 * Same flags are also accepted as `--flag=value` / `--flag value` CLI args,
 * which take priority over the env var of the same name — this is what lets
 * `pnpm dev:demo --robot-latency=200` (brief §21) reach this process.
 *
 * A small stdin console (approved in the plan) exercises presence/chaos
 * behavior without editing code mid-demo:
 *
 *   status       print connection + device state
 *   unresponsive stop telemetry/acks, keep the socket open
 *   resume       resume telemetry/acks
 *   disconnect   graceful close, no auto-reconnect
 *   reconnect    reconnect now (also clears a prior disconnect)
 *   ?            help
 *
 * The stdin console only exists when stdin is a TTY — when `dev:demo`
 * spawns this process, its stdin is `'ignore'` (see `demo/src/children.ts`),
 * so `status`/`unresponsive`/`resume` aren't reachable that way. SIGUSR1 /
 * SIGUSR2 are the headless equivalent of `unresponsive` / `resume` for
 * exactly that case — a standard, minimal Unix idiom for externally
 * signaling a long-running process, not a new architectural layer: no new
 * message type, no new wire protocol, no relay change. Send with
 * `kill -USR1 <pid>` / `kill -USR2 <pid>` against this process's own pid
 * (printed on the `[robot-sim] connecting to ...` line's process, i.e. via
 * `ps`/`pgrep -f robot-sim/src/cli.ts`).
 */

import { RobotSimClient } from './client.ts';

interface Flags {
  readonly relayUrl: string;
  readonly robotId: string;
  readonly deviceSecret: string;
  readonly telemetryMs: number;
  readonly ackDelayMs: number;
  readonly dropAckPercent: number;
  readonly seed: number | undefined;
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}`;
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === undefined) continue;
    if (arg === prefix) return process.argv[i + 1];
    if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
  }
  return undefined;
}

function readFlags(): Flags {
  const relayUrl = readArg('relay-url') ?? process.env.RELAY_URL ?? 'ws://localhost:8787';
  const robotId = readArg('robot-id') ?? process.env.ROBOT_ID ?? 'robot-01';
  const deviceSecret = readArg('device-secret') ?? process.env.DEVICE_SECRET ?? '';
  const telemetryMs = Number(readArg('telemetry-ms') ?? process.env.TELEMETRY_MS ?? '300');
  const ackDelayMs = Number(
    readArg('robot-latency') ?? readArg('ack-delay-ms') ?? process.env.ACK_DELAY_MS ?? '0',
  );
  const dropAckPercent = Number(readArg('drop-ack-percent') ?? process.env.DROP_ACK_PERCENT ?? '0');
  const seedRaw = readArg('seed') ?? process.env.SEED;
  return {
    relayUrl,
    robotId,
    deviceSecret,
    telemetryMs,
    ackDelayMs,
    dropAckPercent,
    seed: seedRaw === undefined ? undefined : Number(seedRaw),
  };
}

const flags = readFlags();

console.log(`[robot-sim] robotId=${flags.robotId} relay=${flags.relayUrl} SIMULATED=true`);
console.log(
  `[robot-sim] DEVICE_SECRET configured: ${flags.deviceSecret.length > 0} (length ${flags.deviceSecret.length})`,
);
if (flags.ackDelayMs > 0) {
  console.log(
    `[robot-sim] simulated control processing delay: ${flags.ackDelayMs}ms (control.ack only — emergency-stop.ack is always immediate)`,
  );
}
if (flags.dropAckPercent > 0) {
  console.log(`[robot-sim] simulated control.ack loss: ${flags.dropAckPercent}%`);
}

const client = new RobotSimClient({
  relayUrl: flags.relayUrl,
  robotId: flags.robotId,
  deviceSecret: flags.deviceSecret,
  telemetryMs: flags.telemetryMs,
  ackDelayMs: flags.ackDelayMs,
  dropAckPercent: flags.dropAckPercent,
  seed: flags.seed,
});

client.connect();

function printHelp(): void {
  console.log('[robot-sim] commands: status | unresponsive | resume | disconnect | reconnect | ?');
}

function printStatus(): void {
  const status = client.status();
  console.log(
    `[robot-sim] status connection=${status.connection} responsive=${status.responsive} ` +
      `session=${status.device.activeSessionId ?? '(none)'} sessionReady=${status.device.sessionReady} ` +
      `lastSeq=${status.device.lastSeq} armed=${status.device.control.armed}`,
  );
}

if (process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    const line = chunk.toString().trim();
    switch (line) {
      case 'status':
        printStatus();
        break;
      case 'unresponsive':
        client.pauseOutput();
        break;
      case 'resume':
        client.resumeOutput();
        break;
      case 'disconnect':
        client.disconnect();
        break;
      case 'reconnect':
        client.connect();
        break;
      case '':
        break;
      case '?':
      default:
        printHelp();
    }
  });
  printHelp();
}

function shutdown(): void {
  console.log('\n[robot-sim] shutting down...');
  client.shutdown();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Headless equivalent of the stdin `unresponsive`/`resume` commands — see
// the module doc comment above for why this exists.
process.on('SIGUSR1', () => client.pauseOutput());
process.on('SIGUSR2', () => client.resumeOutput());
