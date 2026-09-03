import { useState } from 'react';

/**
 * Timeline visualizer showing presence detection over time.
 * Shows how the relay marks device/controller as stale when
 * they stop sending messages.
 */
interface TimelineEvent {
  time: number;
  type: 'device-telemetry' | 'device-disconnect' | 'controller-message' | 'controller-disconnect';
  label: string;
}

const EVENTS: TimelineEvent[] = [
  { time: 0, type: 'device-telemetry', label: 'Device telemetry' },
  { time: 500, type: 'controller-message', label: 'Controller sends control' },
  { time: 1000, type: 'device-telemetry', label: 'Device telemetry' },
  { time: 1500, type: 'controller-message', label: 'Controller sends control' },
  { time: 2000, type: 'device-telemetry', label: 'Device telemetry' },
  { time: 2500, type: 'device-disconnect', label: 'Device disconnects!' },
  { time: 4000, type: 'controller-message', label: 'Controller sends control' },
  { time: 6000, type: 'controller-message', label: 'Controller sends control' },
  { time: 8000, type: 'controller-disconnect', label: 'Controller disconnects!' },
  { time: 10_000, type: 'controller-message', label: 'Controller sends control' },
];

/**
 * Compressed staleness thresholds for demonstration only.
 * Production values (relay/src/room.ts): device=6s, controller=90s.
 * These are scaled down so staleness is visible within a 10s timeline.
 */
const DEMO_DEVICE_STALE_MS = 3500;
const DEMO_CONTROLLER_STALE_MS = 8000;

export function PresenceTimeline() {
  const [currentIdx, setCurrentIdx] = useState(-1);

  const currentTime =
    currentIdx >= 0 && EVENTS[currentIdx] !== undefined ? EVENTS[currentIdx].time : 0;

  const getDeviceState = (time: number) => {
    const lastTelemetry = [...EVENTS]
      .slice(0, currentIdx + 1)
      .filter((e) => e.type === 'device-telemetry')
      .pop();
    const disconnected = EVENTS.findIndex(
      (e, i) => i <= currentIdx && e.type === 'device-disconnect',
    );
    if (disconnected >= 0) return 'disconnected';
    if (!lastTelemetry) return 'offline';
    if (time - lastTelemetry.time > DEMO_DEVICE_STALE_MS) return 'stale';
    return 'online';
  };

  const getControllerState = (time: number) => {
    const lastMessage = [...EVENTS]
      .slice(0, currentIdx + 1)
      .filter((e) => e.type === 'controller-message')
      .pop();
    const disconnected = EVENTS.findIndex(
      (e, i) => i <= currentIdx && e.type === 'controller-disconnect',
    );
    if (disconnected >= 0) return 'disconnected';
    if (!lastMessage) return 'offline';
    if (time - lastMessage.time > DEMO_CONTROLLER_STALE_MS) return 'stale';
    return 'online';
  };

  const deviceState = getDeviceState(currentTime);
  const controllerState = getControllerState(currentTime);

  const stateColors: Record<string, string> = {
    online: '#16a34a',
    stale: '#dc2626',
    disconnected: '#6b7280',
    offline: '#d1d5db',
  };

  return (
    <div className="rl-presence">
      <div className="rl-presence__badge rl-presence__badge--example">
        <span className="rl-presence__badge-dot" />
        Stepped example — not a live monitor
      </div>
      <div className="rl-presence__header">
        <h4 className="rl-presence__title">Presence Detection Timeline</h4>
        <div className="rl-presence__legend">
          <span className="rl-presence__legend-item">
            <span className="rl-presence__dot" style={{ background: stateColors.online }} /> Online
          </span>
          <span className="rl-presence__legend-item">
            <span className="rl-presence__dot" style={{ background: stateColors.stale }} /> Stale
          </span>
          <span className="rl-presence__legend-item">
            <span className="rl-presence__dot" style={{ background: stateColors.disconnected }} />{' '}
            Disconnected
          </span>
        </div>
      </div>

      <div className="rl-presence__tracks">
        <div className="rl-presence__track">
          <div className="rl-presence__track-label">Device</div>
          <div className="rl-presence__track-bar">
            {currentIdx >= 0 && (
              <div
                className="rl-presence__track-status"
                style={{ background: stateColors[deviceState] }}
              >
                {deviceState}
              </div>
            )}
          </div>
        </div>
        <div className="rl-presence__track">
          <div className="rl-presence__track-label">Controller</div>
          <div className="rl-presence__track-bar">
            {currentIdx >= 0 && (
              <div
                className="rl-presence__track-status"
                style={{ background: stateColors[controllerState] }}
              >
                {controllerState}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rl-presence__timeline">
        <div className="rl-presence__events">
          {EVENTS.map((event, i) => (
            <button
              key={i}
              className={`rl-presence__event ${i === currentIdx ? 'rl-presence__event--current' : ''} ${i <= currentIdx ? 'rl-presence__event--passed' : ''}`}
              onClick={() => setCurrentIdx(i)}
            >
              <span className="rl-presence__event-time">{event.time}ms</span>
              <span className="rl-presence__event-dot" />
              <span className="rl-presence__event-label">{event.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rl-presence__controls">
        <button
          className="rl-presence__btn"
          onClick={() => setCurrentIdx(Math.max(-1, currentIdx - 1))}
          disabled={currentIdx < 0}
        >
          ← Prev
        </button>
        <button
          className="rl-presence__btn"
          onClick={() => setCurrentIdx(Math.min(EVENTS.length - 1, currentIdx + 1))}
          disabled={currentIdx >= EVENTS.length - 1}
        >
          Next →
        </button>
        <button
          className="rl-presence__btn rl-presence__btn--reset"
          onClick={() => setCurrentIdx(-1)}
        >
          Reset
        </button>
      </div>

      <style>{`
        .rl-presence {
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          background: var(--rl-surface-raised, #fff);
          margin: 1.5rem 0;
          padding: 1rem;
        }
        .rl-presence__badge {
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
        .rl-presence__badge--example {
          background: rgba(234, 179, 8, 0.08);
          color: #ca8a04;
        }
        .rl-presence__badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #ca8a04;
        }
        .rl-presence__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .rl-presence__title {
          font-family: var(--rl-mono);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          margin: 0;
          color: var(--rl-text-dim, #666);
        }
        .rl-presence__legend {
          display: flex;
          gap: 0.8rem;
        }
        .rl-presence__legend-item {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          font-size: 0.7rem;
          color: var(--rl-text-dim, #666);
        }
        .rl-presence__dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }
        .rl-presence__tracks {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        @media (max-width: 640px) {
          .rl-presence__tracks {
            grid-template-columns: 1fr;
          }
        }
        .rl-presence__track {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .rl-presence__track-label {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          color: var(--rl-text-dim, #666);
          min-width: 4rem;
        }
        .rl-presence__track-bar {
          flex: 1;
          height: 1.5rem;
          border: 1px solid var(--rl-border, #eee);
          border-radius: 3px;
          display: flex;
          align-items: center;
          padding: 0 0.5rem;
        }
        .rl-presence__track-status {
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          color: white;
          padding: 0.15rem 0.4rem;
          border-radius: 3px;
          letter-spacing: 0.04em;
        }
        .rl-presence__timeline {
          margin: 1rem 0;
          overflow-x: auto;
        }
        .rl-presence__events {
          display: flex;
          gap: 0;
          min-width: max-content;
        }
        .rl-presence__event {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
          padding: 0.5rem 0.6rem;
          border: none;
          background: transparent;
          cursor: pointer;
          opacity: 0.4;
          transition: opacity 0.15s ease;
          min-width: 4rem;
        }
        .rl-presence__event--passed {
          opacity: 0.7;
        }
        .rl-presence__event--current {
          opacity: 1;
        }
        .rl-presence__event-time {
          font-family: var(--rl-mono);
          font-size: 0.55rem;
          color: var(--rl-text-dim, #666);
        }
        .rl-presence__event-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--rl-border, #ccc);
          transition: background 0.15s ease;
        }
        .rl-presence__event--current .rl-presence__event-dot {
          background: var(--rl-accent, #ff8a1e);
          box-shadow: 0 0 0 3px var(--rl-accent-soft, rgba(255, 138, 30, 0.2));
        }
        .rl-presence__event--passed .rl-presence__event-dot {
          background: var(--rl-accent, #ff8a1e);
        }
        .rl-presence__event-label {
          font-size: 0.6rem;
          color: var(--rl-text-dim, #666);
          text-align: center;
          max-width: 5rem;
        }
        .rl-presence__controls {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          margin-top: 0.8rem;
        }
        .rl-presence__btn {
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
        .rl-presence__btn:hover:not(:disabled) {
          border-color: var(--rl-accent, #ff8a1e);
          color: var(--rl-accent, #ff8a1e);
        }
        .rl-presence__btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
