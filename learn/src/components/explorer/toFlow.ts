import type { Edge, Node } from '@xyflow/react';

import { visibleConcepts, visibleEdges } from '../../graph/index.ts';
import type { LevelLayout } from '../../graph/layout.ts';
import type { Level } from '../../graph/types.ts';
import type { ConceptCopy } from '../../i18n/types.ts';

export interface ConceptNodeData extends Record<string, unknown> {
  readonly title: string;
  readonly layer: string;
  readonly sourceCount: number;
  readonly dimmed?: boolean;
}

/**
 * Derives React Flow's `Node[]`/`Edge[]` from the Learning Graph IR for one
 * level — a VIEW, recomputed on every level/search change, never the
 * source of truth (see graph/types.ts). Positions come from the
 * build-time ELK layout; nothing here calls ELK.
 */
export function toFlowNodes(
  level: Level,
  layout: LevelLayout,
  copyFor: (id: string) => ConceptCopy,
  sourceCountFor: (id: string) => number,
): Node<ConceptNodeData>[] {
  return visibleConcepts(level).map((concept) => {
    const position = layout.positions[concept.id] ?? { x: 0, y: 0 };
    return {
      id: concept.id,
      type: 'concept',
      position,
      data: {
        title: copyFor(concept.id).title,
        layer: concept.layer,
        sourceCount: sourceCountFor(concept.id),
      },
    };
  });
}

export function toFlowEdges(level: Level): Edge[] {
  return visibleEdges(level).map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    animated: edge.kind === 'flow',
    style:
      edge.kind === 'informs'
        ? { strokeDasharray: '4 3', opacity: 0.6 }
        : edge.kind === 'ack'
          ? { opacity: 0.5 }
          : undefined,
  }));
}
