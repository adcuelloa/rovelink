import { CONTROL_TTL_MS, createControlFrame } from '@rovelink/protocol';
import { DEFAULT_RHYTHM } from '@rovelink/web/src/transport/rhythm.ts';
import { useEffect, useRef, useState } from 'react';

import { SimulatedFirmware, SimulatedRelay } from '../lib/sim/simulated-relay-firmware.ts';

export interface TtlTimelineProps {
  readonly locale: 'en' | 'es';
}

const DRIVING = { throttle: 0.7, steering: 0, gripper: 'idle' as const, armed: true };
const DISARMED = { throttle: 0, steering: 0, gripper: 'idle' as const, armed: false };

const STRINGS = {
  en: {
    hold: 'Hold W (drive)',
    cut: 'Cut connection',
    caption: (ms: number) => `elapsed since last accepted frame vs CONTROL_TTL_MS (${ms}ms)`,
    safeState: ' — SAFE STATE (TTL expired)',
    explain: (heartbeatMs: number, ttlMs: number) =>
      `Heartbeat re-sends every ${heartbeatMs}ms while driving — comfortably under the ${ttlMs}ms watchdog. Once the link is cut, no new frame ever resets the clock, and the vehicle falls back to safe state on its own, without waiting for anyone to release the key.`,
  },
  es: {
    hold: 'Mantén W (manejar)',
    cut: 'Cortar conexión',
    caption: (ms: number) => `tiempo desde el último frame aceptado vs CONTROL_TTL_MS (${ms}ms)`,
    safeState: ' — ESTADO SEGURO (TTL expirado)',
    explain: (heartbeatMs: number, ttlMs: number) =>
      `El heartbeat reenvía cada ${heartbeatMs}ms mientras manejas — cómodamente por debajo del watchdog de ${ttlMs}ms. Una vez cortado el enlace, ningún frame nuevo reinicia el reloj, y el vehículo cae a estado seguro por sí solo, sin esperar a que alguien suelte la tecla.`,
  },
} as const;

/**
 * Isolated TTL/watchdog demonstration: hold "driving", then cut the link and
 * watch elapsed time race the real `CONTROL_TTL_MS` (500ms) threshold from
 * protocol.ts until the (simulated) firmware falls back to safe state on its
 * own — exactly `watchTtl()` in rovelink_device.ino, holding a key physically
 * does nothing once frames stop actually arriving.
 */
export function TtlTimeline({ locale }: TtlTimelineProps) {
  const relayRef = useRef(new SimulatedRelay());
  const firmwareRef = useRef(new SimulatedFirmware());
  const seqRef = useRef(0);
  const lastAcceptedRef = useRef<number>(0);
  const startRef = useRef<number>(performance.now());

  const [driving, setDriving] = useState(false);
  const [cut, setCut] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [stopped, setStopped] = useState(false);

  function now(): number {
    return performance.now() - startRef.current;
  }

  useEffect(() => {
    const sessionId = relayRef.current.mintSession();
    firmwareRef.current.onSessionChanged(sessionId);
    const t = now();
    firmwareRef.current.applyFrame(
      relayRef.current.stamp(createControlFrame(DISARMED, ++seqRef.current, t)),
      t,
    );
    // The watchdog only ever matters once armed (checkTtl is a no-op while
    // disarmed), but seeding this now keeps the displayed "elapsed" counter
    // meaningful from first paint instead of counting up from page load.
    lastAcceptedRef.current = t;
  }, []);

  useEffect(() => {
    if (!driving || cut) return undefined;
    const interval = setInterval(() => {
      const t = now();
      const outcome = firmwareRef.current.applyFrame(
        relayRef.current.stamp(createControlFrame(DRIVING, ++seqRef.current, t)),
        t,
      );
      if (outcome.accepted) lastAcceptedRef.current = t;
    }, DEFAULT_RHYTHM.heartbeatMs);
    return () => clearInterval(interval);
  }, [driving, cut]);

  useEffect(() => {
    let raf = 0;
    function tick(): void {
      raf = requestAnimationFrame(tick);
      const t = now();
      setElapsed(Math.max(0, t - lastAcceptedRef.current));
      if (firmwareRef.current.checkTtl(t)) setStopped(true);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pct = Math.min(100, (elapsed / CONTROL_TTL_MS) * 100);
  const t = STRINGS[locale];

  return (
    <div className="rl-lab" lang={locale}>
      <div className="rl-btn-row">
        <button
          type="button"
          className="rl-btn"
          aria-pressed={driving}
          onClick={() => {
            setDriving(true);
            setCut(false);
            setStopped(false);
            lastAcceptedRef.current = now();
          }}
        >
          {t.hold}
        </button>
        <button
          type="button"
          className="rl-btn rl-btn--danger"
          disabled={!driving || cut}
          onClick={() => setCut(true)}
        >
          {t.cut}
        </button>
      </div>

      <div className="rl-panel">
        <p className="rl-panel__title">{t.caption(CONTROL_TTL_MS)}</p>
        <div style={{ height: 14, borderRadius: 7, background: '#2a2f38', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: pct >= 100 ? 'var(--rl-error)' : 'var(--rl-accent)',
              transition: 'width 0.08s linear',
            }}
          />
        </div>
        <div style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          {Math.round(elapsed)}ms / {CONTROL_TTL_MS}ms{stopped ? t.safeState : ''}
        </div>
      </div>

      <p style={{ fontSize: '0.85rem', opacity: 0.85 }}>
        {t.explain(DEFAULT_RHYTHM.heartbeatMs, CONTROL_TTL_MS)}
      </p>
    </div>
  );
}
