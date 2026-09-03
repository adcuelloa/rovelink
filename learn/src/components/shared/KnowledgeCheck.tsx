/**
 * Interactive knowledge check with progressive reveal.
 * Uses <details>/<summary> for no-JS fallback; the React layer adds
 * smooth open/close and a "check" button feel.
 */
import { useState } from 'react';

interface Props {
  readonly question: string;
  readonly answer: string;
}

export function KnowledgeCheck({ question, answer }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <details className="rl-kc" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="rl-kc__q">{question}</summary>
      <div className="rl-kc__a">{answer}</div>
    </details>
  );
}
