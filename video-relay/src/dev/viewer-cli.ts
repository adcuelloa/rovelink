/**
 * Dev-only minimal viewer: connects to a running video relay, decodes the
 * header/binary frame pairs, acks each one, and prints live transport stats
 * (Problem 7B brief §12/§18). Not the final RoveLink camera UI — that is
 * Problem 7D.
 *
 * ACK TIMING (Problem 7B.1 §10): acks as soon as the complete JPEG binary
 * has been received — NOT after decode/render, which this CLI does not do
 * at all (it never turns the bytes into an image, only measures transport).
 * That is sufficient to prove the transport-level credit protocol
 * (room.ts's `inFlight`/`viewer.ack`) works end to end. A real browser
 * viewer in Problem 7D has an extra stage this CLI doesn't: decoding and
 * painting the JPEG can itself be slower than receiving its bytes, so 7D
 * should measure whether acking here (receipt) still protects against a
 * rendering backlog, or whether it needs to ack after
 * decode/`requestAnimationFrame` instead. Not decided here — this CLI
 * intentionally implements only the simpler of the two.
 *
 * Env vars: VIDEO_RELAY_URL (default ws://localhost:8787), ROBOT_ID
 * (default robot-01), DURATION_S (default 15).
 */

import type { VideoFrameHeader } from '@rovelink/protocol';
import { isVideoMessage, VIDEO_PROTOCOL_VERSION } from '@rovelink/protocol';
import WebSocket from 'ws';

import { VideoViewerStats } from './stats.ts';
import { nextViewerState, type ViewerConnectionState } from './viewer-state.ts';
import { rawDataByteLength, rawDataToText } from './ws-raw-data.ts';

const url = (process.env.VIDEO_RELAY_URL ?? 'ws://localhost:8787').replace(/\/+$/, '');
const robotId = process.env.ROBOT_ID ?? 'robot-01';
const durationS = Number(process.env.DURATION_S ?? 15);

let state: ViewerConnectionState = 'connecting';
let pendingHeader: VideoFrameHeader | null = null;
const stats = new VideoViewerStats();

function transition(event: Parameters<typeof nextViewerState>[1]): void {
  const next = nextViewerState(state, event);
  if (next !== state) console.log(`[viewer] state: ${state} -> ${next}`);
  state = next;
}

console.log(`[viewer] connecting to ${url}/video/${robotId}/viewer`);
const ws = new WebSocket(`${url}/video/${robotId}/viewer`);

ws.on('open', () => transition({ type: 'open' }));

ws.on('message', (data, isBinary) => {
  if (!isBinary) {
    const parsed: unknown = JSON.parse(rawDataToText(data));
    if (!isVideoMessage(parsed)) return;
    if (parsed.type === 'stream') {
      transition({ type: 'stream-state', publisherOnline: parsed.publisherOnline });
      return;
    }
    if (parsed.type === 'frame') {
      pendingHeader = parsed;
    }
    return;
  }

  if (pendingHeader === null) return; // binary with no header: ignore (see room.ts)
  const header: VideoFrameHeader = pendingHeader;
  pendingHeader = null;
  stats.recordFrame({
    streamSessionId: header.streamSessionId,
    seq: header.seq,
    capturedAtMs: header.capturedAtMs,
    byteLength: rawDataByteLength(data),
    arrivedAtMs: Date.now(),
  });
  transition({ type: 'frame' });

  // Ack-on-complete-receipt (see the module doc comment above for why this
  // is the 7B choice, and what 7D should re-measure). Releases this
  // viewer's credit so the relay may send the next frame — see room.ts's
  // #handleViewerAck.
  ws.send(
    JSON.stringify({
      v: VIDEO_PROTOCOL_VERSION,
      type: 'viewer.ack',
      streamSessionId: header.streamSessionId,
      seq: header.seq,
    }),
  );
});

ws.on('close', (code, reason) => {
  console.log(`[viewer] closed code=${code} reason=${reason.toString()}`);
  transition({ type: 'close', willRetry: false });
  printFinal();
  process.exit(0);
});

ws.on('error', (err) => console.error('[viewer] error', err));

const statsTimer = setInterval(() => {
  const snap = stats.snapshot(Date.now());
  const age = stats.frameAgeMs(Date.now());
  console.log(
    `[viewer] state=${state} fps=${snap.fps.toFixed(1)} received=${snap.framesReceived} ` +
      `dropped=${snap.framesDropped} dup=${snap.duplicateFrames} ooo=${snap.outOfOrderFrames} ` +
      `bytesKB=${(snap.bytesReceived / 1024).toFixed(1)} lastLatencyMs=${snap.lastLatencyMs ?? 'n/a'} ` +
      `frameAgeMs=${age ?? 'n/a'} reconnects=${snap.reconnectCount}`,
  );
}, 2000);

function printFinal(): void {
  clearInterval(statsTimer);
  const snap = stats.snapshot(Date.now());
  console.log('[viewer] final snapshot:', snap);
}

setTimeout(() => {
  console.log(`[viewer] ${durationS}s elapsed, closing...`);
  ws.close();
}, durationS * 1000);

process.on('SIGINT', () => {
  console.log('\n[viewer] Ctrl+C received, closing...');
  ws.close();
});
