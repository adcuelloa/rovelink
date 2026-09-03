import { useState } from 'react';

/**
 * Interactive visualizer showing why local control could be direct but
 * remote control needs a relay. Toggles between "Same LAN" and
 * "Different Networks" modes. BLE is NOT part of RoveLink's architecture.
 */
export function LocalRemoteVisualizer() {
  const [mode, setMode] = useState<'local' | 'remote'>('local');

  return (
    <div className="rl-local-remote">
      <div className="rl-local-remote__badge rl-local-remote__badge--example">
        <span className="rl-local-remote__badge-dot" />
        Networking concept
      </div>
      <div className="rl-local-remote__controls">
        <button
          className={`rl-local-remote__btn ${mode === 'local' ? 'rl-local-remote__btn--active' : ''}`}
          onClick={() => setMode('local')}
        >
          Same LAN (direct)
        </button>
        <button
          className={`rl-local-remote__btn ${mode === 'remote' ? 'rl-local-remote__btn--active' : ''}`}
          onClick={() => setMode('remote')}
        >
          Different Networks (relay)
        </button>
      </div>

      <div className="rl-local-remote__diagram">
        {mode === 'local' ? (
          <div className="rl-local-remote__path">
            <div className="rl-local-remote__node rl-local-remote__node--browser">
              <span className="rl-local-remote__icon">💻</span>
              <span className="rl-local-remote__label">Browser</span>
            </div>
            <div className="rl-local-remote__arrow">
              <span className="rl-local-remote__hop">LAN</span>
              <span className="rl-local-remote__latency rl-local-remote__latency--fast">~1ms</span>
            </div>
            <div className="rl-local-remote__node rl-local-remote__node--device">
              <span className="rl-local-remote__icon">🤖</span>
              <span className="rl-local-remote__label">Robot</span>
            </div>
          </div>
        ) : (
          <div className="rl-local-remote__path">
            <div className="rl-local-remote__node rl-local-remote__node--browser">
              <span className="rl-local-remote__icon">💻</span>
              <span className="rl-local-remote__label">Browser</span>
            </div>
            <div className="rl-local-remote__arrow">
              <span className="rl-local-remote__hop">WSS</span>
              <span className="rl-local-remote__latency">~50ms</span>
            </div>
            <div className="rl-local-remote__node rl-local-remote__node--relay">
              <span className="rl-local-remote__icon">☁️</span>
              <span className="rl-local-remote__label">Relay</span>
            </div>
            <div className="rl-local-remote__arrow">
              <span className="rl-local-remote__hop">WSS</span>
              <span className="rl-local-remote__latency">~50ms</span>
            </div>
            <div className="rl-local-remote__node rl-local-remote__node--device">
              <span className="rl-local-remote__icon">🤖</span>
              <span className="rl-local-remote__label">Robot</span>
            </div>
          </div>
        )}
      </div>

      <div className="rl-local-remote__note">
        {mode === 'local' ? (
          <p>
            On the same LAN, local routing may be possible — but RoveLink uses the relay even here
            for simplicity.
          </p>
        ) : (
          <p>
            Different networks — a private LAN address can't be routed from outside. Both sides
            connect outbound to the relay.
          </p>
        )}
      </div>

      <style>{`
        .rl-local-remote {
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          padding: 1rem;
          background: var(--rl-surface-raised, #fff);
          margin: 1.5rem 0;
        }
        .rl-local-remote__badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.2rem 0.5rem;
          border-radius: 3px;
          margin-bottom: 0.8rem;
        }
        .rl-local-remote__badge--example {
          background: rgba(99, 102, 241, 0.08);
          color: #6366f1;
        }
        .rl-local-remote__badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #6366f1;
        }
        .rl-local-remote__controls {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        .rl-local-remote__btn {
          font-family: var(--rl-mono);
          font-size: 0.75rem;
          padding: 0.4rem 0.8rem;
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          background: var(--rl-surface, #fff);
          color: var(--rl-text-dim, #666);
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .rl-local-remote__btn--active {
          background: var(--rl-accent, #ff8a1e);
          color: #1a1300;
          border-color: var(--rl-accent, #ff8a1e);
          font-weight: 600;
        }
        .rl-local-remote__diagram {
          display: flex;
          justify-content: center;
          padding: 1rem 0;
        }
        .rl-local-remote__path {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex-wrap: wrap;
          justify-content: center;
        }
        .rl-local-remote__node {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          padding: 0.6rem 0.8rem;
          border-radius: var(--rl-radius-sm, 4px);
          border: 1px solid var(--rl-border, #ccc);
          background: var(--rl-surface, #fff);
          min-width: 3rem;
        }
        .rl-local-remote__node--relay {
          border-color: var(--rl-accent, #ff8a1e);
          background: var(--rl-accent-soft, rgba(255, 138, 30, 0.08));
        }
        .rl-local-remote__icon {
          font-size: 1.5rem;
        }
        .rl-local-remote__label {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          letter-spacing: 0.04em;
          color: var(--rl-text-dim, #666);
        }
        .rl-local-remote__arrow {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.1rem;
        }
        .rl-local-remote__hop {
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          color: var(--rl-text-dim, #666);
        }
        .rl-local-remote__latency {
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          color: var(--rl-text-dim, #666);
          padding: 0.1rem 0.3rem;
          background: var(--rl-surface-raised, #f5f5f5);
          border-radius: 3px;
        }
        .rl-local-remote__latency--fast {
          color: #16a34a;
        }
        .rl-local-remote__note {
          text-align: center;
          font-size: 0.8rem;
          color: var(--rl-text-dim, #666);
          margin-top: 0.5rem;
        }
        .rl-local-remote__note p {
          margin: 0;
        }
      `}</style>
    </div>
  );
}
