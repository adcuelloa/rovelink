import { CONCEPTS, CONCEPT_BY_ID } from './concepts.ts';
import { EDGES } from './edges.ts';
import { STORIES } from './stories.ts';
import type { ConceptNode, Level } from './types.ts';

export * from './types.ts';
export { CONCEPTS, CONCEPT_BY_ID } from './concepts.ts';
export { EDGES } from './edges.ts';
export { STORIES, R2_TO_MOTORS_STORY } from './stories.ts';

export const GRAPH = { nodes: CONCEPTS, edges: EDGES, stories: STORIES };

/**
 * Level visibility is NOT a single monotonic rank across all three levels:
 * `plain` is a deliberately coarser, separate branch (the four aggregate
 * nodes only), while `technical` -> `code` is a genuine refinement
 * (`code` is a strict superset of `technical`, revealing finer-grained
 * concepts like individual source symbols). A node's `introducedAt` says
 * which of those two branches it belongs to, and — within the
 * technical/code branch — how fine-grained it is.
 */
export function isVisibleAt(concept: ConceptNode, level: Level): boolean {
  if (level === 'plain') return concept.introducedAt === 'plain';
  if (level === 'technical') return concept.introducedAt === 'technical';
  return concept.introducedAt === 'technical' || concept.introducedAt === 'code';
}

export function visibleConcepts(level: Level): readonly ConceptNode[] {
  return CONCEPTS.filter((concept) => isVisibleAt(concept, level));
}

export function visibleEdges(level: Level): typeof EDGES {
  const visible = new Set(visibleConcepts(level).map((c) => c.id));
  return EDGES.filter((edge) => visible.has(edge.from) && visible.has(edge.to));
}

export function neighborsOf(nodeId: string): {
  readonly upstream: string[];
  readonly downstream: string[];
} {
  const upstream = EDGES.filter((e) => e.to === nodeId).map((e) => e.from);
  const downstream = EDGES.filter((e) => e.from === nodeId).map((e) => e.to);
  return { upstream, downstream };
}

export function requireConcept(id: string): ConceptNode {
  const concept = CONCEPT_BY_ID.get(id);
  if (concept === undefined) throw new Error(`unknown concept id: ${id}`);
  return concept;
}
