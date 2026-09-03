import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONCEPTS } from './concepts.ts';

const DOCS = join(import.meta.dirname, '..', 'content', 'docs');
const NETWORK_EN = join(DOCS, 'network');
const NETWORK_ES = join(DOCS, 'es', 'network');

const NETWORK_SLUGS = [
  'why-relay',
  'browser-transport',
  'relay-worker',
  'robot-room',
  'protocol',
  'authentication',
  'reconnection',
];

async function mdxFiles(dir: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith('.mdx'));
  } catch {
    return [];
  }
}

async function readMdx(dir: string, slug: string): Promise<string> {
  return readFile(join(dir, `${slug}.mdx`), 'utf8');
}

// --- Route parity ---

test('every English network lesson has a Spanish counterpart', async () => {
  const esFiles = (await mdxFiles(NETWORK_ES)).map((f) => f.replace('.mdx', ''));
  for (const slug of NETWORK_SLUGS) {
    assert.ok(esFiles.includes(slug), `Missing Spanish translation for network/${slug}`);
  }
});

test('every Spanish network lesson has an English counterpart', async () => {
  const enFiles = (await mdxFiles(NETWORK_EN)).map((f) => f.replace('.mdx', ''));
  for (const slug of NETWORK_SLUGS) {
    assert.ok(enFiles.includes(slug), `Missing English source for es/network/${slug}`);
  }
});

test('English and Spanish have the same number of network lessons', async () => {
  const en = await mdxFiles(NETWORK_EN);
  const es = await mdxFiles(NETWORK_ES);
  assert.equal(en.length, es.length, `EN has ${en.length} files, ES has ${es.length}`);
});

// --- Content parity ---

test('every EN network lesson imports NetworkPath', async () => {
  for (const slug of NETWORK_SLUGS) {
    const content = await readMdx(NETWORK_EN, slug);
    assert.ok(content.includes('NetworkPath'), `network/${slug} missing NetworkPath import`);
  }
});

test('every EN network lesson imports Eyebrow', async () => {
  for (const slug of NETWORK_SLUGS) {
    const content = await readMdx(NETWORK_EN, slug);
    assert.ok(content.includes('Eyebrow'), `network/${slug} missing Eyebrow import`);
  }
});

test('every EN network lesson has at least one KnowledgeCheck', async () => {
  for (const slug of NETWORK_SLUGS) {
    const content = await readMdx(NETWORK_EN, slug);
    assert.ok(content.includes('KnowledgeCheck'), `network/${slug} missing KnowledgeCheck`);
  }
});

test('every EN network lesson has educational structure', async () => {
  for (const slug of NETWORK_SLUGS) {
    const content = await readMdx(NETWORK_EN, slug);
    assert.ok(content.includes('## '), `network/${slug} missing section headings`);
    assert.ok(
      content.includes('NetworkPath') ||
        content.includes('relay') ||
        content.includes('WebSocket') ||
        content.includes('Durable Object'),
      `network/${slug} missing network or source references`,
    );
  }
});

// --- Graph deep-link validity ---

test('every learnSlug in CONCEPTS points to an existing EN lesson', async () => {
  for (const concept of CONCEPTS) {
    if (!concept.learnSlug) continue;
    const [category, slug] = concept.learnSlug.split('/');
    if (!category || !slug) {
      assert.fail(`Concept "${concept.id}" has malformed learnSlug "${concept.learnSlug}"`);
    }
    const dir = category === 'network' ? NETWORK_EN : join(DOCS, category);
    const path = join(dir, `${slug}.mdx`);
    try {
      await readFile(path);
    } catch {
      assert.fail(`Concept "${concept.learnSlug}" learnSlug points to missing file ${path}`);
    }
  }
});

test('all learnSlug concepts reference valid source files', async () => {
  for (const concept of CONCEPTS) {
    if (!concept.learnSlug) continue;
    if (!concept.sourceRefs) continue;
    for (const ref of concept.sourceRefs) {
      assert.ok(ref.path.length > 0, `Concept "${concept.id}" has empty sourceRef path`);
      assert.ok(
        ref.kind === 'source' || ref.kind === 'test',
        `Concept "${concept.id}" has invalid sourceRef kind: ${ref.kind}`,
      );
    }
  }
});

// --- Sidebar parity ---

test('sidebar network section has 7 items', async () => {
  const config = await readFile(join(import.meta.dirname, '..', '..', 'astro.config.mjs'), 'utf8');
  const networkIdx = config.indexOf("label: 'Network & Relay'");
  assert.ok(networkIdx >= 0, 'Could not find Network & Relay sidebar section');
  const afterNetwork = config.slice(networkIdx);
  const nextSectionIdx = afterNetwork.indexOf('\n        },\n        {');
  const section = nextSectionIdx > 0 ? afterNetwork.slice(0, nextSectionIdx) : afterNetwork;
  const slugCount = (section.match(/slug: 'network\//g) ?? []).length;
  assert.equal(slugCount, 7, `Network sidebar section has ${slugCount} items, expected 7`);
});
