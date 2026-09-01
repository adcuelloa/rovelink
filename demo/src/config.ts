/**
 * Demo defaults and CLI/env overrides (Problem 8B §13/§21). Stable
 * documented default ports rather than dynamic discovery — brief §13
 * explicitly prefers this so the frontend wiring stays simple.
 */

export interface DemoConfig {
  readonly controlPort: number;
  readonly videoPort: number;
  readonly webPort: number;
  readonly robotId: string;
  /** Simulated device processing delay before `control.ack` (brief §21).
   * Never applied to `emergency-stop.ack` — see `robot-sim/src/client.ts`. */
  readonly robotLatencyMs: number;
  readonly telemetryMs: number;
}

const DEFAULTS: DemoConfig = {
  controlPort: 8787,
  videoPort: 8788,
  webPort: 5173,
  robotId: 'robot-01',
  robotLatencyMs: 0,
  telemetryMs: 300,
};

function readArg(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}`;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === prefix) return argv[i + 1];
    if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
  }
  return undefined;
}

export function loadConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): DemoConfig {
  const num = (argName: string, envName: string, fallback: number): number => {
    const raw = readArg(argv, argName) ?? env[envName];
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    controlPort: num('control-port', 'CONTROL_PORT', DEFAULTS.controlPort),
    videoPort: num('video-port', 'VIDEO_PORT', DEFAULTS.videoPort),
    webPort: num('web-port', 'WEB_PORT', DEFAULTS.webPort),
    robotId: readArg(argv, 'robot-id') ?? env.ROBOT_ID ?? DEFAULTS.robotId,
    robotLatencyMs: num('robot-latency', 'ROBOT_LATENCY_MS', DEFAULTS.robotLatencyMs),
    telemetryMs: num('telemetry-ms', 'TELEMETRY_MS', DEFAULTS.telemetryMs),
  };
}
