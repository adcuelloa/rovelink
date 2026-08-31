/**
 * Entry worker. It only decides which room the connection belongs to and passes
 * the request to the Durable Object; all the link logic lives in `RobotRoom`.
 */

import { parseRoute } from './route.ts';

export interface Env {
  readonly ROOMS: DurableObjectNamespace;
  /** Shared long-lived credential the ESP32 sends in `device.register`.
   * Single-robot MVP: one secret for the whole fleet. If multiple robot ids
   * become real, this must become per-robot (e.g. `DEVICE_SECRET_<ROBOT_ID>`
   * or a KV/D1-backed credential store) instead of one flat secret. */
  readonly DEVICE_SECRET: string;
  /** Shared operator credential sent in `controller.register`. Same
   * single-robot caveat as DEVICE_SECRET. */
  readonly CONTROLLER_SECRET: string;
  /** Shared ONLY with the video relay (`@rovelink/video-relay`), never
   * with the browser — signs short-lived video viewer tickets minted here
   * in response to `controller.videoTicket.request` (Problem 7C). Must be
   * set to the exact same value as the video relay's own
   * VIDEO_TICKET_SECRET, or every ticket this relay mints will fail
   * verification there. */
  readonly VIDEO_TICKET_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'rovelink-relay' });
    }

    const route = parseRoute(url.pathname);
    if (route === null) {
      return new Response('Use /robot/<id>/controller or /robot/<id>/device', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket connection expected', { status: 426 });
    }

    // The robot id names the room: all its sockets fall into the same object.
    const room = env.ROOMS.get(env.ROOMS.idFromName(route.robotId));
    return room.fetch(request);
  },
};

export { RobotRoom } from './room.ts';
