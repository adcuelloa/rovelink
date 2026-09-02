/**
 * Build-time canonical layout via ELK — never run in the browser. Astro's
 * frontmatter executes this at build (and dev-request) time in Node, so the
 * explorer hydrates with fixed positions already known; "Reset layout"
 * restores exactly this, per level, with no ELK call ever happening
 * client-side and no "nodes flying around" on first paint.
 */
// The bundled build runs synchronously on the main thread — no Web Worker,
// which is what makes this safe to call from Node during the Astro build.
import ELK from 'elkjs/lib/elk.bundled.js';

import { visibleConcepts, visibleEdges } from './index.ts';
import type { Level } from './types.ts';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 72;

export interface LayoutPosition {
  readonly x: number;
  readonly y: number;
}

export interface LevelLayout {
  readonly positions: Readonly<Record<string, LayoutPosition>>;
  readonly width: number;
  readonly height: number;
}

const elk = new ELK();

async function layoutLevel(level: Level): Promise<LevelLayout> {
  const nodes = visibleConcepts(level);
  const edges = visibleEdges(level);

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': '72',
      'elk.spacing.nodeNode': '32',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
  };

  const result = await elk.layout(graph);
  const positions: Record<string, LayoutPosition> = {};
  let maxX = 0;
  let maxY = 0;
  for (const child of result.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    positions[child.id] = { x, y };
    maxX = Math.max(maxX, x + (child.width ?? NODE_WIDTH));
    maxY = Math.max(maxY, y + (child.height ?? NODE_HEIGHT));
  }
  return { positions, width: maxX, height: maxY };
}

/** Computed once per Astro build/dev-request, then baked into the page as
 * JSON props — see the architecture explorer's Astro page. */
export async function computeAllLayouts(): Promise<Readonly<Record<Level, LevelLayout>>> {
  const [plain, technical, code] = await Promise.all([
    layoutLevel('plain'),
    layoutLevel('technical'),
    layoutLevel('code'),
  ]);
  return { plain, technical, code };
}
