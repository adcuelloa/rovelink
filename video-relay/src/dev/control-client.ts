/**
 * Minimal dev-only CONTROL relay client — speaks just enough of
 * `@rovelink/protocol`'s control protocol to authenticate as a controller
 * and request a video viewer ticket (Problem 7C §20).
 *
 * This exists so the dev viewer CLI can exercise the REAL production
 * authority flow (control auth -> ticket request -> video viewer
 * registration) instead of being handed VIDEO_TICKET_SECRET directly and
 * minting its own ticket, which would prove nothing about whether the
 * actual control-relay-issuance path works. Nothing here is part of the
 * video relay itself — it is a standalone dev tool that happens to import
 * shared protocol types, exactly like a real browser controller would.
 */

import { isRemoteMessage, PROTOCOL_VERSION } from '@rovelink/protocol';
import WebSocket from 'ws';

import { rawDataToText } from './ws-raw-data.ts';

export interface VideoTicketFromControl {
  readonly ticket: string;
  readonly expiresAt: number;
}

export interface RequestVideoTicketOptions {
  readonly controlRelayUrl: string;
  readonly robotId: string;
  readonly controllerToken: string;
  readonly timeoutMs?: number;
}

/**
 * Connects to the control relay as a controller, authenticates, requests a
 * video ticket, and disconnects — the exact sequence a real browser tab
 * would run before opening its video viewer socket. Rejects (never hangs
 * forever) on auth failure, a relay-side close, or a timeout.
 */
export function requestVideoTicketViaControl(
  opts: RequestVideoTicketOptions,
): Promise<VideoTicketFromControl> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const url = `${opts.controlRelayUrl.replace(/\/+$/, '')}/robot/${opts.robotId}/controller`;
    const ws = new WebSocket(url);

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      ws.close();
      reject(new Error(`timed out waiting for control auth + video ticket from ${url}`));
    }, opts.timeoutMs ?? 10_000);

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          type: 'controller.register',
          robotId: opts.robotId,
          token: opts.controllerToken,
        }),
      );
    });

    ws.on('message', (data) => {
      const parsed: unknown = JSON.parse(rawDataToText(data));
      if (!isRemoteMessage(parsed)) return;

      if (parsed.type === 'controller.session') {
        // Authenticated (see relay/src/room.ts #handleControllerRegister):
        // now ask for the ticket.
        ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' }));
        return;
      }
      if (parsed.type === 'controller.videoTicket') {
        finish(() => {
          ws.close();
          resolve({ ticket: parsed.ticket, expiresAt: parsed.expiresAt });
        });
      }
    });

    ws.on('close', (code, reason) => {
      finish(() =>
        reject(
          new Error(
            `control relay closed before issuing a ticket (code=${code} reason=${reason.toString()})`,
          ),
        ),
      );
    });

    ws.on('error', (err) => finish(() => reject(err)));
  });
}
