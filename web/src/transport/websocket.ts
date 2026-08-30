/**
 * WSS transport to the Cloudflare relay.
 *
 * The code is complete on the browser side but has not yet been tested
 * against a deployed Worker. The address is never hard-coded: it comes
 * from `VITE_RELAY_URL`.
 */

import type { ControlState, RemoteMessage } from '@rovelink/protocol';
import { CLOSE_CODE, JSON_CODEC, PROTOCOL_VERSION, createControlFrame } from '@rovelink/protocol';

import type { Counters, RobotTransport, TransportListener } from './types.ts';
import { INITIAL_COUNTS, Emitter } from './types.ts';

export interface WebSocketOptions {
  /** Relay base URL, e.g. `wss://relay.example.workers.dev`. */
  readonly url: string;
  readonly robotId?: string;
  readonly pingMs?: number;
  readonly reconnectMs?: number;
  /** Operator credential entered at runtime (see web/src/auth/controller-key.ts).
   * Never sourced from `VITE_*`: this is a live value, not a build-time one. */
  readonly token?: string;
}

/** `undefined` when no relay is configured: the UI shows that instead of failing. */
export const getConfiguredRelayUrl = (): string | undefined => {
  const url = import.meta.env.VITE_RELAY_URL;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
};

export const getConfiguredRobotId = (): string => import.meta.env.VITE_ROBOT_ID ?? 'robot-01';

export class WebSocketTransport implements RobotTransport {
  readonly name = 'WebSocket';
  readonly robotId: string;

  readonly #emitter = new Emitter();
  readonly #url: string;
  readonly #pingMs: number;
  readonly #reconnectMs: number;
  /** Not readonly: cleared on an auth-failed close so a stale/invalid
   * credential can never be retried (see the 'close' handler in #open). */
  #token?: string;

  #ws: WebSocket | null = null;
  #counters: Counters = INITIAL_COUNTS;
  #seq = 0;
  #ping = 0;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;
  #wantConnection = false;

  constructor(options: WebSocketOptions) {
    this.#url = options.url.replace(/\/+$/, '');
    this.robotId = options.robotId ?? 'robot-01';
    this.#pingMs = options.pingMs ?? 2000;
    this.#reconnectMs = options.reconnectMs ?? 1500;
    this.#token = options.token;
  }

  subscribe(listener: TransportListener): () => void {
    return this.#emitter.subscribe(listener);
  }

  connect(): Promise<void> {
    // Defense in depth: the login gate (control-view.ts) is what's supposed
    // to keep this from ever being called without a credential, but a
    // WebSocketTransport must never open the controller socket without one
    // regardless of what called it.
    if (!this.#token) {
      this.#emitter.emit({
        kind: 'auth-error',
        text: 'no controller credential configured',
      });
      return Promise.resolve();
    }
    this.#wantConnection = true;
    return new Promise((resolve) => {
      this.#open(resolve);
    });
  }

  disconnect(): void {
    this.#wantConnection = false;
    this.#stopHeartbeat();
    if (this.#retry !== null) clearTimeout(this.#retry);
    this.#retry = null;
    this.#ws?.close();
    this.#ws = null;
    this.#emitter.emit({ kind: 'robot', online: false });
    this.#emitter.emit({ kind: 'state', state: 'disconnected' });
  }

  sendControl(state: ControlState): void {
    this.#seq += 1;
    this.#send(createControlFrame(state, this.#seq, Date.now()));
  }

  emergencyStop(): void {
    this.#send({ v: PROTOCOL_VERSION, type: 'emergency-stop', sentAt: Date.now() });
  }

  #open(ready: () => void): void {
    this.#emitter.emit({ kind: 'state', state: 'connecting' });
    const ws = new WebSocket(`${this.#url}/robot/${this.robotId}/controller`);
    this.#ws = ws;

    ws.addEventListener('open', () => {
      this.#emitter.emit({ kind: 'state', state: 'connected' });
      this.#send({
        v: PROTOCOL_VERSION,
        type: 'controller.register',
        robotId: this.robotId,
        token: this.#token,
      });
      this.#heartbeat = setInterval(() => this.#sendPing(), this.#pingMs);
      ready();
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      const payload: unknown = event.data;
      if (typeof payload !== 'string' && !(payload instanceof ArrayBuffer)) return;
      const message = JSON_CODEC.decode(payload);
      if (message === null) return;
      this.#count({ received: this.#counters.received + 1 });
      this.#handle(message);
    });

    ws.addEventListener('close', (event: CloseEvent) => {
      this.#stopHeartbeat();
      if (this.#ws !== ws) return;
      this.#ws = null;
      this.#emitter.emit({ kind: 'robot', online: false });
      this.#emitter.emit({ kind: 'state', state: 'disconnected' });

      if (event.code === CLOSE_CODE.AUTH_FAILED) {
        // The relay has told us this credential is wrong. Retrying would
        // just hammer it with the same bad key forever, so stop entirely
        // and let the UI send the operator back to the login prompt with a
        // fresh one.
        this.#wantConnection = false;
        this.#token = undefined;
        this.#emitter.emit({ kind: 'auth-error', text: 'invalid controller credential' });
        return;
      }

      if (this.#wantConnection) {
        this.#retry = setTimeout(() => this.#open(ready), this.#reconnectMs);
      }
    });

    ws.addEventListener('error', () => ws.close());
  }

  #handle(message: RemoteMessage): void {
    switch (message.type) {
      case 'telemetry':
        this.#emitter.emit({ kind: 'telemetry', data: message });
        return;
      case 'room':
        this.#emitter.emit({ kind: 'robot', online: message.deviceOnline });
        return;
      case 'pong':
        this.#emitter.emit({ kind: 'rtt', ms: Math.max(0, Date.now() - message.sentAt) });
        return;
      case 'controller.session':
        // Relay-authored authoritative confirmation only (see room.ts
        // #handleControllerRegister) — this type is never sent to a
        // controller for any other reason, so no further check is needed
        // here beyond having arrived on this authenticated connection.
        this.#emitter.emit({ kind: 'session-established' });
        return;
      default:
        return;
    }
  }

  #sendPing(): void {
    this.#ping += 1;
    this.#send({ v: PROTOCOL_VERSION, type: 'ping', id: this.#ping, sentAt: Date.now() });
  }

  #send(message: RemoteMessage): void {
    const ws = this.#ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON_CODEC.encode(message));
    this.#count({
      sent: this.#counters.sent + 1,
      seq: message.type === 'control' ? message.seq : this.#counters.seq,
    });
  }

  #stopHeartbeat(): void {
    if (this.#heartbeat !== null) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #count(partial: Partial<Counters>): void {
    this.#counters = { ...this.#counters, ...partial };
    this.#emitter.emit({ kind: 'counters', data: this.#counters });
  }
}
