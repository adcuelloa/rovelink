/**
 * Durable Object `RobotRoom`: a relay and nothing more.
 *
 * It does not interpret the robot's physics, does not store driving state and
 * does not keep queues: a frame that cannot be delivered is useless, because by
 * the time it arrived there would be a newer one. Uses the WebSocket Hibernation
 * API, so the room can sleep between packets without closing connections.
 */

import type { RemoteMessage, Role } from '@rovelink/protocol';
import { JSON_CODEC, PROTOCOL_VERSION } from '@rovelink/protocol';

import { parseRoute } from './route.ts';

/** The role is already occupied by another socket. */
const CLOSE_OCCUPIED = 4001;

interface Attachment {
  readonly robotId: string;
  readonly role: Role;
}

function readAttachment(ws: WebSocket): Attachment | null {
  const attachment: unknown = ws.deserializeAttachment();
  if (typeof attachment !== 'object' || attachment === null) return null;
  const possible = attachment as Partial<Attachment>;
  if (typeof possible.robotId !== 'string') return null;
  if (possible.role !== 'controller' && possible.role !== 'device') return null;
  return { robotId: possible.robotId, role: possible.role };
}

export class RobotRoom implements DurableObject {
  readonly #state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.#state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const route = parseRoute(new URL(request.url).pathname);
    if (route === null) return new Response('unknown route', { status: 404 });

    // One device per robot and, for now, one active controller.
    if (this.#getSockets(route.role).length > 0) {
      return new Response(`there is already a ${route.role} in ${route.robotId}`, { status: 409 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // With `acceptWebSocket` (not `accept`) the room can hibernate: the tags
    // and the attachment survive the sleep, instance variables do not.
    this.#state.acceptWebSocket(server, [route.role]);
    server.serializeAttachment({ robotId: route.robotId, role: route.role } satisfies Attachment);
    this.#announceRoom(route.robotId);

    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    const attachment = readAttachment(ws);
    if (attachment === null) return;

    const message = JSON_CODEC.decode(data);
    // Anything that is not protocol is not forwarded: the other end would not
    // understand it.
    if (message === null) return;

    if (message.type === 'ping') {
      // The pong is answered by the relay: it measures the RTT to the edge,
      // which is what decides whether the link is usable for driving.
      this.#send(ws, {
        v: PROTOCOL_VERSION,
        type: 'pong',
        id: message.id,
        sentAt: message.sentAt,
        echoAt: Date.now(),
      });
      return;
    }

    if (attachment.role === 'controller') {
      if (message.type === 'controller.register') {
        this.#announceRoom(attachment.robotId);
        return;
      }
      if (message.type === 'control' || message.type === 'emergency-stop') {
        this.#forward('device', message);
      }
      return;
    }

    if (message.type === 'device.register') {
      this.#announceRoom(attachment.robotId);
      return;
    }
    if (message.type === 'telemetry') this.#forward('controller', message);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    const attachment = readAttachment(ws);
    ws.close(code === CLOSE_OCCUPIED ? code : 1000, reason);
    if (attachment === null) return;

    // Without a controller there is no one to drive: the vehicle must brake
    // on its own, without waiting for its TTL to expire.
    if (attachment.role === 'controller') {
      this.#forward('device', {
        v: PROTOCOL_VERSION,
        type: 'emergency-stop',
        sentAt: Date.now(),
        reason: 'controller-disconnected',
      });
    }
    this.#announceRoom(attachment.robotId, ws);
  }

  webSocketError(ws: WebSocket): void {
    this.webSocketClose(ws, 1011, 'websocket error');
  }

  #getSockets(role: Role): WebSocket[] {
    return this.#state.getWebSockets(role);
  }

  #forward(role: Role, message: RemoteMessage): void {
    for (const target of this.#getSockets(role)) this.#send(target, message);
  }

  #send(ws: WebSocket, message: RemoteMessage): void {
    try {
      ws.send(JSON_CODEC.encode(message));
    } catch {
      // Socket already closed: nothing to save or retry.
    }
  }

  /** Publishes presence to both ends, skipping the one that is leaving. */
  #announceRoom(robotId: string, leaving?: WebSocket): void {
    const alive = (role: Role): WebSocket[] =>
      this.#getSockets(role).filter((ws) => ws !== leaving);

    const message: RemoteMessage = {
      v: PROTOCOL_VERSION,
      type: 'room',
      robotId,
      deviceOnline: alive('device').length > 0,
      controllerOnline: alive('controller').length > 0,
    };

    for (const ws of [...alive('controller'), ...alive('device')]) this.#send(ws, message);
  }
}
