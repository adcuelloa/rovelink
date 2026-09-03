import { useState } from 'react';

/**
 * Simulates a NAT translation table. Shows how a home router maps
 * internal IP:port pairs to external IP:port pairs, explaining why
 * incoming connections can't find the ESP32.
 */
interface TableRow {
  readonly internal: string;
  readonly external: string;
  readonly device: string;
}

const TABLE_ROWS: readonly TableRow[] = [
  { internal: '192.168.1.42:54321', external: '203.0.113.7:41200', device: 'ESP32' },
  { internal: '192.168.1.10:443', external: '203.0.113.7:41201', device: 'Laptop' },
  { internal: '192.168.1.55:8080', external: '203.0.113.7:41202', device: 'Phone' },
];

export function NatTableSimulator() {
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [showMapping, setShowMapping] = useState(false);
  const selectedData: TableRow | null = selectedRow !== null ? TABLE_ROWS[selectedRow]! : null;

  return (
    <div className="rl-nat">
      <div className="rl-nat__badge rl-nat__badge--example">
        <span className="rl-nat__badge-dot" />
        Networking concept
      </div>
      <h4 className="rl-nat__title">NAT Translation Table (your router)</h4>

      <div className="rl-nat__table-wrapper">
        <table className="rl-nat__table">
          <thead>
            <tr>
              <th>Internal (LAN)</th>
              <th>External (WAN)</th>
              <th>Device</th>
            </tr>
          </thead>
          <tbody>
            {TABLE_ROWS.map((row, i) => (
              <tr
                key={i}
                className={`rl-nat__row ${selectedRow === i ? 'rl-nat__row--selected' : ''}`}
                onClick={() => {
                  setSelectedRow(i);
                  setShowMapping(true);
                }}
              >
                <td className="rl-nat__mono">{row.internal}</td>
                <td className="rl-nat__mono">{row.external}</td>
                <td>{row.device}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showMapping && selectedData !== null && (
        <div className="rl-nat__explanation">
          <div className="rl-nat__mapping">
            <div className="rl-nat__mapping-item">
              <span className="rl-nat__mapping-label">Inside your network:</span>
              <code className="rl-nat__mono">{selectedData.internal}</code>
            </div>
            <div className="rl-nat__mapping-arrow">↓ router translates ↓</div>
            <div className="rl-nat__mapping-item">
              <span className="rl-nat__mapping-label">Visible to internet:</span>
              <code className="rl-nat__mono">{selectedData.external}</code>
            </div>
          </div>
          <p className="rl-nat__note">
            An outsider sees <code className="rl-nat__mono">{selectedData.external}</code> but has
            no way to know it maps to <code className="rl-nat__mono">{selectedData.internal}</code>.
            The router only creates entries when <em>you</em> initiate an outbound connection.
          </p>
        </div>
      )}

      <button
        className="rl-nat__reset"
        onClick={() => {
          setSelectedRow(null);
          setShowMapping(false);
        }}
      >
        Reset
      </button>

      <style>{`
        .rl-nat {
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          padding: 1rem;
          background: var(--rl-surface-raised, #fff);
          margin: 1.5rem 0;
        }
        .rl-nat__badge {
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
        .rl-nat__badge--example {
          background: rgba(99, 102, 241, 0.08);
          color: #6366f1;
        }
        .rl-nat__badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #6366f1;
        }
        .rl-nat__title {
          font-family: var(--rl-mono);
          font-size: 0.75rem;
          letter-spacing: 0.04em;
          margin: 0 0 0.8rem 0;
          color: var(--rl-text-dim, #666);
        }
        .rl-nat__table-wrapper {
          overflow-x: auto;
        }
        .rl-nat__table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        .rl-nat__table th {
          font-family: var(--rl-mono);
          font-size: 0.65rem;
          letter-spacing: 0.04em;
          text-align: left;
          padding: 0.4rem 0.6rem;
          border-bottom: 1px solid var(--rl-border, #ccc);
          color: var(--rl-text-dim, #666);
        }
        .rl-nat__row {
          cursor: pointer;
          transition: background 0.12s ease;
        }
        .rl-nat__row:hover {
          background: var(--rl-surface, rgba(0,0,0,0.02));
        }
        .rl-nat__row--selected {
          background: var(--rl-accent-soft, rgba(255, 138, 30, 0.08));
        }
        .rl-nat__row td {
          padding: 0.4rem 0.6rem;
          border-bottom: 1px solid var(--rl-border, #eee);
        }
        .rl-nat__mono {
          font-family: var(--rl-mono);
          font-size: 0.75rem;
        }
        .rl-nat__explanation {
          margin-top: 1rem;
          padding: 0.8rem;
          border: 1px solid var(--rl-border, #eee);
          border-radius: var(--rl-radius-sm, 4px);
          background: var(--rl-surface, #fff);
        }
        .rl-nat__mapping {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
          margin-bottom: 0.8rem;
        }
        .rl-nat__mapping-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .rl-nat__mapping-label {
          font-size: 0.75rem;
          color: var(--rl-text-dim, #666);
        }
        .rl-nat__mapping-arrow {
          font-size: 0.7rem;
          color: var(--rl-text-dim, #999);
        }
        .rl-nat__note {
          font-size: 0.8rem;
          color: var(--rl-text-dim, #666);
          margin: 0;
          line-height: 1.5;
        }
        .rl-nat__reset {
          font-family: var(--rl-mono);
          font-size: 0.7rem;
          margin-top: 0.8rem;
          padding: 0.3rem 0.6rem;
          border: 1px solid var(--rl-border, #ccc);
          border-radius: var(--rl-radius-sm, 4px);
          background: var(--rl-surface, #fff);
          color: var(--rl-text-dim, #666);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
