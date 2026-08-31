/**
 * Canvas frame renderer (Problem 7D §11): binary JPEG -> Blob ->
 * `createImageBitmap()` -> `canvas.drawImage()`. Preferred over a Blob URL
 * `<img>` because `createImageBitmap()` gives an explicit decode-completion
 * point to key `viewer.ack` off (see video-transport.ts's ACK TIMING doc)
 * and never accumulates object URLs.
 *
 * DOM-only, like ui/instruments.ts — no unit tests here; verified live
 * (Problem 7D §22/§25).
 *
 * MEMORY: the previous frame's `ImageBitmap` is closed only AFTER the new
 * one has been painted, so there is a well-defined single hand-off point
 * rather than a window where two bitmaps are retained indefinitely — see
 * §25's "close/release previous ImageBitmap appropriately".
 */

import type { VideoFrameRenderer } from './video-transport.ts';

const supportsImageBitmap = typeof createImageBitmap === 'function';

export function createCanvasRenderer(canvas: HTMLCanvasElement): VideoFrameRenderer {
  const ctx = canvas.getContext('2d');
  let previousBitmap: ImageBitmap | null = null;
  let previousObjectUrl: string | null = null;

  async function renderViaImageBitmap(blob: Blob): Promise<boolean> {
    if (ctx === null) return false;
    const bitmap = await createImageBitmap(blob);
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    ctx.drawImage(bitmap, 0, 0);
    previousBitmap?.close();
    previousBitmap = bitmap;
    return true;
  }

  /** Fallback only if `createImageBitmap` is unavailable (Problem 7D §11) —
   * every evergreen browser RoveLink targets supports it, so this path is
   * not expected to run in practice. */
  function renderViaImg(blob: Blob): Promise<boolean> {
    if (ctx === null) return Promise.resolve(false);
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.addEventListener('load', () => {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        if (previousObjectUrl !== null) URL.revokeObjectURL(previousObjectUrl);
        previousObjectUrl = url;
        resolve(true);
      });
      img.addEventListener('error', () => {
        URL.revokeObjectURL(url);
        resolve(false);
      });
      img.src = url;
    });
  }

  return {
    async render(jpeg) {
      const blob = new Blob([jpeg.slice()], { type: 'image/jpeg' });
      try {
        return supportsImageBitmap ? await renderViaImageBitmap(blob) : await renderViaImg(blob);
      } catch {
        // A malformed/truncated JPEG the browser's own decoder rejects:
        // counted as a decode failure by video-transport.ts, not a crash.
        return false;
      }
    },
  };
}
