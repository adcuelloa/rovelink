/**
 * SIMULATED transport: implements the same `RobotTransport` interface the
 * real `WebSocketTransport` does, so `ControlEngine` and `ControlSender` —
 * both real, unmodified production classes — can drive it exactly as they
 * drive the real relay in web/src/control-view.ts. Only what is behind this
 * interface (the network + relay + firmware) is simulated; everything above
 * it in the pipeline is the actual RoveLink code.
 */
import type { ControlFrame, ControlState, Wheels } from '@rovelink/protocol';
import { CONTROL_TTL_MS, createControlFrame } from '@rovelink/protocol';
import { PendingAckTracker } from '@rovelink/web/src/transport/pending-acks.ts';
import { Emitter } from '@rovelink/web/src/transport/types.ts';
import type { RobotTransport } from '@rovelink/web/src/transport/types.ts';

import type { FrameOutcome } from './simulated-relay-firmware.ts';
import { SimulatedFirmware, SimulatedRelay } from './simulated-relay-firmware.ts';

export type PipelineStage =
  | { readonly stage: 'sent'; readonly frame: ControlFrame; readonly at: number }
  | { readonly stage: 'relay-forwarded'; readonly frame: ControlFrame; readonly at: number }
  | {
      readonly stage: 'firmware-rejected';
      readonly frame: ControlFrame;
      readonly reason: string;
      readonly at: number;
    }
  | {
      readonly stage: 'firmware-accepted';
      readonly frame: ControlFrame;
      readonly wheels: Wheels;
      readonly at: number;
    }
  | { readonly stage: 'ack'; readonly seq: number; readonly rttMs: number; readonly at: number }
  | { readonly stage: 'ttl-stop'; readonly at: number }
  | { readonly stage: 'session-changed'; readonly sessionId: string; readonly at: number };

export type PipelineListener = (event: PipelineStage) => void;

export interface SimulatedTransportOptions {
  /** One-way simulated link latency in ms, sampled per packet. Defaults to
   * a light, steady 30ms so the lab feels responsive out of the box. */
  latencyMs: number;
}

const DEFAULT_LATENCY_MS = 30;

/** Cloudflare and the physical ESP32 are both simulated here (see
 * simulated-relay-firmware.ts for exactly which rules are reproduced and
 * why); every field on the frames flowing through it is the real
 * `ControlFrame` shape from @rovelink/protocol. */
export class SimulatedTransport implements RobotTransport {
  readonly name = 'Simulated';
  readonly robotId: string;

  readonly #emitter = new Emitter();
  readonly #pipeline = new Set<PipelineListener>();
  readonly #relay = new SimulatedRelay();
  readonly #firmware = new SimulatedFirmware();
  readonly #pending = new PendingAckTracker<number>({ maxAgeMs: 5000, maxSize: 128 });

  #seq = 0;
  #connected = false;
  #linkCut = false;
  #latencyMs = DEFAULT_LATENCY_MS;
  #ttlTimer: ReturnType<typeof setInterval> | null = null;
  #now: () => number;

  constructor(
    robotId: string,
    options: Partial<SimulatedTransportOptions> = {},
    now: () => number = () => performance.now(),
  ) {
    this.robotId = robotId;
    this.#latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
    this.#now = now;
  }

  subscribePipeline(listener: PipelineListener): () => void {
    this.#pipeline.add(listener);
    return () => this.#pipeline.delete(listener);
  }

  setLatencyMs(ms: number): void {
    this.#latencyMs = Math.max(0, ms);
  }

  get latencyMs(): number {
    return this.#latencyMs;
  }

  get sessionId(): string | null {
    return this.#relay.sessionId;
  }

  /** EXPERIMENT: simulates a dead link — sent frames vanish instead of
   * reaching the (simulated) firmware, same as a real Wi-Fi/Cloudflare
   * outage would look from the browser's side. */
  cutConnection(): void {
    this.#linkCut = true;
    this.#emitter.emit({ kind: 'alert', level: 'error', text: 'link cut (simulated)' });
  }

  restoreConnection(): void {
    this.#linkCut = false;
    this.#emitter.emit({ kind: 'alert', level: 'ok', text: 'link restored (simulated)' });
  }

  /** EXPERIMENT: mints a new session without a full reconnect, mirroring a
   * controller registering fresh (see relay/src/room.ts
   * #handleControllerRegister) while any in-flight frame from the old
   * session is still on the wire. */
  reconnectController(): void {
    const sessionId = this.#relay.mintSession();
    this.#firmware.onSessionChanged(sessionId);
    this.#pending.clear();
    this.#pipeline.forEach((l) => l({ stage: 'session-changed', sessionId, at: this.#now() }));
    this.#emitter.emit({ kind: 'session-established' });
  }

  connect(): Promise<void> {
    this.#emitter.emit({ kind: 'state', state: 'connecting' });
    const sessionId = this.#relay.mintSession();
    this.#firmware.onSessionChanged(sessionId);
    this.#connected = true;
    this.#linkCut = false;
    this.#emitter.emit({ kind: 'state', state: 'connected' });
    this.#emitter.emit({ kind: 'robot', online: true });
    this.#pipeline.forEach((l) => l({ stage: 'session-changed', sessionId, at: this.#now() }));
    this.#emitter.emit({ kind: 'session-established' });
    this.#ttlTimer = setInterval(() => this.#checkTtl(), 50);
    return Promise.resolve();
  }

  disconnect(): void {
    this.#connected = false;
    if (this.#ttlTimer !== null) clearInterval(this.#ttlTimer);
    this.#ttlTimer = null;
    this.#emitter.emit({ kind: 'state', state: 'disconnected' });
    this.#emitter.emit({ kind: 'robot', online: false });
  }

  sendControl(state: ControlState): void {
    if (!this.#connected) return;
    const seq = ++this.#seq;
    const sentAt = this.#now();
    const frame = this.#relay.stamp(createControlFrame(state, seq, sentAt, CONTROL_TTL_MS));
    this.#pending.record(seq, sentAt);
    this.#pipeline.forEach((l) => l({ stage: 'sent', frame, at: sentAt }));
    if (this.#linkCut) return; // vanishes: the real link would drop it identically.
    setTimeout(() => this.#deliver(frame), this.#latencyMs);
  }

  emergencyStop(): void {
    this.#firmware.emergencyStop();
    const at = this.#now();
    this.#pipeline.forEach((l) => l({ stage: 'ttl-stop', at }));
    this.#emitter.emit({ kind: 'estop-rtt', ms: Math.round(this.#latencyMs * 2) });
  }

  subscribe(listener: Parameters<RobotTransport['subscribe']>[0]): () => void {
    return this.#emitter.subscribe(listener);
  }

  #deliver(frame: ControlFrame): void {
    const at = this.#now();
    this.#pipeline.forEach((l) => l({ stage: 'relay-forwarded', frame, at }));
    const outcome: FrameOutcome = this.#firmware.applyFrame(frame, at);
    if (!outcome.accepted) {
      this.#pipeline.forEach((l) =>
        l({ stage: 'firmware-rejected', frame, reason: outcome.reason, at }),
      );
      return;
    }
    this.#pipeline.forEach((l) =>
      l({ stage: 'firmware-accepted', frame, wheels: outcome.wheels, at }),
    );
    this.#emitter.emit({ kind: 'device-activity', at });
    this.#emitter.emit({
      kind: 'telemetry',
      data: {
        v: 1,
        type: 'telemetry',
        sentAt: at,
        throttle: outcome.state.throttle,
        steering: outcome.state.steering,
        armed: outcome.state.armed,
      },
    });
    const elapsed = this.#pending.resolve(frame.seq, at);
    if (elapsed !== null) {
      this.#pipeline.forEach((l) =>
        l({ stage: 'ack', seq: frame.seq, rttMs: Math.round(elapsed), at }),
      );
      this.#emitter.emit({ kind: 'control-rtt', ms: Math.round(elapsed) });
    }
  }

  #checkTtl(): void {
    const at = this.#now();
    if (this.#firmware.checkTtl(at)) {
      this.#pipeline.forEach((l) => l({ stage: 'ttl-stop', at }));
      this.#emitter.emit({
        kind: 'alert',
        level: 'error',
        text: 'TTL expired — vehicle fell back to safe state (simulated)',
      });
    }
  }
}
