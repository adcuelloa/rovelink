import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadConfig } from './config.ts';

test('stable documented defaults when nothing is overridden', () => {
  const config = loadConfig([], {});
  assert.equal(config.controlPort, 8787);
  assert.equal(config.videoPort, 8788);
  assert.equal(config.webPort, 5173);
  assert.equal(config.robotId, 'robot-01');
  assert.equal(config.robotLatencyMs, 0);
  assert.equal(config.telemetryMs, 300);
});

test('CLI flags override defaults', () => {
  const config = loadConfig(['--control-port=18787', '--robot-latency=200'], {});
  assert.equal(config.controlPort, 18787);
  assert.equal(config.robotLatencyMs, 200);
});

test('env vars override defaults when no flag is given', () => {
  const config = loadConfig([], { VIDEO_PORT: '19788', ROBOT_ID: 'robot-02' });
  assert.equal(config.videoPort, 19788);
  assert.equal(config.robotId, 'robot-02');
});

test('a CLI flag takes priority over the same-named env var', () => {
  const config = loadConfig(['--web-port', '15173'], { WEB_PORT: '25173' });
  assert.equal(config.webPort, 15173);
});
