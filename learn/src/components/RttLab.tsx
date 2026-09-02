import type { TransportEvent } from '@rovelink/web/src/transport/types.ts';
import { useEffect, useRef, useState } from 'react';

import { SimulatedTransport } from '../lib/sim/simulated-transport.ts';

export interface RttLabProps {
  readonly locale: 'en' | 'es';
}

const STRINGS = {
  en: {
    latency: (ms: number) => `simulated device-side latency: ${ms}ms`,
    relayTitle: 'Relay RTT',
    relayBody: 'Edge only — never touches the device.',
    controlTitle: 'Control RTT',
    controlBody: 'Browser → relay → device → relay → browser, for one applied frame.',
    simulated: 'SIMULATED',
    explain:
      'Drag the slider up: Control RTT climbs with it, while Relay RTT stays put — the robot itself can be the slow part of the trip even when the path to Cloudflare is fast.',
  },
  es: {
    latency: (ms: number) => `latencia simulada del lado del dispositivo: ${ms}ms`,
    relayTitle: 'RTT del relevo',
    relayBody: 'Solo el borde — nunca toca al dispositivo.',
    controlTitle: 'RTT de control',
    controlBody: 'Navegador → relevo → dispositivo → relevo → navegador, para un frame aplicado.',
    simulated: 'SIMULADO',
    explain:
      'Sube el control deslizante: el RTT de control sube con él, mientras que el RTT del relevo se mantiene — el robot mismo puede ser la parte lenta del viaje aunque el camino hacia Cloudflare sea rápido.',
  },
} as const;

/**
 * Relay RTT (a ping answered at the Cloudflare edge, never touching the
 * device) and Control RTT (browser -> relay -> device -> relay -> browser)
 * are deliberately different numbers in the real system — this lab makes
 * that visible by letting only the device-side leg get slower.
 */
export function RttLab({ locale }: RttLabProps) {
  const [latencyMs, setLatencyMs] = useState(30);
  const [relayRtt, setRelayRtt] = useState<number | null>(null);
  const [controlRtt, setControlRtt] = useState<number | null>(null);
  const transportRef = useRef<SimulatedTransport | null>(null);
  const t = STRINGS[locale];

  useEffect(() => {
    const transport = new SimulatedTransport('learn-robot', { latencyMs });
    transportRef.current = transport;
    const unsubscribe = transport.subscribe((event: TransportEvent) => {
      if (event.kind === 'control-rtt') setControlRtt(event.ms);
    });
    void transport
      .connect()
      .then(() =>
        transport.sendControl({ throttle: 0, steering: 0, gripper: 'idle', armed: false }),
      );

    const relayInterval = setInterval(() => {
      // Edge-only round trip: a small, steady value independent of whatever
      // the device-side latency slider below is set to.
      setRelayRtt(18 + Math.round(Math.random() * 6));
    }, 1500);

    const driveInterval = setInterval(() => {
      transport.sendControl({ throttle: 0.5, steering: 0, gripper: 'idle', armed: true });
    }, 400);

    return () => {
      unsubscribe();
      clearInterval(relayInterval);
      clearInterval(driveInterval);
      transport.disconnect();
    };
  }, []);

  useEffect(() => {
    transportRef.current?.setLatencyMs(latencyMs);
  }, [latencyMs]);

  return (
    <div className="rl-lab" lang={locale}>
      <div className="rl-panel">
        <label style={{ display: 'block' }}>
          <div
            style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.78rem', marginBottom: '0.3rem' }}
          >
            {t.latency(latencyMs)}
          </div>
          <input
            type="range"
            min={0}
            max={500}
            value={latencyMs}
            onChange={(e) => setLatencyMs(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="rl-panel">
          <p className="rl-panel__title">
            {t.relayTitle} <span className="rl-badge-sim">{t.simulated}</span>
          </p>
          <div style={{ fontFamily: 'var(--rl-mono)', fontSize: '1.4rem' }}>
            {relayRtt !== null ? `${relayRtt} ms` : '—'}
          </div>
          <p style={{ fontSize: '0.78rem', opacity: 0.75 }}>{t.relayBody}</p>
        </div>
        <div className="rl-panel">
          <p className="rl-panel__title">
            {t.controlTitle} <span className="rl-badge-sim">{t.simulated}</span>
          </p>
          <div style={{ fontFamily: 'var(--rl-mono)', fontSize: '1.4rem' }}>
            {controlRtt !== null ? `${controlRtt} ms` : '—'}
          </div>
          <p style={{ fontSize: '0.78rem', opacity: 0.75 }}>{t.controlBody}</p>
        </div>
      </div>
      <p style={{ fontSize: '0.85rem', opacity: 0.85 }}>{t.explain}</p>
    </div>
  );
}
