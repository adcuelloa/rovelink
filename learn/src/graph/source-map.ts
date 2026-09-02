/**
 * Resolves each concept's `sourceRefs` into concrete, revision-pinned
 * evidence — file, symbol, line, GitHub URL — at BUILD TIME (Node only:
 * uses lib/repo.ts's filesystem + git access). The result is plain,
 * JSON-serializable data baked into the page as props, so the browser
 * bundle never needs `fs` or `child_process` to show a source link.
 */
import { findSymbolLine, githubUrl, readRepoFile } from '../lib/repo.ts';
import { CONCEPTS } from './concepts.ts';
import type { SourceRef } from './types.ts';

export interface ResolvedSourceRef {
  readonly path: string;
  readonly symbol?: string;
  readonly kind: SourceRef['kind'];
  readonly line: number | null;
  readonly url: string;
}

function resolveOne(ref: SourceRef): ResolvedSourceRef {
  const source = readRepoFile(ref.path);
  const line =
    ref.symbol !== undefined && source !== null ? findSymbolLine(source, ref.symbol) : null;
  return {
    path: ref.path,
    symbol: ref.symbol,
    kind: ref.kind,
    line,
    url: githubUrl(ref.path, line),
  };
}

/** Every concept id -> its resolved source evidence, ready to serialize. */
export function resolveSourceMap(): Readonly<Record<string, readonly ResolvedSourceRef[]>> {
  const map: Record<string, readonly ResolvedSourceRef[]> = {};
  for (const concept of CONCEPTS) {
    map[concept.id] = (concept.sourceRefs ?? []).map(resolveOne);
  }
  return map;
}
