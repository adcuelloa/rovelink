import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONCEPTS } from './concepts.ts';

const DOCS = join(import.meta.dirname, '..', 'content', 'docs');
const CONTROL_EN = join(DOCS, 'control');
const CONTROL_ES = join(DOCS, 'es', 'control');
const NETWORK_EN = join(DOCS, 'network');

const CONTROL_SLUGS = [
  'browser-input',
  'input-ownership',
  'controller-profiles',
  'control-engine',
  'control-sender',
  'rhythm-heartbeats',
  'control-frames',
  'differential-drive',
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

test('every English control lesson has a Spanish counterpart', async () => {
  const esFiles = (await mdxFiles(CONTROL_ES)).map((f) => f.replace('.mdx', ''));
  for (const slug of CONTROL_SLUGS) {
    assert.ok(esFiles.includes(slug), `Missing Spanish translation for control/${slug}`);
  }
});

test('every Spanish control lesson has an English counterpart', async () => {
  const enFiles = (await mdxFiles(CONTROL_EN)).map((f) => f.replace('.mdx', ''));
  for (const slug of CONTROL_SLUGS) {
    assert.ok(enFiles.includes(slug), `Missing English source for es/control/${slug}`);
  }
});

test('English and Spanish have the same number of control lessons', async () => {
  const en = await mdxFiles(CONTROL_EN);
  const es = await mdxFiles(CONTROL_ES);
  assert.equal(en.length, es.length, `EN has ${en.length} files, ES has ${es.length}`);
});

// --- Content parity ---

test('every EN control lesson imports PipelinePosition', async () => {
  for (const slug of CONTROL_SLUGS) {
    const content = await readMdx(CONTROL_EN, slug);
    assert.ok(
      content.includes('PipelinePosition'),
      `control/${slug} missing PipelinePosition import`,
    );
  }
});

test('every EN control lesson imports Eyebrow', async () => {
  for (const slug of CONTROL_SLUGS) {
    const content = await readMdx(CONTROL_EN, slug);
    assert.ok(content.includes('Eyebrow'), `control/${slug} missing Eyebrow import`);
  }
});

test('every EN control lesson has at least one KnowledgeCheck', async () => {
  for (const slug of CONTROL_SLUGS) {
    const content = await readMdx(CONTROL_EN, slug);
    assert.ok(content.includes('KnowledgeCheck'), `control/${slug} missing KnowledgeCheck`);
  }
});

test('every EN control lesson has educational structure', async () => {
  for (const slug of CONTROL_SLUGS) {
    const content = await readMdx(CONTROL_EN, slug);
    // Must have at least one heading
    assert.ok(content.includes('## '), `control/${slug} missing section headings`);
    // Must reference the pipeline or a source file
    assert.ok(
      content.includes('PipelinePosition') ||
        content.includes('pipeline') ||
        content.includes('web/src/') ||
        content.includes('protocol/src/'),
      `control/${slug} missing pipeline or source references`,
    );
  }
});

// --- Graph deep-link validity ---

test('every learnSlug in CONCEPTS points to an existing EN lesson', async () => {
  for (const concept of CONCEPTS) {
    if (!concept.learnSlug) continue;
    const [category, slug] = concept.learnSlug.split('/');
    const dir = category === 'network' ? NETWORK_EN : CONTROL_EN;
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

test('sidebar control section has 8 items', async () => {
  const config = await readFile(join(import.meta.dirname, '..', '..', 'astro.config.mjs'), 'utf8');
  // Find the Control section and count its slug entries
  const controlIdx = config.indexOf("label: 'Control'");
  assert.ok(controlIdx >= 0, 'Could not find Control sidebar section');
  // Find the next section label after Control
  const afterControl = config.slice(controlIdx);
  const nextSectionIdx = afterControl.indexOf('\n        },\n        {');
  const section = nextSectionIdx > 0 ? afterControl.slice(0, nextSectionIdx) : afterControl;
  const slugCount = (section.match(/slug: 'control\//g) ?? []).length;
  assert.equal(slugCount, 8, `Control sidebar section has ${slugCount} items, expected 8`);
});
