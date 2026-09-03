import { useState } from 'react';

/**
 * Side-by-side comparison of protocol messages. Shows core connection
 * messages first, with additional message types available via progressive
 * disclosure. Click a message type to see its JSON shape and field descriptions.
 */
const CORE_MESSAGES = [
  {
    type: 'device.register',
    direction: 'device → relay',
    description: 'Robot announces itself to the relay.',
    json: {
      v: 1,
      type: 'device.register',
      robotId: 'r2',
      token: '***',
      firmware: 'rovelink_device/1.0',
    },
    fields: [
      { name: 'v', desc: 'Protocol version (must be 1)' },
      { name: 'type', desc: 'Message discriminator' },
      { name: 'robotId', desc: 'Which robot this device represents' },
      { name: 'token', desc: 'Device credential for authentication' },
      { name: 'firmware', desc: 'Firmware version string (informational)' },
    ],
  },
  {
    type: 'controller.register',
    direction: 'browser → relay',
    description: 'Browser requests to control a robot.',
    json: {
      v: 1,
      type: 'controller.register',
      robotId: 'r2',
      token: '***',
    },
    fields: [
      { name: 'v', desc: 'Protocol version (must be 1)' },
      { name: 'type', desc: 'Message discriminator' },
      { name: 'robotId', desc: 'Which robot to control' },
      { name: 'token', desc: 'Controller credential for authentication' },
    ],
  },
  {
    type: 'controller.session',
    direction: 'relay → both',
    description: 'Relay tells device and controller which session is active.',
    json: {
      v: 1,
      type: 'controller.session',
      robotId: 'r2',
      sessionId: 'abc-123',
    },
    fields: [
      { name: 'robotId', desc: 'Which robot this session belongs to' },
      { name: 'sessionId', desc: 'Relay-minted session identity' },
    ],
  },
  {
    type: 'control',
    direction: 'browser → relay → device',
    description: 'Driving command with throttle, steering, and gripper state.',
    json: {
      v: 1,
      type: 'control',
      seq: 42,
      sentAt: 1725400000000,
      ttlMs: 500,
      throttle: 0.72,
      steering: -0.18,
      gripper: 'open',
      armed: true,
      controlSessionId: 'abc-123',
    },
    fields: [
      { name: 'seq', desc: 'Sequence number — higher always wins' },
      { name: 'sentAt', desc: 'Browser clock when frame was created' },
      { name: 'ttlMs', desc: 'Time-to-live — robot ignores after this' },
      { name: 'throttle', desc: 'Forward/backward intent (-1 to 1)' },
      { name: 'steering', desc: 'Left/right intent (-1 to 1)' },
      { name: 'gripper', desc: "'idle', 'open', or 'close'" },
      { name: 'armed', desc: 'Whether motors are enabled' },
      { name: 'controlSessionId', desc: 'Stamped by relay, not browser' },
    ],
  },
  {
    type: 'telemetry',
    direction: 'device → relay → browser',
    description: 'Robot reports its current state back to the browser.',
    json: {
      v: 1,
      type: 'telemetry',
      sentAt: 1725400000100,
      ackSeq: 41,
      ackSessionId: 'abc-123',
      rssi: -55,
      throttle: 0.72,
      steering: -0.18,
      armed: true,
    },
    fields: [
      { name: 'ackSeq', desc: 'Last control seq the robot applied' },
      { name: 'ackSessionId', desc: 'Which session ackSeq belongs to' },
      { name: 'rssi', desc: 'WiFi signal strength in dBm' },
    ],
  },
  {
    type: 'ping',
    direction: 'browser → relay',
    description: 'Browser measures round-trip time to the relay edge.',
    json: {
      v: 1,
      type: 'ping',
      id: 1,
      sentAt: 1725400000000,
    },
    fields: [
      { name: 'id', desc: 'Ping identifier for matching pong' },
      { name: 'sentAt', desc: 'Browser clock when ping was sent' },
    ],
  },
  {
    type: 'pong',
    direction: 'relay → browser',
    description: 'Relay echoes the ping back with its own timestamp.',
    json: {
      v: 1,
      type: 'pong',
      id: 1,
      sentAt: 1725400000000,
      echoAt: 1725400000020,
    },
    fields: [
      { name: 'id', desc: 'Matches the ping' },
      { name: 'sentAt', desc: 'Original ping timestamp' },
      { name: 'echoAt', desc: 'Relay clock when pong was sent' },
    ],
  },
];

const ADDITIONAL_MESSAGES = [
  {
    type: 'emergency-stop',
    direction: 'browser → relay → device',
    description: 'Immediate halt, independent of session or sequence.',
    json: {
      v: 1,
      type: 'emergency-stop',
      sentAt: 1725400000000,
      reason: 'controller-disconnected',
    },
    fields: [
      { name: 'sentAt', desc: 'When the stop was triggered' },
      { name: 'reason', desc: 'Why the stop was triggered' },
    ],
  },
  {
    type: 'control.ack',
    direction: 'device → relay → browser',
    description: 'Device confirms it applied a control frame.',
    json: {
      v: 1,
      type: 'control.ack',
      seq: 42,
      controlSessionId: 'abc-123',
    },
    fields: [
      { name: 'seq', desc: 'Which control frame was applied' },
      { name: 'controlSessionId', desc: 'Session the ack belongs to' },
    ],
  },
  {
    type: 'emergency-stop.ack',
    direction: 'device → relay → browser',
    description: 'Device confirms it applied an emergency stop.',
    json: {
      v: 1,
      type: 'emergency-stop.ack',
      sentAt: 1725400000000,
    },
    fields: [{ name: 'sentAt', desc: 'Matches the original emergency-stop' }],
  },
  {
    type: 'room',
    direction: 'relay → both',
    description: 'Presence broadcast — who is online right now.',
    json: {
      v: 1,
      type: 'room',
      robotId: 'r2',
      deviceOnline: true,
      controllerOnline: true,
    },
    fields: [
      { name: 'deviceOnline', desc: 'Is the robot connected and responsive?' },
      { name: 'controllerOnline', desc: 'Is a browser controlling it?' },
    ],
  },
  {
    type: 'controller.videoTicket.request',
    direction: 'browser → relay',
    description: 'Browser requests a video viewer ticket.',
    json: {
      v: 1,
      type: 'controller.videoTicket.request',
    },
    fields: [],
  },
  {
    type: 'controller.videoTicket',
    direction: 'relay → browser',
    description: 'Relay sends a short-lived video ticket back.',
    json: {
      v: 1,
      type: 'controller.videoTicket',
      robotId: 'r2',
      ticket: '***',
      expiresAt: 1725400060000,
    },
    fields: [
      { name: 'ticket', desc: 'Short-lived video viewer credential' },
      { name: 'expiresAt', desc: 'When the ticket expires' },
    ],
  },
];

export function ProtocolCompare() {
  const [selected, setSelected] = useState(0);
  const [showAdditional, setShowAdditional] = useState(false);
  const allMessages = showAdditional ? [...CORE_MESSAGES, ...ADDITIONAL_MESSAGES] : CORE_MESSAGES;
  const msg = allMessages[selected]!;

  return (
    <div className="rl-protocol">
      <div className="rl-protocol__badge rl-protocol__badge--implemented">
        <span className="rl-protocol__badge-dot" />
        Implemented in protocol/src/protocol.ts
      </div>
      <div className="rl-protocol__tabs">
        {CORE_MESSAGES.map((m, i) => (
          <button
            key={m.type}
            className={`rl-protocol__tab ${i === selected && !showAdditional ? 'rl-protocol__tab--active' : ''}`}
            onClick={() => {
              setSelected(i);
              setShowAdditional(false);
            }}
          >
            {m.type}
          </button>
        ))}
      </div>

      {showAdditional && (
        <div className="rl-protocol__tabs rl-protocol__tabs--secondary">
          {ADDITIONAL_MESSAGES.map((m, i) => (
            <button
              key={m.type}
              className={`rl-protocol__tab ${i === selected - CORE_MESSAGES.length ? 'rl-protocol__tab--active' : ''}`}
              onClick={() => setSelected(CORE_MESSAGES.length + i)}
            >
              {m.type}
            </button>
          ))}
        </div>
      )}

      <div
        className="rl-protocol__toggle"
        onClick={() => {
          setShowAdditional(!showAdditional);
          if (!showAdditional) setSelected(CORE_MESSAGES.length);
          else setSelected(0);
        }}
      >
        <span className="rl-protocol__toggle-icon">{showAdditional ? '▾' : '▸'}</span>
        {showAdditional
          ? 'Hide additional messages'
          : 'Show additional messages (e-stop, ack, room, video)'}
      </div>

      <div className="rl-protocol__content">
        <div className="rl-protocol__header">
          <span className="rl-protocol__direction">{msg.direction}</span>
          <span className="rl-protocol__desc">{msg.description}</span>
        </div>

        <div className="rl-protocol__body">
          <div className="rl-protocol__json">
            <pre>{JSON.stringify(msg.json, null, 2)}</pre>
          </div>

          <div className="rl-protocol__fields">
            <h4 className="rl-protocol__fields-title">Fields</h4>
            {msg.fields.map((f) => (
              <div key={f.name} className="rl-protocol__field">
                <code className="rl-protocol__field-name">{f.name}</code>
                <span className="rl-protocol__field-desc">{f.desc}</span>
              </div>
            ))}
            {msg.fields.length === 0 && (
              <div className="rl-protocol__field">
                <span className="rl-protocol__field-desc" style={{ fontStyle: 'italic' }}>
                  No additional fields
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .rl-protocol {
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          background: var(--rl-surface-raised, #fff);
          margin: 1.5rem 0;
          overflow: hidden;
        }
        .rl-protocol__badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-family: var(--rl-mono);
          font-size: 0.6rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.3rem 0.6rem;
          margin: 0.6rem 0 0 0.6rem;
          border-radius: 3px;
        }
        .rl-protocol__badge--implemented {
          background: rgba(22, 163, 74, 0.08);
          color: #16a34a;
        }
        .rl-protocol__badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #16a34a;
        }
        .rl-protocol__tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 0;
          border-bottom: 1px solid var(--rl-border, #ccc);
          background: var(--rl-surface, #fafafa);
        }
        .rl-protocol__tabs--secondary {
          border-top: 1px dashed var(--rl-border, #ddd);
        }
        .rl-protocol__tab {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          padding: 0.5rem 0.7rem;
          border: none;
          border-bottom: 2px solid transparent;
          background: transparent;
          color: var(--rl-text-dim, #666);
          cursor: pointer;
          transition: all 0.12s ease;
        }
        .rl-protocol__tab:hover {
          color: var(--rl-accent, #ff8a1e);
        }
        .rl-protocol__tab--active {
          color: var(--rl-accent, #ff8a1e);
          border-bottom-color: var(--rl-accent, #ff8a1e);
          font-weight: 600;
        }
        .rl-protocol__toggle {
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          padding: 0.5rem 0.8rem;
          cursor: pointer;
          color: var(--rl-text-dim, #666);
          border-bottom: 1px solid var(--rl-border, #eee);
          transition: color 0.12s ease;
        }
        .rl-protocol__toggle:hover {
          color: var(--rl-accent, #ff8a1e);
        }
        .rl-protocol__toggle-icon {
          margin-right: 0.3rem;
        }
        .rl-protocol__content {
          padding: 1rem;
        }
        .rl-protocol__header {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }
        .rl-protocol__direction {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          padding: 0.2rem 0.5rem;
          border-radius: 3px;
          background: var(--rl-accent-soft, rgba(255, 138, 30, 0.08));
          color: var(--rl-accent, #ff8a1e);
          letter-spacing: 0.04em;
        }
        .rl-protocol__desc {
          font-size: 0.85rem;
          color: var(--rl-text, #333);
        }
        .rl-protocol__body {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }
        @media (max-width: 640px) {
          .rl-protocol__body {
            grid-template-columns: 1fr;
          }
        }
        .rl-protocol__json {
          background: var(--rl-surface, #1a1a2e);
          border-radius: var(--rl-radius-sm, 4px);
          padding: 0.8rem;
          overflow-x: auto;
        }
        .rl-protocol__json pre {
          margin: 0;
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          color: #e2e8f0;
          line-height: 1.5;
        }
        .rl-protocol__fields-title {
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          letter-spacing: 0.04em;
          margin: 0 0 0.5rem 0;
          color: var(--rl-text-dim, #666);
        }
        .rl-protocol__field {
          display: flex;
          gap: 0.5rem;
          padding: 0.3rem 0;
          border-bottom: 1px solid var(--rl-border, #eee);
          font-size: 0.8rem;
        }
        .rl-protocol__field-name {
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          color: var(--rl-accent, #ff8a1e);
          min-width: 8rem;
          flex-shrink: 0;
        }
        .rl-protocol__field-desc {
          color: var(--rl-text-dim, #666);
        }
      `}</style>
    </div>
  );
}
