import { useEffect, useRef, useState } from 'react';

import type { Story } from '../../graph/types.ts';
import type { UiStrings } from '../../i18n/types.ts';

export interface StoryBarProps {
  readonly story: Story;
  readonly stepIndex: number;
  readonly onStep: (index: number) => void;
  readonly ui: UiStrings;
}

const AUTOPLAY_MS = 3800;

/** Guided-story transport controls: Previous/Next/Play. Camera movement is
 * driven by the caller (ArchitectureExplorer's focusNode) reacting to
 * `stepIndex` — finite, bounded steps, never a free-running animation, and
 * autoplay itself is disabled outright under prefers-reduced-motion rather
 * than merely skipping the pan/zoom easing. */
export function StoryBar({ story, stepIndex, onStep, ui }: StoryBarProps) {
  const [playing, setPlaying] = useState(false);
  const reducedMotion = useReducedMotion();
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing || reducedMotion) return undefined;
    timer.current = setInterval(() => {
      onStep(Math.min(stepIndex + 1, story.steps.length - 1));
    }, AUTOPLAY_MS);
    return () => {
      if (timer.current !== null) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stepIndex, reducedMotion]);

  useEffect(() => {
    if (stepIndex >= story.steps.length - 1) setPlaying(false);
  }, [stepIndex, story.steps.length]);

  return (
    <div className="rl-story__nav">
      <button
        type="button"
        className="rl-toolbar-btn"
        onClick={() => onStep(Math.max(0, stepIndex - 1))}
        disabled={stepIndex === 0}
      >
        ← {ui.story.previous}
      </button>
      <span className="rl-story__progress">
        {ui.story.step} {stepIndex + 1} {ui.story.of} {story.steps.length}
      </span>
      {!reducedMotion && (
        <button
          type="button"
          className="rl-toolbar-btn"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
        >
          {playing ? ui.story.pause : ui.story.play}
        </button>
      )}
      <button
        type="button"
        className="rl-toolbar-btn"
        onClick={() => onStep(Math.min(story.steps.length - 1, stepIndex + 1))}
        disabled={stepIndex === story.steps.length - 1}
      >
        {ui.story.next} →
      </button>
    </div>
  );
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = () => setReduced(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}
