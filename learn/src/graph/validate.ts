import { conceptCopy, LOCALES } from '../i18n/index.ts';
/**
 * Validation layer for the Learning Graph IR — the thing that stops a
 * beautiful, stale diagram from shipping. Node-only (reads the filesystem);
 * never imported by a browser-hydrated component.
 */
import { findSymbolLine, readRepoFile, repoFileExists } from '../lib/repo.ts';
import { CONCEPTS } from './concepts.ts';
import { EDGES } from './edges.ts';
import { STORIES } from './stories.ts';

export interface ValidationIssue {
  readonly rule: string;
  readonly message: string;
}

export function validateGraph(): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ids = new Set<string>();

  for (const concept of CONCEPTS) {
    if (ids.has(concept.id)) {
      issues.push({
        rule: 'duplicate-concept-id',
        message: `duplicate concept id "${concept.id}"`,
      });
    }
    ids.add(concept.id);
  }

  for (const edge of EDGES) {
    if (!ids.has(edge.from)) {
      issues.push({
        rule: 'dangling-edge',
        message: `edge "${edge.id}" references unknown node "${edge.from}"`,
      });
    }
    if (!ids.has(edge.to)) {
      issues.push({
        rule: 'dangling-edge',
        message: `edge "${edge.id}" references unknown node "${edge.to}"`,
      });
    }
  }

  for (const concept of CONCEPTS) {
    for (const group of concept.aggregates ?? []) {
      if (!ids.has(group)) {
        issues.push({
          rule: 'invalid-view-node-reference',
          message: `concept "${concept.id}" aggregates unknown node "${group}"`,
        });
      }
    }
    if (concept.group !== undefined && !ids.has(concept.group)) {
      issues.push({
        rule: 'invalid-view-node-reference',
        message: `concept "${concept.id}" has unknown group "${concept.group}"`,
      });
    }
  }

  for (const story of STORIES) {
    if (story.steps.length === 0) {
      issues.push({ rule: 'invalid-story-step', message: `story "${story.id}" has no steps` });
    }
    for (const step of story.steps) {
      if (!ids.has(step.nodeId)) {
        issues.push({
          rule: 'invalid-story-step',
          message: `story "${story.id}" references unknown node "${step.nodeId}"`,
        });
      }
    }
  }

  for (const concept of CONCEPTS) {
    for (const locale of LOCALES) {
      try {
        const copy = conceptCopy(locale, concept.id);
        if (copy.title.trim() === '' || copy.plain.trim() === '') {
          issues.push({
            rule: 'missing-localized-concept-copy',
            message: `concept "${concept.id}" has an empty title/plain copy for locale "${locale}"`,
          });
        }
      } catch {
        issues.push({
          rule: 'missing-localized-concept-copy',
          message: `concept "${concept.id}" has no copy for locale "${locale}"`,
        });
      }
    }
  }

  for (const concept of CONCEPTS) {
    for (const ref of concept.sourceRefs ?? []) {
      if (!repoFileExists(ref.path)) {
        issues.push({
          rule: ref.kind === 'test' ? 'missing-test-file' : 'missing-source-file',
          message: `concept "${concept.id}" references missing ${ref.kind} file "${ref.path}"`,
        });
        continue;
      }
      if (ref.symbol !== undefined) {
        const source = readRepoFile(ref.path);
        if (source === null || findSymbolLine(source, ref.symbol) === null) {
          issues.push({
            rule: 'missing-source-symbol',
            message: `concept "${concept.id}" references symbol "${ref.symbol}" not found in "${ref.path}"`,
          });
        }
      }
    }
  }

  return issues;
}
