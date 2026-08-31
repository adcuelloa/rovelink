/**
 * WSS transport to the Cloudflare relay.
 *
 * The code is complete on the browser side but has not yet been tested
 * against a deployed Worker. The address is never hard-coded: it comes
 * from `VITE_RELAY_URL`.
 */

import type { ControlState, RemoteMessage } from '@rovelink/protocol';
import { CLOSE_CODE, JSON_CODEC, PROTOCOL_VERSION, createControlFrame } from '@rovelink/protocol';

import type { VideoTicketOutcome, VideoTicketSource } from '../video/ticket-source.ts';
import type { Counters, RobotTransport, TransportListener } from './types.ts';
import { INITIAL_COUNTS, Emitter } from './types.ts';

/** How long `requestVideoTicket()` waits for `controller.videoTicket`
 * before giving up (Problem 7D §4). Well above a normal round trip, well
 * below anything a human would notice as a hang. */
const VIDEO_TICKET_TIMEOUT_MS = 8000;

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

/** `undefined` when no video relay is configured: the video panel shows
 * that instead of failing (Problem 7D §15). Deliberately a SEPARATE
 * config value from `getConfiguredRelayUrl` — control and video are
 * always different Worker deployments, never the same URL. */
export const getConfiguredVideoRelayUrl = (): string | undefined => {
  const url = import.meta.env.VITE_VIDEO_RELAY_URL;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
};

/** Awaiting `controller.videoTicket` for a request already sent. Only one
 * of these exists at a time (Problem 7D §4): a second `requestVideoTicket()`
 * call resolves this one as `superseded` before starting its own. */
interface PendingTicketRequest {
  readonly resolve: (outcome: VideoTicketOutcome) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  /** The `#ws` this request was sent on — if that socket is replaced or
   * torn down before a response arrives, this request is resolved
   * `disconnected` rather than left to time out or match a reply from a
   * DIFFERENT connection/session (Problem 7D §4's "stale response from an
   * old control connection/session"). */
  readonly socket: WebSocket;
}

export class WebSocketTransport implements RobotTransport, VideoTicketSource {
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
  #pendingTicketRequest: PendingTicketRequest | null = null;

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
    if (this.#ws !== null) this.#failPendingTicketRequestFor(this.#ws);
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

  /**
   * The only bridge VideoTransport has into control (Problem 7D §1/§4):
   * asks THIS already-authenticated connection for a short-lived video
   * viewer ticket. Never sends `CONTROLLER_SECRET` anywhere near
   * VideoTransport — only the resulting ticket crosses that boundary.
   *
   * At most one outstanding request at a time: the wire protocol has no
   * correlation id (see protocol.ts's `VideoTicketRequest`), so a second
   * call while one is pending resolves the first as `superseded` rather
   * than inventing unreliable matching logic.
   */
  requestVideoTicket(): Promise<VideoTicketOutcome> {
    const ws = this.#ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, reason: 'disconnected' });
    }
    this.#supersedePendingTicketRequest();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.#pendingTicketRequest?.resolve === resolve) this.#pendingTicketRequest = null;
        resolve({ ok: false, reason: 'timeout' });
      }, VIDEO_TICKET_TIMEOUT_MS);
      this.#pendingTicketRequest = { resolve, timeout, socket: ws };
      this.#send({ v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    });
  }

  #supersedePendingTicketRequest(): void {
    const pending = this.#pendingTicketRequest;
    if (pending === null) return;
    clearTimeout(pending.timeout);
    this.#pendingTicketRequest = null;
    pending.resolve({ ok: false, reason: 'superseded' });
  }

  #failPendingTicketRequestFor(ws: WebSocket): void {
    const pending = this.#pendingTicketRequest;
    if (pending === null || pending.socket !== ws) return;
    clearTimeout(pending.timeout);
    this.#pendingTicketRequest = null;
    pending.resolve({ ok: false, reason: 'disconnected' });
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
      // A ticket request outstanding on THIS socket can never be answered
      // now — resolved 'disconnected' rather than left to its own timeout,
      // and never confused with a request sent on a socket that replaced
      // it (Problem 7D §4's "stale response from an old control
      // connection/session").
      this.#failPendingTicketRequestFor(ws);
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
      case 'controller.videoTicket':
        if (this.#pendingTicketRequest !== null) {
          clearTimeout(this.#pendingTicketRequest.timeout);
          const { resolve } = this.#pendingTicketRequest;
          this.#pendingTicketRequest = null;
          resolve({ ok: true, ticket: message.ticket, expiresAt: message.expiresAt });
        }
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
