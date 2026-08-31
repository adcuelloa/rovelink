/**
 * Entry worker for the video relay. Deliberately its own Worker, its own
 * package, its own `Env` — see wrangler.jsonc and the Problem 7B brief §1:
 * nothing here is reachable from, or shares state with, the control relay
 * (`@rovelink/relay`). It only decides which room a connection belongs to
 * and hands the request to the Durable Object; all relay logic lives in
 * `VideoRoom`.
 */

import { parseVideoRoute } from './route.ts';

export interface Env {
  readonly VIDEO_ROOMS: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'rovelink-video-relay' });
    }

    const route = parseVideoRoute(url.pathname);
    if (route === null) {
      return new Response('Use /video/<id>/publisher or /video/<id>/viewer', { status: 404 });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket connection expected', { status: 426 });
    }

    const room = env.VIDEO_ROOMS.get(env.VIDEO_ROOMS.idFromName(route.robotId));
    return room.fetch(request);
  },
};

export { VideoRoom } from './room.ts';
