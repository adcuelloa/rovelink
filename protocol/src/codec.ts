/**
 * Remote protocol serialization.
 *
 * Today it is JSON. The rest of the application only knows this interface, so
 * switching to a binary frame (ArrayBuffer) later does not touch the browser
 * transport, the relay, or the UI.
 */

import type { RemoteMessage } from './protocol.ts';
import { isRemoteMessage } from './protocol.ts';

/** What can arrive over a WebSocket, in browser or Node. */
export type RawData = string | ArrayBuffer | Uint8Array;

export interface RemoteCodec {
  readonly name: string;
  encode(message: RemoteMessage): string | ArrayBuffer;
  /** Returns `null` if the data is not a valid message for this version. */
  decode(data: RawData): RemoteMessage | null;
}

const textDecoder = new TextDecoder();

function toRawText(data: RawData): string {
  if (typeof data === 'string') return data;
  return textDecoder.decode(data);
}

export const JSON_CODEC: RemoteCodec = {
  name: 'json',

  encode(message) {
    return JSON.stringify(message);
  },

  decode(data) {
    let value: unknown;
    try {
      value = JSON.parse(toRawText(data));
    } catch {
      return null;
    }
    return isRemoteMessage(value) ? value : null;
  },
};
