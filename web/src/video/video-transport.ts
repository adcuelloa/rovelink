/**
 * Browser video viewer transport (Problem 7D).
 *
 * authenticated control -> requestVideoTicket() -> open video WSS ->
 * viewer.register(ticket) -> stream state / cached frame -> [frame header,
 * binary JPEG] pairs -> decode/render -> viewer.ack -> repeat.
 *
 * Deliberately separate from ControlEngine/ControlSender/InputOwnership/
 * gamepad/profile modules (Problem 7D §1): this file never imports any of
 * them, and never carries a control command. Its only dependency on the
 * control side is the narrow `VideoTicketSource` interface (ticket-source.ts).
 *
 * ACK TIMING (§12): a complete frame (header + matching binary) is always
 * decoded via the injected `renderer.render()`, and `viewer.ack` is sent
 * the instant that promise resolves — true OR false. A decode failure is
 * counted and dropped, never left unacked: leaving it unacked would starve
 * the relay's one-frame-in-flight credit for this viewer until
 * ACK_TIMEOUT_MS silently kills the connection, which is worse than
 * skipping one bad frame. This also means the relay's existing Problem
 * 7B.1 credit protocol — built to protect against network/slow-viewer
 * backlog — now equally protects against a slow browser decode/render
 * pipeline, for free: the relay will not send frame N+1 until N's ack
 * arrives, whether N was slow because of the network or because the main
 * thread was busy painting a canvas.
 *
 * NO FRAME QUEUE (§13): frame-pairing.ts already bounds pending state to
 * one header. This class adds one more bound on top: `#decoding`, a single
 * flag guarding the (should-never-happen, given the relay's own credit
 * protocol) case of a second complete frame arriving before the first
 * one's render() has resolved — such a frame is dropped, never queued
 * alongside the one already being decoded.
 */

import type { VideoFrameHeader, VideoMessage } from '@rovelink/protocol';
import {
  isJpeg,
  isVideoMessage,
  VIDEO_CLOSE_CODE,
  VIDEO_PROTOCOL_VERSION,
} from '@rovelink/protocol';

import { INITIAL_FRAME_PAIRING_STATE, reduceFramePairing } from './frame-pairing.ts';
import type { FramePairingState } from './frame-pairing.ts';
import { VideoStats } from './stats.ts';
import type { VideoTicketSource } from './ticket-source.ts';
import { nextVideoViewerState } from './viewer-state.ts';
import type { VideoViewerState } from './viewer-state.ts';

/** The subset of the browser `WebSocket` API this module needs — narrow
 * and injectable so tests run without a real socket (same convention as
 * transport/sender.ts's injected `now`, transport/mock.ts's MockTransport).
 * Deliberately structurally compatible with the real DOM `WebSocket`, so
 * the default `createSocket` can hand one over directly with no adapter
 * or cast: `event` is typed `unknown` here (rather than per-event
 * overloads, which fought TypeScript's structural checking on both the
 * real `WebSocket` and the test fake without a net readability win) and
 * narrowed at the two call sites with small local type guards instead. */
export interface VideoSocketLike {
  binaryType: string;
  readyState: number;
  /** A viewer only ever sends JSON text (`viewer.register`/`viewer.ack`) —
   * never binary; only the publisher side sends raw JPEG bytes. */
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: unknown) => void,
  ): void;
}

function isMessageEventLike(event: unknown): event is { readonly data: unknown } {
  return typeof event === 'object' && event !== null && 'data' in event;
}

function isCloseEventLike(
  event: unknown,
): event is { readonly code: number; readonly reason: string } {
  return typeof event === 'object' && event !== null && 'code' in event;
}

export interface VideoFrameRenderer {
  /** Decodes and paints `jpeg`. Resolves `true` on success, `false` on a
   * decode failure — NEVER rejects (a throwing renderer is a bug in the
   * renderer, not something this transport can recover a credit-release
   * decision from; wrap your own decode try/catch and resolve false). */
  render(jpeg: Uint8Array, meta: { width: number; height: number }): Promise<boolean>;
}

export interface VideoTransportOptions {
  readonly url: string;
  readonly robotId: string;
  readonly ticketSource: VideoTicketSource;
  readonly renderer: VideoFrameRenderer;
  readonly createSocket?: (url: string) => VideoSocketLike;
  readonly now?: () => number;
  readonly reconnectMinMs?: number;
  readonly reconnectMaxMs?: number;
}

export type { VideoViewerState } from './viewer-state.ts';
export type { VideoStatsSnapshot } from './stats.ts';

type Listener = () => void;

const DEFAULT_RECONNECT_MIN_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 15_000;

export class VideoTransport {
  readonly #url: string;
  readonly #robotId: string;
  readonly #ticketSource: VideoTicketSource;
  readonly #renderer: VideoFrameRenderer;
  readonly #createSocket: (url: string) => VideoSocketLike;
  readonly #now: () => number;
  readonly #reconnectMinMs: number;
  readonly #reconnectMaxMs: number;

  readonly #listeners = new Set<Listener>();
  readonly #statsTracker: VideoStats;

  #state: VideoViewerState = 'disconnected';
  #wantConnection = false;
  #socket: VideoSocketLike | null = null;
  #framePairing: FramePairingState = INITIAL_FRAME_PAIRING_STATE;
  #decoding = false;
  #backoffMs: number;
  #authFailureStreak = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #ticketRequestToken = 0;

  constructor(options: VideoTransportOptions) {
    this.#url = options.url.replace(/\/+$/, '');
    this.#robotId = options.robotId;
    this.#ticketSource = options.ticketSource;
    this.#renderer = options.renderer;
    this.#createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.#now = options.now ?? (() => Date.now());
    this.#reconnectMinMs = options.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
    this.#reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.#backoffMs = this.#reconnectMinMs;
    this.#statsTracker = new VideoStats();
  }

  get state(): VideoViewerState {
    return this.#state;
  }

  get stats() {
    return this.#statsTracker.snapshot(this.#now());
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Idempotent: a call while already connecting/connected is a no-op
   * (Problem 7D §4's "duplicate connect calls"). */
  connect(): void {
    if (this.#wantConnection) return;
    this.#wantConnection = true;
    this.#authFailureStreak = 0;
    this.#backoffMs = this.#reconnectMinMs;
    this.#beginTicketRequest();
  }

  /** Hard stop: closes any open socket, cancels any pending reconnect
   * timer or in-flight ticket request, and — critically — never
   * auto-reconnects afterward. Used both for an explicit operator "Video
   * Off" and for control-loss (Problem 7D §8): the only way out of
   * `disconnected` is a fresh `connect()` call. */
  disconnect(): void {
    this.#wantConnection = false;
    this.#ticketRequestToken += 1; // invalidates any in-flight ticket request
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.close();
    this.#socket = null;
    this.#framePairing = INITIAL_FRAME_PAIRING_STATE;
    this.#decoding = false;
    this.#transition({ type: 'disconnect' });
  }

  /** DOM-free pause/resume pair for the UI layer to wire to
   * `document.visibilitychange` (Problem 7D §18) — this class never
   * listens to `document` itself, so it stays testable without jsdom.
   * `pause()` behaves like `disconnect()` but remembers that video was
   * wanted, so `resume()` can bring it back with a fresh ticket. */
  pause(): void {
    if (!this.#wantConnection) return;
    this.#ticketRequestToken += 1;
    if (this.#reconnectTimer !== null) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#socket?.close();
    this.#socket = null;
    this.#framePairing = INITIAL_FRAME_PAIRING_STATE;
    this.#decoding = false;
    this.#transition({ type: 'disconnect' });
    // #wantConnection deliberately stays true: resume() checks it.
  }

  resume(): void {
    if (!this.#wantConnection) return; // was never connected / was explicitly disconnected
    if (this.#state !== 'disconnected') return;
    this.#backoffMs = this.#reconnectMinMs;
    this.#beginTicketRequest();
  }

  #beginTicketRequest(): void {
    this.#transition({ type: 'connect' });
    const token = ++this.#ticketRequestToken;
    void this.#ticketSource.requestVideoTicket().then((outcome) => {
      if (token !== this.#ticketRequestToken) return; // superseded/cancelled
      if (!outcome.ok) {
        this.#transition({ type: 'ticket-failed' });
        return;
      }
      this.#transition({ type: 'ticket-ok' });
      this.#openSocket(outcome.ticket);
      return;
    });
  }

  #openSocket(ticket: string): void {
    const socket = this.#createSocket(`${this.#url}/video/${this.#robotId}/viewer`);
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.addEventListener('open', () => {
      if (this.#socket !== socket) return;
      this.#transition({ type: 'socket-open' });
      socket.send(
        JSON.stringify({
          v: VIDEO_PROTOCOL_VERSION,
          type: 'viewer.register',
          robotId: this.#robotId,
          ticket,
        }),
      );
    });

    socket.addEventListener('message', (event) => {
      if (this.#socket !== socket) return;
      if (!isMessageEventLike(event)) return;
      this.#handleMessage(socket, event.data);
    });

    socket.addEventListener('close', (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#framePairing = INITIAL_FRAME_PAIRING_STATE;
      this.#decoding = false;
      this.#handleClose(isCloseEventLike(event) ? event.code : 1006);
    });

    socket.addEventListener('error', () => {
      socket.close();
    });
  }

  #handleMessage(socket: VideoSocketLike, data: unknown): void {
    if (typeof data === 'string') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!isVideoMessage(parsed)) return;
      this.#handleVideoMessage(parsed);
      return;
    }
    if (data instanceof ArrayBuffer) this.#handleBinary(socket, data);
  }

  #handleVideoMessage(message: VideoMessage): void {
    if (message.type === 'stream') {
      this.#transition({ type: 'stream-state', publisherOnline: message.publisherOnline });
      return;
    }
    if (message.type === 'frame') {
      const result = reduceFramePairing(this.#framePairing, { type: 'header', header: message });
      this.#framePairing = result.state;
      // 'header-replaced' means a prior header's binary never arrived —
      // nothing to ack (we hold no valid completed frame for it).
    }
  }

  #handleBinary(socket: VideoSocketLike, data: ArrayBuffer): void {
    const result = reduceFramePairing(this.#framePairing, {
      type: 'binary',
      byteLength: data.byteLength,
    });
    this.#framePairing = result.state;

    if (result.outcome.type === 'ignored-binary-without-header') return;

    if (result.outcome.type === 'size-mismatch') {
      // Arrived, but corrupt/truncated relative to what the header
      // declared: never rendered, but still acked — releasing this
      // viewer's credit is what keeps one bad frame from stalling the
      // whole stream (Problem 7D §10).
      this.#statsTracker.recordDecodeFailure();
      this.#ack(socket, result.outcome.header);
      return;
    }

    if (result.outcome.type !== 'frame-ready') return;
    const header = result.outcome.header;

    this.#statsTracker.recordReceived({
      streamSessionId: header.streamSessionId,
      seq: header.seq,
      capturedAtMs: header.capturedAtMs,
      byteLength: data.byteLength,
      arrivedAtMs: this.#now(),
    });
    this.#transition({ type: 'frame' });

    if (this.#decoding) {
      // No frame queue (§13): a second complete frame while still decoding
      // the first is dropped, not queued — should not happen given the
      // relay's own one-frame-in-flight credit, but handled safely if it
      // somehow does. Not acked: this viewer never consumed it, and the
      // relay will simply not have sent a THIRD frame either (it is still
      // waiting on the ack for the first), so no credit is lost.
      this.#statsTracker.recordDecodeFailure();
      return;
    }

    const bytes = new Uint8Array(data);
    if (!isJpeg(bytes)) {
      this.#statsTracker.recordDecodeFailure();
      this.#ack(socket, header);
      return;
    }

    this.#decoding = true;
    void this.#renderer
      .render(bytes, { width: header.width, height: header.height })
      .catch(() => false)
      .then((ok) => {
        this.#decoding = false;
        if (ok) {
          this.#statsTracker.recordRendered(this.#now());
        } else {
          this.#statsTracker.recordDecodeFailure();
        }
        // Ack regardless of decode outcome (§12): this is the one and only
        // ack for this frame, sent exactly once, whether it rendered or not.
        this.#ack(socket, header);
        return;
      });
  }

  #ack(socket: VideoSocketLike, header: VideoFrameHeader): void {
    if (this.#socket !== socket) return; // a reconnect already happened
    try {
      socket.send(
        JSON.stringify({
          v: VIDEO_PROTOCOL_VERSION,
          type: 'viewer.ack',
          streamSessionId: header.streamSessionId,
          seq: header.seq,
        }),
      );
    } catch {
      // Socket already closing: nothing to save or retry.
    }
  }

  #handleClose(code: number): void {
    if (!this.#wantConnection) {
      // disconnect()/pause() already drove the state machine; nothing
      // further to do (and no reconnect).
      return;
    }

    const isLiveOrWaiting = this.#state === 'live' || this.#state === 'waiting-for-publisher';
    if (isLiveOrWaiting) {
      // A connection that reached at least "waiting for publisher" proved
      // auth genuinely worked — a later close is treated as an ordinary
      // link hiccup, not an auth problem, however it is later classified
      // below.
      this.#authFailureStreak = 0;
    }

    if (code === VIDEO_CLOSE_CODE.AUTH_FAILED) {
      this.#authFailureStreak += 1;
      if (this.#authFailureStreak >= 2) {
        // One retry with a fresh ticket already failed too: stop, rather
        // than loop forever hammering the relay with bad auth attempts
        // (Problem 7D §7). Goes straight to 'error', not through a
        // willRetry:false 'close' event first — that event's own
        // transition lands on 'disconnected', which would then swallow
        // the follow-up 'error' event (disconnected only leaves on an
        // explicit 'connect').
        this.#wantConnection = false;
        this.#transition({ type: 'error' });
        return;
      }
      this.#scheduleReconnect(true);
      return;
    }

    // TICKET_EXPIRED, REGISTRATION_TIMEOUT, ACK_TIMEOUT, an ordinary
    // network close, or anything else: all retryable with a fresh ticket.
    // PUBLISHER_REPLACED is a publisher-only code and should not normally
    // reach a viewer at all.
    this.#scheduleReconnect(false);
  }

  #scheduleReconnect(resetBackoffFast: boolean): void {
    this.#transition({ type: 'close', willRetry: true });
    const delay = resetBackoffFast ? this.#reconnectMinMs : this.#backoffMs;
    this.#backoffMs = Math.min(this.#backoffMs * 2, this.#reconnectMaxMs);
    this.#statsTracker.recordReconnect();
    this.#statsTracker.reset();
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      if (!this.#wantConnection) return;
      this.#beginTicketRequest();
    }, delay);
  }

  #transition(event: Parameters<typeof nextVideoViewerState>[1]): void {
    const next = nextVideoViewerState(this.#state, event);
    if (next === this.#state) return;
    this.#state = next;
    if (next === 'live') this.#backoffMs = this.#reconnectMinMs;
    for (const listener of this.#listeners) listener();
  }
}
