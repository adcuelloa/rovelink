/**
 * Dev-only simulated camera publisher. Connects outbound to a running video
 * relay (`wrangler dev` locally, or a deployed Worker) exactly the way a
 * real ESP32-CAM eventually would: no physical camera required (Problem 7B
 * brief §7).
 *
 * Uses the `ws` package (not the global browser-style `WebSocket`)
 * specifically for its per-message send callback: it is the only
 * send-completion signal available anywhere in this stack (see the
 * backpressure doc comment in room.ts — the Cloudflare-side WebSocket gives
 * none at all). That lets this publisher demonstrate a REAL publisher-side
 * latest-frame-wins policy: if the previous frame's binary hasn't finished
 * writing to the socket by the time the next tick fires, this tick is
 * skipped rather than queued — never "catch up" by sending a backlog of
 * stale frames.
 *
 * Env vars: VIDEO_RELAY_URL (default ws://localhost:8787), ROBOT_ID
 * (default robot-01), FPS (default 10), DURATION_S (default: run until
 * Ctrl+C).
 */

import { isVideoMessage } from '@rovelink/protocol';
import WebSocket from 'ws';

import { buildSimulatedFrame } from './simulated-frame.ts';
import { rawDataToText } from './ws-raw-data.ts';

const url = (process.env.VIDEO_RELAY_URL ?? 'ws://localhost:8787').replace(/\/+$/, '');
const robotId = process.env.ROBOT_ID ?? 'robot-01';
const fps = Number(process.env.FPS ?? 10);
const durationS = process.env.DURATION_S !== undefined ? Number(process.env.DURATION_S) : null;
const intervalMs = 1000 / fps;

let streamSessionId: string | null = null;
let seq = 0;
let sending = false;
let sentFrames = 0;
let skippedFrames = 0;
let sentBytes = 0;
const startedAt = Date.now();
let tickTimer: ReturnType<typeof setInterval> | null = null;

console.log(`[publisher] connecting to ${url}/video/${robotId}/publisher (target ${fps} fps)`);
const ws = new WebSocket(`${url}/video/${robotId}/publisher`);

ws.on('open', () => console.log('[publisher] socket open, awaiting publisher.accepted...'));

ws.on('message', (data) => {
  const parsed: unknown = JSON.parse(rawDataToText(data));
  if (!isVideoMessage(parsed)) return;

  if (parsed.type === 'publisher.accepted') {
    streamSessionId = parsed.streamSessionId;
    console.log(`[publisher] accepted, streamSessionId=${streamSessionId}`);
    tickTimer = setInterval(tick, intervalMs);
    if (durationS !== null) setTimeout(stop, durationS * 1000);
    return;
  }
  if (parsed.type === 'publisher.rejected') {
    console.error(`[publisher] rejected: ${parsed.reason}`);
    process.exit(1);
  }
});

ws.on('close', (code, reason) => {
  console.log(`[publisher] closed code=${code} reason=${reason.toString()}`);
  report();
  process.exit(0);
});

ws.on('error', (err) => console.error('[publisher] error', err));

function tick(): void {
  if (streamSessionId === null) return;
  if (sending) {
    // Publisher-side latest-frame-wins (Problem 7B brief §5/§7): the
    // previous frame's binary hasn't finished writing yet, so this tick is
    // dropped rather than queued behind it.
    skippedFrames += 1;
    return;
  }
  seq += 1;
  const { header, jpeg } = buildSimulatedFrame({ streamSessionId, seq, capturedAtMs: Date.now() });
  sending = true;
  ws.send(JSON.stringify(header));
  ws.send(jpeg, () => {
    sending = false;
  });
  sentFrames += 1;
  sentBytes += jpeg.byteLength;
}

function report(): void {
  const elapsedS = (Date.now() - startedAt) / 1000;
  console.log(
    `[publisher] frames sent=${sentFrames} skipped=${skippedFrames} bytes=${sentBytes} ` +
      `elapsed=${elapsedS.toFixed(1)}s avgFps=${(sentFrames / elapsedS).toFixed(2)} ` +
      `avgKBps=${(sentBytes / 1024 / elapsedS).toFixed(1)}`,
  );
}

function stop(): void {
  if (tickTimer !== null) clearInterval(tickTimer);
  ws.close();
}

process.on('SIGINT', () => {
  console.log('\n[publisher] Ctrl+C received, closing...');
  stop();
});
