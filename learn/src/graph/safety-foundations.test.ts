import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONCEPTS } from './concepts.ts';

const DOCS = join(import.meta.dirname, '..', 'content', 'docs');
const SAFETY_EN = join(DOCS, 'safety');
const SAFETY_ES = join(DOCS, 'es', 'safety');

const SAFETY_SLUGS = [
  'safe-state',
  'safe-baseline',
  'control-sessions',
  'message-ordering',
  'ttl-watchdog',
  'emergency-stop',
  'failure-scenarios',
  'reconnection-recovery',
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

test('every English safety lesson has a Spanish counterpart', async () => {
  const esFiles = (await mdxFiles(SAFETY_ES)).map((f) => f.replace('.mdx', ''));
  for (const slug of SAFETY_SLUGS) {
    assert.ok(esFiles.includes(slug), `Missing Spanish translation for safety/${slug}`);
  }
});

test('every Spanish safety lesson has an English counterpart', async () => {
  const enFiles = (await mdxFiles(SAFETY_EN)).map((f) => f.replace('.mdx', ''));
  for (const slug of SAFETY_SLUGS) {
    assert.ok(enFiles.includes(slug), `Missing English source for es/safety/${slug}`);
  }
});

test('English and Spanish have the same number of safety lessons', async () => {
  const en = await mdxFiles(SAFETY_EN);
  const es = await mdxFiles(SAFETY_ES);
  assert.equal(en.length, es.length, `EN has ${en.length} files, ES has ${es.length}`);
});

// --- Content parity ---

test('every EN safety lesson imports SafetyPath', async () => {
  for (const slug of SAFETY_SLUGS) {
    const content = await readMdx(SAFETY_EN, slug);
    assert.ok(content.includes('SafetyPath'), `safety/${slug} missing SafetyPath import`);
  }
});

test('every EN safety lesson imports Eyebrow', async () => {
  for (const slug of SAFETY_SLUGS) {
    const content = await readMdx(SAFETY_EN, slug);
    assert.ok(content.includes('Eyebrow'), `safety/${slug} missing Eyebrow import`);
  }
});

test('every EN safety lesson has at least one KnowledgeCheck', async () => {
  for (const slug of SAFETY_SLUGS) {
    const content = await readMdx(SAFETY_EN, slug);
    assert.ok(content.includes('KnowledgeCheck'), `safety/${slug} missing KnowledgeCheck`);
  }
});

test('every EN safety lesson has educational structure', async () => {
  for (const slug of SAFETY_SLUGS) {
    const content = await readMdx(SAFETY_EN, slug);
    assert.ok(content.includes('## '), `safety/${slug} missing section headings`);
    assert.ok(
      content.includes('SafetyPath') ||
        content.includes('firmware') ||
        content.includes('protocol') ||
        content.includes('SAFE_STATE'),
      `safety/${slug} missing safety or source references`,
    );
  }
});

test('failure-scenarios lesson includes SafetyFailureLab', async () => {
  const content = await readMdx(SAFETY_EN, 'failure-scenarios');
  assert.ok(content.includes('SafetyFailureLab'), 'failure-scenarios missing SafetyFailureLab');
  assert.ok(content.includes('client:only'), 'failure-scenarios missing client:only directive');
});

// --- Graph deep-link validity ---

test('every learnSlug in safety CONCEPTS points to an existing EN lesson', async () => {
  for (const concept of CONCEPTS) {
    if (!concept.learnSlug) continue;
    if (!concept.learnSlug.startsWith('safety/')) continue;
    const slug = concept.learnSlug.replace('safety/', '');
    const path = join(SAFETY_EN, `${slug}.mdx`);
    try {
      await readFile(path);
    } catch {
      assert.fail(`Concept "${concept.learnSlug}" learnSlug points to missing file ${path}`);
    }
  }
});

test('all safety learnSlug concepts reference valid source files', async () => {
  for (const concept of CONCEPTS) {
    if (!concept.learnSlug) continue;
    if (!concept.learnSlug.startsWith('safety/')) continue;
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

test('sidebar safety section has 8 items', async () => {
  const config = await readFile(join(import.meta.dirname, '..', '..', 'astro.config.mjs'), 'utf8');
  const safetyIdx = config.indexOf("label: 'Safety & Authority'");
  assert.ok(safetyIdx >= 0, 'Could not find Safety & Authority sidebar section');
  const afterSafety = config.slice(safetyIdx);
  const nextSectionIdx = afterSafety.indexOf('\n        },\n        {');
  const section = nextSectionIdx > 0 ? afterSafety.slice(0, nextSectionIdx) : afterSafety;
  const slugCount = (section.match(/slug: 'safety\//g) ?? []).length;
  assert.equal(slugCount, 8, `Safety sidebar section has ${slugCount} items, expected 8`);
});

// --- EN/ES content structure parity ---

test('EN and ES safety lessons have the same SafetyPath current values', async () => {
  for (const slug of SAFETY_SLUGS) {
    const enContent = await readMdx(SAFETY_EN, slug);
    const esContent = await readMdx(SAFETY_ES, slug);
    const enMatch = enContent.match(/SafetyPath current="([^"]+)"/);
    const esMatch = esContent.match(/SafetyPath current="([^"]+)"/);
    assert.ok(enMatch, `EN safety/${slug} missing SafetyPath current`);
    assert.ok(esMatch, `ES safety/${slug} missing SafetyPath current`);
    if (enMatch && esMatch) {
      assert.equal(
        enMatch[1],
        esMatch[1],
        `SafetyPath current mismatch: EN="${enMatch[1]}" ES="${esMatch[1]}"`,
      );
    }
  }
});

test('EN and ES safety lessons have the same number of KnowledgeCheck components', async () => {
  for (const slug of SAFETY_SLUGS) {
    const enContent = await readMdx(SAFETY_EN, slug);
    const esContent = await readMdx(SAFETY_ES, slug);
    const enCount = (enContent.match(/<KnowledgeCheck/g) ?? []).length;
    const esCount = (esContent.match(/<KnowledgeCheck/g) ?? []).length;
    assert.equal(
      enCount,
      esCount,
      `KnowledgeCheck count mismatch in safety/${slug}: EN=${enCount} ES=${esCount}`,
    );
  }
});
