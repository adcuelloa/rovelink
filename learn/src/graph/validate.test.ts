import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CONCEPTS } from './concepts.ts';
import { EDGES } from './edges.ts';
import { isVisibleAt, visibleConcepts, visibleEdges } from './index.ts';
import { validateGraph } from './validate.ts';

test('the graph has no validation issues', () => {
  const issues = validateGraph();
  assert.deepEqual(issues, [], issues.map((i) => `[${i.rule}] ${i.message}`).join('\n'));
});

test('every concept id is unique', () => {
  const ids = CONCEPTS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every edge references an existing node in both directions', () => {
  const ids = new Set(CONCEPTS.map((c) => c.id));
  for (const edge of EDGES) {
    assert.ok(ids.has(edge.from), `edge.from "${edge.from}" missing`);
    assert.ok(ids.has(edge.to), `edge.to "${edge.to}" missing`);
  }
});

test('plain level shows only the four aggregate nodes', () => {
  const plain = visibleConcepts('plain')
    .map((c) => c.id)
    .toSorted();
  assert.deepEqual(plain, ['browser', 'cloud-relay', 'human', 'robot']);
});

test('code level shows every non-aggregate concept', () => {
  const nonAggregates = CONCEPTS.filter((c) => c.introducedAt !== 'plain');
  assert.equal(visibleConcepts('code').length, nonAggregates.length);
});

test('technical level hides plain aggregates but shows the real pipeline', () => {
  const technical = visibleConcepts('technical').map((c) => c.id);
  assert.ok(!technical.includes('browser'));
  assert.ok(technical.includes('control-engine'));
  assert.ok(technical.includes('firmware-control'));
});

test('an edge is only visible when both endpoints are visible at that level', () => {
  for (const edge of visibleEdges('plain')) {
    const from = CONCEPTS.find((c) => c.id === edge.from);
    const to = CONCEPTS.find((c) => c.id === edge.to);
    assert.ok(from && isVisibleAt(from, 'plain'));
    assert.ok(to && isVisibleAt(to, 'plain'));
  }
});
