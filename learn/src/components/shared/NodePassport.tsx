import type { ReactNode } from 'react';

import type { ResolvedSourceRef } from '../../graph/source-map.ts';
import type { ConceptNode } from '../../graph/types.ts';
import type { ConceptCopy, UiStrings } from '../../i18n/types.ts';
import { FactBadge } from './FactBadge.tsx';

export interface NodePassportProps {
  readonly concept: ConceptNode;
  readonly copy: ConceptCopy;
  readonly ui: UiStrings;
  readonly sourceRefs: readonly ResolvedSourceRef[];
  readonly level: 'plain' | 'technical' | 'code';
  readonly onClose?: () => void;
}

/**
 * The "semantic passport": progressive disclosure of everything RoveLink
 * Learn knows about one concept. Sections render only when the concept
 * actually has that content — a plain aggregate node shows almost nothing,
 * a deeply-documented pipeline stage shows much more.
 */
export function NodePassport({ concept, copy, ui, sourceRefs, level, onClose }: NodePassportProps) {
  const sources = sourceRefs.filter((r) => r.kind === 'source');
  const tests = sourceRefs.filter((r) => r.kind === 'test');

  return (
    <aside className="passport" aria-label={copy.title}>
      <header className="passport__header">
        <h2 className="passport__title">{copy.title}</h2>
        {onClose && (
          <button
            type="button"
            className="passport__close"
            onClick={onClose}
            aria-label={ui.passport.close}
          >
            ×
          </button>
        )}
      </header>

      {concept.facts && concept.facts.length > 0 && (
        <p className="passport__facts">
          {concept.facts.map((fact) => (
            <FactBadge key={fact} fact={fact} ui={ui} />
          ))}
        </p>
      )}

      <Section label={ui.passport.plain}>{copy.plain}</Section>

      {level !== 'plain' && copy.technical && (
        <Section label={ui.passport.technical}>{copy.technical}</Section>
      )}
      {level !== 'plain' && copy.why && <Section label={ui.passport.why}>{copy.why}</Section>}
      {level !== 'plain' && copy.tradeoffs && (
        <Section label={ui.passport.tradeoffs}>{copy.tradeoffs}</Section>
      )}
      {level !== 'plain' && copy.failure && (
        <Section label={ui.passport.failure}>{copy.failure}</Section>
      )}
      {level !== 'plain' && copy.safetyImpact && (
        <Section label={ui.passport.safetyImpact}>{copy.safetyImpact}</Section>
      )}

      {level !== 'plain' && copy.advantages && copy.advantages.length > 0 && (
        <Section label={ui.passport.advantages}>
          <ul>
            {copy.advantages.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Section>
      )}
      {level !== 'plain' && copy.disadvantages && copy.disadvantages.length > 0 && (
        <Section label={ui.passport.disadvantages}>
          <ul>
            {copy.disadvantages.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Section>
      )}
      {level !== 'plain' && copy.alternatives && copy.alternatives.length > 0 && (
        <Section label={ui.passport.alternatives}>
          <ul>
            {copy.alternatives.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Section>
      )}

      {level === 'code' && (sources.length > 0 || tests.length > 0) && (
        <Section label={ui.passport.source}>
          <ul className="passport__sources">
            {sources.map((ref) => (
              <li key={ref.path + (ref.symbol ?? '')}>
                <a href={ref.url} target="_blank" rel="noreferrer">
                  {ui.passport.viewSource}
                </a>
                <code>
                  {ref.path}
                  {ref.symbol ? ` — ${ref.symbol}` : ''}
                </code>
              </li>
            ))}
            {tests.map((ref) => (
              <li key={ref.path}>
                <a href={ref.url} target="_blank" rel="noreferrer">
                  {ui.passport.viewTest}
                </a>
                <code>{ref.path}</code>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {copy.tryIt && <Section label={ui.passport.tryIt}>{copy.tryIt}</Section>}
    </aside>
  );
}

function Section({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <section className="passport__section">
      <h3 className="passport__section-label">{label}</h3>
      <div className="passport__section-body">{children}</div>
    </section>
  );
}
