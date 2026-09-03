import { useState } from 'react';

/**
 * Interactive visualizer showing how browser and device independently
 * connect to the relay, then discover each other in the same room.
 */
export function RendezvousVisualizer() {
  const [step, setStep] = useState(0);

  const steps = [
    { label: 'Start', description: 'Both browser and robot are offline.' },
    {
      label: 'Device connects',
      description: 'The robot opens a WebSocket to the relay (outbound connection).',
    },
    {
      label: 'Device registers',
      description: 'The robot sends device.register with its robotId and token.',
    },
    {
      label: 'Browser connects',
      description: 'The browser opens a WebSocket to the relay (outbound connection).',
    },
    {
      label: 'Browser registers',
      description: 'The browser sends controller.register with the same robotId.',
    },
    {
      label: 'Room formed',
      description: 'The relay pairs them — both receive a room message with presence info.',
    },
  ];

  return (
    <div className="rl-rendezvous">
      <div className="rl-rendezvous__badge rl-rendezvous__badge--simulation">
        <span className="rl-rendezvous__badge-dot" />
        Simulation of RoveLink behavior
      </div>
      <div className="rl-rendezvous__diagram">
        <div
          className={`rl-rendezvous__node rl-rendezvous__node--device ${step >= 1 ? 'rl-rendezvous__node--connected' : ''}`}
        >
          <span className="rl-rendezvous__icon">🤖</span>
          <span className="rl-rendezvous__label">Robot</span>
          {step >= 1 && <span className="rl-rendezvous__status">connected</span>}
        </div>

        <div className="rl-rendezvous__center">
          <div
            className={`rl-rendezvous__relay ${step >= 1 ? 'rl-rendezvous__relay--active' : ''}`}
          >
            <span className="rl-rendezvous__icon">☁️</span>
            <span className="rl-rendezvous__label">Relay</span>
          </div>
          {step >= 2 && (
            <div className="rl-rendezvous__room-label">
              Room: <code>robot/{'{id}'}</code>
            </div>
          )}
        </div>

        <div
          className={`rl-rendezvous__node rl-rendezvous__node--browser ${step >= 3 ? 'rl-rendezvous__node--connected' : ''}`}
        >
          <span className="rl-rendezvous__icon">💻</span>
          <span className="rl-rendezvous__label">Browser</span>
          {step >= 3 && <span className="rl-rendezvous__status">connected</span>}
        </div>
      </div>

      <div className="rl-rendezvous__step-indicator">
        <span className="rl-rendezvous__step-count">
          Step {step + 1} of {steps.length}
        </span>
        <span className="rl-rendezvous__step-desc">{steps[step]?.description ?? ''}</span>
      </div>

      <div className="rl-rendezvous__arrows">
        {step >= 1 && <div className="rl-rendezvous__line rl-rendezvous__line--device" />}
        {step >= 3 && <div className="rl-rendezvous__line rl-rendezvous__line--browser" />}
        {step >= 5 && <div className="rl-rendezvous__line rl-rendezvous__line--paired">paired</div>}
      </div>

      <div className="rl-rendezvous__controls">
        <button
          className="rl-rendezvous__btn"
          onClick={() => setStep(Math.max(0, step - 1))}
          disabled={step === 0}
        >
          ← Prev
        </button>
        <button
          className="rl-rendezvous__btn"
          onClick={() => setStep(Math.min(steps.length - 1, step + 1))}
          disabled={step === steps.length - 1}
        >
          Next →
        </button>
        <button className="rl-rendezvous__btn rl-rendezvous__btn--reset" onClick={() => setStep(0)}>
          Reset
        </button>
      </div>

      <style>{`
        .rl-rendezvous {
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          padding: 1rem;
          background: var(--rl-surface-raised, #fff);
          margin: 1.5rem 0;
        }
        .rl-rendezvous__badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.3rem 0.6rem;
          border-radius: 3px;
          margin-bottom: 0.8rem;
        }
        .rl-rendezvous__badge--simulation {
          background: rgba(234, 179, 8, 0.08);
          color: #ca8a04;
        }
        .rl-rendezvous__badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #ca8a04;
        }
        .rl-rendezvous__diagram {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 1.5rem;
          padding: 1.5rem 0;
          flex-wrap: wrap;
        }
        .rl-rendezvous__node {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          padding: 0.8rem 1rem;
          border-radius: var(--rl-radius-sm, 4px);
          border: 2px solid var(--rl-border, #ccc);
          background: var(--rl-surface, #fff);
          min-width: 4rem;
          opacity: 0.4;
          transition: all 0.3s ease;
        }
        .rl-rendezvous__node--connected {
          opacity: 1;
          border-color: var(--rl-accent, #ff8a1e);
        }
        .rl-rendezvous__center {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
        }
        .rl-rendezvous__relay {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          padding: 0.8rem 1rem;
          border-radius: var(--rl-radius-sm, 4px);
          border: 2px solid var(--rl-border, #ccc);
          background: var(--rl-surface, #fff);
          opacity: 0.6;
          transition: all 0.3s ease;
        }
        .rl-rendezvous__relay--active {
          opacity: 1;
          border-color: var(--rl-accent, #ff8a1e);
          background: var(--rl-accent-soft, rgba(255, 138, 30, 0.08));
        }
        .rl-rendezvous__room-label {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          color: var(--rl-text-dim, #666);
        }
        .rl-rendezvous__room-label code {
          background: var(--rl-surface-raised, #f5f5f5);
          padding: 0.1rem 0.3rem;
          border-radius: 3px;
        }
        .rl-rendezvous__icon {
          font-size: 1.5rem;
        }
        .rl-rendezvous__label {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          letter-spacing: 0.04em;
          color: var(--rl-text-dim, #666);
        }
        .rl-rendezvous__status {
          font-family: var(--rl-mono);
          font-size: 0.55rem;
          color: #16a34a;
          letter-spacing: 0.04em;
        }
        .rl-rendezvous__step-indicator {
          text-align: center;
          margin: 0.5rem 0;
        }
        .rl-rendezvous__step-count {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          color: var(--rl-text-dim, #666);
          display: block;
          margin-bottom: 0.2rem;
        }
        .rl-rendezvous__step-desc {
          font-size: 0.8rem;
          color: var(--rl-text, #333);
        }
        .rl-rendezvous__arrows {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          margin: 0.5rem 0;
        }
        .rl-rendezvous__line {
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          padding: 0.2rem 0.5rem;
          border-radius: 3px;
          background: var(--rl-surface-raised, #f5f5f5);
          color: var(--rl-text-dim, #666);
        }
        .rl-rendezvous__line--paired {
          background: var(--rl-accent-soft, rgba(255, 138, 30, 0.12));
          color: var(--rl-accent, #ff8a1e);
          font-weight: 600;
        }
        .rl-rendezvous__controls {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 0.8rem;
        }
        .rl-rendezvous__btn {
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          padding: 0.4rem 0.8rem;
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          background: var(--rl-surface, #fff);
          color: var(--rl-text-dim, #666);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .rl-rendezvous__btn:hover:not(:disabled) {
          border-color: var(--rl-accent, #ff8a1e);
          color: var(--rl-accent, #ff8a1e);
        }
        .rl-rendezvous__btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .rl-rendezvous__btn--reset {
          border-color: var(--rl-border, #ccc);
        }
      `}</style>
    </div>
  );
}
