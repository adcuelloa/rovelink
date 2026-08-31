/**
 * Dev-only minimal viewer: authenticates with the CONTROL relay exactly the
 * way a real browser controller would (Problem 7C §20), gets a video
 * ticket, then connects to the video relay, registers with that ticket,
 * decodes the header/binary frame pairs, acks each one, and prints live
 * transport stats (Problem 7B brief §12/§18). Not the final RoveLink camera
 * UI — that is Problem 7D.
 *
 * AUTH FLOW: this CLI does NOT read VIDEO_TICKET_SECRET and does NOT mint
 * its own ticket — that would prove nothing about whether the real
 * control-relay issuance path works. It goes through control-client.ts:
 * register as a controller with CONTROLLER_SECRET, wait for
 * `controller.session` (proof of authentication), request a ticket, then
 * use that ticket to register as a video viewer. This is the exact
 * sequence a real browser tab will run once Problem 7D wires it into the
 * dashboard.
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
 * Env vars: VIDEO_RELAY_URL (default ws://localhost:8787), CONTROL_RELAY_URL
 * (default ws://localhost:8080), ROBOT_ID (default robot-01),
 * CONTROLLER_SECRET (required — the operator credential), DURATION_S
 * (default 15).
 */

import type { VideoFrameHeader } from '@rovelink/protocol';
import { isVideoMessage, VIDEO_PROTOCOL_VERSION } from '@rovelink/protocol';
import WebSocket from 'ws';

import { requestVideoTicketViaControl } from './control-client.ts';
import { VideoViewerStats } from './stats.ts';
import { nextViewerState, type ViewerConnectionState } from './viewer-state.ts';
import { rawDataByteLength, rawDataToText } from './ws-raw-data.ts';

const url = (process.env.VIDEO_RELAY_URL ?? 'ws://localhost:8787').replace(/\/+$/, '');
const controlRelayUrl = (process.env.CONTROL_RELAY_URL ?? 'ws://localhost:8080').replace(
  /\/+$/,
  '',
);
const robotId = process.env.ROBOT_ID ?? 'robot-01';
const controllerToken = process.env.CONTROLLER_SECRET ?? '';
const durationS = Number(process.env.DURATION_S ?? 15);

let state: ViewerConnectionState = 'connecting';
let pendingHeader: VideoFrameHeader | null = null;
const stats = new VideoViewerStats();

function transition(event: Parameters<typeof nextViewerState>[1]): void {
  const next = nextViewerState(state, event);
  if (next !== state) console.log(`[viewer] state: ${state} -> ${next}`);
  state = next;
}

function printFinal(stats_: VideoViewerStats, statsTimer: ReturnType<typeof setInterval>): void {
  clearInterval(statsTimer);
  console.log('[viewer] final snapshot:', stats_.snapshot(Date.now()));
}

async function main(): Promise<void> {
  console.log(
    `[viewer] CONTROLLER_SECRET configured: ${controllerToken.length > 0} (length ${controllerToken.length})`,
  );
  console.log(`[viewer] authenticating with control relay at ${controlRelayUrl} ...`);
  const { ticket, expiresAt } = await requestVideoTicketViaControl({
    controlRelayUrl,
    robotId,
    controllerToken,
  });
  console.log(
    `[viewer] got video ticket, expires in ${Math.round((expiresAt - Date.now()) / 1000)}s`,
  );

  console.log(`[viewer] connecting to ${url}/video/${robotId}/viewer`);
  const ws = new WebSocket(`${url}/video/${robotId}/viewer`);

  ws.on('open', () => {
    transition({ type: 'open' });
    ws.send(
      JSON.stringify({ v: VIDEO_PROTOCOL_VERSION, type: 'viewer.register', robotId, ticket }),
    );
  });

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

    // Ack-on-complete-receipt (see the module doc comment above for why
    // this is the 7B choice, and what 7D should re-measure). Releases this
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

  ws.on('close', (code, reason) => {
    console.log(`[viewer] closed code=${code} reason=${reason.toString()}`);
    transition({ type: 'close', willRetry: false });
    printFinal(stats, statsTimer);
    process.exit(0);
  });

  ws.on('error', (err) => console.error('[viewer] error', err));

  setTimeout(() => {
    console.log(`[viewer] ${durationS}s elapsed, closing...`);
    ws.close();
  }, durationS * 1000);

  process.on('SIGINT', () => {
    console.log('\n[viewer] Ctrl+C received, closing...');
    ws.close();
  });
}

main().catch((err: unknown) => {
  console.error('[viewer] failed to establish an authenticated video connection:', err);
  process.exit(1);
});
