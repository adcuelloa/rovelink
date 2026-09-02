import '@xyflow/react/dist/style.css';
import {
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { neighborsOf, visibleConcepts } from '../graph/index.ts';
import type { LevelLayout } from '../graph/layout.ts';
import type { ResolvedSourceRef } from '../graph/source-map.ts';
import type { Level, Story } from '../graph/types.ts';
import type { ConceptCopy, UiStrings } from '../i18n/types.ts';
import { ConceptFlowNode } from './explorer/ConceptFlowNode.tsx';
import { StoryBar } from './explorer/StoryBar.tsx';
import type { ConceptNodeData } from './explorer/toFlow.ts';
import { toFlowEdges, toFlowNodes } from './explorer/toFlow.ts';
import { NodePassport } from './shared/NodePassport.tsx';

const NODE_TYPES = { concept: ConceptFlowNode };

export interface ArchitectureExplorerProps {
  readonly locale: 'en' | 'es';
  readonly layouts: Readonly<Record<Level, LevelLayout>>;
  readonly concepts: Record<string, ConceptCopy>;
  readonly sourceMap: Readonly<Record<string, readonly ResolvedSourceRef[]>>;
  readonly ui: UiStrings;
  readonly initialLevel?: Level;
  readonly focusNodeId?: string;
  /** When set, renders the guided story transport (Previous/Next/Play) and
   * drives selection/camera through `story.steps` on the same graph — no
   * separate diagram is ever created for a story. */
  readonly story?: Story;
}

export function ArchitectureExplorer(props: ArchitectureExplorerProps) {
  return (
    <ReactFlowProvider>
      <ExplorerInner {...props} />
    </ReactFlowProvider>
  );
}

function ExplorerInner({
  locale,
  layouts,
  concepts,
  sourceMap,
  ui,
  initialLevel,
  focusNodeId,
  story,
}: ArchitectureExplorerProps) {
  const [level, setLevel] = useState<Level>(initialLevel ?? 'technical');
  const [selected, setSelected] = useState<string | null>(
    focusNodeId ?? (story ? (story.steps[0]?.nodeId ?? null) : null),
  );
  const [query, setQuery] = useState('');
  const [storyStep, setStoryStep] = useState(0);
  const { fitView } = useReactFlow();

  const layout = layouts[level];
  const copyFor = useCallback((id: string) => concepts[id] ?? { title: id, plain: '' }, [concepts]);
  const sourceCountFor = useCallback((id: string) => sourceMap[id]?.length ?? 0, [sourceMap]);

  const baseNodes = useMemo(
    () => toFlowNodes(level, layout, copyFor, sourceCountFor),
    [level, layout, copyFor, sourceCountFor],
  );
  const baseEdges = useMemo(() => toFlowEdges(level), [level]);

  const [nodes, setNodes] = useState<Node<ConceptNodeData>[]>(baseNodes);
  const [edges, setEdges] = useState<Edge[]>(baseEdges);

  useEffect(() => {
    setNodes(baseNodes);
    setEdges(baseEdges);
    if (selected !== null && !visibleConcepts(level).some((c) => c.id === selected))
      setSelected(null);
    const id = requestAnimationFrame(() => fitView({ duration: 200, padding: 0.15 }));
    return () => cancelAnimationFrame(id);
    // Intentionally keyed on `level` alone: `baseNodes`/`baseEdges` are
    // derived from it, and `selected`/`fitView` are read, not depended on.
  }, [level]); // eslint-disable-line

  const { upstream, downstream } = useMemo(() => {
    if (selected === null) return { upstream: [], downstream: [] };
    const visibleIds = new Set(visibleConcepts(level).map((c) => c.id));
    const raw = neighborsOf(selected);
    return {
      upstream: raw.upstream.filter((id) => visibleIds.has(id)),
      downstream: raw.downstream.filter((id) => visibleIds.has(id)),
    };
  }, [selected, level]);
  const related = useMemo(
    () => new Set([selected, ...upstream, ...downstream].filter(Boolean)),
    [selected, upstream, downstream],
  );

  const decoratedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selected,
        data: { ...n.data, dimmed: selected !== null && !related.has(n.id) },
      })),
    [nodes, selected, related],
  );

  const decoratedEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        style: {
          ...e.style,
          opacity:
            selected === null || related.has(e.source) || related.has(e.target) ? undefined : 0.12,
        },
      })),
    [edges, selected, related],
  );

  const matches = useMemo(() => {
    if (query.trim() === '') return [];
    const q = query.toLowerCase();
    return visibleConcepts(level).filter((c) => copyFor(c.id).title.toLowerCase().includes(q));
  }, [query, level, copyFor]);

  function resetLayout(): void {
    setNodes(toFlowNodes(level, layout, copyFor, sourceCountFor));
  }

  function focusNode(id: string): void {
    setSelected(id);
    const node = nodes.find((n) => n.id === id);
    if (node) void fitView({ nodes: [node], duration: 250, padding: 0.6, maxZoom: 1.1 });
  }

  useEffect(() => {
    if (!story) return;
    const step = story.steps[storyStep];
    if (step) focusNode(step.nodeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story, storyStep, level]);

  const selectedCopy = selected ? copyFor(selected) : null;
  const selectedConcept = selected
    ? (visibleConcepts(level).find((c) => c.id === selected) ?? null)
    : null;

  return (
    <div className="rl-explorer" lang={locale}>
      <div>
        <div className="rl-explorer__toolbar">
          <div className="rl-levels" role="group" aria-label="Level">
            {(['plain', 'technical', 'code'] as const).map((lv) => (
              <button
                key={lv}
                type="button"
                aria-pressed={level === lv}
                onClick={() => setLevel(lv)}
              >
                {ui.levels[lv]}
              </button>
            ))}
          </div>
          <input
            className="rl-search"
            type="search"
            name="concept-search"
            placeholder={ui.explorer.search}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={ui.explorer.search}
          />
          <button type="button" className="rl-toolbar-btn" onClick={resetLayout}>
            {ui.explorer.resetLayout}
          </button>
          <button
            type="button"
            className="rl-toolbar-btn"
            onClick={() => fitView({ duration: 200, padding: 0.15 })}
          >
            {ui.explorer.resetView}
          </button>
        </div>
        {story && (
          <div className="rl-explorer__toolbar" style={{ borderBottom: 'none' }}>
            <strong>{ui.story.title}</strong>
            <StoryBar story={story} stepIndex={storyStep} onStep={setStoryStep} ui={ui} />
          </div>
        )}
        {matches.length > 0 && (
          <ul className="rl-node-list" style={{ padding: '0.4rem 0.8rem' }}>
            {matches.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => focusNode(m.id)}>
                  {copyFor(m.id).title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rl-explorer__canvas">
          <ReactFlow
            nodes={decoratedNodes}
            edges={decoratedEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
            onNodeClick={(_, node) => focusNode(node.id)}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              bgColor="var(--rl-surface-raised)"
              maskColor="var(--rl-minimap-mask, rgba(0,0,0,0.55))"
              nodeColor="var(--rl-accent)"
            />
          </ReactFlow>
        </div>
      </div>
      <div className="rl-explorer__side">
        {story && story.steps[storyStep]?.example && (
          <div className="rl-panel" style={{ marginBottom: '1rem' }}>
            <p className="rl-panel__title">
              <span className="rl-badge-sim">SIMULATION</span> example
            </p>
            <dl style={{ margin: 0, fontFamily: 'var(--rl-mono)', fontSize: '0.8rem' }}>
              {Object.entries(story.steps[storyStep]?.example ?? {}).map(([key, value]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <dt>{key}</dt>
                  <dd style={{ margin: 0 }}>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {selectedCopy && selectedConcept ? (
          <>
            <NodePassport
              concept={selectedConcept}
              copy={selectedCopy}
              ui={ui}
              sourceRefs={sourceMap[selectedConcept.id] ?? []}
              level={level}
              onClose={() => setSelected(null)}
            />
            {(upstream.length > 0 || downstream.length > 0) && (
              <div style={{ marginTop: '1rem' }}>
                {upstream.length > 0 && (
                  <NeighborList
                    label={ui.explorer.upstream}
                    ids={upstream}
                    copyFor={copyFor}
                    onSelect={focusNode}
                  />
                )}
                {downstream.length > 0 && (
                  <NeighborList
                    label={ui.explorer.downstream}
                    ids={downstream}
                    copyFor={copyFor}
                    onSelect={focusNode}
                  />
                )}
              </div>
            )}
          </>
        ) : (
          <p style={{ opacity: 0.7 }}>{ui.explorer.noSelection}</p>
        )}
        <h3 className="passport__section-label" style={{ marginTop: '1.2rem' }}>
          {ui.explorer.nodeList}
        </h3>
        <ul className="rl-node-list">
          {visibleConcepts(level).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-current={selected === c.id}
                onClick={() => focusNode(c.id)}
              >
                {copyFor(c.id).title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NeighborList({
  label,
  ids,
  copyFor,
  onSelect,
}: {
  readonly label: string;
  readonly ids: readonly string[];
  readonly copyFor: (id: string) => ConceptCopy;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <h3 className="passport__section-label">{label}</h3>
      <ul className="rl-node-list">
        {ids.map((id) => (
          <li key={id}>
            <button type="button" onClick={() => onSelect(id)}>
              {copyFor(id).title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
