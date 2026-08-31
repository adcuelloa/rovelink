/**
 * Builds a single (header, jpeg) frame pair from the checked-in fixture.
 * Pure and dependency-free (no socket, no timers): used by both the dev
 * publisher CLI (publisher-cli.ts, real cadence over a real WebSocket) and
 * the Durable Object integration tests (room.do.test.ts, which just need
 * valid frame pairs on demand without running a live simulator).
 */

import { VIDEO_PROTOCOL_VERSION, type VideoFrameHeader } from '@rovelink/protocol';

import { FIXTURE_HEIGHT, FIXTURE_WIDTH, loadFixtureFrame } from './fixture.ts';

export interface SimulatedFrameInput {
  readonly streamSessionId: string;
  readonly seq: number;
  readonly capturedAtMs: number;
}

export interface SimulatedFrame {
  readonly header: VideoFrameHeader;
  readonly jpeg: Uint8Array;
}

/** Same static fixture image on every call: 7B does not require
 * photorealistic or even changing imagery, only a real, valid JPEG a viewer
 * can genuinely decode (see fixture.ts). */
export function buildSimulatedFrame(input: SimulatedFrameInput): SimulatedFrame {
  const jpeg = loadFixtureFrame();
  const header: VideoFrameHeader = {
    v: VIDEO_PROTOCOL_VERSION,
    type: 'frame',
    streamSessionId: input.streamSessionId,
    seq: input.seq,
    capturedAtMs: input.capturedAtMs,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
    byteLength: jpeg.byteLength,
  };
  return { header, jpeg };
}
