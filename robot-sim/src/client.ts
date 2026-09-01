/**
 * Robot simulator WS client (Problem 8B). Connects to the REAL control relay
 * as an ordinary device peer — it never calls relay internals, never decides
 * whether its own credential is valid, and never fabricates a
 * `controller.session` (Refinement 4 / brief §4): all of that authority
 * stays exactly where it is in production, in `relay/src/room.ts`. This
 * module only maintains the local `DeviceState` (device-state.ts) and speaks
 * the wire protocol a real ESP32 would.
 *
 * Reconnect backoff (1s -> 30s, doubling, reset on a fresh socket open)
 * mirrors `firmware/rovelink_device/transport.cpp`'s bounded exponential
 * backoff — not byte-exact, but the same shape.
 *
 * "Unresponsive" mode (Refinement 2): the socket stays PHYSICALLY OPEN.
 * Incoming `control`/`emergency-stop` frames still update the local
 * `DeviceState` (so a resume reports accurate, non-stale state), but no
 * device-originated message is ever sent while unresponsive — no telemetry,
 * no `control.ack`, no `emergency-stop.ack`. That absence of evidence is
 * exactly what the relay's stale sweep and the browser's
 * `UI_UNRESPONSIVE_THRESHOLD_MS` are designed to detect, so this exercises
 * the real Problem 8A presence logic instead of faking a UI state.
 */

import type {
  ControlFrame,
  ControlSession,
  EmergencyStop,
  RemoteMessage,
} from '@rovelink/protocol';
import { CLOSE_CODE, isRemoteMessage, PROTOCOL_VERSION } from '@rovelink/protocol';
import WebSocket from 'ws';
import type { RawData } from 'ws';

import type { DeviceState } from './device-state.ts';
import {
  applyControlFrame,
  applyEmergencyStop,
  applyTtlWatchdog,
  INITIAL_DEVICE_STATE,
  onSessionChanged,
} from './device-state.ts';
import { wheelsFor } from './motor.ts';
import { mulberry32 } from './rng.ts';

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const DEFAULT_TELEMETRY_MS = 300;
const DEFAULT_TTL_MS = 500;

export type ConnectionStatus =
  | 'connecting'
  | 'registering'
  | 'online'
  | 'reconnecting'
  | 'disconnected';

export interface RobotSimOptions {
  readonly relayUrl: string;
  readonly robotId: string;
  readonly deviceSecret: string;
  readonly firmwareLabel?: string;
  readonly telemetryMs?: number;
  readonly ttlMs?: number;
  /** Simulated processing delay before a normal `control.ack` is sent, in
   * ms. Never applied to `emergency-stop.ack` (Refinement 3 / brief §21):
   * E-stop is always acked immediately, so it stays a safety signal rather
   * than something a "slow device" demo can accidentally mask. */
  readonly ackDelayMs?: number;
  /** 0-100: probability that an otherwise-earned `control.ack` is dropped
   * before sending, simulating ack loss on the wire (not a processing
   * failure — the frame is still applied). Deterministic when `seed` is
   * set, `Math.random()` otherwise. */
  readonly dropAckPercent?: number;
  readonly seed?: number;
  readonly log?: (line: string) => void;
}

export interface RobotSimStatus {
  readonly connection: ConnectionStatus;
  readonly responsive: boolean;
  readonly device: DeviceState;
}

/**
 * Minimal dev-only relay client, same spirit as
 * `video-relay/src/dev/control-client.ts`: parses text frames with
 * `isRemoteMessage`, never assumes shape beyond what that validator confirms.
 */
interface ResolvedOptions {
  readonly relayUrl: string;
  readonly robotId: string;
  readonly deviceSecret: string;
  readonly firmwareLabel: string | undefined;
  readonly telemetryMs: number;
  readonly ttlMs: number;
  readonly ackDelayMs: number;
  readonly dropAckPercent: number;
  readonly seed: number | undefined;
}

export class RobotSimClient {
  readonly #opts: ResolvedOptions;
  readonly #log: (line: string) => void;
  readonly #random: () => number;

  #ws: WebSocket | null = null;
  #connection: ConnectionStatus = 'disconnected';
  #responsive = true;
  #device: DeviceState = INITIAL_DEVICE_STATE;
  #lastFrameAt = 0;
  #backoffMs = BACKOFF_MIN_MS;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #telemetryTimer: ReturnType<typeof setInterval> | null = null;
  #ttlTimer: ReturnType<typeof setInterval> | null = null;
  #stopping = false;
  #lastLoggedControl: string | null = null;

  constructor(options: RobotSimOptions) {
    this.#opts = {
      relayUrl: options.relayUrl.replace(/\/+$/, ''),
      robotId: options.robotId,
      deviceSecret: options.deviceSecret,
      firmwareLabel: options.firmwareLabel,
      telemetryMs: options.telemetryMs ?? DEFAULT_TELEMETRY_MS,
      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
      ackDelayMs: options.ackDelayMs ?? 0,
      dropAckPercent: options.dropAckPercent ?? 0,
      seed: options.seed,
    };
    this.#log = options.log ?? ((line) => console.log(line));
    this.#random = options.seed === undefined ? Math.random : mulberry32(options.seed);
  }

  status(): RobotSimStatus {
    return { connection: this.#connection, responsive: this.#responsive, device: this.#device };
  }

  /** Connects (or reconnects immediately, bypassing backoff) — used both for
   * the initial connect and the `reconnect` console command. */
  connect(): void {
    this.#stopping = false;
    this.#openSocket();
  }

  /** Graceful disconnect: closes the socket and does NOT auto-reconnect
   * until `connect()` is called again explicitly. */
  disconnect(): void {
    this.#stopping = true;
    this.#clearTimers();
    if (this.#reconnectTimer !== null) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
    this.#connection = 'disconnected';
    this.#ws?.close(1000, 'operator-disconnect');
  }

  /** Enters "unresponsive": socket stays open, but the device stops sending
   * anything (see module doc comment). */
  pauseOutput(): void {
    if (!this.#responsive) return;
    this.#responsive = false;
    this.#log('[robot-sim] unresponsive: telemetry/acks suppressed, socket stays open');
  }

  /** Leaves "unresponsive": resumes telemetry/acks immediately. */
  resumeOutput(): void {
    if (this.#responsive) return;
    this.#responsive = true;
    this.#log('[robot-sim] resumed: telemetry/acks flowing again');
  }

  shutdown(): void {
    this.disconnect();
  }

  #openSocket(): void {
    this.#connection = 'connecting';
    const url = `${this.#opts.relayUrl}/robot/${this.#opts.robotId}/device`;
    this.#log(`[robot-sim] connecting to ${url}`);
    const ws = new WebSocket(url);
    this.#ws = ws;

    ws.on('open', () => {
      this.#backoffMs = BACKOFF_MIN_MS;
      this.#connection = 'registering';
      this.#log('[robot-sim] socket open, registering (device.register)');
      ws.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'device.register',
          robotId: this.#opts.robotId,
          token: this.#opts.deviceSecret,
          firmware: this.#opts.firmwareLabel ?? 'robot-sim/0.1.0',
        }),
      );
      this.#startLoops();
    });

    ws.on('message', (data) => {
      this.#onMessage(rawDataToText(data));
    });

    ws.on('close', (code, reason) => {
      this.#clearTimers();
      const wasRegistered = this.#connection === 'online' || this.#connection === 'registering';
      this.#connection = 'disconnected';
      this.#log(
        `[robot-sim] closed code=${code} reason=${reason.toString() || '(none)'}` +
          (code === CLOSE_CODE.AUTH_FAILED ? ' — check DEVICE_SECRET' : ''),
      );
      if (!wasRegistered) return;
      this.#scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.#log(`[robot-sim] socket error: ${err.message}`);
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopping) return;
    this.#connection = 'reconnecting';
    const delay = this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, BACKOFF_MAX_MS);
    this.#log(`[robot-sim] reconnecting in ${delay}ms`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#openSocket();
    }, delay);
  }

  #startLoops(): void {
    this.#telemetryTimer = setInterval(() => this.#sendTelemetry(), this.#opts.telemetryMs);
    this.#ttlTimer = setInterval(() => this.#tickTtl(), Math.min(100, this.#opts.ttlMs));
  }

  #clearTimers(): void {
    if (this.#telemetryTimer !== null) {
      clearInterval(this.#telemetryTimer);
      this.#telemetryTimer = null;
    }
    if (this.#ttlTimer !== null) {
      clearInterval(this.#ttlTimer);
      this.#ttlTimer = null;
    }
  }

  #tickTtl(): void {
    if (!this.#device.control.armed) return;
    const next = applyTtlWatchdog(this.#device, Date.now(), this.#lastFrameAt, this.#opts.ttlMs);
    if (next !== this.#device) {
      this.#device = next;
      this.#log('[robot-sim] STOP ttl');
    }
  }

  #onMessage(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRemoteMessage(parsed)) return;
    const message: RemoteMessage = parsed;

    switch (message.type) {
      case 'room':
        // Only a registered socket ever receives a `room` broadcast (see
        // relay/src/room.ts #getRegisteredSockets) — the first one this
        // connection sees is proof `device.register` was accepted. Logged
        // (once) as the demo orchestrator's readiness signal for this
        // process — see demo/src/main.ts.
        if (this.#connection === 'registering') {
          this.#connection = 'online';
          this.#log('[robot-sim] registered and online');
        }
        return;
      case 'controller.session':
        this.#onSessionChanged(message);
        return;
      case 'control':
        this.#onControlFrame(message);
        return;
      case 'emergency-stop':
        this.#onEmergencyStop(message);
        return;
      default:
        // ping/pong, control.ack, etc. — nothing a device needs to act on.
        return;
    }
  }

  #onSessionChanged(message: ControlSession): void {
    if (this.#connection === 'registering') this.#connection = 'online';
    this.#device = onSessionChanged(message.sessionId);
    this.#lastFrameAt = Date.now();
    this.#log(`[robot-sim] session active id=${message.sessionId}`);
  }

  #onControlFrame(frame: ControlFrame): void {
    const before = this.#device;
    const { state, ack } = applyControlFrame(before, {
      seq: frame.seq,
      controlSessionId: frame.controlSessionId,
      throttle: frame.throttle,
      steering: frame.steering,
      gripper: frame.gripper,
      armed: frame.armed,
    });

    if (!this.#responsive) {
      // Unresponsive: internal state still advances (see module doc
      // comment) so a resume reports fresh state, but nothing is sent.
      this.#device = state;
      return;
    }

    if (state.lastSeq !== before.lastSeq) this.#lastFrameAt = Date.now();
    this.#device = state;
    this.#logControlChange(before, state);

    if (ack === null) return;
    if (this.#opts.dropAckPercent > 0 && this.#random() * 100 < this.#opts.dropAckPercent) {
      this.#log(`[robot-sim] control.ack seq=${ack.seq} deliberately dropped`);
      return;
    }
    this.#sendAckAfterDelay(ack.seq, ack.controlSessionId);
  }

  #sendAckAfterDelay(seq: number, controlSessionId: string): void {
    const send = (): void => {
      this.#send({ v: PROTOCOL_VERSION, type: 'control.ack', controlSessionId, seq });
    };
    if (this.#opts.ackDelayMs > 0) {
      setTimeout(send, this.#opts.ackDelayMs);
    } else {
      send();
    }
  }

  #onEmergencyStop(message: EmergencyStop): void {
    const { state, ack } = applyEmergencyStop(this.#device, message.sentAt);
    this.#device = state;
    this.#log('[robot-sim] STOP emergency');
    if (!this.#responsive) return;
    // Always immediate, never delayed by ackDelayMs — see class doc comment
    // and Refinement 3: a "slow device" demo must never look like a slow
    // E-stop.
    this.#send({ v: PROTOCOL_VERSION, type: 'emergency-stop.ack', sentAt: ack.sentAt });
  }

  #sendTelemetry(): void {
    if (!this.#responsive) return;
    if (this.#ws === null || this.#ws.readyState !== WebSocket.OPEN) return;
    this.#send({
      v: PROTOCOL_VERSION,
      type: 'telemetry',
      sentAt: Date.now(),
      ackSeq: this.#device.lastSeq,
      ackSessionId: this.#device.activeSessionId ?? '',
      rssi: this.#syntheticRssi(),
      throttle: this.#device.control.throttle,
      steering: this.#device.control.steering,
      armed: this.#device.control.armed,
    });
  }

  #syntheticRssi(): number {
    // Plausible, clearly-fixed-range value — never a physical measurement
    // (brief §4).
    return Math.round(-55 + (this.#random() * 16 - 8));
  }

  #logControlChange(before: DeviceState, after: DeviceState): void {
    if (before.control === after.control) return;
    const wheels = wheelsFor(after.control);
    const line =
      `[robot-sim] armed=${after.control.armed} throttle=${after.control.throttle.toFixed(2)} ` +
      `steering=${after.control.steering.toFixed(2)} left=${wheels.left.toFixed(2)} ` +
      `right=${wheels.right.toFixed(2)} gripper=${after.control.gripper}`;
    if (line === this.#lastLoggedControl) return;
    this.#lastLoggedControl = line;
    this.#log(line);
  }

  #send(message: RemoteMessage): void {
    if (this.#ws === null || this.#ws.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(message));
  }
}

/**
 * `ws`'s `RawData` is `Buffer | ArrayBuffer | Buffer[]` — never `string`
 * here since this client never enables the (default-off) `fragments`
 * option differently. Mirrors `video-relay/src/dev/ws-raw-data.ts`'s
 * narrowing, kept local rather than imported across a package boundary for
 * a two-branch helper.
 */
function rawDataToText(data: RawData): string {
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}
