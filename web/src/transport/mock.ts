/**
 * Simulated robot in the browser: no ESP32, no Cloudflare.
 *
 * Mimics what the real link will do — latency, telemetry, RTT, TTL — so
 * the full interface can be developed and tested without hardware.
 */

import type { ControlState, ControlFrame, Telemetry } from '@rovelink/protocol';
import {
  SAFE_STATE,
  PROTOCOL_VERSION,
  applyArmed,
  createControlFrame,
  isNewerFrame,
  isFrameExpired,
} from '@rovelink/protocol';

import type { Counters, RobotTransport, TransportListener } from './types.ts';
import { INITIAL_COUNTS, Emitter } from './types.ts';

export interface MockOptions {
  readonly robotId?: string;
  /** One-way latency; simulated RTT is double plus jitter. */
  readonly latencyMs?: number;
  readonly jitterMs?: number;
  readonly telemetryMs?: number;
  /** How long the "robot" takes to appear after `connect()`. */
  readonly startupMs?: number;
}

export class MockTransport implements RobotTransport {
  readonly name = 'Mock';
  readonly robotId: string;

  readonly #emitter = new Emitter();
  readonly #latency: number;
  readonly #jitter: number;
  readonly #telemetryMs: number;
  readonly #startupMs: number;

  #counters: Counters = INITIAL_COUNTS;
  #seq = 0;
  #lastApplied = 0;
  #robotState: ControlState = SAFE_STATE;
  #timers = new Set<ReturnType<typeof setTimeout>>();
  #telemetryInterval: ReturnType<typeof setInterval> | null = null;
  #connected = false;

  constructor(options: MockOptions = {}) {
    this.robotId = options.robotId ?? 'robot-01';
    this.#latency = options.latencyMs ?? 35;
    this.#jitter = options.jitterMs ?? 12;
    this.#telemetryMs = options.telemetryMs ?? 500;
    this.#startupMs = options.startupMs ?? 180;
  }

  subscribe(listener: TransportListener): () => void {
    return this.#emitter.subscribe(listener);
  }

  connect(): Promise<void> {
    if (this.#connected) return Promise.resolve();
    this.#emitter.emit({ kind: 'state', state: 'connecting' });
    return new Promise((resolve) => {
      this.#schedule(() => {
        this.#connected = true;
        this.#emitter.emit({ kind: 'state', state: 'connected' });
        this.#emitter.emit({ kind: 'robot', online: true });
        this.#emitter.emit({ kind: 'alert', level: 'ok', text: 'simulated robot linked' });
        this.#telemetryInterval = setInterval(() => this.#emitTelemetry(), this.#telemetryMs);
        resolve();
      }, this.#startupMs);
    });
  }

  disconnect(): void {
    if (!this.#connected && this.#timers.size === 0) return;
    this.#connected = false;
    for (const t of this.#timers) clearTimeout(t);
    this.#timers.clear();
    if (this.#telemetryInterval !== null) clearInterval(this.#telemetryInterval);
    this.#telemetryInterval = null;
    this.#robotState = SAFE_STATE;
    this.#emitter.emit({ kind: 'robot', online: false });
    this.#emitter.emit({ kind: 'state', state: 'disconnected' });
  }

  sendControl(state: ControlState): void {
    if (!this.#connected) return;
    this.#seq += 1;
    const frame = createControlFrame(state, this.#seq, Date.now());
    this.#count({ sent: this.#counters.sent + 1, seq: this.#seq });
    this.#schedule(() => this.#receiveOnRobot(frame), this.#delay());
  }

  emergencyStop(): void {
    this.#seq += 1;
    this.#count({ sent: this.#counters.sent + 1, seq: this.#seq });
    this.#robotState = SAFE_STATE;
    this.#lastApplied = this.#seq;
    this.#emitter.emit({ kind: 'alert', level: 'error', text: 'emergency stop applied' });
    if (this.#connected) this.#emitTelemetry();
  }

  #delay(): number {
    return this.#latency + Math.random() * this.#jitter;
  }

  #schedule(action: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.#timers.delete(t);
      action();
    }, ms);
    this.#timers.add(t);
  }

  /** What the firmware would do: discard old and expired frames, obey the latest. */
  #receiveOnRobot(frame: ControlFrame): void {
    if (!this.#connected) return;
    if (!isNewerFrame(frame, this.#lastApplied)) return;
    this.#lastApplied = frame.seq;
    if (isFrameExpired(frame, Date.now())) {
      this.#robotState = SAFE_STATE;
      this.#emitter.emit({
        kind: 'alert',
        level: 'error',
        text: `frame ${frame.seq} expired (TTL)`,
      });
      return;
    }
    this.#robotState = applyArmed(frame);
    this.#emitter.emit({ kind: 'relay-rtt', ms: Math.round(this.#delay() * 2) });
  }

  #emitTelemetry(): void {
    const data: Telemetry = {
      v: PROTOCOL_VERSION,
      type: 'telemetry',
      sentAt: Date.now(),
      ackSeq: this.#lastApplied,
      rssi: -55 - Math.round(Math.random() * 12),
      throttle: this.#robotState.throttle,
      steering: this.#robotState.steering,
      armed: this.#robotState.armed,
    };
    this.#count({ received: this.#counters.received + 1 });
    this.#emitter.emit({ kind: 'device-activity', at: performance.now() });
    this.#emitter.emit({ kind: 'telemetry', data });
    this.#emitter.emit({ kind: 'relay-rtt', ms: Math.round(this.#delay() * 2) });
  }

  #count(partial: Partial<Counters>): void {
    this.#counters = { ...this.#counters, ...partial };
    this.#emitter.emit({ kind: 'counters', data: this.#counters });
  }
}
