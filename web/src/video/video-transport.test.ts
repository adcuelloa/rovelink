import assert from 'node:assert/strict';
import test from 'node:test';

import { VIDEO_PROTOCOL_VERSION } from '@rovelink/protocol';

import type { VideoTicketOutcome, VideoTicketSource } from './ticket-source.ts';
import {
  VideoTransport,
  type VideoFrameRenderer,
  type VideoSocketLike,
} from './video-transport.ts';
import type { VideoViewerState } from './viewer-state.ts';

/** Minimal fake WebSocket-like object, matching this codebase's existing
 * dependency-injection convention (see transport/sender.test.ts's
 * fakeTransport, sender.ts's injected `now`). Lets VideoTransport's
 * orchestration logic (ticket serialization, reconnect/backoff, ack
 * timing, close-code handling) be tested without a real socket or server. */
class FakeSocket implements VideoSocketLike {
  binaryType = 'blob';
  readyState = 0;
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener);
    this.#listeners.set(type, set);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }

  #emit(type: string, detail: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(detail);
  }

  simulateOpen(): void {
    this.readyState = 1;
    this.#emit('open', {});
  }

  simulateText(json: unknown): void {
    this.#emit('message', { data: JSON.stringify(json) });
  }

  simulateBinary(bytes: Uint8Array): void {
    this.#emit('message', { data: bytes.buffer });
  }

  simulateClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.#emit('close', { code, reason });
  }
}

/** Parses JSON into a plain object view for test assertions, without an
 * unchecked cast from `any` — spreads into a fresh object literal, the
 * same technique used in protocol/src/video-ticket.test.ts, which gives an
 * index-signature-compatible type with no assertion needed. */
function parseJsonObject(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
}

function jpeg(length = 20_000): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[length - 2] = 0xff;
  bytes[length - 1] = 0xd9;
  return bytes;
}

function frameHeader(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: VIDEO_PROTOCOL_VERSION,
    type: 'frame',
    streamSessionId: 'session-a',
    seq: 1,
    capturedAtMs: 0,
    width: 640,
    height: 480,
    byteLength: 20_000,
    ...overrides,
  };
}

/** Ticket source that hands out sequential fake tickets, recording every
 * call so tests can assert "a fresh ticket was requested". `calls` is a
 * live counter object (not a snapshot) so tests can read it after further
 * activity. */
function fakeTicketSource(behavior: () => VideoTicketOutcome = defaultOk): {
  source: VideoTicketSource;
  counter: { calls: number };
} {
  const counter = { calls: 0 };
  const source: VideoTicketSource = {
    requestVideoTicket: () => {
      counter.calls += 1;
      return Promise.resolve(behavior());
    },
  };
  return { source, counter };
}

let ticketCounter = 0;
function defaultOk(): VideoTicketOutcome {
  ticketCounter += 1;
  return { ok: true, ticket: `ticket-${ticketCounter}`, expiresAt: Date.now() + 45_000 };
}

function fakeRenderer(result: () => Promise<boolean> = () => Promise.resolve(true)): {
  renderer: VideoFrameRenderer;
  calls: { jpeg: Uint8Array; width: number; height: number }[];
} {
  const calls: { jpeg: Uint8Array; width: number; height: number }[] = [];
  return {
    calls,
    renderer: {
      render: (bytes, meta) => {
        calls.push({ jpeg: bytes, width: meta.width, height: meta.height });
        return result();
      },
    },
  };
}

function states(transport: VideoTransport): VideoViewerState[] {
  const seen: VideoViewerState[] = [];
  transport.subscribe(() => seen.push(transport.state));
  return seen;
}

function makeTransport(opts: {
  ticketSource?: VideoTicketSource;
  renderer?: VideoFrameRenderer;
  now?: () => number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}): { transport: VideoTransport; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const transport = new VideoTransport({
    url: 'wss://video.test',
    robotId: 'robot-01',
    ticketSource: opts.ticketSource ?? fakeTicketSource().source,
    renderer: opts.renderer ?? fakeRenderer().renderer,
    now: opts.now,
    reconnectMinMs: opts.reconnectMinMs,
    reconnectMaxMs: opts.reconnectMaxMs,
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { transport, sockets };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('connect requests a ticket before ever opening a socket', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source });
  transport.connect();
  assert.equal(transport.state, 'requesting-ticket');
  assert.equal(sockets.length, 0);
  await flush();
  assert.equal(counter.calls, 1);
  assert.equal(sockets.length, 1);
});

test('a failed ticket request never opens a socket', async () => {
  const { transport, sockets } = makeTransport({
    ticketSource: {
      requestVideoTicket: () => Promise.resolve({ ok: false, reason: 'disconnected' }),
    },
  });
  transport.connect();
  await flush();
  assert.equal(sockets.length, 0);
  assert.equal(transport.state, 'error');
});

test('duplicate connect() calls do not request a second ticket or open a second socket', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source });
  transport.connect();
  transport.connect();
  transport.connect();
  await flush();
  assert.equal(counter.calls, 1);
  assert.equal(sockets.length, 1);
});

test('viewer.register is sent with the ticket immediately on socket open', async () => {
  const { transport, sockets } = makeTransport({});
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  const sent = sockets[0]?.sent[0];
  if (typeof sent !== 'string') throw new Error('expected the first sent message to be text');
  const parsed = parseJsonObject(sent);
  assert.equal(parsed.type, 'viewer.register');
  assert.equal(parsed.robotId, 'robot-01');
  assert.equal(typeof parsed.ticket, 'string');
});

test('viewer-before-publisher: registering -> waiting-for-publisher on stream{false}', async () => {
  const { transport, sockets } = makeTransport({});
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateText({
    v: VIDEO_PROTOCOL_VERSION,
    type: 'stream',
    robotId: 'robot-01',
    publisherOnline: false,
  });
  assert.equal(transport.state, 'waiting-for-publisher');
});

test('publisher appears while waiting: waiting-for-publisher -> live, and a real frame decodes and renders', async () => {
  const { renderer, calls } = fakeRenderer();
  const { transport, sockets } = makeTransport({ renderer });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  // Publisher is not live yet when this viewer registers.
  sockets[0]?.simulateText({
    v: VIDEO_PROTOCOL_VERSION,
    type: 'stream',
    robotId: 'robot-01',
    publisherOnline: false,
  });
  assert.equal(transport.state, 'waiting-for-publisher');

  // Publisher connects afterward.
  sockets[0]?.simulateText({
    v: VIDEO_PROTOCOL_VERSION,
    type: 'stream',
    robotId: 'robot-01',
    publisherOnline: true,
    streamSessionId: 'session-a',
  });
  assert.equal(transport.state, 'live');

  sockets[0]?.simulateText(frameHeader());
  sockets[0]?.simulateBinary(jpeg());
  await flush();

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.width, 640);
});

test('publisher disappears: live -> waiting-for-publisher, no stale frame pretends otherwise', async () => {
  const { transport, sockets } = makeTransport({});
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateText({
    v: VIDEO_PROTOCOL_VERSION,
    type: 'stream',
    robotId: 'robot-01',
    publisherOnline: true,
    streamSessionId: 'session-a',
  });
  sockets[0]?.simulateText(frameHeader());
  sockets[0]?.simulateBinary(jpeg());
  await flush();
  assert.equal(transport.state, 'live');

  sockets[0]?.simulateText({
    v: VIDEO_PROTOCOL_VERSION,
    type: 'stream',
    robotId: 'robot-01',
    publisherOnline: false,
  });
  assert.equal(transport.state, 'waiting-for-publisher');
});

test('after render, exactly one matching viewer.ack is sent for that frame', async () => {
  const { transport, sockets } = makeTransport({});
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateText(frameHeader({ seq: 7, streamSessionId: 'session-a' }));
  sockets[0]?.simulateBinary(jpeg());
  await flush();

  const acks = (sockets[0]?.sent ?? [])
    .filter((m): m is string => typeof m === 'string')
    .map((m) => parseJsonObject(m))
    .filter((m) => m.type === 'viewer.ack');
  assert.equal(acks.length, 1);
  assert.equal(acks[0]?.seq, 7);
  assert.equal(acks[0]?.streamSessionId, 'session-a');
});

test('a decode failure still sends the ack (releases credit) and counts as failed, not rendered', async () => {
  const { renderer } = fakeRenderer(() => Promise.resolve(false));
  const { transport, sockets } = makeTransport({ renderer });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateText(frameHeader({ seq: 3 }));
  sockets[0]?.simulateBinary(jpeg());
  await flush();

  const acks = (sockets[0]?.sent ?? [])
    .filter((m): m is string => typeof m === 'string')
    .map((m) => parseJsonObject(m))
    .filter((m) => m.type === 'viewer.ack');
  assert.equal(acks.length, 1, 'must still ack so the relay does not deadlock waiting');
  assert.equal(acks[0]?.seq, 3);
  assert.equal(transport.stats.framesFailedDecode, 1);
  assert.equal(transport.stats.framesRendered, 0);
});

test('a byte-length mismatch is dropped and still acked, never rendered', async () => {
  const { renderer, calls } = fakeRenderer();
  const { transport, sockets } = makeTransport({ renderer });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateText(frameHeader({ seq: 9, byteLength: 999 }));
  sockets[0]?.simulateBinary(jpeg(20_000)); // does not match declared byteLength
  await flush();

  assert.equal(calls.length, 0, 'a size-mismatched frame must never reach the renderer');
  const acks = (sockets[0]?.sent ?? [])
    .filter((m): m is string => typeof m === 'string')
    .map((m) => parseJsonObject(m))
    .filter((m) => m.type === 'viewer.ack');
  assert.equal(acks.length, 1, 'still acked so the relay is not left waiting on a corrupt frame');
});

test('malformed sequencing (binary with no header) does not crash and sends no ack', async () => {
  const { transport, sockets } = makeTransport({});
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateBinary(jpeg());
  await flush();
  assert.equal(transport.state, 'registering');
  const acks = (sockets[0]?.sent ?? []).filter(
    (m) => typeof m === 'string' && parseJsonObject(m).type === 'viewer.ack',
  );
  assert.equal(acks.length, 0);
});

test('no frame queue: a second header+binary arriving while the first is still decoding is dropped, not queued', async () => {
  // A plain mutable holder object (rather than a bare `let`) so reading it
  // after the Promise executor runs is never mis-narrowed back to `null`.
  const resolver: { current: ((ok: boolean) => void) | null } = { current: null };
  const renderer: VideoFrameRenderer = {
    render: () =>
      new Promise((resolve) => {
        resolver.current = resolve;
      }),
  };
  const { transport, sockets } = makeTransport({ renderer });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();

  sockets[0]?.simulateText(frameHeader({ seq: 1 }));
  sockets[0]?.simulateBinary(jpeg());
  await flush(); // render() is now pending, unresolved

  // A second frame arrives before the first has finished "decoding" — this
  // should never happen given the relay's own credit protocol, but must be
  // handled safely rather than queued if it somehow does.
  sockets[0]?.simulateText(frameHeader({ seq: 2 }));
  sockets[0]?.simulateBinary(jpeg());
  await flush();

  resolver.current?.(true);
  await flush();

  assert.equal(transport.stats.framesRendered, 1, 'only the first frame was ever decoded');
});

test('streamSessionId change resets seq tracking without treating it as a mass drop', async () => {
  const { transport, sockets } = makeTransport({});
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateText(frameHeader({ seq: 40, streamSessionId: 'session-a' }));
  sockets[0]?.simulateBinary(jpeg());
  await flush();

  sockets[0]?.simulateText(frameHeader({ seq: 1, streamSessionId: 'session-b' }));
  sockets[0]?.simulateBinary(jpeg());
  await flush();

  assert.equal(transport.stats.framesMissing, 0);
  assert.equal(transport.stats.lastStreamSessionId, 'session-b');
});

test('reconnect requests a FRESH ticket, never reusing the previous one', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source, reconnectMinMs: 1 });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  assert.equal(counter.calls, 1);

  sockets[0]?.simulateClose(1006, '');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(counter.calls, 2, 'a fresh ticket must be requested for the reconnect attempt');
  assert.equal(sockets.length, 2);
});

test('TICKET_EXPIRED retries with a fresh ticket', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source, reconnectMinMs: 1 });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateClose(4106, 'ticket-expired'); // VIDEO_CLOSE_CODE.TICKET_EXPIRED
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(counter.calls, 2);
  assert.equal(sockets.length, 2);
});

test('AUTH_FAILED retries once with a fresh ticket, then stops rather than looping forever', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source, reconnectMinMs: 1 });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  sockets[0]?.simulateClose(4105, 'auth-failed'); // VIDEO_CLOSE_CODE.AUTH_FAILED
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(counter.calls, 2, 'exactly one retry with a fresh ticket');
  sockets[1]?.simulateOpen();
  sockets[1]?.simulateClose(4105, 'auth-failed'); // fails again
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(counter.calls, 2, 'must not keep retrying forever on repeated auth failure');
  assert.equal(transport.state, 'error');
});

test('explicit disconnect cancels everything and never auto-reconnects', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source, reconnectMinMs: 1 });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  transport.disconnect();
  assert.equal(transport.state, 'disconnected');

  sockets[0]?.simulateClose(1006, '');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(counter.calls, 1, 'no reconnect attempt after an explicit disconnect');
  assert.equal(transport.state, 'disconnected');
});

test('pause() disconnects and does not auto-reconnect on its own', async () => {
  const { transport, sockets } = makeTransport({ reconnectMinMs: 1 });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  transport.pause();
  assert.equal(transport.state, 'disconnected');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sockets.length, 1, 'no reconnect attempt while paused');
});

test('resume() after pause() requests a fresh ticket and reconnects', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  assert.equal(counter.calls, 1);

  transport.pause();
  transport.resume();
  await flush();
  assert.equal(counter.calls, 2, 'resume must request a fresh ticket, never reuse the old one');
  assert.equal(sockets.length, 2);
});

test('resume() without a prior connect()/pause() is a no-op', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport } = makeTransport({ ticketSource: source });
  transport.resume();
  await flush();
  assert.equal(counter.calls, 0);
  assert.equal(transport.state, 'disconnected');
});

test('disconnect() after pause() stays disconnected: resume() no longer reconnects', async () => {
  const { counter, source } = fakeTicketSource();
  const { transport, sockets } = makeTransport({ ticketSource: source });
  transport.connect();
  await flush();
  sockets[0]?.simulateOpen();
  transport.pause();
  transport.disconnect(); // e.g. control was lost while the tab was already hidden
  transport.resume(); // a later visibilitychange must not undo the disconnect
  await flush();
  assert.equal(counter.calls, 1, 'resume after an explicit disconnect must not reconnect');
  assert.equal(transport.state, 'disconnected');
});

test('state transitions are observable via subscribe()', async () => {
  const { transport, sockets } = makeTransport({});
  const seen = states(transport);
  transport.connect();
  assert.deepEqual(seen, ['requesting-ticket']);
  await flush();
  assert.deepEqual(seen, ['requesting-ticket', 'connecting']);
  sockets[0]?.simulateOpen();
  assert.deepEqual(seen, ['requesting-ticket', 'connecting', 'registering']);
});
