/**
 * Loads the checked-in simulated-camera JPEG fixture used by the dev
 * publisher and by tests. Generated once (ImageMagick, 640x480, quality 80,
 * verified with Pillow — see fixtures/frame.jpg, the source image) to land
 * inside the ~15-30 KB/frame range the Problem 7A audit estimated for the
 * real AI-Thinker ESP32-CAM at VGA/quality-12 — this is a real, decodable
 * JPEG, not a synthetic placeholder, so a viewer exercising the actual
 * decode/render path (§7 of the Problem 7B brief) has something genuine to
 * decode. Not photorealistic camera footage: 7B does not require that.
 *
 * Embedded as base64 (fixtures/frame-base64.ts, generated from
 * fixtures/frame.jpg) rather than read from disk at runtime: this module
 * needs to work identically under plain Node (route/dev-helper unit tests),
 * the Cloudflare Workers/workerd sandbox (room.do.test.ts, which has no
 * real filesystem `readFileSync` could reach), and a real deploy. `atob` is
 * used instead of `node:buffer` for the same reason — it is a global in
 * both environments, not a Node-only API.
 */

import { FIXTURE_FRAME_BASE64 } from './fixtures/frame-base64.ts';

export const FIXTURE_WIDTH = 640;
export const FIXTURE_HEIGHT = 480;

let cached: Uint8Array | null = null;

function decode(): Uint8Array {
  const binary = atob(FIXTURE_FRAME_BASE64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Returns a fresh copy each call: callers are free to mutate their copy
 * without corrupting the module-level cache. */
export function loadFixtureFrame(): Uint8Array {
  if (cached === null) cached = decode();
  return cached.slice();
}
