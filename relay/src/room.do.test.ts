/**
 * `RobotRoom` behavior against the real Workers runtime (Durable Object
 * hibernation, `getWebSockets`, alarms): plain `node --test` cannot exercise
 * these APIs, so this file runs under @cloudflare/vitest-pool-workers
 * (`vitest run`) instead of `node --test` like route.test.ts.
 *
 * Credentials: DEVICE_SECRET/CONTROLLER_SECRET are test-only fixtures
 * injected via `miniflare.bindings` in vitest.config.ts, not real secrets.
 */

import type { RemoteMessage } from '@rovelink/protocol';
import {
  CLOSE_CODE,
  createControlFrame,
  JSON_CODEC,
  PROTOCOL_VERSION,
  SAFE_STATE,
  verifyVideoTicket,
} from '@rovelink/protocol';
import { runDurableObjectAlarm, runInDurableObject, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import type { RobotRoom } from './room.ts';

type Role = 'device' | 'controller';

const VALID_DEVICE_TOKEN = 'test-device-secret';
const VALID_CONTROLLER_TOKEN = 'test-controller-secret';
const VIDEO_TICKET_SECRET = 'test-video-ticket-secret';

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

function registerDevice(ws: WebSocket, robotId: string, token?: string): void {
  send(ws, { v: PROTOCOL_VERSION, type: 'device.register', robotId, token });
}

function registerController(ws: WebSocket, robotId: string, token?: string): void {
  send(ws, { v: PROTOCOL_VERSION, type: 'controller.register', robotId, token });
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

/** Asserts a socket never receives another message before `settle()`
 * resolves: used to prove forwarding did NOT happen. */
function neverReceives(ws: WebSocket): () => boolean {
  let received = false;
  ws.addEventListener('message', () => {
    received = true;
  });
  return () => received;
}

/** Collects every decoded message a socket receives, in arrival order —
 * used where the ORDER between two message types matters (e.g.
 * controller.session must arrive before the first control frame it
 * covers), which waitForMessage alone can't establish. */
function collectMessages(ws: WebSocket): RemoteMessage[] {
  const messages: RemoteMessage[] = [];
  ws.addEventListener('message', (event: MessageEvent) => {
    const raw = JSON_CODEC.decode(event.data);
    if (raw !== null) messages.push(raw);
  });
  return messages;
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Backdates a role's lastSeenAt directly in storage, simulating a peer that
 * has gone silent for `ageMs`, without waiting out the real staleness or
 * registration-timeout bound in real time. */
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

async function isRegistered(robotId: string, role: Role): Promise<boolean> {
  const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
  return runInDurableObject(stub, (_instance: RobotRoom, state: DurableObjectState) =>
    state.getWebSockets(role).some((ws) => ws.deserializeAttachment()?.registered === true),
  );
}

describe('RobotRoom: connection accept', () => {
  it('accepts a device connection', async () => {
    const { response } = await open('/robot/room-first-device/device');
    expect(response.status).toBe(101);
  });

  it('accepts a controller connection', async () => {
    const { response } = await open('/robot/room-first-controller/controller');
    expect(response.status).toBe(101);
  });

  it('accepts a second, still-unauthenticated connection for the same role', async () => {
    // Occupancy is decided at registration time, not at accept time (see
    // #handleDeviceRegister / #handleControllerRegister): a pending socket
    // owns nothing, so a second connection attempt is never turned away at
    // the transport layer. Otherwise a legitimate authenticated device
    // reconnect could be blocked by a 409 before it ever got to prove
    // itself.
    const robotId = 'room-second-pending';
    const { response: first } = await open(`/robot/${robotId}/device`);
    const { response: second } = await open(`/robot/${robotId}/device`);
    expect(first.status).toBe(101);
    expect(second.status).toBe(101);
  });
});

describe('RobotRoom: device authentication', () => {
  it('registers a device with a valid token', async () => {
    const robotId = 'room-device-valid';
    const { ws } = await open(`/robot/${robotId}/device`);
    expect(ws).not.toBeNull();
    registerDevice(ws!, robotId, VALID_DEVICE_TOKEN);
    await settle();
    expect(await isRegistered(robotId, 'device')).toBe(true);
  });

  it('rejects a device with an invalid token', async () => {
    const robotId = 'room-device-invalid';
    const { ws } = await open(`/robot/${robotId}/device`);
    expect(ws).not.toBeNull();
    const closed = waitForClose(ws!);
    registerDevice(ws!, robotId, 'wrong-token');
    await expect(closed).resolves.toMatchObject({
      code: CLOSE_CODE.AUTH_FAILED,
      reason: 'auth-failed',
    });
    expect(await isRegistered(robotId, 'device')).toBe(false);
  });

  it('rejects a device with a missing token', async () => {
    const robotId = 'room-device-missing-token';
    const { ws } = await open(`/robot/${robotId}/device`);
    expect(ws).not.toBeNull();
    const closed = waitForClose(ws!);
    registerDevice(ws!, robotId, undefined);
    await expect(closed).resolves.toMatchObject({ code: CLOSE_CODE.AUTH_FAILED });
    expect(await isRegistered(robotId, 'device')).toBe(false);
  });

  it('never lets an invalid device evict the current, valid device', async () => {
    const robotId = 'room-device-invalid-cannot-evict';
    const { ws: valid } = await open(`/robot/${robotId}/device`);
    registerDevice(valid!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const { ws: attacker } = await open(`/robot/${robotId}/device`);
    const attackerClosed = waitForClose(attacker!);
    registerDevice(attacker!, robotId, 'wrong-token');
    await expect(attackerClosed).resolves.toMatchObject({ code: CLOSE_CODE.AUTH_FAILED });

    // The valid device's socket was never touched: still the only device,
    // still registered. The attacker's socket is gone, not merely demoted.
    expect(await isRegistered(robotId, 'device')).toBe(true);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const deviceCount = await runInDurableObject(
      stub,
      (_instance: RobotRoom, state: DurableObjectState) => state.getWebSockets('device').length,
    );
    expect(deviceCount).toBe(1);
  });

  it('an authenticated device reconnect replaces the old device immediately', async () => {
    const robotId = 'room-device-takeover';
    const { ws: oldDevice } = await open(`/robot/${robotId}/device`);
    registerDevice(oldDevice!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const oldClosed = waitForClose(oldDevice!);
    const { ws: newDevice } = await open(`/robot/${robotId}/device`);
    registerDevice(newDevice!, robotId, VALID_DEVICE_TOKEN);

    // No 409, no waiting for the 6s stale lease: the old socket is closed
    // as part of the same registration that authenticates the new one.
    await expect(oldClosed).resolves.toMatchObject({
      code: CLOSE_CODE.DEVICE_REPLACED,
      reason: 'replaced-by-authenticated-device',
    });
    await settle();
    expect(await isRegistered(robotId, 'device')).toBe(true);

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const deviceCount = await runInDurableObject(
      stub,
      (_instance: RobotRoom, state: DurableObjectState) => state.getWebSockets('device').length,
    );
    // The old socket is gone, not just demoted: exactly one device remains.
    expect(deviceCount).toBe(1);
  });

  it('the old device stops receiving control after replacement', async () => {
    const robotId = 'room-device-stops-after-replace';
    const { ws: oldDevice } = await open(`/robot/${robotId}/device`);
    registerDevice(oldDevice!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const firstFrame = waitForMessage(oldDevice!, 'control');
    send(controller!, createControlFrame(SAFE_STATE, 1, Date.now()));
    await expect(firstFrame).resolves.toMatchObject({ type: 'control' });

    const { ws: newDevice } = await open(`/robot/${robotId}/device`);
    registerDevice(newDevice!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const oldNeverAgain = neverReceives(oldDevice!);
    const nextOnNew = waitForMessage(newDevice!, 'control');
    send(controller!, createControlFrame(SAFE_STATE, 2, Date.now()));
    await expect(nextOnNew).resolves.toMatchObject({ type: 'control' });
    expect(oldNeverAgain()).toBe(false);
  });
});

describe('RobotRoom: controller authentication', () => {
  it('registers a controller with a valid token', async () => {
    const robotId = 'room-controller-valid';
    const { ws } = await open(`/robot/${robotId}/controller`);
    registerController(ws!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();
    expect(await isRegistered(robotId, 'controller')).toBe(true);
  });

  it('rejects a controller with an invalid token', async () => {
    const robotId = 'room-controller-invalid';
    const { ws } = await open(`/robot/${robotId}/controller`);
    const closed = waitForClose(ws!);
    registerController(ws!, robotId, 'wrong-token');
    await expect(closed).resolves.toMatchObject({
      code: CLOSE_CODE.AUTH_FAILED,
      reason: 'auth-failed',
    });
    expect(await isRegistered(robotId, 'controller')).toBe(false);
  });

  it('an unauthenticated socket never counts as online', async () => {
    const robotId = 'room-unregistered-presence';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);

    // Device connects but never registers.
    const { ws: device } = await open(`/robot/${robotId}/device`);
    expect(device).not.toBeNull();

    // Ping/pong is answered pre-registration (harmless RTT probe), so it is
    // a safe way to fetch current state deterministically instead of racing
    // an announcement.
    send(controller!, { v: PROTOCOL_VERSION, type: 'ping', id: 1, sentAt: Date.now() });
    await waitForMessage(controller!, 'pong');

    expect(await isRegistered(robotId, 'device')).toBe(false);
  });

  it('forwards nothing to an unauthenticated socket', async () => {
    const robotId = 'room-unregistered-forward';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);

    // Controller registers; device deliberately never does.
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const deviceNeverReceives = neverReceives(device!);
    send(controller!, createControlFrame(SAFE_STATE, 1, Date.now()));
    await settle();
    expect(deviceNeverReceives()).toBe(false);
  });

  it('telemetry is unavailable to an unauthenticated controller', async () => {
    const robotId = 'room-telemetry-unauth-controller';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    // Controller deliberately never registers.
    await settle();

    const controllerNeverReceives = neverReceives(controller!);
    send(device!, { v: PROTOCOL_VERSION, type: 'telemetry', sentAt: Date.now() });
    await settle();
    expect(controllerNeverReceives()).toBe(false);
  });

  it('a duplicate authenticated controller does not silently steal control', async () => {
    const robotId = 'room-controller-no-takeover';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controllerA } = await open(`/robot/${robotId}/controller`);
    registerController(controllerA!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const { ws: controllerB } = await open(`/robot/${robotId}/controller`);
    const bClosed = waitForClose(controllerB!);
    registerController(controllerB!, robotId, VALID_CONTROLLER_TOKEN);
    await expect(bClosed).resolves.toMatchObject({
      code: CLOSE_CODE.OCCUPIED,
      reason: 'controller-occupied',
    });

    // A is still authoritative: its control frames still reach the device.
    const frame = waitForMessage(device!, 'control');
    send(controllerA!, createControlFrame(SAFE_STATE, 1, Date.now()));
    await expect(frame).resolves.toMatchObject({ type: 'control' });
  });
});

describe('RobotRoom: registration timeout', () => {
  it('evicts a socket that never registers, via the alarm sweep', async () => {
    const robotId = 'room-registration-timeout';
    const { ws } = await open(`/robot/${robotId}/device`);
    expect(ws).not.toBeNull();

    // Past REGISTER_TIMEOUT_MS (5s) but well under any staleness bound —
    // this is specifically the "never registered" path, not a stale-peer
    // reclaim.
    await markSilentFor(robotId, 'device', 6000);

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const closed = waitForClose(ws!);
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await expect(closed).resolves.toMatchObject({
      code: CLOSE_CODE.REGISTRATION_TIMEOUT,
      reason: 'registration-timeout',
    });
  });

  it('a pending controller cannot block a legitimate operator for long', async () => {
    // Regression guard for the DoS this bound exists to close: before it
    // existed, an unauthenticated socket could occupy the controller slot
    // for the full 90s controller staleness window. Now occupancy is only
    // ever granted to a registered socket, so a pending one blocks nothing
    // at all — the legitimate operator registers immediately regardless.
    const robotId = 'room-controller-pending-no-dos';
    const { ws: attacker } = await open(`/robot/${robotId}/controller`);
    expect(attacker).not.toBeNull(); // never registers

    const { ws: operator } = await open(`/robot/${robotId}/controller`);
    registerController(operator!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();
    expect(await isRegistered(robotId, 'controller')).toBe(true);
  });
});

describe('RobotRoom: release on disconnect', () => {
  it('releases the device role on a clean close', async () => {
    const robotId = 'room-clean-close';
    const { ws: first } = await open(`/robot/${robotId}/device`);
    registerDevice(first!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    first?.close(1000, 'bye');
    await settle();

    const { ws: second, response } = await open(`/robot/${robotId}/device`);
    registerDevice(second!, robotId, VALID_DEVICE_TOKEN);
    await settle();
    expect(response.status).toBe(101);
    expect(await isRegistered(robotId, 'device')).toBe(true);
  });

  it('releases the role after a socket error, same as a close', async () => {
    const robotId = 'room-error-release';
    const { ws: first, response: firstResponse } = await open(`/robot/${robotId}/device`);
    expect(firstResponse.status).toBe(101);
    registerDevice(first!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runInDurableObject(stub, (instance: RobotRoom, state: DurableObjectState) => {
      const [ws] = state.getWebSockets('device');
      if (ws) instance.webSocketError(ws);
    });

    const { ws: second, response: secondResponse } = await open(`/robot/${robotId}/device`);
    registerDevice(second!, robotId, VALID_DEVICE_TOKEN);
    await settle();
    expect(secondResponse.status).toBe(101);
    expect(await isRegistered(robotId, 'device')).toBe(true);
  });

  it('forwards emergency-stop to the device when a registered controller disconnects', async () => {
    const robotId = 'room-emergency-on-close';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    expect(device).not.toBeNull();
    expect(controller).not.toBeNull();

    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const emergency = waitForMessage(device!, 'emergency-stop');
    controller?.close(1000, 'bye');
    await expect(emergency).resolves.toMatchObject({ type: 'emergency-stop' });
  });

  it('does not force an emergency-stop from an unregistered controller disconnecting', async () => {
    const robotId = 'room-no-emergency-unregistered';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    // Controller deliberately never registers.
    await settle();

    const deviceNeverReceives = neverReceives(device!);
    controller?.close(1000, 'bye');
    await settle();
    expect(deviceNeverReceives()).toBe(false);
  });

  it('updates presence after a close', async () => {
    const robotId = 'room-presence';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    expect(device).not.toBeNull();
    expect(controller).not.toBeNull();

    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await waitForMessage(controller!, 'room', (room) => room.deviceOnline);

    device?.close(1000, 'bye');
    const afterClose = await waitForMessage(controller!, 'room', (room) => !room.deviceOnline);
    expect(afterClose.deviceOnline).toBe(false);
  });
});

describe('RobotRoom: Problem 2 stale-lease behavior (regression)', () => {
  it('rejects a live (non-stale) duplicate controller rather than reclaiming', async () => {
    const robotId = 'room-live-not-stale';
    const { ws: first } = await open(`/robot/${robotId}/controller`);
    registerController(first!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const { ws: second } = await open(`/robot/${robotId}/controller`);
    const closed = waitForClose(second!);
    registerController(second!, robotId, VALID_CONTROLLER_TOKEN);
    await expect(closed).resolves.toMatchObject({ code: CLOSE_CODE.OCCUPIED });
  });

  it('reclaims a stale controller role instead of rejecting the newcomer', async () => {
    const robotId = 'room-stale-controller';
    const { ws: first } = await open(`/robot/${robotId}/controller`);
    registerController(first!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    await markStale(robotId, 'controller');

    const closed = waitForClose(first!);
    const { ws: second } = await open(`/robot/${robotId}/controller`);
    registerController(second!, robotId, VALID_CONTROLLER_TOKEN);
    await expect(closed).resolves.toMatchObject({
      code: CLOSE_CODE.OCCUPIED,
      reason: 'stale-role-reclaimed',
    });
    expect(await isRegistered(robotId, 'controller')).toBe(true);
  });

  it('tolerates a controller gap that would already be stale for a device', async () => {
    // Regression test: a live browser tab was observed being evicted because
    // Chrome throttles a backgrounded tab's ping timer well past a bound
    // sized for the nominal ~2s cadence. 30s exceeds the device bound (6s)
    // but must not exceed the controller's (90s).
    const robotId = 'room-controller-tolerance';
    const { ws: first } = await open(`/robot/${robotId}/controller`);
    registerController(first!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    await markSilentFor(robotId, 'controller', 30_000);

    const { ws: second } = await open(`/robot/${robotId}/controller`);
    const closed = waitForClose(second!);
    registerController(second!, robotId, VALID_CONTROLLER_TOKEN);
    await expect(closed).resolves.toMatchObject({
      code: CLOSE_CODE.OCCUPIED,
      reason: 'controller-occupied',
    });
    // The original, merely-throttled controller is still registered.
    expect(await isRegistered(robotId, 'controller')).toBe(true);
  });

  it('evicts a stale registered socket via the alarm sweep with no competing connection', async () => {
    const robotId = 'room-sweep';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    await markStale(robotId, 'device');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const closed = waitForClose(device!);
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    await expect(closed).resolves.toMatchObject({
      code: CLOSE_CODE.OCCUPIED,
      reason: 'stale-heartbeat-timeout',
    });

    const afterSweep = await waitForMessage(controller!, 'room', (room) => !room.deviceOnline);
    expect(afterSweep.deviceOnline).toBe(false);
  });
});

describe('RobotRoom: stale device is demoted logically, not by waiting on close (Problem 8A)', () => {
  it('demotes a stale registered device in the sweep itself, without needing its close to complete', async () => {
    const robotId = 'room-8a-device-immediate-demote';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();
    await markStale(robotId, 'device');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    // Deliberately not waiting on the device socket's own close event: the
    // assertion is that demotion does not depend on it.
    expect(await isRegistered(robotId, 'device')).toBe(false);
  });

  it('broadcasts deviceOnline:false from the sweep itself, without waiting for webSocketClose', async () => {
    const robotId = 'room-8a-device-announce-in-sweep';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await waitForMessage(controller!, 'room', (room) => room.deviceOnline);
    await markStale(robotId, 'device');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const offline = waitForMessage(controller!, 'room', (room) => !room.deviceOnline);
    await runDurableObjectAlarm(stub);
    // No waitForClose(device!) anywhere in this test: the room broadcast is
    // asserted to arrive from the sweep alone.
    await expect(offline).resolves.toMatchObject({ deviceOnline: false });
  });

  it('the demoted attachment reports unregistered even if the socket object is still enumerable', async () => {
    const robotId = 'room-8a-device-zombie-attachment';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();
    await markStale(robotId, 'device');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runDurableObjectAlarm(stub);

    // Whether or not the physical socket has actually finished closing by
    // this point (a truly dead peer can linger far longer than this test
    // environment ever reproduces — see alarm()'s doc comment), nothing
    // still enumerable under 'device' may claim to be a registered device.
    const stillClaimingRegistered = await runInDurableObject(
      stub,
      (_instance: RobotRoom, state: DurableObjectState) =>
        state.getWebSockets('device').some((ws) => ws.deserializeAttachment()?.registered === true),
    );
    expect(stillClaimingRegistered).toBe(false);
    expect(device).not.toBeNull();
  });

  it('a second sweep over an already-demoted stale device does not re-announce or re-log an eviction', async () => {
    const robotId = 'room-8a-device-idempotent-sweep';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();
    await markStale(robotId, 'device');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runDurableObjectAlarm(stub); // first sweep: demotes + announces

    // A controller registering only AFTER the first sweep already observes
    // the corrected state in its own registration-time announce.
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await waitForMessage(controller!, 'room', (room) => !room.deviceOnline);

    // The single close() the first sweep requested still completes exactly
    // once, firing webSocketClose() and its own (harmless, already-current)
    // re-announce — deterministically forced here rather than raced against
    // the real socket's async close, so it can be drained before asserting
    // silence below.
    await runInDurableObject(stub, (instance: RobotRoom) => {
      instance.webSocketClose(device!, CLOSE_CODE.OCCUPIED, 'stale-heartbeat-timeout');
    });
    await settle();

    const controllerReceivesNothingElse = neverReceives(controller!);
    await runDurableObjectAlarm(stub); // second sweep over the same socket
    await runDurableObjectAlarm(stub); // third, for good measure
    await settle();
    expect(controllerReceivesNothingElse()).toBe(false);
  });

  it('a belated webSocketClose on an already-demoted device does not knock a new replacement device offline', async () => {
    const robotId = 'room-8a-device-belated-close';
    const { ws: oldDevice } = await open(`/robot/${robotId}/device`);
    registerDevice(oldDevice!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    await markStale(robotId, 'device');
    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runDurableObjectAlarm(stub);
    await waitForMessage(controller!, 'room', (room) => !room.deviceOnline);

    const { ws: newDevice } = await open(`/robot/${robotId}/device`);
    registerDevice(newDevice!, robotId, VALID_DEVICE_TOKEN);
    await waitForMessage(controller!, 'room', (room) => room.deviceOnline);

    // The old device's close handler finally runs, long after being
    // demoted and long after a replacement already took over.
    await runInDurableObject(stub, (instance: RobotRoom) => {
      instance.webSocketClose(oldDevice!, CLOSE_CODE.OCCUPIED, 'stale-heartbeat-timeout');
    });
    await settle();

    expect(await isRegistered(robotId, 'device')).toBe(true);
  });
});

describe('RobotRoom: controller ping as a presence heartbeat (Problem 8A)', () => {
  it('a ping from a registered controller refreshes its lastSeenAt', async () => {
    const robotId = 'room-8a-ping-refresh-ctrl';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    // Right up against, but not past, the controller stale bound.
    await markSilentFor(robotId, 'controller', 89_000);
    send(controller!, { v: PROTOCOL_VERSION, type: 'ping', id: 1, sentAt: Date.now() });
    await waitForMessage(controller!, 'pong');

    // If the ping had not refreshed lastSeenAt, this socket would already
    // be past STALE_MS.controller and the sweep below would evict it.
    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runDurableObjectAlarm(stub);
    await settle();
    expect(await isRegistered(robotId, 'controller')).toBe(true);
  });

  it('repeated pings keep an idle, disarmed controller present well past the old 90s failure point', async () => {
    const robotId = 'room-8a-ping-idle-ctrl-alive';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    for (let i = 0; i < 3; i++) {
      await markSilentFor(robotId, 'controller', 89_000);
      send(controller!, { v: PROTOCOL_VERSION, type: 'ping', id: i, sentAt: Date.now() });
      await waitForMessage(controller!, 'pong', (pong) => pong.id === i);
      await runDurableObjectAlarm(stub);
    }
    await settle();
    // Three simulated near-90s gaps, each bridged by a ping: no control or
    // heartbeat frame was ever sent, only presence pings.
    expect(await isRegistered(robotId, 'controller')).toBe(true);
  });

  it("a controller ping does not refresh the device's lastSeenAt", async () => {
    const robotId = 'room-8a-ping-no-touch-device';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    await markStale(robotId, 'device');
    send(controller!, { v: PROTOCOL_VERSION, type: 'ping', id: 1, sentAt: Date.now() });
    await waitForMessage(controller!, 'pong');

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runDurableObjectAlarm(stub);
    await settle();
    // The controller's own ping must not have rescued the stale device.
    expect(await isRegistered(robotId, 'device')).toBe(false);
  });

  it('a ping from a pending, unregistered controller neither registers it nor rescues it from the registration timeout', async () => {
    const robotId = 'room-8a-ping-pending-unreg';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    // Deliberately never registers.
    send(controller!, { v: PROTOCOL_VERSION, type: 'ping', id: 1, sentAt: Date.now() });
    await waitForMessage(controller!, 'pong');
    expect(await isRegistered(robotId, 'controller')).toBe(false);

    await markSilentFor(robotId, 'controller', 6000); // past REGISTER_TIMEOUT_MS
    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    const closed = waitForClose(controller!);
    await runDurableObjectAlarm(stub);
    await expect(closed).resolves.toMatchObject({ code: CLOSE_CODE.REGISTRATION_TIMEOUT });
  });

  it('a pong echoes the same id and sentAt the ping carried', async () => {
    const robotId = 'room-8a-ping-pong-matches';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const sentAt = Date.now();
    const pong = waitForMessage(controller!, 'pong');
    send(controller!, { v: PROTOCOL_VERSION, type: 'ping', id: 42, sentAt });
    await expect(pong).resolves.toMatchObject({ id: 42, sentAt });
  });
});

describe('RobotRoom: control/E-stop ack forwarding (Problem 8A)', () => {
  it('forwards a control.ack from device to controller unchanged', async () => {
    const robotId = 'room-8a-ack-control-forward';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const ack = waitForMessage(controller!, 'control.ack');
    send(device!, {
      v: PROTOCOL_VERSION,
      type: 'control.ack',
      controlSessionId: 'session-a',
      seq: 5,
    });
    await expect(ack).resolves.toMatchObject({ controlSessionId: 'session-a', seq: 5 });
  });

  it('forwards an emergency-stop.ack from device to controller unchanged', async () => {
    const robotId = 'room-8a-ack-estop-forward';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const ack = waitForMessage(controller!, 'emergency-stop.ack');
    send(device!, { v: PROTOCOL_VERSION, type: 'emergency-stop.ack', sentAt: 1700000000000 });
    await expect(ack).resolves.toMatchObject({ sentAt: 1700000000000 });
  });

  it('a control.ack from a device counts as freshness evidence, keeping it from going stale', async () => {
    const robotId = 'room-8a-ack-refreshes-device';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    await markSilentFor(robotId, 'device', 5900); // just under STALE_MS.device (6000ms)
    send(device!, {
      v: PROTOCOL_VERSION,
      type: 'control.ack',
      controlSessionId: 'session-a',
      seq: 1,
    });

    const stub = env.ROOMS.get(env.ROOMS.idFromName(robotId));
    await runDurableObjectAlarm(stub);
    await settle();
    expect(await isRegistered(robotId, 'device')).toBe(true);
  });

  it('a control.ack sent by a controller (wrong role) is not forwarded anywhere', async () => {
    const robotId = 'room-8a-ack-wrong-role';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const deviceNeverReceives = neverReceives(device!);
    const controllerNeverReceivesAgain = neverReceives(controller!);
    send(controller!, {
      v: PROTOCOL_VERSION,
      type: 'control.ack',
      controlSessionId: 'session-a',
      seq: 1,
    });
    await settle();
    expect(deviceNeverReceives()).toBe(false);
    expect(controllerNeverReceivesAgain()).toBe(false);
  });

  it('an ack from an unregistered device is never forwarded', async () => {
    const robotId = 'room-8a-ack-unregistered-device';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    // Deliberately never registers.
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const controllerNeverReceives = neverReceives(controller!);
    send(device!, {
      v: PROTOCOL_VERSION,
      type: 'control.ack',
      controlSessionId: 'session-a',
      seq: 1,
    });
    await settle();
    expect(controllerNeverReceives()).toBe(false);
  });
});

describe('RobotRoom: session-scoped sequencing (Problem 4)', () => {
  it("sends controller.session to the device before that controller's first control frame", async () => {
    const robotId = 'room-session-order';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const messages = collectMessages(device!);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);

    const controlArrived = waitForMessage(device!, 'control');
    send(controller!, createControlFrame(SAFE_STATE, 1, Date.now()));
    await controlArrived;

    const sessionIndex = messages.findIndex((m) => m.type === 'controller.session');
    const controlIndex = messages.findIndex((m) => m.type === 'control');
    expect(sessionIndex).toBeGreaterThanOrEqual(0);
    expect(controlIndex).toBeGreaterThan(sessionIndex);
  });

  it('also sends controller.session to the newly-promoted controller itself, matching the device copy', async () => {
    // This is what lets the browser know its own registration is
    // authoritative (not merely accepted) — see
    // ControlSender.establishSessionBaseline() on the web side, which only
    // ever fires in direct response to this message.
    const robotId = 'room-session-to-ctrl';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    const deviceSession = waitForMessage(device!, 'controller.session');
    const controllerSession = waitForMessage(controller!, 'controller.session');
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);

    const [{ sessionId: idSeenByDevice }, { sessionId: idSeenByController }] = await Promise.all([
      deviceSession,
      controllerSession,
    ]);
    expect(idSeenByController).toBe(idSeenByDevice);
  });

  it('sends the currently-authoritative controller.session to a device that registers afterward', async () => {
    const robotId = 'room-session-late-device';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const { ws: device } = await open(`/robot/${robotId}/device`);
    const sessionMsg = waitForMessage(device!, 'controller.session');
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await expect(sessionMsg).resolves.toMatchObject({ type: 'controller.session', robotId });
  });

  it('mints a distinct controlSessionId for each new controller registration', async () => {
    const robotId = 'room-session-distinct';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const { ws: controllerA } = await open(`/robot/${robotId}/controller`);
    const sessionA = waitForMessage(device!, 'controller.session');
    registerController(controllerA!, robotId, VALID_CONTROLLER_TOKEN);
    const { sessionId: idA } = await sessionA;

    controllerA?.close(1000, 'bye');
    await settle();

    // Same robot, same credential, brand-new WebSocket: exactly the "fresh
    // page / new login / transient reconnect" case — all treated uniformly
    // as a new session, per the approved design.
    const { ws: controllerB } = await open(`/robot/${robotId}/controller`);
    const sessionB = waitForMessage(device!, 'controller.session', (m) => m.sessionId !== idA);
    registerController(controllerB!, robotId, VALID_CONTROLLER_TOKEN);
    const { sessionId: idB } = await sessionB;

    expect(idA).not.toBe(idB);
  });

  it("stamps forwarded control frames with the sender controller's session id", async () => {
    const robotId = 'room-session-stamp';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    const session = waitForMessage(device!, 'controller.session');
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    const { sessionId } = await session;

    const frame = waitForMessage(device!, 'control');
    send(controller!, createControlFrame(SAFE_STATE, 1, Date.now()));
    await expect(frame).resolves.toMatchObject({ type: 'control', controlSessionId: sessionId });
  });

  it('ignores a client-supplied controlSessionId and stamps its own instead', async () => {
    const robotId = 'room-session-no-client-auth';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    const session = waitForMessage(device!, 'controller.session');
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    const { sessionId } = await session;

    const forged = {
      ...createControlFrame(SAFE_STATE, 1, Date.now()),
      controlSessionId: 'attacker-forged-session',
    };
    const frame = waitForMessage(device!, 'control');
    send(controller!, forged);
    await expect(frame).resolves.toMatchObject({ controlSessionId: sessionId });
  });

  it('never sends controller.session to the device, or to itself, on behalf of a rejected controller', async () => {
    const robotId = 'room-session-rejected';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const deviceMessages = collectMessages(device!);
    const { ws: attacker } = await open(`/robot/${robotId}/controller`);
    const attackerMessages = collectMessages(attacker!);
    registerController(attacker!, robotId, 'wrong-token');
    await settle();

    expect(deviceMessages.some((m) => m.type === 'controller.session')).toBe(false);
    expect(deviceMessages.some((m) => m.type === 'control')).toBe(false);
    // A rejected controller must never receive a session it could use to
    // force-send a baseline that affects the robot — it only ever sees the
    // auth-failed close.
    expect(attackerMessages.some((m) => m.type === 'controller.session')).toBe(false);
  });

  it('forwards emergency-stop without a controlSessionId: it stays session-independent', async () => {
    const robotId = 'room-session-estop-indep';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const stop = waitForMessage(device!, 'emergency-stop');
    send(controller!, { v: PROTOCOL_VERSION, type: 'emergency-stop', sentAt: Date.now() });
    const received = await stop;
    expect('controlSessionId' in received).toBe(false);
  });

  it('forwards telemetry ackSessionId to the controller unchanged', async () => {
    const robotId = 'room-session-telemetry';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const telemetry = waitForMessage(controller!, 'telemetry');
    send(device!, {
      v: PROTOCOL_VERSION,
      type: 'telemetry',
      sentAt: Date.now(),
      ackSeq: 3,
      ackSessionId: 'device-reported-session',
    });
    await expect(telemetry).resolves.toMatchObject({
      ackSeq: 3,
      ackSessionId: 'device-reported-session',
    });
  });
});

describe('RobotRoom: video ticket issuance (Problem 7C)', () => {
  it('an unauthenticated (device-role) socket cannot request a ticket', async () => {
    const robotId = 'room-ticket-wrong-role';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    await settle();

    const deviceNeverReceives = neverReceives(device!);
    send(device!, { v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    await settle();
    expect(deviceNeverReceives()).toBe(false);
  });

  it('a pending (unregistered) controller cannot request a ticket', async () => {
    const robotId = 'room-ticket-pending';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    // Deliberately never registers.
    const controllerNeverReceives = neverReceives(controller!);
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    await settle();
    expect(controllerNeverReceives()).toBe(false);
  });

  it('an authenticated controller can request a ticket, scoped to its own robot', async () => {
    const robotId = 'room-ticket-valid';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const ticketPromise = waitForMessage(controller!, 'controller.videoTicket');
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    const response = await ticketPromise;
    expect(response.robotId).toBe(robotId);
    expect(typeof response.ticket).toBe('string');
    expect(response.expiresAt).toBeGreaterThan(Date.now());
  });

  it('a request cannot smuggle a different robotId: the ticket is always for the room the controller is authenticated to', async () => {
    const robotId = 'room-ticket-own-robot-only';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const ticketPromise = waitForMessage(controller!, 'controller.videoTicket');
    // The request type itself carries no robotId field at all (see
    // protocol.ts's VideoTicketRequest) — any extra field sent is simply
    // not part of the schema and cannot influence which robot the ticket
    // is minted for.
    send(controller!, {
      v: PROTOCOL_VERSION,
      type: 'controller.videoTicket.request',
      // @ts-expect-error deliberately sending an extra, non-schema field
      robotId: 'robot-99',
    });
    const response = await ticketPromise;
    expect(response.robotId).toBe(robotId);
  });

  it('the returned ticket verifies successfully at the video ticket verifier', async () => {
    const robotId = 'room-ticket-verifies';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const ticketPromise = waitForMessage(controller!, 'controller.videoTicket');
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    const response = await ticketPromise;

    const result = await verifyVideoTicket(
      response.ticket,
      VIDEO_TICKET_SECRET,
      { robotId, role: 'viewer' },
      Date.now(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.robotId).toBe(robotId);
  });

  it('a tampered copy of a real ticket fails the verifier', async () => {
    const robotId = 'room-ticket-tamper';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const ticketPromise = waitForMessage(controller!, 'controller.videoTicket');
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    const response = await ticketPromise;

    const tampered = `${response.ticket}x`;
    const result = await verifyVideoTicket(
      tampered,
      VIDEO_TICKET_SECRET,
      { robotId, role: 'viewer' },
      Date.now(),
    );
    expect(result.ok).toBe(false);
  });

  it('the ticket secret itself never appears in the response', async () => {
    const robotId = 'room-ticket-no-secret-leak';
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    await settle();

    const ticketPromise = waitForMessage(controller!, 'controller.videoTicket');
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    const response = await ticketPromise;

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(VIDEO_TICKET_SECRET);
    expect(serialized).not.toContain('VIDEO_TICKET_SECRET');
  });

  it('requesting a video ticket does not alter control session/seq/TTL state', async () => {
    const robotId = 'room-ticket-no-side-effect';
    const { ws: device } = await open(`/robot/${robotId}/device`);
    registerDevice(device!, robotId, VALID_DEVICE_TOKEN);
    const { ws: controller } = await open(`/robot/${robotId}/controller`);
    registerController(controller!, robotId, VALID_CONTROLLER_TOKEN);
    const session = await waitForMessage(device!, 'controller.session');
    await settle();

    // A control frame before the ticket request, to establish a baseline.
    const beforeFrame = waitForMessage(device!, 'control');
    send(controller!, createControlFrame(SAFE_STATE, 1, Date.now()));
    const before = await beforeFrame;
    expect(before.controlSessionId).toBe(session.sessionId);

    // Request a video ticket — pure side channel.
    const ticketPromise = waitForMessage(controller!, 'controller.videoTicket');
    send(controller!, { v: PROTOCOL_VERSION, type: 'controller.videoTicket.request' });
    await ticketPromise;

    // The control session must be exactly what it was before: no new
    // controller.session was issued, and subsequent control frames still
    // carry the SAME controlSessionId and continue the SAME seq stream.
    const afterFrame = waitForMessage(device!, 'control');
    send(controller!, createControlFrame(SAFE_STATE, 2, Date.now()));
    const after = await afterFrame;
    expect(after.controlSessionId).toBe(session.sessionId);
    expect(after.seq).toBe(2);
  });
});
