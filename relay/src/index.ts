/**
 * Entry worker. It only decides which room the connection belongs to and passes
 * the request to the Durable Object; all the link logic lives in `RobotRoom`.
 */

import { parseRoute } from './route.ts';

export interface Env {
  readonly ROOMS: DurableObjectNamespace;
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
