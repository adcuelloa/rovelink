/**
 * `VideoRoom` behavior against the real Workers runtime (Durable Object
 * hibernation, `getWebSockets`, alarms): plain `node --test` cannot
 * exercise these APIs, so this file runs under
 * @cloudflare/vitest-pool-workers (`vitest run`) instead of `node --test`
 * like route.test.ts — same split as the control relay's room.do.test.ts
 * vs. route.test.ts.
 *
 * Credentials: VIDEO_PUBLISHER_SECRET/VIDEO_TICKET_SECRET are test-only
 * fixtures injected via `miniflare.bindings` in vitest.config.ts, not real
 * secrets.
 */

import type { VideoMessage } from '@rovelink/protocol';
import {
  isJpeg,
  isVideoMessage,
  mintVideoTicket,
  VIDEO_CLOSE_CODE,
  VIDEO_PROTOCOL_VERSION,
} from '@rovelink/protocol';
import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { loadFixtureFrame } from './dev/fixture.ts';
import type { VideoRoom } from './room.ts';

const VALID_PUBLISHER_TOKEN = 'test-video-publisher-secret';
const VALID_TICKET_SECRET = 'test-video-ticket-secret';

async function open(path: string): Promise<{ ws: WebSocket | null; response: Response }> {
  const response = await SELF.fetch(`https://video-relay.test${path}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = response.webSocket ?? null;
  ws?.accept();
  // WebSocket.binaryType defaults to 'blob' (WHATWG default, honored even
  // by the Workers-runtime client-side socket under test here): without
  // this, every binary frame arrives as a Blob instead of an ArrayBuffer
  // and waitForBinary()'s `instanceof ArrayBuffer` check never matches.
  if (ws !== null) ws.binaryType = 'arraybuffer';
  return { ws, response };
}

function isMessageType<T extends VideoMessage['type']>(
  message: VideoMessage,
  type: T,
): message is Extract<VideoMessage, { type: T }> {
  return message.type === type;
}

function waitForMessage<T extends VideoMessage['type']>(
  ws: WebSocket,
  type: T,
  predicate: (message: Extract<VideoMessage, { type: T }>) => boolean = () => true,
): Promise<Extract<VideoMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), 2000);
    const handler = (event: MessageEvent): void => {
      if (typeof event.data !== 'string') return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!isVideoMessage(raw) || !isMessageType(raw, type)) return;
      const message = raw;
      if (!predicate(message)) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      resolve(message);
    };
    ws.addEventListener('message', handler);
  });
}

/** Resolves with the next binary frame payload (an ArrayBuffer). */
function waitForBinary(ws: WebSocket): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timed out waiting for binary frame')), 2000);
    const handler = (event: MessageEvent): void => {
      if (!(event.data instanceof ArrayBuffer)) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      resolve(event.data);
    };
    ws.addEventListener('message', handler);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }), {
      once: true,
    });
  });
}

/** Asserts a socket never receives any message before `settle()` resolves. */
function neverReceivesAnything(ws: WebSocket): () => boolean {
  let received = false;
  ws.addEventListener('message', () => {
    received = true;
  });
  return () => received;
}

/** Reads a socket's raw attachment for test-only introspection without an
 * unchecked `as` cast: `Attachment` itself is private to room.ts, so this
 * names only the fields tests actually touch — narrowed defensively, the
 * same `typeof === 'object' && !== null` guard room.ts's own
 * readAttachment() uses before casting to its own known shape. */
interface TestAttachmentView {
  readonly inFlight?: unknown;
  readonly framesSkipped?: unknown;
  readonly pendingSince?: unknown;
  readonly registered?: unknown;
  readonly token?: unknown;
  readonly ticket?: unknown;
  readonly secret?: unknown;
}

function readTestAttachment(ws: WebSocket): TestAttachmentView {
  const raw: unknown = ws.deserializeAttachment();
  return typeof raw === 'object' && raw !== null ? raw : {};
}

function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerPublisher(ws: WebSocket, robotId: string, token: string): void {
  ws.send(
    JSON.stringify({ v: VIDEO_PROTOCOL_VERSION, type: 'publisher.register', robotId, token }),
  );
}

function registerViewer(ws: WebSocket, robotId: string, ticket: string): void {
  ws.send(JSON.stringify({ v: VIDEO_PROTOCOL_VERSION, type: 'viewer.register', robotId, ticket }));
}

async function mintTestTicket(
  robotId: string,
  overrides: { readonly ttlMs?: number; readonly issuedAtMs?: number } = {},
): Promise<string> {
  const minted = await mintVideoTicket(
    { robotId, role: 'viewer' },
    VALID_TICKET_SECRET,
    overrides.issuedAtMs ?? Date.now(),
    overrides.ttlMs,
  );
  return minted.token;
}

/** Opens and fully authenticates a publisher socket in one step. */
async function openPublisher(
  robotId: string,
  token: string = VALID_PUBLISHER_TOKEN,
): Promise<{ ws: WebSocket; accepted: Extract<VideoMessage, { type: 'publisher.accepted' }> }> {
  const { ws } = await open(`/video/${robotId}/publisher`);
  if (ws === null) throw new Error('no websocket');
  const acceptedPromise = waitForMessage(ws, 'publisher.accepted');
  registerPublisher(ws, robotId, token);
  const accepted = await acceptedPromise;
  return { ws, accepted };
}

/** Opens and fully authenticates a viewer socket in one step. */
async function openViewer(
  robotId: string,
  ticket?: string,
): Promise<{ ws: WebSocket; state: Extract<VideoMessage, { type: 'stream' }> }> {
  const { ws } = await open(`/video/${robotId}/viewer`);
  if (ws === null) throw new Error('no websocket');
  const t = ticket ?? (await mintTestTicket(robotId));
  const statePromise = waitForMessage(ws, 'stream');
  registerViewer(ws, robotId, t);
  const state = await statePromise;
  return { ws, state };
}

function sendAck(ws: WebSocket, streamSessionId: string, seq: number): void {
  ws.send(JSON.stringify({ v: VIDEO_PROTOCOL_VERSION, type: 'viewer.ack', streamSessionId, seq }));
}

/** Publishes one full frame (header text message + binary payload) on an
 * already-registered publisher socket. */
function publishFrame(ws: WebSocket, streamSessionId: string, seq: number): Uint8Array {
  const jpeg = loadFixtureFrame();
  ws.send(
    JSON.stringify({
      v: VIDEO_PROTOCOL_VERSION,
      type: 'frame',
      streamSessionId,
      seq,
      capturedAtMs: Date.now(),
      width: 640,
      height: 480,
      byteLength: jpeg.byteLength,
    }),
  );
  ws.send(jpeg);
  return jpeg;
}

/** Convenience for a "fast" viewer: waits for one frame's header+binary,
 * then immediately acks it. */
async function waitForFrameAndAck(
  ws: WebSocket,
): Promise<{ header: Extract<VideoMessage, { type: 'frame' }>; binary: ArrayBuffer }> {
  const headerPromise = waitForMessage(ws, 'frame');
  const binaryPromise = waitForBinary(ws);
  const header = await headerPromise;
  const binary = await binaryPromise;
  sendAck(ws, header.streamSessionId, header.seq);
  return { header, binary };
}

function trackFrameSeqs(ws: WebSocket): number[] {
  const seqs: number[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    const parsed: unknown = JSON.parse(event.data);
    if (isVideoMessage(parsed) && parsed.type === 'frame') seqs.push(parsed.seq);
  });
  return seqs;
}

let roomCounter = 0;
/** Every test gets its own robotId so Durable Object state never leaks
 * between tests (each robotId is its own room instance). */
function freshRobotId(): string {
  roomCounter += 1;
  return `room-${roomCounter}`;
}

/** Backdates a socket's pendingSince/inFlight.sentAt in storage, then
 * triggers the sweep directly — avoids waiting out REGISTRATION_TIMEOUT_MS/
 * ACK_TIMEOUT_MS in real time. */
async function forceSweep(
  robotId: string,
  mutate: (attachment: TestAttachmentView) => TestAttachmentView,
): Promise<boolean> {
  const stub = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(robotId));
  await runInDurableObject(stub, (_instance: VideoRoom, state: DurableObjectState) => {
    for (const role of ['publisher', 'viewer'] as const) {
      for (const ws of state.getWebSockets(role)) {
        ws.serializeAttachment(mutate(readTestAttachment(ws)));
      }
    }
  });
  return runDurableObjectAlarm(stub);
}

describe('VideoRoom: connection accept', () => {
  it('accepts a publisher connection', async () => {
    const { response } = await open(`/video/${freshRobotId()}/publisher`);
    expect(response.status).toBe(101);
  });

  it('accepts a viewer connection', async () => {
    const { response } = await open(`/video/${freshRobotId()}/viewer`);
    expect(response.status).toBe(101);
  });

  it('rejects an unknown route', async () => {
    const response = await SELF.fetch('https://video-relay.test/video/robot-01/spy', {
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(404);
  });
});

describe('VideoRoom: publisher authentication', () => {
  it('correct credential is accepted and yields a fresh streamSessionId', async () => {
    const robotId = freshRobotId();
    const { accepted } = await openPublisher(robotId);
    expect(accepted.robotId).toBe(robotId);
    expect(accepted.streamSessionId.length).toBeGreaterThan(0);
  });

  it('no credential (empty token) is rejected', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/publisher`);
    if (ws === null) throw new Error('no websocket');
    registerPublisher(ws, robotId, '');
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);
  });

  it('wrong credential is rejected', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/publisher`);
    if (ws === null) throw new Error('no websocket');
    registerPublisher(ws, robotId, 'totally-wrong-token');
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);
  });

  it('a pending (unregistered) publisher cannot publish a frame', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const { ws: viewer } = await openViewer(robotId);

    const neverGetsFrame = neverReceivesAnything(viewer);
    // Never registered: send frame data directly.
    publishFrame(publisher, 'not-a-real-session', 1);
    await settle();
    expect(neverGetsFrame()).toBe(false);
  });

  it('an invalid publisher registration attempt can never replace the valid, live publisher', async () => {
    const robotId = freshRobotId();
    const { ws: valid, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const { ws: attacker } = await open(`/video/${robotId}/publisher`);
    if (attacker === null) throw new Error('no websocket');
    registerPublisher(attacker, robotId, 'wrong-token');
    const closed = await waitForClose(attacker);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);

    // The original publisher is untouched: it can still stream.
    const framePromise = waitForMessage(viewer, 'frame');
    publishFrame(valid, accepted.streamSessionId, 1);
    const header = await framePromise;
    expect(header.seq).toBe(1);
  });

  it('authenticated replacement: old publisher is closed, new streamSessionId, viewer follows the new session', async () => {
    const robotId = freshRobotId();
    const { ws: first, accepted: firstAccepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const firstClosed = waitForClose(first);
    const streamUpdatePromise = waitForMessage(viewer, 'stream', (s) => s.publisherOnline);
    const { ws: second } = await open(`/video/${robotId}/publisher`);
    if (second === null) throw new Error('no websocket');
    const secondAcceptedPromise = waitForMessage(second, 'publisher.accepted');
    registerPublisher(second, robotId, VALID_PUBLISHER_TOKEN);

    const secondAccepted = await secondAcceptedPromise;
    expect(secondAccepted.streamSessionId).not.toBe(firstAccepted.streamSessionId);

    const closed = await firstClosed;
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.PUBLISHER_REPLACED);

    const streamUpdate = await streamUpdatePromise;
    expect(streamUpdate.streamSessionId).toBe(secondAccepted.streamSessionId);

    const framePromise = waitForMessage(viewer, 'frame');
    publishFrame(second, secondAccepted.streamSessionId, 1);
    const header = await framePromise;
    expect(header.streamSessionId).toBe(secondAccepted.streamSessionId);
  });

  it('after a publisher disconnects cleanly, a new publisher registers with a different streamSessionId', async () => {
    const robotId = freshRobotId();
    const { ws: first, accepted: firstAccepted } = await openPublisher(robotId);
    first.close();
    await settle();

    const { accepted: secondAccepted } = await openPublisher(robotId);
    expect(secondAccepted.streamSessionId).not.toBe(firstAccepted.streamSessionId);
  });

  it('registration timeout evicts a publisher that never registers', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/publisher`);
    if (ws === null) throw new Error('no websocket');

    const closed = waitForClose(ws);
    const ran = await forceSweep(robotId, (a) => ({ ...a, pendingSince: Date.now() - 10_000 }));
    expect(ran).toBe(true);
    const result = await closed;
    expect(result.code).toBe(VIDEO_CLOSE_CODE.REGISTRATION_TIMEOUT);
  });

  it('the publisher credential is never persisted in the socket attachment', async () => {
    const robotId = freshRobotId();
    await openPublisher(robotId);
    const stub = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(robotId));
    const hasSecretField = await runInDurableObject(
      stub,
      (_instance: VideoRoom, state: DurableObjectState) => {
        const [publisherWs] = state.getWebSockets('publisher');
        const attachment = publisherWs ? readTestAttachment(publisherWs) : undefined;
        return attachment !== undefined && ('token' in attachment || 'secret' in attachment);
      },
    );
    expect(hasSecretField).toBe(false);
  });
});

describe('VideoRoom: viewer authentication', () => {
  it('a valid ticket is accepted and registers the viewer', async () => {
    const robotId = freshRobotId();
    const { state } = await openViewer(robotId);
    expect(state.type).toBe('stream');
  });

  it('no ticket at all: the viewer stays pending and sees nothing', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    const neverGetsAnything = neverReceivesAnything(ws);
    await settle();
    expect(neverGetsAnything()).toBe(false);
  });

  it('a malformed ticket is rejected', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    registerViewer(ws, robotId, 'not-a-real-ticket');
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);
  });

  it('a ticket signed with the wrong secret (bad signature) is rejected', async () => {
    const robotId = freshRobotId();
    const bogus = await mintVideoTicket(
      { robotId, role: 'viewer' },
      'a-completely-wrong-secret',
      Date.now(),
    );
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    registerViewer(ws, robotId, bogus.token);
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);
  });

  it('a tampered ticket payload is rejected', async () => {
    const robotId = freshRobotId();
    const ticket = await mintTestTicket(robotId);
    const [payloadSegment, signatureSegment] = ticket.split('.');
    const parsed: unknown = JSON.parse(
      Buffer.from(payloadSegment ?? '', 'base64url').toString('utf8'),
    );
    const decoded = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...decoded, robotId: 'robot-99' }),
      'utf8',
    ).toString('base64url');
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    registerViewer(ws, robotId, `${tamperedPayload}.${signatureSegment}`);
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);
  });

  it('an expired ticket is rejected with the dedicated TICKET_EXPIRED code', async () => {
    const robotId = freshRobotId();
    const ticket = await mintTestTicket(robotId, { ttlMs: 1 });
    await settle(20); // let it actually expire
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    registerViewer(ws, robotId, ticket);
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.TICKET_EXPIRED);
  });

  it('a future-issued ticket beyond clock skew is rejected', async () => {
    const robotId = freshRobotId();
    const ticket = await mintTestTicket(robotId, { issuedAtMs: Date.now() + 60_000 });
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    registerViewer(ws, robotId, ticket);
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);
  });

  it('a ticket minted for a different robotId is rejected', async () => {
    const robotId = freshRobotId();
    const ticket = await mintTestTicket('some-other-robot');
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    registerViewer(ws, robotId, ticket);
    const closed = await waitForClose(ws);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.AUTH_FAILED);
  });

  it('a pending viewer receives no cached frame even if one already exists', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    publishFrame(publisher, accepted.streamSessionId, 1);
    await settle();

    const { ws: pending } = await open(`/video/${robotId}/viewer`);
    if (pending === null) throw new Error('no websocket');
    const neverGetsAnything = neverReceivesAnything(pending);
    await settle();
    expect(neverGetsAnything()).toBe(false); // never registered, never sent anything
  });

  it('a pending viewer cannot ack / release flow control', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: pending } = await open(`/video/${robotId}/viewer`);
    if (pending === null) throw new Error('no websocket');

    // Guess at an ack for what would be the first frame — must be ignored,
    // and must not crash the room or affect the publisher.
    sendAck(pending, accepted.streamSessionId, 1);
    await settle();

    const framePromise = waitForMessage(pending, 'frame').catch(() => null);
    publishFrame(publisher, accepted.streamSessionId, 1);
    await settle();
    // Nothing arrives: this socket was never promoted to a registered
    // viewer, regardless of the ack it sent while pending.
    const raced = await Promise.race([framePromise, settle(50).then(() => 'timeout')]);
    expect(raced).not.toHaveProperty('seq');
  });

  it('registration timeout evicts a viewer that never registers', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');

    const closed = waitForClose(ws);
    const ran = await forceSweep(robotId, (a) => ({ ...a, pendingSince: Date.now() - 10_000 }));
    expect(ran).toBe(true);
    const result = await closed;
    expect(result.code).toBe(VIDEO_CLOSE_CODE.REGISTRATION_TIMEOUT);
  });

  it('ticket expiry after an established connection does not break the active stream', async () => {
    const robotId = freshRobotId();
    const shortTicket = await mintTestTicket(robotId, { ttlMs: 30 });
    const { ws: viewer } = await openViewer(robotId, shortTicket);
    await settle(60); // the ticket is now well past its own expiresAt

    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { header } = await (async () => {
      const p = waitForFrameAndAck(viewer);
      publishFrame(publisher, accepted.streamSessionId, 1);
      return p;
    })();
    // The already-registered viewer is unaffected by its ticket's expiry:
    // 7C's chosen policy is that a ticket only authorizes ESTABLISHING the
    // connection (see video-ticket.ts's module doc).
    expect(header.seq).toBe(1);
  });

  it('the ticket is never persisted in the socket attachment', async () => {
    const robotId = freshRobotId();
    await openViewer(robotId);
    const stub = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(robotId));
    const hasTicketField = await runInDurableObject(
      stub,
      (_instance: VideoRoom, state: DurableObjectState) => {
        const [viewerWs] = state.getWebSockets('viewer');
        const attachment = viewerWs ? readTestAttachment(viewerWs) : undefined;
        return attachment !== undefined && ('ticket' in attachment || 'secret' in attachment);
      },
    );
    expect(hasTicketField).toBe(false);
  });
});

describe('VideoRoom: viewer presence/state', () => {
  it('a viewer connecting before any publisher sees waiting (publisherOnline: false)', async () => {
    const robotId = freshRobotId();
    const { state } = await openViewer(robotId);
    expect(state.publisherOnline).toBe(false);
  });

  it('an existing viewer is told when a publisher becomes live', async () => {
    const robotId = freshRobotId();
    const { ws: viewer } = await openViewer(robotId);

    const livePromise = waitForMessage(viewer, 'stream', (s) => s.publisherOnline);
    const { accepted } = await openPublisher(robotId);

    const live = await livePromise;
    expect(live.streamSessionId).toBe(accepted.streamSessionId);
  });

  it('a viewer joining after the publisher sees publisherOnline: true immediately', async () => {
    const robotId = freshRobotId();
    await openPublisher(robotId);
    const { state } = await openViewer(robotId);
    expect(state.publisherOnline).toBe(true);
  });

  it('publisher disconnect is broadcast to viewers as publisherOnline: false', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    publisher.close();
    const offline = await waitForMessage(viewer, 'stream', (s) => !s.publisherOnline);
    expect(offline.publisherOnline).toBe(false);
  });

  it('a viewer disconnecting/reconnecting never affects the publisher or other viewers', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewerA } = await openViewer(robotId);
    const { ws: viewerB } = await openViewer(robotId);
    viewerB.close();
    await settle();

    // Publisher keeps streaming; the remaining viewer keeps receiving.
    publishFrame(publisher, accepted.streamSessionId, 1);
    const header = await waitForMessage(viewerA, 'frame');
    expect(header.seq).toBe(1);
  });
});

describe('VideoRoom: frame forwarding', () => {
  it('a single viewer receives the header then the matching binary payload', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const binaryPromise = waitForBinary(viewer);
    const headerPromise = waitForMessage(viewer, 'frame');
    const sent = publishFrame(publisher, accepted.streamSessionId, 1);

    const header = await headerPromise;
    const binary = await binaryPromise;
    expect(header.byteLength).toBe(sent.byteLength);
    expect(binary.byteLength).toBe(sent.byteLength);
    expect(isJpeg(binary)).toBe(true);
  });

  it('two viewers both receive the same publisher frame from a single publish', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewerA } = await openViewer(robotId);
    const { ws: viewerB } = await openViewer(robotId);

    const headerA = waitForMessage(viewerA, 'frame');
    const headerB = waitForMessage(viewerB, 'frame');
    const binaryA = waitForBinary(viewerA);
    const binaryB = waitForBinary(viewerB);
    publishFrame(publisher, accepted.streamSessionId, 5);

    const [a, b] = await Promise.all([headerA, headerB]);
    expect(a.seq).toBe(5);
    expect(b.seq).toBe(5);
    expect(a.streamSessionId).toBe(b.streamSessionId);
    const [binA, binB] = await Promise.all([binaryA, binaryB]);
    expect(binA.byteLength).toBe(binB.byteLength);
  });

  it('a late-joining viewer immediately receives the cached latest frame', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    publishFrame(publisher, accepted.streamSessionId, 9);
    await settle();

    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    const headerPromise = waitForMessage(viewer, 'frame');
    registerViewer(viewer, robotId, await mintTestTicket(robotId));
    const header = await headerPromise;
    expect(header.seq).toBe(9);
  });

  it('frame ordering is preserved end-to-end for sequential acked publishes', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const seqs: number[] = [];
    for (const seq of [1, 2, 3]) {
      const framePromise = waitForFrameAndAck(viewer);
      publishFrame(publisher, accepted.streamSessionId, seq);
      const { header } = await framePromise;
      seqs.push(header.seq);
    }
    expect(seqs).toEqual([1, 2, 3]);
  });
});

describe('VideoRoom: malformed and oversized input', () => {
  it('non-JSON text from an authenticated publisher is safely ignored, connection stays open', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await openPublisher(robotId);
    publisher.send('not json at all {{{');
    await settle();
    expect(publisher.readyState).toBe(WebSocket.READY_STATE_OPEN);
  });

  it('a binary payload with no preceding header is safely ignored', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await openPublisher(robotId);
    publisher.send(loadFixtureFrame());
    await settle();
    expect(publisher.readyState).toBe(WebSocket.READY_STATE_OPEN);
  });

  it('a binary payload whose length mismatches the header is dropped, not forwarded', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    publisher.send(
      JSON.stringify({
        v: VIDEO_PROTOCOL_VERSION,
        type: 'frame',
        streamSessionId: accepted.streamSessionId,
        seq: 1,
        capturedAtMs: Date.now(),
        width: 640,
        height: 480,
        byteLength: 999_999,
      }),
    );
    publisher.send(loadFixtureFrame());
    await settle();

    const headerPromise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 2);
    const header = await headerPromise;
    expect(header.seq).toBe(2);
  });

  it('a header declaring more than MAX_JPEG_BYTES is rejected before the binary arrives', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);

    publisher.send(
      JSON.stringify({
        v: VIDEO_PROTOCOL_VERSION,
        type: 'frame',
        streamSessionId: accepted.streamSessionId,
        seq: 1,
        capturedAtMs: Date.now(),
        width: 640,
        height: 480,
        byteLength: 10 * 1024 * 1024,
      }),
    );
    const closed = await waitForClose(publisher);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.OVERSIZED_FRAME);
  });
});

describe('VideoRoom: viewer ack / flow control (Problem 7B.1)', () => {
  it('ack validation: wrong session, wrong seq, and no-in-flight acks are all ignored', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    sendAck(viewer, accepted.streamSessionId, 1); // nothing in flight yet
    await settle();

    const header1Promise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    const header1 = await header1Promise;
    expect(header1.seq).toBe(1);

    publishFrame(publisher, accepted.streamSessionId, 2);
    await settle();

    const seqs = trackFrameSeqs(viewer);
    sendAck(viewer, 'a-different-session', 1);
    sendAck(viewer, accepted.streamSessionId, 2);
    sendAck(viewer, accepted.streamSessionId, 0);
    await settle();
    expect(seqs).toEqual([]);

    const header2Promise = waitForMessage(viewer, 'frame');
    sendAck(viewer, accepted.streamSessionId, 1);
    const header2 = await header2Promise;
    expect(header2.seq).toBe(2);
  });

  it('a duplicate ack after credit was already released does not release it a second time', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const { header: header1 } = await (async () => {
      const p = waitForFrameAndAck(viewer);
      publishFrame(publisher, accepted.streamSessionId, 1);
      return p;
    })();
    expect(header1.seq).toBe(1);

    const header2Promise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 2);
    await header2Promise;

    const seqs = trackFrameSeqs(viewer);
    sendAck(viewer, accepted.streamSessionId, 1);
    publishFrame(publisher, accepted.streamSessionId, 3);
    await settle();
    expect(seqs).toEqual([]);
  });

  it('a stalled viewer receives no frames 2-100 while unacked, then only the newest once it acks', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const header1Promise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    const header1 = await header1Promise;
    expect(header1.seq).toBe(1);

    const seqs = trackFrameSeqs(viewer);
    for (let seq = 2; seq <= 100; seq += 1) publishFrame(publisher, accepted.streamSessionId, seq);
    await settle(20);
    expect(seqs).toEqual([]);

    const header100Promise = waitForMessage(viewer, 'frame');
    sendAck(viewer, accepted.streamSessionId, 1);
    const header100 = await header100Promise;
    expect(header100.seq).toBe(100);
  });

  it('a stalled viewer never affects a fast-acking viewer sharing the same publisher', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: fast } = await openViewer(robotId);
    const { ws: slow } = await openViewer(robotId);

    const fastSeqs: number[] = [];
    fast.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const parsed: unknown = JSON.parse(event.data);
      if (isVideoMessage(parsed) && parsed.type === 'frame') {
        fastSeqs.push(parsed.seq);
        sendAck(fast, parsed.streamSessionId, parsed.seq);
      }
    });
    const slowSeqs = trackFrameSeqs(slow);

    for (let seq = 1; seq <= 20; seq += 1) {
      const fastFramePromise = waitForMessage(fast, 'frame', (h) => h.seq === seq);
      publishFrame(publisher, accepted.streamSessionId, seq);
      await fastFramePromise;
      await settle();
    }
    await settle(20);

    expect(fastSeqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(slowSeqs).toEqual([1]);

    const slowNextPromise = waitForMessage(slow, 'frame');
    sendAck(slow, accepted.streamSessionId, 1);
    const slowNext = await slowNextPromise;
    expect(slowNext.seq).toBe(20);
  });

  it('an in-flight frame from a replaced publisher session can still be acked, releasing credit for the new session', async () => {
    const robotId = freshRobotId();
    const { ws: pubA, accepted: acceptedA } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const header50Promise = waitForMessage(viewer, 'frame');
    publishFrame(pubA, acceptedA.streamSessionId, 50);
    const header50 = await header50Promise;
    expect(header50.seq).toBe(50);

    pubA.close();
    await settle();

    const { ws: pubB, accepted: acceptedB } = await openPublisher(robotId);
    expect(acceptedB.streamSessionId).not.toBe(acceptedA.streamSessionId);

    const header1BPromise = waitForMessage(viewer, 'frame');
    publishFrame(pubB, acceptedB.streamSessionId, 1);
    await settle();

    sendAck(viewer, acceptedA.streamSessionId, 50);
    const header1B = await header1BPromise;
    expect(header1B.seq).toBe(1);
    expect(header1B.streamSessionId).toBe(acceptedB.streamSessionId);
  });

  it('a viewer whose in-flight frame is never acked is evicted after the ack timeout', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const headerPromise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    await headerPromise;

    const closed = waitForClose(viewer);
    const ran = await forceSweep(robotId, (a) => ({
      ...a,
      inFlight: {
        ...(typeof a.inFlight === 'object' && a.inFlight !== null ? a.inFlight : {}),
        sentAt: Date.now() - 10_000,
      },
    }));
    expect(ran).toBe(true);
    const result = await closed;
    expect(result.code).toBe(VIDEO_CLOSE_CODE.ACK_TIMEOUT);
  });

  it('publishing hundreds of frames to a stalled viewer keeps state bounded: one in-flight id, no queue, no storage', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    const headerPromise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    await headerPromise;

    for (let seq = 2; seq <= 500; seq += 1) publishFrame(publisher, accepted.streamSessionId, seq);

    const stub = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(robotId));
    const readFramesSkipped = (): Promise<number> =>
      runInDurableObject(stub, (_instance: VideoRoom, state: DurableObjectState) => {
        const [viewerWs] = state.getWebSockets('viewer');
        const framesSkipped = viewerWs ? readTestAttachment(viewerWs).framesSkipped : 0;
        return typeof framesSkipped === 'number' ? framesSkipped : 0;
      });

    let framesSkipped = await readFramesSkipped();
    for (let attempt = 0; attempt < 50 && framesSkipped < 499; attempt += 1) {
      await settle(20);
      framesSkipped = await readFramesSkipped();
    }

    const { attachmentSize, storedKeys } = await runInDurableObject(
      stub,
      async (_instance: VideoRoom, state: DurableObjectState) => {
        const [viewerWs] = state.getWebSockets('viewer');
        return {
          attachmentSize: viewerWs ? Object.keys(readTestAttachment(viewerWs)).length : -1,
          storedKeys: (await state.storage.list()).size,
        };
      },
    );
    expect(attachmentSize).toBeGreaterThan(0);
    expect(attachmentSize).toBeLessThan(10);
    expect(framesSkipped).toBe(499);
    expect(storedKeys).toBe(0);
  });
});

describe('VideoRoom: no persistent storage', () => {
  it('never writes to Durable Object storage while frames flow', async () => {
    const robotId = freshRobotId();
    const { ws: publisher, accepted } = await openPublisher(robotId);
    const { ws: viewer } = await openViewer(robotId);

    for (let seq = 1; seq <= 5; seq += 1) {
      const framePromise = waitForFrameAndAck(viewer);
      publishFrame(publisher, accepted.streamSessionId, seq);
      const { header } = await framePromise;
      expect(header.seq).toBe(seq);
    }

    const stub = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(robotId));
    const stored = await runInDurableObject(
      stub,
      (_instance: VideoRoom, state: DurableObjectState) => state.storage.list(),
    );
    expect(stored.size).toBe(0);
  });
});

describe('VideoRoom: separation from control', () => {
  it('this package declares no dependency on the control relay', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    expect(pkg.default.dependencies).not.toHaveProperty('@rovelink/relay');
  });
});
