import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { writeDemoEnvFiles } from './env-file.ts';
import { generateDemoSecrets } from './secrets.ts';

test('writes control/video env files under the OS temp dir, never inside the repo', async () => {
  const secrets = generateDemoSecrets();
  const files = await writeDemoEnvFiles(secrets);
  try {
    assert.ok(files.dir.startsWith(tmpdir()));
    assert.ok(!files.dir.includes('rovelink/relay'));
    assert.ok(!files.dir.includes('rovelink/video-relay'));
  } finally {
    await files.cleanup();
  }
});

test('the control env file contains only the control relay secrets', async () => {
  const secrets = generateDemoSecrets();
  const files = await writeDemoEnvFiles(secrets);
  try {
    const content = await readFile(files.controlEnvPath, 'utf8');
    assert.match(content, new RegExp(`DEVICE_SECRET=${secrets.deviceSecret}`));
    assert.match(content, new RegExp(`CONTROLLER_SECRET=${secrets.controllerSecret}`));
    assert.match(content, new RegExp(`VIDEO_TICKET_SECRET=${secrets.videoTicketSecret}`));
    assert.ok(
      !content.includes(secrets.videoPublisherSecret),
      'must not leak the publisher secret',
    );
  } finally {
    await files.cleanup();
  }
});

test('the video env file contains only the video relay secrets, sharing VIDEO_TICKET_SECRET', async () => {
  const secrets = generateDemoSecrets();
  const files = await writeDemoEnvFiles(secrets);
  try {
    const content = await readFile(files.videoEnvPath, 'utf8');
    assert.match(content, new RegExp(`VIDEO_PUBLISHER_SECRET=${secrets.videoPublisherSecret}`));
    assert.match(content, new RegExp(`VIDEO_TICKET_SECRET=${secrets.videoTicketSecret}`));
    assert.ok(!content.includes(secrets.deviceSecret), 'must not leak the device secret');
    assert.ok(!content.includes(secrets.controllerSecret), 'must not leak the controller secret');
  } finally {
    await files.cleanup();
  }
});

test('files and directory are created with restrictive permissions', async () => {
  const files = await writeDemoEnvFiles(generateDemoSecrets());
  try {
    const dirMode = (await stat(files.dir)).mode & 0o777;
    const controlMode = (await stat(files.controlEnvPath)).mode & 0o777;
    const videoMode = (await stat(files.videoEnvPath)).mode & 0o777;
    assert.equal(dirMode, 0o700);
    assert.equal(controlMode, 0o600);
    assert.equal(videoMode, 0o600);
  } finally {
    await files.cleanup();
  }
});

test('cleanup() removes the temp directory entirely', async () => {
  const files = await writeDemoEnvFiles(generateDemoSecrets());
  await files.cleanup();
  await assert.rejects(() => stat(files.dir), { code: 'ENOENT' });
});
