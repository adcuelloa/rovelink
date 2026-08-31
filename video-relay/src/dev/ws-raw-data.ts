/**
 * Small helpers for the `ws` package's `RawData` type (`Buffer | ArrayBuffer
 * | Buffer[]`), used by both dev CLIs. Normalizes to `Uint8Array` and uses
 * only `ArrayBufferView`-level properties (`.buffer`/`.byteOffset`/
 * `.byteLength`, which `Buffer` inherits from `Uint8Array`) rather than any
 * `Buffer`-specific method — `Buffer`'s own methods do not always narrow
 * cleanly here across pnpm-deduped `@types/node` versions pulled in
 * transitively by `@types/ws`, but the `Uint8Array` contract it extends is
 * stable regardless.
 *
 * `ws` fragments a message into `Buffer[]` only in rare cases (fragmented
 * frames without an assembling option set); handled here defensively, not
 * because 7B's small frames are expected to trigger it.
 */

import type { RawData } from 'ws';

const textDecoder = new TextDecoder();

function toUint8Array(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) {
    const total = data.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of data) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export function rawDataToText(data: RawData): string {
  return textDecoder.decode(toUint8Array(data));
}

export function rawDataByteLength(data: RawData): number {
  return toUint8Array(data).byteLength;
}
