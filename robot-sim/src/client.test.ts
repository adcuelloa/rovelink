/**
 * Wire-level tests for `RobotSimClient` against a fake relay (a local
 * `WebSocketServer`, not the real Cloudflare relay — that's covered by
 * manual demo verification). Exercises exactly what `device-state.test.ts`
 * cannot: what actually goes on the socket — `device.register`,
 * `controller.session` handling, `control.ack`/`emergency-stop.ack` framing,
 * telemetry shape/cadence, unresponsive suppression, and reconnect.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import { isRemoteMessage, PROTOCOL_VERSION } from '@rovelink/protocol';
import type { RemoteMessage } from '@rovelink/protocol';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket as WsSocket } from 'ws';

import { RobotSimClient } from './client.ts';

interface FakeRelay {
  readonly url: string;
  readonly server: WebSocketServer;
  nextConnection(): Promise<WsSocket>;
  close(): Promise<void>;
}

async function startFakeRelay(): Promise<FakeRelay> {
  const server = new WebSocketServer({ port: 0 });
  await once(server, 'listening');
  const address = server.address();
  if (typeof address === 'string' || address === null) {
    throw new Error('unexpected server address');
  }
  const url = `ws://127.0.0.1:${address.port}`;

  return {
    url,
    server,
    nextConnection: () => new Promise<WsSocket>((resolve) => server.once('connection', resolve)),
    close: async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

function toText(data: RawData): string {
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return data.toString('utf8');
}

function parseMessage(data: RawData): RemoteMessage {
  const parsed: unknown = JSON.parse(toText(data));
  assert.ok(isRemoteMessage(parsed), 'test sent/received a value that fails isRemoteMessage');
  return parsed;
}

function nextMessage(socket: WsSocket): Promise<RemoteMessage> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(parseMessage(data));
    });
  });
}

async function collectMessages(
  socket: WsSocket,
  count: number,
  timeoutMs = 2000,
): Promise<RemoteMessage[]> {
  const messages: RemoteMessage[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timed out waiting for ${count} messages, got ${messages.length}`)),
      timeoutMs,
    );
    socket.on('message', (data) => {
      messages.push(parseMessage(data));
      if (messages.length >= count) {
        clearTimeout(timer);
        resolve(messages);
      }
    });
  });
}

const silentLog = (): void => {};

test('sends device.register with the configured secret immediately on connect', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'test-secret',
    log: silentLog,
  });
  try {
    client.connect();
    const socket = await relay.nextConnection();
    const message = await nextMessage(socket);
    assert.equal(message.type, 'device.register');
    if (message.type !== 'device.register') return;
    assert.equal(message.robotId, 'robot-01');
    assert.equal(message.token, 'test-secret');
    assert.equal(message.v, PROTOCOL_VERSION);
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('a room broadcast (proof of registration) moves status to online', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    log: silentLog,
  });
  try {
    client.connect();
    const socket = await relay.nextConnection();
    await nextMessage(socket); // device.register
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'room',
        robotId: 'robot-01',
        deviceOnline: true,
        controllerOnline: false,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(client.status().connection, 'online');
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('control lifecycle: baseline gate, armed drive, and control.ack framing', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    log: silentLog,
  });
  try {
    client.connect();
    const socket = await relay.nextConnection();
    await nextMessage(socket); // device.register

    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'controller.session',
        robotId: 'robot-01',
        sessionId: 'sess-1',
      }),
    );

    // Armed=true before baseline: rejected, no ack.
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'control',
        seq: 1,
        sentAt: Date.now(),
        ttlMs: 500,
        throttle: 0.5,
        steering: 0,
        gripper: 'idle',
        armed: true,
        controlSessionId: 'sess-1',
      }),
    );

    // Baseline-establishing disarmed frame: acked.
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'control',
        seq: 2,
        sentAt: Date.now(),
        ttlMs: 500,
        throttle: 0,
        steering: 0,
        gripper: 'idle',
        armed: false,
        controlSessionId: 'sess-1',
      }),
    );
    const baselineAck = await nextMessage(socket);
    assert.deepEqual(baselineAck, {
      v: PROTOCOL_VERSION,
      type: 'control.ack',
      controlSessionId: 'sess-1',
      seq: 2,
    });

    // Now an armed frame drives and acks.
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'control',
        seq: 3,
        sentAt: Date.now(),
        ttlMs: 500,
        throttle: 0.75,
        steering: -0.25,
        gripper: 'open',
        armed: true,
        controlSessionId: 'sess-1',
      }),
    );
    const driveAck = await nextMessage(socket);
    assert.deepEqual(driveAck, {
      v: PROTOCOL_VERSION,
      type: 'control.ack',
      controlSessionId: 'sess-1',
      seq: 3,
    });
    assert.equal(client.status().device.control.armed, true);
    assert.equal(client.status().device.control.throttle, 0.75);
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('emergency-stop is always acked immediately, never delayed by ackDelayMs', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    ackDelayMs: 5000,
    log: silentLog,
  });
  try {
    client.connect();
    const socket = await relay.nextConnection();
    await nextMessage(socket); // device.register

    const sentAt = Date.now();
    const startedWaiting = Date.now();
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'emergency-stop', sentAt }));
    const ack = await nextMessage(socket);
    const elapsed = Date.now() - startedWaiting;

    assert.deepEqual(ack, { v: PROTOCOL_VERSION, type: 'emergency-stop.ack', sentAt });
    assert.ok(elapsed < 1000, `E-stop ack took ${elapsed}ms — must not be delayed by ackDelayMs`);
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('a normal control.ack IS delayed by the configured ackDelayMs', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    ackDelayMs: 150,
    log: silentLog,
  });
  try {
    client.connect();
    const socket = await relay.nextConnection();
    await nextMessage(socket); // device.register
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'controller.session',
        robotId: 'robot-01',
        sessionId: 'sess-1',
      }),
    );

    const sentBaselineAt = Date.now();
    socket.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: 'control',
        seq: 1,
        sentAt: Date.now(),
        ttlMs: 500,
        throttle: 0,
        steering: 0,
        gripper: 'idle',
        armed: false,
        controlSessionId: 'sess-1',
      }),
    );
    await nextMessage(socket);
    const elapsed = Date.now() - sentBaselineAt;
    assert.ok(elapsed >= 140, `control.ack arrived after ${elapsed}ms, expected >= ~150ms delay`);
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('telemetry has the expected shape and cadence', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    telemetryMs: 30,
    log: silentLog,
  });
  try {
    client.connect();
    const socket = await relay.nextConnection();
    await nextMessage(socket); // device.register

    const messages = await collectMessages(socket, 2);
    for (const message of messages) {
      assert.equal(message.type, 'telemetry');
      if (message.type !== 'telemetry') continue;
      assert.equal(typeof message.sentAt, 'number');
      assert.equal(message.ackSeq, -1);
      assert.equal(message.ackSessionId, '');
      assert.equal(typeof message.rssi, 'number');
      assert.equal(message.armed, false);
    }
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('unresponsive suppresses telemetry and acks while the socket stays open; resume restores them', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    telemetryMs: 30,
    log: silentLog,
  });
  try {
    client.connect();
    const socket = await relay.nextConnection();
    await nextMessage(socket); // device.register

    client.pauseOutput();
    let sawMessageWhilePaused = false;
    const onMessage = (): void => {
      sawMessageWhilePaused = true;
    };
    socket.on('message', onMessage);
    await new Promise((resolve) => setTimeout(resolve, 120));
    socket.off('message', onMessage);
    assert.equal(sawMessageWhilePaused, false, 'no device-originated message while unresponsive');
    assert.equal(
      socket.readyState,
      1 /* OPEN */,
      'socket stays physically open while unresponsive',
    );

    client.resumeOutput();
    const [message] = await collectMessages(socket, 1);
    assert.ok(message);
    assert.equal(message.type, 'telemetry');
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('an explicit disconnect() does not auto-reconnect', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    log: silentLog,
  });
  try {
    client.connect();
    await relay.nextConnection();
    client.disconnect();

    let reconnected = false;
    const onConnection = (): void => {
      reconnected = true;
    };
    relay.server.on('connection', onConnection);
    await new Promise((resolve) => setTimeout(resolve, 1300));
    relay.server.off('connection', onConnection);
    assert.equal(reconnected, false);
    assert.equal(client.status().connection, 'disconnected');
  } finally {
    client.shutdown();
    await relay.close();
  }
});

test('a relay-initiated close triggers reconnect with backoff', async () => {
  const relay = await startFakeRelay();
  const client = new RobotSimClient({
    relayUrl: relay.url,
    robotId: 'robot-01',
    deviceSecret: 'secret',
    log: silentLog,
  });
  try {
    client.connect();
    const first = await relay.nextConnection();
    await nextMessage(first); // device.register
    first.close(4003, 'auth-failed');

    const second = await relay.nextConnection();
    const message = await nextMessage(second);
    assert.equal(message.type, 'device.register');
  } finally {
    client.shutdown();
    await relay.close();
  }
});
