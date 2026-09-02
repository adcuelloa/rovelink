import type { Fact } from '../../graph/types.ts';
import type { UiStrings } from '../../i18n/types.ts';

const FACT_CLASS: Record<Fact, string> = {
  implemented: 'fact-badge fact-badge--implemented',
  rationale: 'fact-badge fact-badge--rationale',
  alternative: 'fact-badge fact-badge--alternative',
  simulation: 'fact-badge fact-badge--simulation',
  measured: 'fact-badge fact-badge--measured',
};

export function FactBadge({ fact, ui }: { readonly fact: Fact; readonly ui: UiStrings }) {
  return <span className={FACT_CLASS[fact]}>{ui.facts[fact]}</span>;
}

export function SourceBadge({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span className="src-badge" title={`${count} source reference${count === 1 ? '' : 's'}`}>
      SRC {count}
    </span>
  );
}
