import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ControlEngine } from '@rovelink/web/src/control/engine.ts';
import { ControlSender } from '@rovelink/web/src/transport/sender.ts';
import type { TransportEvent } from '@rovelink/web/src/transport/types.ts';

import { SimulatedTransport } from './simulated-transport.ts';

function withClock() {
  let now = 0;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('ControlEngine + ControlSender (real, unmodified production classes) can drive the simulated transport end to end', async () => {
  const clock = withClock();
  const transport = new SimulatedTransport('robot-01', { latencyMs: 0 }, clock.now);
  const events: TransportEvent[] = [];
  transport.subscribe((e) => events.push(e));

  await transport.connect();
  assert.ok(events.some((e) => e.kind === 'session-established'));

  const engine = new ControlEngine();
  const sender = new ControlSender(transport, { now: clock.now, heartbeatMs: 150, hzMax: 30 });
  engine.subscribe(({ state }) => sender.update(state));

  // Establish the disarmed baseline exactly like control-view.ts does in
  // response to 'session-established'.
  sender.establishSessionBaseline();

  engine.arm(true);
  engine.axes(0.8, 0);

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.ok(events.some((e) => e.kind === 'control-rtt'));
  transport.disconnect();
});

test('cutting the connection drops in-flight frames instead of delivering them', async () => {
  const clock = withClock();
  const transport = new SimulatedTransport('robot-01', { latencyMs: 5 }, clock.now);
  const pipeline: string[] = [];
  transport.subscribePipeline((e) => pipeline.push(e.stage));
  await transport.connect();
  transport.sendControl({ throttle: 0, steering: 0, gripper: 'idle', armed: false });
  transport.cutConnection();
  transport.sendControl({ throttle: 1, steering: 0, gripper: 'idle', armed: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const acceptedCount = pipeline.filter((s) => s === 'firmware-accepted').length;
  assert.equal(acceptedCount, 1, 'only the frame sent before the cut should have been delivered');
  transport.disconnect();
});
