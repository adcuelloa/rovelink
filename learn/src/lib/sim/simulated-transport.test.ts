import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONTROL_TTL_MS } from '@rovelink/protocol';
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

test('link silence trips the local watchdog and reports it as watchdog-stop, never emergency-stop', async () => {
  const clock = withClock();
  const transport = new SimulatedTransport('robot-01', { latencyMs: 0 }, clock.now);
  const pipeline: string[] = [];
  transport.subscribePipeline((e) => pipeline.push(e.stage));
  await transport.connect();

  transport.sendControl({ throttle: 0, steering: 0, gripper: 'idle', armed: false }); // baseline
  await new Promise((resolve) => setTimeout(resolve, 10));
  transport.sendControl({ throttle: 0.5, steering: 0, gripper: 'idle', armed: true }); // arm
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Simulate silence past CONTROL_TTL_MS purely via the injected clock, then
  // give the transport's real 50ms watchdog poll a chance to observe it.
  clock.advance(CONTROL_TTL_MS + 50);
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.ok(
    pipeline.includes('watchdog-stop'),
    'expected a watchdog-stop event once silence exceeds CONTROL_TTL_MS while armed',
  );
  assert.ok(
    !pipeline.includes('emergency-stop'),
    'a watchdog trip must never be reported as an emergency-stop',
  );
  transport.disconnect();
});

test('emergencyStop() reports emergency-stop, never watchdog-stop, on a healthy link', async () => {
  const clock = withClock();
  const transport = new SimulatedTransport('robot-01', { latencyMs: 0 }, clock.now);
  const pipeline: string[] = [];
  transport.subscribePipeline((e) => pipeline.push(e.stage));
  await transport.connect();
  transport.sendControl({ throttle: 0, steering: 0, gripper: 'idle', armed: false });
  await new Promise((resolve) => setTimeout(resolve, 10));

  transport.emergencyStop();

  assert.ok(pipeline.includes('emergency-stop'), 'expected an emergency-stop event');
  assert.ok(
    !pipeline.includes('watchdog-stop'),
    'an explicit E-stop over a healthy link must never be reported as a watchdog trip',
  );
  transport.disconnect();
});
