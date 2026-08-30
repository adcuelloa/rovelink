/**
 * `RobotRoom` behavior against the real Workers runtime (Durable Object
 * hibernation, `getWebSockets`, alarms): plain `node --test` cannot exercise
 * these APIs, so this file runs under @cloudflare/vitest-pool-workers
 * (`vitest run`) instead of `node --test` like route.test.ts.
 */

import type { RemoteMessage } from '@rovelink/protocol';
import { createControlFrame, JSON_CODEC, PROTOCOL_VERSION, SAFE_STATE } from '@rovelink/protocol';
import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { RobotRoom } from './room.ts';

type Role = 'device' | 'controller';

async function open(path: string): Promise<{ ws: WebSocket | null; response: Response }> {
  const response = await SELF.fetch(`https://relay.test${path}`, {
    headers: { Upgrade: 'websocket' },
  });
  const ws = response.webSocket ?? null;
  ws?.accept();
  return { ws, response };
}

function send(ws: WebSocket, message: RemoteMessage): void {
  ws.send(JSON_CODEC.encode(message));
}

function isMessageType<T extends RemoteMessage['type']>(
  message: RemoteMessage,
  type: T,
): message is Extract<RemoteMessage, { type: T }> {
  return message.type === type;
}

/** Resolves on the first message of `type` for which `predicate` holds,
 * ignoring any other traffic (e.g. unrelated `room` broadcasts) in between. */
function waitForMessage<T extends RemoteMessage['type']>(
  ws: WebSocket,
  type: T,
  predicate: (message: Extract<RemoteMessage, { type: T }>) => boolean = () => true,
): Promise<Extract<RemoteMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timed out waiting for "${type}"`)), 2000);
    const handler = (event: MessageEvent): void => {
      const raw = JSON_CODEC.decode(event.data);
      if (raw === null || !isMessageType(raw, type) || !predicate(raw)) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', handler);
      resolve(raw);
    };
    ws.addEventListener('message', handler);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }), {
      once: true,
    });
  });
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Backdates a role's lastSeenAt directly in storage, simulating a peer that
 * has gone silent for `ageMs`, without waiting out STALE_MS in real time. */
async function markSilentFor(robotId: string, role: Role, ageMs: number): Promise<void> {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
  await runInDurableObject(stub, (_instance: RobotRoom, state: DurableObjectState) => {
    for (const ws of state.getWebSockets(role)) {
      const attachment = ws.deserializeAttachment();
      ws.serializeAttachment({ ...attachment, lastSeenAt: Date.now() - ageMs });
    }
  });
}

/** Beyond both roles' staleness bounds (see room.ts STALE_MS). */
async function markStale(robotId: string, role: Role): Promise<void> {
  await markSilentFor(robotId, role, 120_000);
}

describe('RobotRoom: role occupancy', () => {
  it('accepts the first device', async () => {
    const { response } = await open('/robot/room-first-device/device');
    expect(response.status).toBe(101);
  });

  it('rejects a live duplicate device with 409', async () => {
    const { ws: first, response: firstResponse } = await open('/robot/room-dup-device/device');
    expect(firstResponse.status).toBe(101);
    expect(first).not.toBeNull();

    const { response: secondResponse } = await open('/robot/room-dup-device/device');
    expect(secondResponse.status).toBe(409);
  });

  it('accepts the first controller', async () => {
    const { response } = await open('/robot/room-first-controller/controller');
    expect(response.status).toBe(101);
  });

  it('rejects a live duplicate controller with 409', async () => {
    const { ws: first, response: firstResponse } = await open(
      '/robot/room-dup-controller/controller',
    );
    expect(firstResponse.status).toBe(101);
    expect(first).not.toBeNull();

    const { response: secondResponse } = await open('/robot/room-dup-controller/controller');
    expect(secondResponse.status).toBe(409);
  });
});

describe('RobotRoom: release on disconnect', () => {
  it('releases the role on a clean close', async () => {
    const robotId = 'room-clean-close';
    const { ws: first } = await open(`/robot/${robotId}/device`);
    expect(first).not.toBeNull();

    first?.close(1000, 'bye');
    await settle();

    const { response } = await open(`/robot/${robotId}/device`);
    expect(response.status).toBe(101);
  });

  it('releases the role after a socket error, same as a close', async () => {
    const robotId = 'room-error-release';
    const { ws: first, response: firstResponse } = await open(`/robot/${robotId}/device`);
    expect(firstResponse.status).toBe(101);
    expect(first).not.toBeNull();

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runInDurableObject(stub, (instance: RobotRoom, state: DurableObjectState) => {
      const [ws] = state.getWebSockets('device');
      if (ws) instance.webSocketError(ws);
    });

    const { response: secondResponse } = await open(`/robot/${robotId}/device`);
    expect(secondResponse.status).toBe(101);
  });

  it('forwards emergency-stop to the device when the controller disconnects', async () => {
    const robotId = 'room-emergency-on-close';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    expect(device).not.toBeNull();
    expect(controller).not.toBeNull();

    send(device!, { v: PROTOCOL_VERSION, type: 'device.register', robotId });
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.register', robotId });
    await settle();

    const emergency = waitForMessage(device!, 'emergency-stop');
    controller?.close(1000, 'bye');
    await expect(emergency).resolves.toMatchObject({ type: 'emergency-stop' });
  });

  it('updates presence after a close', async () => {
    const robotId = 'room-presence';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    expect(device).not.toBeNull();
    expect(controller).not.toBeNull();

    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.register', robotId });
    send(device!, { v: PROTOCOL_VERSION, type: 'device.register', robotId });
    await waitForMessage(controller!, 'room', (room) => room.deviceOnline);

    device?.close(1000, 'bye');
    const afterClose = await waitForMessage(controller!, 'room', (room) => !room.deviceOnline);
    expect(afterClose.deviceOnline).toBe(false);
  });
});

describe('RobotRoom: stale-role reclaim', () => {
  it('rejects a live (non-stale) duplicate rather than reclaiming', async () => {
    const robotId = 'room-live-not-stale';
    const { response: firstResponse } = await open(`/robot/${robotId}/device`);
    expect(firstResponse.status).toBe(101);

    const { response: secondResponse } = await open(`/robot/${robotId}/device`);
    expect(secondResponse.status).toBe(409);
  });

  it('reclaims a stale device role instead of returning 409', async () => {
    const robotId = 'room-stale-device';
    const { ws: first, response: firstResponse } = await open(`/robot/${robotId}/device`);
    expect(firstResponse.status).toBe(101);
    expect(first).not.toBeNull();
    send(first!, { v: PROTOCOL_VERSION, type: 'device.register', robotId });
    await settle();

    await markStale(robotId, 'device');

    const closed = waitForClose(first!);
    const { response: secondResponse } = await open(`/robot/${robotId}/device`);
    expect(secondResponse.status).toBe(101);
    await expect(closed).resolves.toMatchObject({ code: 4001 });
  });

  it('tolerates a controller gap that would already be stale for a device', async () => {
    // Regression test: a live browser tab was observed being evicted by the
    // sweep because Chrome throttles a backgrounded tab's ping timer well
    // past a bound sized for the nominal ~2s cadence. 30s exceeds the device
    // bound (6s) but must not exceed the controller's (90s).
    const robotId = 'room-controller-tolerance';
    const { ws: controller, response } = await open(`/robot/${robotId}/controller`);
    expect(response.status).toBe(101);
    expect(controller).not.toBeNull();
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.register', robotId });
    await settle();

    await markSilentFor(robotId, 'controller', 30_000);

    const { response: competing } = await open(`/robot/${robotId}/controller`);
    expect(competing.status).toBe(409);
  });

  it('eventually reclaims a controller that stays silent past its own bound', async () => {
    const robotId = 'room-controller-eventually-stale';
    const { ws: controller, response } = await open(`/robot/${robotId}/controller`);
    expect(response.status).toBe(101);
    expect(controller).not.toBeNull();
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.register', robotId });
    await settle();

    await markStale(robotId, 'controller');

    const { response: competing } = await open(`/robot/${robotId}/controller`);
    expect(competing.status).toBe(101);
  });

  it('evicts a stale socket via the alarm sweep with no competing connection', async () => {
    const robotId = 'room-sweep';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    expect(device).not.toBeNull();
    expect(controller).not.toBeNull();

    send(device!, { v: PROTOCOL_VERSION, type: 'device.register', robotId });
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.register', robotId });
    await settle();

    await markStale(robotId, 'device');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const afterSweep = await waitForMessage(controller!, 'room', (room) => !room.deviceOnline);
    expect(afterSweep.deviceOnline).toBe(false);
  });
});

describe('RobotRoom: registration-gated presence and forwarding', () => {
  it('does not forward control frames to an unregistered device', async () => {
    const robotId = 'room-unregistered-forward';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    expect(device).not.toBeNull();
    expect(controller).not.toBeNull();

    // Controller registers; device deliberately never does.
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.register', robotId });
    await settle();

    let received = false;
    device?.addEventListener('message', () => {
      received = true;
    });

    send(controller!, createControlFrame(SAFE_STATE, 1, Date.now()));
    await settle();

    expect(received).toBe(false);
  });

  it('does not count an unregistered socket toward presence', async () => {
    const robotId = 'room-unregistered-presence';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    expect(controller).not.toBeNull();
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.register', robotId });

    // Device connects but never registers.
    const { ws: device } = await open(`/robot/${robotId}/device`);
    expect(device).not.toBeNull();

    // No 'room' broadcast should ever report deviceOnline: true for this
    // socket, since it never registered. Send a harmless ping from the
    // controller to fetch the *current* state deterministically instead of
    // racing an announcement.
    send(controller!, { v: PROTOCOL_VERSION, type: 'ping', id: 1, sentAt: Date.now() });
    await waitForMessage(controller!, 'pong');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const deviceOnline = await runInDurableObject(
      stub,
      (_instance: RobotRoom, state: DurableObjectState) =>
        state.getWebSockets('device').some((ws) => ws.deserializeAttachment()?.registered === true),
    );
    expect(deviceOnline).toBe(false);
  });
});
