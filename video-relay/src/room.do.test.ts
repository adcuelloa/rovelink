/**
 * `VideoRoom` behavior against the real Workers runtime (Durable Object
 * hibernation, `getWebSockets`): plain `node --test` cannot exercise these
 * APIs, so this file runs under @cloudflare/vitest-pool-workers (`vitest
 * run`) instead of `node --test` like route.test.ts — same split as the
 * control relay's room.do.test.ts vs. route.test.ts.
 */

import type { VideoMessage } from '@rovelink/protocol';
import {
  isJpeg,
  isVideoMessage,
  VIDEO_CLOSE_CODE,
  VIDEO_PROTOCOL_VERSION,
} from '@rovelink/protocol';
import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { loadFixtureFrame } from './dev/fixture.ts';
import type { VideoRoom } from './room.ts';

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

/** Reads a socket's raw attachment for test-only introspection (backdating
 * `inFlight.sentAt`, counting `framesSkipped`, checking bounded shape via
 * `Object.keys`). `Attachment` itself is private to room.ts, so this names
 * only the fields tests actually touch — narrowed defensively, the same
 * `typeof === 'object' && !== null` guard room.ts's own readAttachment()
 * uses before casting to its own known shape. The object reference itself
 * is untouched, so `Object.keys()` on the result still reflects every real
 * runtime field, not just the ones named here. */
interface TestAttachmentView {
  readonly inFlight?: unknown;
  readonly framesSkipped?: unknown;
}

function readTestAttachment(ws: WebSocket): TestAttachmentView {
  const raw: unknown = ws.deserializeAttachment();
  return typeof raw === 'object' && raw !== null ? raw : {};
}

function settle(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Publishes one full frame (header text message + binary payload) on an
 * already-accepted publisher socket. */
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

/** Sends a `viewer.ack` for (streamSessionId, seq) on an already-accepted
 * viewer socket. */
function sendAck(ws: WebSocket, streamSessionId: string, seq: number): void {
  ws.send(JSON.stringify({ v: VIDEO_PROTOCOL_VERSION, type: 'viewer.ack', streamSessionId, seq }));
}

/** Convenience for a "fast" viewer: waits for one frame's header+binary,
 * then immediately acks it — the credit-release cycle most tests want
 * without spelling it out every time. */
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

/** Collects every `frame` header's `seq` a socket receives, in arrival
 * order — used to assert what a viewer did or did NOT receive over a
 * window, without needing a one-shot waitForMessage for each. */
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

describe('VideoRoom: publisher authority', () => {
  it('the first publisher is accepted with a fresh streamSessionId', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/publisher`);
    if (ws === null) throw new Error('no websocket');
    const accepted = await waitForMessage(ws, 'publisher.accepted');
    expect(accepted.robotId).toBe(robotId);
    expect(accepted.streamSessionId.length).toBeGreaterThan(0);
  });

  it('a second live publisher is rejected, the first stays authoritative', async () => {
    const robotId = freshRobotId();
    const { ws: first } = await open(`/video/${robotId}/publisher`);
    if (first === null) throw new Error('no websocket');
    const firstAccepted = await waitForMessage(first, 'publisher.accepted');

    const { ws: second } = await open(`/video/${robotId}/publisher`);
    if (second === null) throw new Error('no websocket');
    const rejected = await waitForMessage(second, 'publisher.rejected');
    expect(rejected.robotId).toBe(robotId);
    const closed = await waitForClose(second);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.PUBLISHER_OCCUPIED);

    // The first publisher was never touched: it can still publish.
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    const framePromise = waitForMessage(viewer, 'frame');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);
    publishFrame(first, firstAccepted.streamSessionId, 1);
    await framePromise;
  });

  it('after a publisher disconnects, a new publisher is accepted with a different streamSessionId', async () => {
    const robotId = freshRobotId();
    const { ws: first } = await open(`/video/${robotId}/publisher`);
    if (first === null) throw new Error('no websocket');
    const firstAccept = await waitForMessage(first, 'publisher.accepted');
    first.close();
    await settle();

    const { ws: second } = await open(`/video/${robotId}/publisher`);
    if (second === null) throw new Error('no websocket');
    const secondAccept = await waitForMessage(second, 'publisher.accepted');
    expect(secondAccept.streamSessionId).not.toBe(firstAccept.streamSessionId);
  });
});

describe('VideoRoom: viewer presence/state', () => {
  it('a viewer connecting before any publisher sees waiting (publisherOnline: false)', async () => {
    const robotId = freshRobotId();
    const { ws } = await open(`/video/${robotId}/viewer`);
    if (ws === null) throw new Error('no websocket');
    const state = await waitForMessage(ws, 'stream');
    expect(state.publisherOnline).toBe(false);
  });

  it('an existing viewer is told when a publisher becomes live', async () => {
    const robotId = freshRobotId();
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => !s.publisherOnline);

    const livePromise = waitForMessage(viewer, 'stream', (s) => s.publisherOnline);
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');

    const live = await livePromise;
    expect(live.streamSessionId).toBe(accepted.streamSessionId);
  });

  it('a viewer joining after the publisher sees publisherOnline: true immediately', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    await waitForMessage(publisher, 'publisher.accepted');

    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    const state = await waitForMessage(viewer, 'stream');
    expect(state.publisherOnline).toBe(true);
  });

  it('publisher disconnect is broadcast to viewers as publisherOnline: false', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    await waitForMessage(publisher, 'publisher.accepted');

    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    publisher.close();
    const offline = await waitForMessage(viewer, 'stream', (s) => !s.publisherOnline);
    expect(offline.publisherOnline).toBe(false);
  });

  it('a viewer disconnecting/reconnecting never affects the publisher or other viewers', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');

    const { ws: viewerA } = await open(`/video/${robotId}/viewer`);
    if (viewerA === null) throw new Error('no websocket');
    await waitForMessage(viewerA, 'stream', (s) => s.publisherOnline);

    const { ws: viewerB } = await open(`/video/${robotId}/viewer`);
    if (viewerB === null) throw new Error('no websocket');
    await waitForMessage(viewerB, 'stream', (s) => s.publisherOnline);
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
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');

    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

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
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');

    // Each viewer's own initial `stream` message is sent synchronously
    // during its own connect (see VideoRoom#handleViewerConnect) — the wait
    // must be registered before opening the NEXT viewer, or it can arrive
    // and be missed before a listener for it ever exists.
    const { ws: viewerA } = await open(`/video/${robotId}/viewer`);
    if (viewerA === null) throw new Error('no websocket');
    const viewerALive = waitForMessage(viewerA, 'stream', (s) => s.publisherOnline);

    const { ws: viewerB } = await open(`/video/${robotId}/viewer`);
    if (viewerB === null) throw new Error('no websocket');
    const viewerBLive = waitForMessage(viewerB, 'stream', (s) => s.publisherOnline);

    await viewerALive;
    await viewerBLive;

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
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');

    // No viewer is connected yet when this frame is published.
    publishFrame(publisher, accepted.streamSessionId, 9);
    await settle();

    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    const header = await waitForMessage(viewer, 'frame');
    expect(header.seq).toBe(9);
  });

  it('frame ordering is preserved end-to-end for sequential acked publishes', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    // Each publish now has to wait for the viewer's ack of the previous
    // frame before the next one can be delivered — see room.ts's per-viewer
    // credit (Problem 7B.1). A viewer that acks immediately still sees
    // every frame, in order.
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
  it('non-JSON text from a publisher is safely ignored, connection stays open', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    await waitForMessage(publisher, 'publisher.accepted');

    publisher.send('not json at all {{{');
    await settle();
    expect(publisher.readyState).toBe(WebSocket.READY_STATE_OPEN);
  });

  it('a binary payload with no preceding header is safely ignored', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    await waitForMessage(publisher, 'publisher.accepted');

    publisher.send(loadFixtureFrame());
    await settle();
    expect(publisher.readyState).toBe(WebSocket.READY_STATE_OPEN);
  });

  it('a binary payload whose length mismatches the header is dropped, not forwarded', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    publisher.send(
      JSON.stringify({
        v: VIDEO_PROTOCOL_VERSION,
        type: 'frame',
        streamSessionId: accepted.streamSessionId,
        seq: 1,
        capturedAtMs: Date.now(),
        width: 640,
        height: 480,
        byteLength: 999_999, // does not match what actually follows
      }),
    );
    publisher.send(loadFixtureFrame());
    await settle();

    // Prove nothing was forwarded: a real, correctly-sized frame arrives
    // next and must be the FIRST thing the viewer ever receives.
    const headerPromise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 2);
    const header = await headerPromise;
    expect(header.seq).toBe(2);
  });

  it('a header declaring more than MAX_JPEG_BYTES is rejected before the binary arrives', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');

    publisher.send(
      JSON.stringify({
        v: VIDEO_PROTOCOL_VERSION,
        type: 'frame',
        streamSessionId: accepted.streamSessionId,
        seq: 1,
        capturedAtMs: Date.now(),
        width: 640,
        height: 480,
        byteLength: 10 * 1024 * 1024, // 10 MiB > MAX_JPEG_BYTES
      }),
    );
    const closed = await waitForClose(publisher);
    expect(closed.code).toBe(VIDEO_CLOSE_CODE.OVERSIZED_FRAME);
  });
});

describe('VideoRoom: viewer ack / flow control (Problem 7B.1)', () => {
  it('ack validation: wrong session, wrong seq, and no-in-flight acks are all ignored', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    // An ack before any frame was ever sent: nothing to release.
    sendAck(viewer, accepted.streamSessionId, 1);
    await settle();

    const header1Promise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    const header1 = await header1Promise;
    expect(header1.seq).toBe(1);
    // seq 1 is now in flight, unacknowledged.

    publishFrame(publisher, accepted.streamSessionId, 2);
    await settle();

    const seqs = trackFrameSeqs(viewer);
    sendAck(viewer, 'a-different-session', 1); // wrong streamSessionId
    sendAck(viewer, accepted.streamSessionId, 2); // future seq, not what was sent
    sendAck(viewer, accepted.streamSessionId, 0); // older seq
    await settle();
    expect(seqs).toEqual([]); // none of the above released credit

    // The one exact match does.
    const header2Promise = waitForMessage(viewer, 'frame');
    sendAck(viewer, accepted.streamSessionId, 1);
    const header2 = await header2Promise;
    expect(header2.seq).toBe(2);
  });

  it('a duplicate ack after credit was already released does not release it a second time', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    const { header: header1 } = await (async () => {
      const p = waitForFrameAndAck(viewer);
      publishFrame(publisher, accepted.streamSessionId, 1);
      return p;
    })();
    expect(header1.seq).toBe(1);

    // Frame 2 is now sent and in flight (credit from acking 1 was used).
    const header2Promise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 2);
    await header2Promise;

    // Re-sending the ack for the OLD seq 1 must not touch the current
    // in-flight frame (seq 2).
    const seqs = trackFrameSeqs(viewer);
    sendAck(viewer, accepted.streamSessionId, 1);
    publishFrame(publisher, accepted.streamSessionId, 3);
    await settle();
    expect(seqs).toEqual([]); // seq 3 withheld: credit for seq 2 was never released
  });

  it('a stalled viewer receives no frames 2-100 while unacked, then only the newest once it acks', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    const header1Promise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    const header1 = await header1Promise;
    expect(header1.seq).toBe(1);
    // Deliberately never ack seq 1.

    const seqs = trackFrameSeqs(viewer);
    for (let seq = 2; seq <= 100; seq += 1) publishFrame(publisher, accepted.streamSessionId, seq);
    await settle(20);
    expect(seqs).toEqual([]); // none of 2-100 delivered while credit is withheld

    const header100Promise = waitForMessage(viewer, 'frame');
    sendAck(viewer, accepted.streamSessionId, 1);
    const header100 = await header100Promise;
    expect(header100.seq).toBe(100); // newest available, not 2
  });

  it('a stalled viewer never affects a fast-acking viewer sharing the same publisher', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');

    const { ws: fast } = await open(`/video/${robotId}/viewer`);
    if (fast === null) throw new Error('no websocket');
    const fastLive = waitForMessage(fast, 'stream', (s) => s.publisherOnline);
    const { ws: slow } = await open(`/video/${robotId}/viewer`);
    if (slow === null) throw new Error('no websocket');
    const slowLive = waitForMessage(slow, 'stream', (s) => s.publisherOnline);
    await fastLive;
    await slowLive;

    const fastSeqs: number[] = [];
    fast.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return;
      const parsed: unknown = JSON.parse(event.data);
      if (isVideoMessage(parsed) && parsed.type === 'frame') {
        fastSeqs.push(parsed.seq);
        sendAck(fast, parsed.streamSessionId, parsed.seq);
      }
    });
    const slowSeqs = trackFrameSeqs(slow); // never acks

    for (let seq = 1; seq <= 20; seq += 1) {
      // Wait for the fast viewer's OWN receipt of this exact frame (whose
      // listener above sends the ack synchronously in the same dispatch)
      // before publishing the next one — a fixed number of event-loop
      // ticks is not a reliable proxy for "the ack round-trip completed"
      // across two independent WebSocket connections into one DO.
      const fastFramePromise = waitForMessage(fast, 'frame', (h) => h.seq === seq);
      publishFrame(publisher, accepted.streamSessionId, seq);
      await fastFramePromise;
      await settle(); // margin for the ack message itself to reach the DO
    }
    await settle(20);

    expect(fastSeqs).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(slowSeqs).toEqual([1]); // only ever got its first frame

    const slowNextPromise = waitForMessage(slow, 'frame');
    sendAck(slow, accepted.streamSessionId, 1);
    const slowNext = await slowNextPromise;
    expect(slowNext.seq).toBe(20); // newest, once it finally acks
  });

  it('an in-flight frame from a replaced publisher session can still be acked, releasing credit for the new session', async () => {
    const robotId = freshRobotId();
    const { ws: pubA } = await open(`/video/${robotId}/publisher`);
    if (pubA === null) throw new Error('no websocket');
    const acceptedA = await waitForMessage(pubA, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    const header50Promise = waitForMessage(viewer, 'frame');
    publishFrame(pubA, acceptedA.streamSessionId, 50);
    const header50 = await header50Promise;
    expect(header50.seq).toBe(50);
    // session A / seq 50 now in flight, never acked.

    pubA.close();
    await settle();

    const { ws: pubB } = await open(`/video/${robotId}/publisher`);
    if (pubB === null) throw new Error('no websocket');
    const acceptedB = await waitForMessage(pubB, 'publisher.accepted');
    expect(acceptedB.streamSessionId).not.toBe(acceptedA.streamSessionId);

    const header1BPromise = waitForMessage(viewer, 'frame');
    publishFrame(pubB, acceptedB.streamSessionId, 1);
    await settle();
    // Still withheld: the viewer's credit is still held by session A/seq 50.

    // Acking the OLD (session A) in-flight frame is still valid credit
    // release for this viewer — the relay does not compare seq numbers
    // across sessions, it only checks what THIS viewer is actually holding.
    sendAck(viewer, acceptedA.streamSessionId, 50);
    const header1B = await header1BPromise;
    expect(header1B.seq).toBe(1);
    expect(header1B.streamSessionId).toBe(acceptedB.streamSessionId);
  });

  it('a viewer whose in-flight frame is never acked is evicted after the ack timeout', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    const headerPromise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    await headerPromise; // in flight, never acked

    // Backdate the viewer's inFlight.sentAt well past ACK_TIMEOUT_MS rather
    // than sleeping several real seconds, then trigger the sweep directly.
    const stub = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(robotId));
    await runInDurableObject(stub, (_instance: VideoRoom, state: DurableObjectState) => {
      for (const ws of state.getWebSockets('viewer')) {
        const attachment = readTestAttachment(ws);
        const inFlight =
          typeof attachment.inFlight === 'object' && attachment.inFlight !== null
            ? attachment.inFlight
            : {};
        ws.serializeAttachment({
          ...attachment,
          inFlight: { ...inFlight, sentAt: Date.now() - 10_000 },
        });
      }
    });

    const closed = waitForClose(viewer);
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    const result = await closed;
    expect(result.code).toBe(VIDEO_CLOSE_CODE.ACK_TIMEOUT);
  });

  it('publishing hundreds of frames to a stalled viewer keeps state bounded: one in-flight id, no queue, no storage', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

    const headerPromise = waitForMessage(viewer, 'frame');
    publishFrame(publisher, accepted.streamSessionId, 1);
    await headerPromise; // in flight, never acked

    for (let seq = 2; seq <= 500; seq += 1) publishFrame(publisher, accepted.streamSessionId, seq);

    const stub = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(robotId));
    const readFramesSkipped = (): Promise<number> =>
      runInDurableObject(stub, (_instance: VideoRoom, state: DurableObjectState) => {
        const [viewerWs] = state.getWebSockets('viewer');
        const framesSkipped = viewerWs ? readTestAttachment(viewerWs).framesSkipped : 0;
        return typeof framesSkipped === 'number' ? framesSkipped : 0;
      });

    // Poll instead of a fixed sleep: 500 sequential sends take a variable
    // amount of real time to fully drain through the test runtime's own
    // WebSocket dispatch, and a fixed timeout would either be flaky on a
    // slow run or needlessly slow on a fast one. Bounded so a genuine stall
    // still fails the test rather than hanging.
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
          // A bounded credit record is a handful of scalar fields, not a
          // structure that grows with frame count.
          attachmentSize: viewerWs ? Object.keys(readTestAttachment(viewerWs)).length : -1,
          storedKeys: (await state.storage.list()).size,
        };
      },
    );
    expect(attachmentSize).toBeGreaterThan(0);
    expect(attachmentSize).toBeLessThan(10); // a small fixed set of fields, never one per frame
    expect(framesSkipped).toBe(499); // every frame after the first was withheld, tracked as a single counter
    expect(storedKeys).toBe(0); // still zero Durable Object storage writes
  });
});

describe('VideoRoom: no persistent storage', () => {
  it('never writes to Durable Object storage while frames flow', async () => {
    const robotId = freshRobotId();
    const { ws: publisher } = await open(`/video/${robotId}/publisher`);
    if (publisher === null) throw new Error('no websocket');
    const accepted = await waitForMessage(publisher, 'publisher.accepted');
    const { ws: viewer } = await open(`/video/${robotId}/viewer`);
    if (viewer === null) throw new Error('no websocket');
    await waitForMessage(viewer, 'stream', (s) => s.publisherOnline);

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
