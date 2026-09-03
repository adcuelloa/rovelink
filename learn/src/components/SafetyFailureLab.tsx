import type { ControlState } from '@rovelink/protocol';
import { createControlFrame } from '@rovelink/protocol';
import { useRef, useState } from 'react';

import { SimulatedFirmware, SimulatedRelay } from '../lib/sim/simulated-relay-firmware.ts';

export interface SafetyFailureLabProps {
  readonly locale: 'en' | 'es';
}

const DISARMED: ControlState = { throttle: 0, steering: 0, gripper: 'idle', armed: false };
const DRIVING: ControlState = { throttle: 0.6, steering: 0, gripper: 'idle', armed: true };

type Decision = 'ACCEPT' | 'REJECT' | 'SAFE STOP';

type SafetyGate =
  | 'CONNECTED'
  | 'REGISTERED'
  | 'CURRENT SESSION'
  | 'BASELINE READY'
  | 'ARMED'
  | 'FRESH CONTROL';

const SAFETY_GATES: readonly SafetyGate[] = [
  'CONNECTED',
  'REGISTERED',
  'CURRENT SESSION',
  'BASELINE READY',
  'ARMED',
  'FRESH CONTROL',
] as const;

const STRINGS = {
  en: {
    title: 'Safety & Authority Lab',
    subtitle:
      'Exercise the safety gate checks in order. Each button triggers a scenario — observe which gate accepts, rejects, or forces a safe stop.',
    newSession: 'New Session',
    sendBaseline: 'Send Safe Baseline',
    armDrive: 'Arm & Drive',
    dropNetwork: 'Drop Network',
    replayOldSeq: 'Replay Old Seq',
    sendOldSession: 'Send Old Session',
    skipBaseline: 'Skip Baseline',
    emergencyStop: 'Emergency Stop',
    reconnectController: 'Reconnect Controller',
    reset: 'Reset Lab',
    authorityLadder: 'Authority Ladder',
    safetyGate: 'Safety Gate State',
    eventLog: 'Event Log',
    reasonAccept: 'All gates passed',
    reasonReject: 'wrong-session',
    reasonRejectSeq: 'stale-seq',
    reasonRejectBaseline: 'armed-before-baseline',
    reasonRejectTtl: 'ttl-expired',
    reasonSafeStop: 'Emergency stop / session change',
    noSession: 'No active session',
    seq: 'Seq',
    lastSession: 'Session',
    baselineReady: 'Baseline ready',
    armed: 'Armed',
    noEvents: 'Trigger a scenario to see events here.',
  },
  es: {
    title: 'Laboratorio de Seguridad y Autoridad',
    subtitle:
      'Ejercita las verificaciones de la compuerta de seguridad en orden. Cada botón dispara un escenario — observa cuál compuerta acepta, rechaza o fuerza parada segura.',
    newSession: 'Nueva Sesión',
    sendBaseline: 'Enviar Línea Base',
    armDrive: 'Armar y Manejar',
    dropNetwork: 'Cortar Red',
    replayOldSeq: 'Reenviar Seq Vieja',
    sendOldSession: 'Enviar Sesión Vieja',
    skipBaseline: 'Saltar Línea Base',
    emergencyStop: 'Parada de Emergencia',
    reconnectController: 'Reconectar Controlador',
    reset: 'Reiniciar Lab',
    authorityLadder: 'Escalera de Autoridad',
    safetyGate: 'Estado de Compuerta',
    eventLog: 'Registro de Eventos',
    reasonAccept: 'Todas las compuertas pasaron',
    reasonReject: 'wrong-session',
    reasonRejectSeq: 'stale-seq',
    reasonRejectBaseline: 'armed-before-baseline',
    reasonRejectTtl: 'ttl-expired',
    reasonSafeStop: 'Parada de emergencia / cambio de sesión',
    noSession: 'Sin sesión activa',
    seq: 'Seq',
    lastSession: 'Sesión',
    baselineReady: 'Línea base lista',
    armed: 'Armado',
    noEvents: 'Dispara un escenario para ver eventos aquí.',
  },
} as const;

interface LogEntry {
  readonly step: string;
  readonly label: string;
  readonly decision: Decision;
  readonly reason?: string;
  readonly gates: readonly SafetyGate[];
  readonly seq?: number;
  readonly session?: string;
}

function resolveDecision(outcome: { accepted: boolean; reason?: string }): Decision {
  if (outcome.accepted) return 'ACCEPT';
  if (outcome.reason === 'armed-before-baseline') return 'SAFE STOP';
  return 'REJECT';
}

function resolveGates(
  outcome: { accepted: boolean; reason?: string },
  baselineReady: boolean,
  armed: boolean,
): readonly SafetyGate[] {
  const gates: SafetyGate[] = ['CONNECTED', 'REGISTERED'];
  if (
    outcome.accepted ||
    outcome.reason === 'ttl-expired' ||
    outcome.reason === 'armed-before-baseline'
  ) {
    gates.push('CURRENT SESSION');
  }
  if (baselineReady) gates.push('BASELINE READY');
  if (armed) gates.push('ARMED');
  if (armed && outcome.accepted) gates.push('FRESH CONTROL');
  return gates;
}

export function SafetyFailureLab({ locale }: SafetyFailureLabProps) {
  const relayRef = useRef(new SimulatedRelay());
  const firmwareRef = useRef(new SimulatedFirmware());
  const sessionIdRef = useRef('');
  const seqRef = useRef(0);
  const baselineSentRef = useRef(false);

  const [log, setLog] = useState<readonly LogEntry[]>([]);
  const [gates, setGates] = useState<readonly SafetyGate[]>([]);
  const [currentSeq, setCurrentSeq] = useState(0);
  const [currentSession, setCurrentSession] = useState('');
  const [isBaselineReady, setIsBaselineReady] = useState(false);
  const [isArmed, setIsArmed] = useState(false);

  const t = STRINGS[locale];

  function pushLog(entry: Omit<LogEntry, 'step'>): void {
    setLog((prev) => [...prev, { ...entry, step: String(prev.length + 1) }]);
  }

  function newSession(): void {
    sessionIdRef.current = relayRef.current.mintSession();
    firmwareRef.current.onSessionChanged(sessionIdRef.current);
    baselineSentRef.current = false;
    seqRef.current = 0;
    setCurrentSession(sessionIdRef.current.slice(0, 8));
    setIsBaselineReady(false);
    setIsArmed(false);
    setCurrentSeq(0);
    setGates(['CONNECTED', 'REGISTERED', 'CURRENT SESSION']);
  }

  function sendFrame(label: string, state: ControlState, sessionOverride?: string): void {
    const now = performance.now();
    const seq = ++seqRef.current;
    const frame = createControlFrame(state, seq, now);
    const stamped = relayRef.current.stamp(frame);
    const finalFrame = sessionOverride
      ? { ...stamped, controlSessionId: sessionOverride }
      : stamped;
    const outcome = firmwareRef.current.applyFrame(finalFrame, now);
    const decision = resolveDecision(outcome);

    if (outcome.accepted && !state.armed) {
      baselineSentRef.current = true;
    }

    const armedState = outcome.accepted ? state.armed : isArmed;
    const resolvedGates = resolveGates(outcome, baselineSentRef.current, armedState);

    setGates(resolvedGates);
    setCurrentSeq(seq);
    setIsBaselineReady(baselineSentRef.current);
    setIsArmed(armedState);

    let reason: string | undefined;
    if (!outcome.accepted) {
      if (decision === 'SAFE STOP') {
        reason = t.reasonSafeStop;
      } else if (outcome.reason === 'wrong-session') {
        reason = t.reasonReject;
      } else if (outcome.reason === 'stale-seq') {
        reason = t.reasonRejectSeq;
      } else if (outcome.reason === 'armed-before-baseline') {
        reason = t.reasonRejectBaseline;
      } else if (outcome.reason === 'ttl-expired') {
        reason = t.reasonRejectTtl;
      }
    }

    pushLog({
      label,
      decision,
      reason,
      gates: resolvedGates,
      seq,
      session: sessionOverride ? sessionOverride.slice(0, 8) : currentSession,
    });
  }

  function handleNewSession(): void {
    newSession();
    pushLog({
      label: t.newSession,
      decision: 'ACCEPT',
      reason: t.reasonAccept,
      gates: ['CONNECTED', 'REGISTERED', 'CURRENT SESSION'],
    });
  }

  function handleSendBaseline(): void {
    if (!sessionIdRef.current) {
      pushLog({ label: t.sendBaseline, decision: 'REJECT', reason: t.noSession, gates: [] });
      return;
    }
    sendFrame(t.sendBaseline, DISARMED);
  }

  function handleArmDrive(): void {
    if (!sessionIdRef.current) {
      pushLog({ label: t.armDrive, decision: 'REJECT', reason: t.noSession, gates: [] });
      return;
    }
    sendFrame(t.armDrive, DRIVING);
  }

  function handleDropNetwork(): void {
    pushLog({ label: t.dropNetwork, decision: 'SAFE STOP', reason: t.reasonRejectTtl, gates });
    setIsArmed(false);
  }

  function handleReplayOldSeq(): void {
    if (!sessionIdRef.current) {
      pushLog({ label: t.replayOldSeq, decision: 'REJECT', reason: t.noSession, gates: [] });
      return;
    }
    const staleSeq = Math.max(0, currentSeq - 1);
    const now = performance.now();
    const frame = createControlFrame(DRIVING, staleSeq, now);
    const stamped = relayRef.current.stamp(frame);
    const outcome = firmwareRef.current.applyFrame(stamped, now);

    pushLog({
      label: t.replayOldSeq,
      decision: resolveDecision(outcome),
      reason: t.reasonRejectSeq,
      gates,
      seq: staleSeq,
      session: currentSession,
    });
  }

  function handleSendOldSession(): void {
    // Mint a session to stamp onto the frame, then mint a different one
    // so the firmware's active session won't match — simulates a delayed
    // frame from a previous controller connection.
    const staleSession = relayRef.current.mintSession();
    const freshSession = relayRef.current.mintSession();
    firmwareRef.current.onSessionChanged(freshSession);
    sessionIdRef.current = freshSession;
    setCurrentSession(freshSession.slice(0, 8));

    const now = performance.now();
    const seq = ++seqRef.current;
    const frame = createControlFrame(DRIVING, seq, now);
    const stamped = relayRef.current.stamp(frame);
    const withStale = { ...stamped, controlSessionId: staleSession };
    const outcome = firmwareRef.current.applyFrame(withStale, now);

    pushLog({
      label: t.sendOldSession,
      decision: resolveDecision(outcome),
      reason: t.reasonReject,
      gates,
      seq,
      session: staleSession.slice(0, 8),
    });
  }

  function handleSkipBaseline(): void {
    if (!sessionIdRef.current) {
      pushLog({ label: t.skipBaseline, decision: 'REJECT', reason: t.noSession, gates: [] });
      return;
    }
    const now = performance.now();
    const seq = ++seqRef.current;
    const frame = createControlFrame(DRIVING, seq, now);
    const stamped = relayRef.current.stamp(frame);
    const outcome = firmwareRef.current.applyFrame(stamped, now);

    pushLog({
      label: t.skipBaseline,
      decision: resolveDecision(outcome),
      reason: t.reasonRejectBaseline,
      gates,
      seq,
      session: currentSession,
    });
  }

  function handleEmergencyStop(): void {
    firmwareRef.current.emergencyStop();
    setIsArmed(false);
    setIsBaselineReady(false);
    setGates(['CONNECTED', 'REGISTERED', 'CURRENT SESSION']);

    pushLog({
      label: t.emergencyStop,
      decision: 'SAFE STOP',
      reason: t.reasonSafeStop,
      gates: ['CONNECTED', 'REGISTERED', 'CURRENT SESSION'],
    });
  }

  function handleReconnectController(): void {
    const newSid = relayRef.current.mintSession();
    firmwareRef.current.onSessionChanged(newSid);
    baselineSentRef.current = false;
    seqRef.current = 0;
    sessionIdRef.current = newSid;
    setCurrentSession(newSid.slice(0, 8));
    setIsBaselineReady(false);
    setIsArmed(false);
    setCurrentSeq(0);
    setGates(['CONNECTED', 'REGISTERED', 'CURRENT SESSION']);

    pushLog({
      label: t.reconnectController,
      decision: 'ACCEPT',
      reason: t.reasonAccept,
      gates: ['CONNECTED', 'REGISTERED', 'CURRENT SESSION'],
      session: newSid.slice(0, 8),
    });
  }

  function handleReset(): void {
    relayRef.current = new SimulatedRelay();
    firmwareRef.current = new SimulatedFirmware();
    sessionIdRef.current = '';
    seqRef.current = 0;
    baselineSentRef.current = false;
    setLog([]);
    setGates([]);
    setCurrentSeq(0);
    setCurrentSession('');
    setIsBaselineReady(false);
    setIsArmed(false);
  }

  return (
    <div className="rl-lab" lang={locale}>
      <div className="rl-panel">
        <p className="rl-panel__title">{t.title}</p>
        <p style={{ fontSize: '0.85rem', opacity: 0.85, margin: '0 0 0.6rem' }}>{t.subtitle}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="rl-panel">
            <p className="rl-panel__title">{t.safetyGate}</p>
            <div style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.78rem', lineHeight: 1.8 }}>
              <div>
                {t.seq}: {currentSeq}
              </div>
              <div>
                {t.lastSession}: {currentSession || '—'}
              </div>
              <div>
                {t.baselineReady}: {isBaselineReady ? '✓' : '—'}
              </div>
              <div>
                {t.armed}: {isArmed ? '✓' : '—'}
              </div>
            </div>
          </div>

          <div className="rl-btn-row">
            <button type="button" className="rl-btn" onClick={handleNewSession}>
              {t.newSession}
            </button>
            <button
              type="button"
              className="rl-btn"
              disabled={!sessionIdRef.current}
              onClick={handleSendBaseline}
            >
              {t.sendBaseline}
            </button>
            <button
              type="button"
              className="rl-btn"
              disabled={!sessionIdRef.current}
              onClick={handleArmDrive}
            >
              {t.armDrive}
            </button>
            <button
              type="button"
              className="rl-btn rl-btn--danger"
              disabled={!isArmed}
              onClick={handleDropNetwork}
            >
              {t.dropNetwork}
            </button>
          </div>

          <div className="rl-btn-row">
            <button
              type="button"
              className="rl-btn"
              disabled={currentSeq < 2}
              onClick={handleReplayOldSeq}
            >
              {t.replayOldSeq}
            </button>
            <button type="button" className="rl-btn" onClick={handleSendOldSession}>
              {t.sendOldSession}
            </button>
            <button
              type="button"
              className="rl-btn"
              disabled={!sessionIdRef.current}
              onClick={handleSkipBaseline}
            >
              {t.skipBaseline}
            </button>
          </div>

          <div className="rl-btn-row">
            <button type="button" className="rl-btn rl-btn--danger" onClick={handleEmergencyStop}>
              {t.emergencyStop}
            </button>
            <button type="button" className="rl-btn" onClick={handleReconnectController}>
              {t.reconnectController}
            </button>
            <button type="button" className="rl-btn" onClick={handleReset}>
              {t.reset}
            </button>
          </div>

          <LogPanel entries={log} strings={t} />
        </div>

        <AuthorityLadder currentGates={gates} strings={t} />
      </div>
    </div>
  );
}

function LogPanel({
  entries,
  strings,
}: {
  readonly entries: readonly LogEntry[];
  readonly strings: (typeof STRINGS)['en'] | (typeof STRINGS)['es'];
}) {
  if (entries.length === 0) {
    return (
      <div className="rl-panel">
        <p className="rl-panel__title">{strings.eventLog}</p>
        <p style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.8rem', opacity: 0.6 }}>
          {strings.noEvents}
        </p>
      </div>
    );
  }

  return (
    <div className="rl-panel" style={{ maxHeight: '22rem', overflowY: 'auto' }}>
      <p className="rl-panel__title">{strings.eventLog}</p>
      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          fontFamily: 'var(--rl-mono)',
          fontSize: '0.78rem',
          lineHeight: 1.7,
        }}
      >
        {entries.map((entry) => (
          <li key={entry.step} style={{ borderBottom: '1px solid var(--rl-border)' }}>
            <span style={{ opacity: 0.5, marginRight: '0.4rem' }}>{entry.step}.</span>
            <span style={{ marginRight: '0.4rem' }}>{entry.label}</span>
            <DecisionBadge decision={entry.decision} />
            {entry.reason && (
              <span style={{ opacity: 0.7, marginLeft: '0.3rem' }}>{entry.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DecisionBadge({ decision }: { readonly decision: Decision }) {
  const colorMap: Record<Decision, string> = {
    ACCEPT: 'var(--rl-ok)',
    REJECT: 'var(--rl-error)',
    'SAFE STOP': 'var(--rl-warning)',
  };
  return (
    <span
      style={{
        fontFamily: 'var(--rl-mono)',
        fontSize: '0.72rem',
        fontWeight: 600,
        padding: '0.05rem 0.35rem',
        borderRadius: '3px',
        background: `color-mix(in srgb, ${colorMap[decision]} 18%, transparent)`,
        color: colorMap[decision],
        letterSpacing: '0.03em',
      }}
    >
      {decision}
    </span>
  );
}

function AuthorityLadder({
  currentGates,
  strings,
}: {
  readonly currentGates: readonly SafetyGate[];
  readonly strings: (typeof STRINGS)['en'] | (typeof STRINGS)['es'];
}) {
  return (
    <div className="rl-panel" style={{ alignSelf: 'start', position: 'sticky', top: '1rem' }}>
      <p className="rl-panel__title">{strings.authorityLadder}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {SAFETY_GATES.map((gate) => {
          const reached = currentGates.includes(gate);
          return (
            <li
              key={gate}
              style={{
                fontFamily: 'var(--rl-mono)',
                fontSize: '0.78rem',
                padding: '0.35rem 0.5rem',
                marginBottom: '0.2rem',
                borderRadius: '4px',
                border: `1.5px solid ${reached ? 'var(--rl-accent)' : 'var(--rl-border)'}`,
                background: reached
                  ? 'color-mix(in srgb, var(--rl-accent) 10%, transparent)'
                  : 'transparent',
                color: reached ? 'var(--rl-accent)' : 'var(--rl-text-dim)',
                fontWeight: reached ? 600 : 400,
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ marginRight: '0.4rem', opacity: reached ? 1 : 0.4 }}>
                {reached ? '▶' : '○'}
              </span>
              {gate}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
