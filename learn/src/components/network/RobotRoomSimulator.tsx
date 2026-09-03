import { useState } from 'react';

/**
 * Interactive RobotRoom simulator. Shows how the Durable Object
 * manages device/controller slots, detects staleness, and handles
 * reconnection.
 */
interface RoomState {
  deviceConnected: boolean;
  deviceResponsive: boolean;
  controllerConnected: boolean;
  controlSessionId: string | null;
  lastDeviceMessage: number;
  lastControllerMessage: number;
}

const DEVICE_STALE_MS = 6000;
const CONTROLLER_STALE_MS = 90_000;

function isStale(lastMessage: number, threshold: number, now: number): boolean {
  return now - lastMessage > threshold;
}

export function RobotRoomSimulator() {
  const [room, setRoom] = useState<RoomState>({
    deviceConnected: false,
    deviceResponsive: false,
    controllerConnected: false,
    controlSessionId: null,
    lastDeviceMessage: 0,
    lastControllerMessage: 0,
  });
  const [time, setTime] = useState(1000);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog((prev) => [...prev.slice(-9), msg]);

  const deviceConnect = () => {
    const now = time;
    setRoom((r) => ({
      ...r,
      deviceConnected: true,
      deviceResponsive: true,
      lastDeviceMessage: now,
    }));
    addLog(`t=${now}ms: Device connected`);
  };

  const deviceDisconnect = () => {
    setRoom((r) => ({
      ...r,
      deviceConnected: false,
      deviceResponsive: false,
    }));
    addLog(`t=${time}ms: Device disconnected`);
  };

  const controllerConnect = () => {
    const now = time;
    setRoom((r) => ({
      ...r,
      controllerConnected: true,
      lastControllerMessage: now,
      controlSessionId: r.controlSessionId ?? `session-${Date.now()}`,
    }));
    addLog(`t=${now}ms: Controller connected`);
  };

  const controllerDisconnect = () => {
    setRoom((r) => ({
      ...r,
      controllerConnected: false,
    }));
    addLog(`t=${time}ms: Controller disconnected`);
  };

  const sendTelemetry = () => {
    const now = time;
    setRoom((r) => ({
      ...r,
      deviceResponsive: true,
      lastDeviceMessage: now,
    }));
    addLog(`t=${now}ms: Device telemetry received`);
  };

  const advanceTime = (ms: number) => {
    setTime((t) => t + ms);
  };

  const deviceStale =
    room.deviceConnected && isStale(room.lastDeviceMessage, DEVICE_STALE_MS, time);
  const controllerStale =
    room.controllerConnected && isStale(room.lastControllerMessage, CONTROLLER_STALE_MS, time);

  return (
    <div className="rl-room-sim">
      <div className="rl-room-sim__header">
        <h4 className="rl-room-sim__title">RobotRoom Durable Object</h4>
        <div className="rl-room-sim__time">
          t = {time}ms
          <button className="rl-room-sim__time-btn" onClick={() => advanceTime(1000)}>
            +1s
          </button>
          <button className="rl-room-sim__time-btn" onClick={() => advanceTime(5000)}>
            +5s
          </button>
          <button className="rl-room-sim__time-btn" onClick={() => advanceTime(30_000)}>
            +30s
          </button>
        </div>
      </div>

      <div className="rl-room-sim__grid">
        <div className="rl-room-sim__slot">
          <div
            className={`rl-room-sim__slot-header ${room.deviceConnected ? 'rl-room-sim__slot-header--active' : ''}`}
          >
            Device Slot
          </div>
          <div className="rl-room-sim__slot-body">
            <div>Connected: {room.deviceConnected ? '✅' : '❌'}</div>
            <div>Responsive: {room.deviceResponsive ? '✅' : '❌'}</div>
            {deviceStale && (
              <div className="rl-room-sim__warning">
                {'⚠️ STALE (>'}
                {DEVICE_STALE_MS}
                {'ms)'}
              </div>
            )}
            <div className="rl-room-sim__slot-actions">
              <button
                className="rl-room-sim__btn"
                onClick={deviceConnect}
                disabled={room.deviceConnected}
              >
                Connect
              </button>
              <button
                className="rl-room-sim__btn"
                onClick={deviceDisconnect}
                disabled={!room.deviceConnected}
              >
                Disconnect
              </button>
              <button
                className="rl-room-sim__btn"
                onClick={sendTelemetry}
                disabled={!room.deviceConnected}
              >
                Telemetry
              </button>
            </div>
          </div>
        </div>

        <div className="rl-room-sim__slot">
          <div
            className={`rl-room-sim__slot-header ${room.controllerConnected ? 'rl-room-sim__slot-header--active' : ''}`}
          >
            Controller Slot
          </div>
          <div className="rl-room-sim__slot-body">
            <div>Connected: {room.controllerConnected ? '✅' : '❌'}</div>
            {room.controlSessionId && (
              <div>
                Session: <code>{room.controlSessionId}</code>
              </div>
            )}
            {controllerStale && (
              <div className="rl-room-sim__warning">
                {'⚠️ STALE (>'}
                {CONTROLLER_STALE_MS}
                {'ms)'}
              </div>
            )}
            <div className="rl-room-sim__slot-actions">
              <button
                className="rl-room-sim__btn"
                onClick={controllerConnect}
                disabled={room.controllerConnected}
              >
                Connect
              </button>
              <button
                className="rl-room-sim__btn"
                onClick={controllerDisconnect}
                disabled={!room.controllerConnected}
              >
                Disconnect
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rl-room-sim__log">
        <div className="rl-room-sim__log-title">Event Log</div>
        {log.length === 0 ? (
          <div className="rl-room-sim__log-empty">No events yet</div>
        ) : (
          log.map((entry, i) => (
            <div key={i} className="rl-room-sim__log-entry">
              {entry}
            </div>
          ))
        )}
      </div>

      <style>{`
        .rl-room-sim {
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          background: var(--rl-surface-raised, #fff);
          margin: 1.5rem 0;
          overflow: hidden;
        }
        .rl-room-sim__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.8rem 1rem;
          border-bottom: 1px solid var(--rl-border, #ccc);
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .rl-room-sim__title {
          font-family: var(--rl-mono);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          margin: 0;
          color: var(--rl-text-dim, #666);
        }
        .rl-room-sim__time {
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .rl-room-sim__time-btn {
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          padding: 0.2rem 0.4rem;
          border: 1px solid var(--rl-border, #ccc);
          border-radius: 3px;
          background: var(--rl-surface, #fff);
          cursor: pointer;
        }
        .rl-room-sim__grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0;
        }
        @media (max-width: 640px) {
          .rl-room-sim__grid {
            grid-template-columns: 1fr;
          }
        }
        .rl-room-sim__slot {
          border-right: 1px solid var(--rl-border, #eee);
        }
        .rl-room-sim__slot:last-child {
          border-right: none;
        }
        .rl-room-sim__slot-header {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          letter-spacing: 0.04em;
          padding: 0.5rem 0.8rem;
          background: var(--rl-surface, #fafafa);
          border-bottom: 1px solid var(--rl-border, #eee);
          color: var(--rl-text-dim, #666);
        }
        .rl-room-sim__slot-header--active {
          color: var(--rl-accent, #ff8a1e);
          font-weight: 600;
        }
        .rl-room-sim__slot-body {
          padding: 0.8rem;
          font-size: 0.8rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .rl-room-sim__slot-body code {
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          background: var(--rl-surface-raised, #f5f5f5);
          padding: 0.1rem 0.3rem;
          border-radius: 3px;
        }
        .rl-room-sim__warning {
          color: #dc2626;
          font-weight: 600;
          font-size: 0.75rem;
        }
        .rl-room-sim__slot-actions {
          display: flex;
          gap: 0.3rem;
          margin-top: 0.4rem;
          flex-wrap: wrap;
        }
        .rl-room-sim__btn {
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          padding: 0.25rem 0.5rem;
          border: 1px solid var(--rl-border, #ccc);
          border-radius: 3px;
          background: var(--rl-surface, #fff);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .rl-room-sim__btn:hover:not(:disabled) {
          border-color: var(--rl-accent, #ff8a1e);
          color: var(--rl-accent, #ff8a1e);
        }
        .rl-room-sim__btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .rl-room-sim__log {
          border-top: 1px solid var(--rl-border, #eee);
          padding: 0.6rem 0.8rem;
          max-height: 120px;
          overflow-y: auto;
        }
        .rl-room-sim__log-title {
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          letter-spacing: 0.04em;
          color: var(--rl-text-dim, #666);
          margin-bottom: 0.3rem;
        }
        .rl-room-sim__log-empty {
          font-size: 0.75rem;
          color: var(--rl-text-dim, #999);
          font-style: italic;
        }
        .rl-room-sim__log-entry {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          color: var(--rl-text-dim, #666);
          padding: 0.15rem 0;
          border-bottom: 1px solid var(--rl-border, #f5f5f5);
        }
      `}</style>
    </div>
  );
}
