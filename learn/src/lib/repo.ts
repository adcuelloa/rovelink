/**
 * Build-time bridge to the actual repository: resolves a source path relative
 * to the monorepo root, finds the line a symbol is declared on (so links
 * never rely on a hand-typed line number), and builds a revision-pinned
 * GitHub URL. Node-only — never imported by a browser-hydrated component.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** learn/src/lib -> repo root. */
export const REPO_ROOT = resolve(HERE, '../../..');
export const GITHUB_REPO = 'adcuelloa/rovelink';

let cachedSha: string | null | undefined;

/** The commit SHA this build ran against, or `null` outside a git checkout. */
export function currentCommitSha(): string | null {
  if (cachedSha !== undefined) return cachedSha;
  try {
    cachedSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    cachedSha = null;
  }
  return cachedSha;
}

export function repoFileExists(relativePath: string): boolean {
  return existsSync(join(REPO_ROOT, relativePath));
}

export function readRepoFile(relativePath: string): string | null {
  const full = join(REPO_ROOT, relativePath);
  if (!existsSync(full)) return null;
  return readFileSync(full, 'utf8');
}

/**
 * Finds the 1-indexed line where `symbol` is declared: a `class`, `function`,
 * `interface`, `type`, `const`/`let`, or (for firmware) a bare C declaration
 * naming it. This is a best-effort anchor, not a full parser — good enough to
 * stop hand-maintained line numbers from going stale, without needing a TS
 * compiler in the loop. Returns `null` if the symbol never appears as a
 * declaration.
 */
export function findSymbolLine(source: string, symbol: string): number | null {
  const lines = source.split('\n');
  const declaration = new RegExp(
    `\\b(class|function|interface|type|const|let|enum)\\s+${escapeRegExp(symbol)}\\b`,
  );
  const cFunction = new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`);
  for (const [index, line] of lines.entries()) {
    if (declaration.test(line)) return index + 1;
  }
  for (const [index, line] of lines.entries()) {
    if (cFunction.test(line)) return index + 1;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Revision-pinned GitHub URL for a repo-relative path, optionally anchored
 * to a line. Falls back to `main` when no git metadata is available (e.g. a
 * tarball build with no `.git` directory) — the site itself never needs
 * network access to compute this. */
export function githubUrl(relativePath: string, line?: number | null): string {
  const ref = currentCommitSha() ?? 'main';
  const anchor = line !== null && line !== undefined ? `#L${line}` : '';
  return `https://github.com/${GITHUB_REPO}/blob/${ref}/${relativePath}${anchor}`;
}
