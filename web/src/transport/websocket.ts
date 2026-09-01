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
import { PendingAckTracker } from './pending-acks.ts';
import type { Counters, RobotTransport, TransportListener } from './types.ts';
import { INITIAL_COUNTS, Emitter } from './types.ts';

/** How long `requestVideoTicket()` waits for `controller.videoTicket`
 * before giving up (Problem 7D §4). Well above a normal round trip, well
 * below anything a human would notice as a hang. */
const VIDEO_TICKET_TIMEOUT_MS = 8000;

/** Control/E-stop RTT tracking (Problem 8A): well above any real round
 * trip, so a lost ack still gets swept out promptly rather than lingering. */
const PENDING_ACK_MAX_AGE_MS = 5000;
const PENDING_CONTROL_ACK_MAX = 64;
const PENDING_ESTOP_ACK_MAX = 8;

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

  /** The relay-minted session this transport is currently authoritative
   * under (see 'controller.session' in #handle) — never client-invented.
   * `undefined` until the first session is established. Used only to key
   * outgoing control frames for #controlAcks; never sent anywhere. */
  #currentSessionId: string | undefined;
  /** Keyed by `${sessionId}|${seq}` so a delayed ack from a superseded
   * session can never be mismatched against a same-numbered frame from the
   * current one. */
  readonly #controlAcks = new PendingAckTracker<string>({
    maxAgeMs: PENDING_ACK_MAX_AGE_MS,
    maxSize: PENDING_CONTROL_ACK_MAX,
  });
  /** Keyed by the emergency-stop's own `sentAt`: e-stop is deliberately
   * session/seq-independent (see EmergencyStop in protocol.ts), so it has
   * nothing else to correlate by. */
  readonly #estopAcks = new PendingAckTracker<number>({
    maxAgeMs: PENDING_ACK_MAX_AGE_MS,
    maxSize: PENDING_ESTOP_ACK_MAX,
  });

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
    // Nothing sent on this connection can ever be acked now — an in-flight
    // RTT measurement must never resolve, or worse be mismatched, against
    // whatever session/seq a future reconnect starts from.
    this.#currentSessionId = undefined;
    this.#controlAcks.clear();
    this.#estopAcks.clear();
    this.#emitter.emit({ kind: 'robot', online: false });
    this.#emitter.emit({ kind: 'state', state: 'disconnected' });
  }

  sendControl(state: ControlState): void {
    this.#seq += 1;
    const seq = this.#seq;
    this.#send(createControlFrame(state, seq, Date.now()));
    if (this.#currentSessionId !== undefined) {
      this.#controlAcks.record(`${this.#currentSessionId}|${seq}`, performance.now());
    }
  }

  emergencyStop(): void {
    const sentAt = Date.now();
    this.#send({ v: PROTOCOL_VERSION, type: 'emergency-stop', sentAt });
    this.#estopAcks.record(sentAt, performance.now());
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
      // Same reasoning as disconnect(): a reconnect starts a fresh session
      // and fresh seq bookkeeping, so nothing still in flight on the old
      // socket may ever resolve against it.
      this.#currentSessionId = undefined;
      this.#controlAcks.clear();
      this.#estopAcks.clear();
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
        // Real device-originated evidence: emitted separately from the
        // telemetry payload itself so freshness tracking never has to be
        // inferred from anything else (a control frame, a relay pong, a
        // local timer, or `room` presence) — see TransportEvent's
        // 'device-activity' doc.
        this.#emitter.emit({ kind: 'device-activity', at: performance.now() });
        this.#emitter.emit({ kind: 'telemetry', data: message });
        return;
      case 'room':
        this.#emitter.emit({ kind: 'robot', online: message.deviceOnline });
        return;
      case 'pong':
        this.#emitter.emit({ kind: 'relay-rtt', ms: Math.max(0, Date.now() - message.sentAt) });
        return;
      case 'controller.session':
        // Relay-authored authoritative confirmation only (see room.ts
        // #handleControllerRegister) — this type is never sent to a
        // controller for any other reason, so no further check is needed
        // here beyond having arrived on this authenticated connection.
        //
        // A session change resets Control RTT tracking (Problem 8A): any
        // ack still pending belonged to a now-superseded session and could
        // otherwise be matched against a same-numbered frame from this new
        // one. Recorded BEFORE emitting 'session-established' — that event
        // synchronously triggers establishSessionBaseline()'s own
        // sendControl() call, which must see the new session id already in
        // place.
        this.#currentSessionId = message.sessionId;
        this.#controlAcks.clear();
        this.#emitter.emit({ kind: 'session-established' });
        return;
      case 'control.ack': {
        const rtt = this.#controlAcks.resolve(
          `${message.controlSessionId}|${message.seq}`,
          performance.now(),
        );
        if (rtt !== null) this.#emitter.emit({ kind: 'control-rtt', ms: Math.round(rtt) });
        return;
      }
      case 'emergency-stop.ack': {
        const rtt = this.#estopAcks.resolve(message.sentAt, performance.now());
        if (rtt !== null) this.#emitter.emit({ kind: 'estop-rtt', ms: Math.round(rtt) });
        return;
      }
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
