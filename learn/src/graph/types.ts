/**
 * Learning Graph IR — the typed source of truth for RoveLink Learn's
 * architecture explorer, guided story, and node passports.
 *
 * React Flow's `Node[]`/`Edge[]` is a VIEW, derived from this at render time
 * (see components/explorer/toFlow.ts) — never the other way around. Concept
 * ids are stable and language-independent; localized copy lives in i18n/.
 */

/** Progressive-disclosure levels, least to most detailed. Every concept
 * exists once; a level only changes which concepts are currently visible. */
export type Level = 'plain' | 'technical' | 'code';

export const LEVELS: readonly Level[] = ['plain', 'technical', 'code'];

export const levelRank = (level: Level): number => LEVELS.indexOf(level);

/** Broad section of the pipeline a concept belongs to — used for layout
 * banding and for grouping technical/code concepts under a plain aggregate. */
export type Layer = 'human' | 'browser' | 'relay' | 'firmware' | 'hardware';

export type Fact = 'implemented' | 'rationale' | 'alternative' | 'simulation' | 'measured';

export interface SourceRef {
  readonly path: string;
  /** Exported symbol this reference anchors to — resolved to a line number
   * at build time (see lib/repo.ts), never hand-typed. */
  readonly symbol?: string;
  readonly kind: 'source' | 'test';
}

export interface ConceptNode {
  readonly id: string;
  readonly layer: Layer;
  /** Minimum level at which this concept becomes visible. A `plain`
   * concept is visible at every level; a `code` concept only at `code`. */
  readonly introducedAt: Level;
  /** For a `plain` aggregate node (human/browser/cloud-relay/robot): the
   * technical/code concept ids it stands in for when zoomed out. */
  readonly aggregates?: readonly string[];
  /** For a technical/code concept: which plain aggregate it belongs to. */
  readonly group?: string;
  readonly sourceRefs?: readonly SourceRef[];
  readonly facts?: readonly Fact[];
  /** Optional deep-dive lesson slug (without leading /). When present, the
   * passport renders a "Learn more →" link to /{slug}/. */
  readonly learnSlug?: string;
}

export type EdgeKind = 'flow' | 'informs' | 'ack';

export interface ConceptEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
}

export interface StoryStep {
  readonly nodeId: string;
  /** Illustrative real-shaped example data shown at this beat (e.g. a
   * sample ControlFrame) — always labeled SIMULATION in the UI. */
  readonly example?: Readonly<Record<string, string | number | boolean>>;
}

export interface Story {
  readonly id: string;
  readonly steps: readonly StoryStep[];
}

export interface LearningGraph {
  readonly nodes: readonly ConceptNode[];
  readonly edges: readonly ConceptEdge[];
  readonly stories: readonly Story[];
}
