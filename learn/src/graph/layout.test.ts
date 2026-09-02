import assert from 'node:assert/strict';
import { test } from 'node:test';

import { visibleConcepts } from './index.ts';
import { computeAllLayouts } from './layout.ts';

test('ELK produces one finite position per visible node, per level', async () => {
  const layouts = await computeAllLayouts();
  for (const level of ['plain', 'technical', 'code'] as const) {
    const concepts = visibleConcepts(level);
    const layout = layouts[level];
    for (const concept of concepts) {
      const position = layout.positions[concept.id];
      assert.ok(position, `missing layout position for "${concept.id}" at level "${level}"`);
      assert.ok(Number.isFinite(position.x));
      assert.ok(Number.isFinite(position.y));
    }
    assert.ok(layout.width > 0);
    assert.ok(layout.height > 0);
  }
});
