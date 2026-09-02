import { createControlFrame } from '@rovelink/protocol';
import { useState } from 'react';

import { SimulatedFirmware, SimulatedRelay } from '../lib/sim/simulated-relay-firmware.ts';

export interface SessionSequenceLabProps {
  readonly locale: 'en' | 'es';
}

const DISARMED = { throttle: 0, steering: 0, gripper: 'idle' as const, armed: false };
const DRIVING = { throttle: 0.5, steering: 0, gripper: 'idle' as const, armed: true };

const STRINGS = {
  en: {
    run: 'Run',
    reorderTitle: 'Packet reorder',
    reorderBody: 'Sequence 101, 102, 103, 104 delivered out of order as 101, 103, 102, 104.',
    reorderExplain:
      '102 ≤ lastSeq (103 already advanced it) — a stale control must never override a newer one.',
    duplicateTitle: 'Duplicate packet',
    duplicateBody: 'The same seq is sent twice.',
    reconnectTitle: 'Controller reconnect',
    reconnectBody:
      'Session A drives, then the controller reconnects (session B mints), then a delayed session-A frame finally arrives, then B must still establish its own disarmed baseline.',
    reconnectExplain:
      'SEQ orders frames within a session. SESSION provides authority across controller lifetimes — a frame from A is dropped outright once B is active, no matter its seq.',
  },
  es: {
    run: 'Ejecutar',
    reorderTitle: 'Reordenamiento de paquetes',
    reorderBody: 'La secuencia 101, 102, 103, 104 se entrega desordenada como 101, 103, 102, 104.',
    reorderExplain:
      '102 ≤ lastSeq (103 ya lo había avanzado) — un control obsoleto nunca debe pisar uno más nuevo.',
    duplicateTitle: 'Paquete duplicado',
    duplicateBody: 'El mismo seq se envía dos veces.',
    reconnectTitle: 'Reconexión del control',
    reconnectBody:
      'La sesión A maneja, luego el control se reconecta (se genera la sesión B), luego finalmente llega un frame demorado de la sesión A, y B todavía debe establecer su propia línea base desarmada.',
    reconnectExplain:
      'SEQ ordena los frames dentro de una sesión. SESSION da autoridad a través de las vidas del controlador — un frame de A se descarta directamente en cuanto B está activa, sin importar su seq.',
  },
} as const;

interface LogRow {
  readonly seq: number;
  readonly session: string;
  readonly result: 'ACCEPT' | 'DROP';
  readonly reason?: string;
}

function useScenario() {
  const [log, setLog] = useState<readonly LogRow[]>([]);
  function run(steps: readonly { seq: number; session: 'A' | 'B'; armed?: boolean }[]) {
    const relay = new SimulatedRelay();
    const firmware = new SimulatedFirmware();
    const sessions: Record<'A' | 'B', string> = { A: '', B: '' };
    sessions.A = relay.mintSession();
    firmware.onSessionChanged(sessions.A);

    const rows: LogRow[] = [];
    let now = 0;
    for (const step of steps) {
      if (step.session === 'B' && sessions.B === '') {
        sessions.B = relay.mintSession();
        firmware.onSessionChanged(sessions.B);
      }
      now += 10;
      const state = step.armed ? DRIVING : DISARMED;
      const frame = {
        ...createControlFrame(state, step.seq, now),
        controlSessionId: sessions[step.session],
      };
      const outcome = firmware.applyFrame(frame, now);
      rows.push({
        seq: step.seq,
        session: step.session,
        result: outcome.accepted ? 'ACCEPT' : 'DROP',
        reason: outcome.accepted ? undefined : outcome.reason,
      });
    }
    setLog(rows);
  }
  return { log, run };
}

export function SessionSequenceLab({ locale }: SessionSequenceLabProps) {
  const reorder = useScenario();
  const duplicate = useScenario();
  const reconnect = useScenario();
  const t = STRINGS[locale];

  return (
    <div className="rl-lab" lang={locale}>
      <div className="rl-panel">
        <p className="rl-panel__title">{t.reorderTitle}</p>
        <p style={{ fontSize: '0.85rem' }}>{t.reorderBody}</p>
        <button
          type="button"
          className="rl-btn"
          onClick={() =>
            reorder.run([
              { seq: 101, session: 'A' },
              { seq: 103, session: 'A' },
              { seq: 102, session: 'A' },
              { seq: 104, session: 'A' },
            ])
          }
        >
          {t.run}
        </button>
        <Log rows={reorder.log} />
        {reorder.log.some((r) => r.result === 'DROP') && (
          <p style={{ fontSize: '0.82rem', opacity: 0.85 }}>{t.reorderExplain}</p>
        )}
      </div>

      <div className="rl-panel">
        <p className="rl-panel__title">{t.duplicateTitle}</p>
        <p style={{ fontSize: '0.85rem' }}>{t.duplicateBody}</p>
        <button
          type="button"
          className="rl-btn"
          onClick={() =>
            duplicate.run([
              { seq: 5, session: 'A' },
              { seq: 5, session: 'A' },
            ])
          }
        >
          {t.run}
        </button>
        <Log rows={duplicate.log} />
      </div>

      <div className="rl-panel">
        <p className="rl-panel__title">{t.reconnectTitle}</p>
        <p style={{ fontSize: '0.85rem' }}>{t.reconnectBody}</p>
        <button
          type="button"
          className="rl-btn"
          onClick={() =>
            reconnect.run([
              { seq: 1, session: 'A' },
              { seq: 2, session: 'A', armed: true },
              { seq: 3, session: 'A', armed: true }, // delayed A frame, applied after B below
              { seq: 1, session: 'B', armed: true }, // B's very first frame — before its own baseline
              { seq: 2, session: 'B' },
              { seq: 3, session: 'B', armed: true },
            ])
          }
        >
          {t.run}
        </button>
        <Log rows={reconnect.log} />
        <p style={{ fontSize: '0.82rem', opacity: 0.85 }}>{t.reconnectExplain}</p>
      </div>
    </div>
  );
}

function Log({ rows }: { readonly rows: readonly LogRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: '0.6rem 0 0',
        padding: 0,
        fontFamily: 'var(--rl-mono)',
        fontSize: '0.8rem',
      }}
    >
      {rows.map((row, i) => (
        <li key={i} style={{ color: row.result === 'ACCEPT' ? 'var(--rl-ok)' : 'var(--rl-error)' }}>
          seq={row.seq} session={row.session} → {row.result}
          {row.reason ? ` (${row.reason})` : ''}
        </li>
      ))}
    </ul>
  );
}
