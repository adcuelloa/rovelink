import type { ControlFrame, ControlState, Gripper } from '@rovelink/protocol';
import { differentialMix } from '@rovelink/protocol';
import { readSemantic } from '@rovelink/web/src/control/controls.ts';
import { ControlEngine } from '@rovelink/web/src/control/engine.ts';
import { listenGamepad, NO_GAMEPAD } from '@rovelink/web/src/control/gamepad.ts';
import type { GamepadState } from '@rovelink/web/src/control/gamepad.ts';
import { listenKeyboard } from '@rovelink/web/src/control/keyboard.ts';
import { normalizeGamepadName } from '@rovelink/web/src/control/mapping.ts';
import { InputOwnership } from '@rovelink/web/src/control/ownership.ts';
import type { InputSource } from '@rovelink/web/src/control/ownership.ts';
import { RACING_PROFILE } from '@rovelink/web/src/control/profile.ts';
import { ControlSender } from '@rovelink/web/src/transport/sender.ts';
import type { TransportEvent } from '@rovelink/web/src/transport/types.ts';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { UiStrings } from '../i18n/types.ts';
import type { PipelineStage } from '../lib/sim/simulated-transport.ts';
import { SimulatedTransport } from '../lib/sim/simulated-transport.ts';
import { RoverView } from './lab/RoverView.tsx';
import { TouchPad } from './lab/TouchPad.tsx';

export interface ControlPipelineLabProps {
  readonly locale: 'en' | 'es';
  readonly ui: UiStrings;
}

interface Stages {
  input: string;
  ownership: InputSource | null;
  profile: string;
  engine: ControlState | null;
  sender: string;
  frame: ControlFrame | null;
  relay: string;
  firmware: string;
  mix: { left: number; right: number } | null;
  ack: number | null;
  rtt: number | null;
}

const EMPTY_STAGES: Stages = {
  input: '—',
  ownership: null,
  profile: RACING_PROFILE.name,
  engine: null,
  sender: '—',
  frame: null,
  relay: '—',
  firmware: '—',
  mix: null,
  ack: null,
  rtt: null,
};

const STATUS = {
  en: {
    sent: 'sent',
    forwarded: 'forwarded',
    accepted: 'accepted',
    rejected: (reason: string) => `rejected: ${REASON_EN[reason] ?? reason}`,
    safeState: 'safe state (TTL/E-stop)',
    session: (id: string) => `session ${id}…`,
    gamepad: 'Gamepad',
    profile: 'profile',
  },
  es: {
    sent: 'enviado',
    forwarded: 'reenviado',
    accepted: 'aceptado',
    rejected: (reason: string) => `rechazado: ${REASON_ES[reason] ?? reason}`,
    safeState: 'estado seguro (TTL/parada de emergencia)',
    session: (id: string) => `sesión ${id}…`,
    gamepad: 'Control',
    profile: 'perfil',
  },
} as const;

const REASON_EN: Record<string, string> = {
  'wrong-session': 'wrong session',
  'stale-seq': 'stale sequence',
  'armed-before-baseline': 'armed before baseline',
  'ttl-expired': 'TTL expired',
};

const REASON_ES: Record<string, string> = {
  'wrong-session': 'sesión incorrecta',
  'stale-seq': 'secuencia obsoleta',
  'armed-before-baseline': 'armado antes de la línea base',
  'ttl-expired': 'TTL expirado',
};

const STAGE_ORDER: readonly (keyof Stages)[] = [
  'input',
  'ownership',
  'profile',
  'engine',
  'sender',
  'frame',
  'relay',
  'firmware',
  'mix',
  'ack',
  'rtt',
];

/**
 * The Control Pipeline Lab: a live, driveable simulation. Keyboard, touch,
 * and a real Gamepad API controller all funnel through the REAL, unmodified
 * `InputOwnership` / `ControlEngine` / `ControlSender` classes from
 * @rovelink/web — only what sits behind the `RobotTransport` boundary (the
 * relay and the firmware) is a simulation.
 */
export function ControlPipelineLab({ locale, ui }: ControlPipelineLabProps) {
  const t = STATUS[locale];
  const [stages, setStages] = useState<Stages>(EMPTY_STAGES);
  const [gamepad, setGamepad] = useState<GamepadState>(NO_GAMEPAD);
  const [semantic, setSemantic] = useState<Record<string, number>>({});
  const [armed, setArmed] = useState(false);
  const [connected, setConnected] = useState(false);
  const [latencyMs, setLatencyMsState] = useState(30);
  const [linkCut, setLinkCut] = useState(false);
  const [flash, setFlash] = useState<ReadonlySet<keyof Stages>>(new Set());

  const engineRef = useRef<ControlEngine | null>(null);
  const ownershipRef = useRef<InputOwnership | null>(null);
  const transportRef = useRef<SimulatedTransport | null>(null);

  useEffect(() => {
    function pulse(stage: keyof Stages): void {
      setFlash((current) => new Set(current).add(stage));
      setTimeout(
        () =>
          setFlash((current) => {
            const next = new Set(current);
            next.delete(stage);
            return next;
          }),
        260,
      );
    }

    const ownership = new InputOwnership();
    const engine = new ControlEngine();
    const transport = new SimulatedTransport('learn-robot', { latencyMs });
    const sender = new ControlSender(transport);
    ownershipRef.current = ownership;
    engineRef.current = engine;
    transportRef.current = transport;

    function applyOwned(): void {
      engine.axes(ownership.axes.throttle, ownership.axes.steering);
      engine.gripper(ownership.gripper);
    }

    function doEmergencyStop(): void {
      engine.emergencyStop();
      transport.emergencyStop();
    }

    const unsubEngine = engine.subscribe(({ state }) => {
      setStages((s) => ({ ...s, engine: state }));
      setArmed(state.armed);
      pulse('engine');
      sender.update(state);
    });

    const unsubPipeline = transport.subscribePipeline((event: PipelineStage) => {
      switch (event.stage) {
        case 'sent':
          setStages((s) => ({ ...s, sender: t.sent, frame: event.frame }));
          pulse('frame');
          return;
        case 'relay-forwarded':
          setStages((s) => ({ ...s, relay: t.forwarded }));
          pulse('relay');
          return;
        case 'firmware-rejected':
          setStages((s) => ({ ...s, firmware: t.rejected(event.reason) }));
          pulse('firmware');
          return;
        case 'firmware-accepted':
          setStages((s) => ({ ...s, firmware: t.accepted, mix: event.wheels }));
          pulse('firmware');
          pulse('mix');
          return;
        case 'ack':
          setStages((s) => ({ ...s, ack: event.seq, rtt: event.rttMs }));
          pulse('ack');
          pulse('rtt');
          return;
        case 'ttl-stop':
          setStages((s) => ({ ...s, firmware: t.safeState }));
          return;
        case 'session-changed':
          setStages((s) => ({ ...s, relay: t.session(event.sessionId.slice(0, 8)) }));
      }
    });

    const unsubTransport = transport.subscribe((event: TransportEvent) => {
      if (event.kind === 'state') setConnected(event.state === 'connected');
    });

    void transport.connect().then(() => sender.establishSessionBaseline());
    sender.start(() => engine.state);

    const unsubKeyboard = listenKeyboard(window, {
      onAxes: (axes) => {
        ownership.setAxes('keyboard', axes);
        applyOwned();
      },
      onGripper: (g) => {
        ownership.setGripper('keyboard', g);
        applyOwned();
      },
      onAction: (action) => {
        if (action === 'stop') doEmergencyStop();
        else if (action === 'toggleArm') engine.toggleArm();
      },
      onActivity: () => {
        ownership.claim('keyboard');
        setStages((s) => ({ ...s, input: 'keyboard', ownership: 'keyboard' }));
        pulse('input');
        pulse('ownership');
      },
    });

    const unsubGamepad = listenGamepad(
      window,
      {
        onAxes: (throttle, steering) => {
          ownership.setAxes('gamepad', { throttle, steering });
          if (throttle !== 0 || steering !== 0) {
            ownership.claim('gamepad');
            setStages((s) => ({ ...s, input: 'gamepad', ownership: 'gamepad' }));
          }
          applyOwned();
        },
        onGripper: (g) => {
          ownership.setGripper('gamepad', g);
          if (g !== 'idle') ownership.claim('gamepad');
          applyOwned();
        },
        onAction: (action) => {
          ownership.claim('gamepad');
          if (action === 'stop') doEmergencyStop();
          else if (action === 'arm') engine.arm(true);
          else if (action === 'disarm') engine.arm(false);
        },
        onState: setGamepad,
      },
      { profile: RACING_PROFILE },
    );

    return () => {
      unsubEngine();
      unsubPipeline();
      unsubTransport();
      unsubKeyboard();
      unsubGamepad();
      sender.stop();
      transport.disconnect();
    };
    // Mount-once wiring: `latencyMs` at construction time only — later
    // changes go through the ref via the effect below, without tearing
    // down and reconnecting the whole simulated session.
  }, []);

  // Read-only gamepad telemetry (raw stick/trigger values) for display only
  // — never fed back into control, which stays owned entirely by the
  // listenGamepad wiring above.
  useEffect(() => {
    let raf = 0;
    function sample(): void {
      raf = requestAnimationFrame(sample);
      const pad = navigator.getGamepads?.()[0];
      if (!pad) return;
      setSemantic(
        readSemantic({
          axes: pad.axes,
          buttons: pad.buttons.map((b) => b.pressed),
          buttonValues: pad.buttons.map((b) => b.value),
        }),
      );
    }
    raf = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    transportRef.current?.setLatencyMs(latencyMs);
  }, [latencyMs]);

  function touchAxes(throttle: number, steering: number): void {
    const own = ownershipRef.current;
    if (!own) return;
    own.claim('touch');
    own.setAxes('touch', { throttle, steering });
    setStages((s) => ({ ...s, input: 'touch', ownership: 'touch' }));
    engineRef.current?.axes(own.axes.throttle, own.axes.steering);
  }

  function touchGripper(g: Gripper): void {
    const own = ownershipRef.current;
    if (!own) return;
    own.claim('touch');
    own.setGripper('touch', g);
    engineRef.current?.gripper(own.gripper);
  }

  const wheels =
    stages.mix ??
    (stages.engine
      ? differentialMix(stages.engine.throttle, stages.engine.steering)
      : { left: 0, right: 0 });

  return (
    <div className="rl-lab" lang={locale}>
      <div className="rl-owner-row">
        {(['keyboard', 'touch', 'gamepad'] as const).map((source) => (
          <span key={source} className="rl-owner-chip" data-active={stages.ownership === source}>
            {source}
          </span>
        ))}
        <span className="rl-badge-sim" style={{ marginLeft: 'auto' }}>
          {ui.lab.simulation} — {connected ? ui.lab.connected : ui.lab.disconnected}
        </span>
      </div>

      <div className="rl-lab__pipeline">
        {STAGE_ORDER.map((key) => (
          <Stage
            key={key}
            label={ui.lab.stages[key]}
            active={flash.has(key)}
            rejected={key === 'firmware' && stages.firmware.startsWith('rejected')}
          >
            <StageBody stageKey={key} stages={stages} wheels={wheels} />
          </Stage>
        ))}
      </div>

      <div className="rl-lab__bottom">
        <div>
          <RoverView left={wheels.left} right={wheels.right} armed={armed} />
          <TouchPad onAxes={touchAxes} onGripper={touchGripper} locale={locale} />
        </div>
        <div className="rl-panel">
          <p className="rl-panel__title">{t.gamepad}</p>
          {gamepad.connected ? (
            <div style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.78rem' }}>
              <div>{normalizeGamepadName(gamepad.id)}</div>
              <div>
                {t.profile}: {RACING_PROFILE.name}
              </div>
              <div>
                R2 {fmt(semantic.R2)} · L2 {fmt(semantic.L2)}
              </div>
              <div>
                LX {fmt(semantic.LeftStickX)} · LY {fmt(semantic.LeftStickY)}
              </div>
            </div>
          ) : (
            <p style={{ opacity: 0.7, fontSize: '0.85rem' }}>{ui.lab.noGamepad}</p>
          )}
        </div>
      </div>

      <div className="rl-panel">
        <p className="rl-panel__title">{ui.lab.experimentValues}</p>
        <div className="rl-btn-row" style={{ marginBottom: '0.6rem' }}>
          <label
            style={{
              fontFamily: 'var(--rl-mono)',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
          >
            {ui.lab.latency}
            <input
              type="range"
              min={0}
              max={500}
              value={latencyMs}
              onChange={(e) => setLatencyMsState(Number(e.target.value))}
            />
            {latencyMs}ms
          </label>
          <button type="button" className="rl-toolbar-btn" onClick={() => setLatencyMsState(30)}>
            {ui.lab.resetDefaults}
          </button>
        </div>
        <div className="rl-btn-row">
          <button
            type="button"
            className="rl-btn"
            aria-pressed={linkCut}
            onClick={() => {
              const transport = transportRef.current;
              if (!transport) return;
              if (linkCut) transport.restoreConnection();
              else transport.cutConnection();
              setLinkCut(!linkCut);
            }}
          >
            {linkCut ? ui.lab.restoreConnection : ui.lab.cutConnection}
          </button>
          <button
            type="button"
            className="rl-btn"
            onClick={() => transportRef.current?.reconnectController()}
          >
            {ui.lab.reconnectController}
          </button>
          <button
            type="button"
            className="rl-btn rl-btn--danger"
            onClick={() => {
              engineRef.current?.emergencyStop();
              transportRef.current?.emergencyStop();
            }}
          >
            {ui.lab.emergencyStop}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stage({
  label,
  active,
  rejected,
  children,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly rejected: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="rl-stage" data-active={active} data-status={rejected ? 'reject' : undefined}>
      <div className="rl-stage__label">{label}</div>
      {children}
    </div>
  );
}

function StageBody({
  stageKey,
  stages,
  wheels,
}: {
  readonly stageKey: keyof Stages;
  readonly stages: Stages;
  readonly wheels: { left: number; right: number };
}) {
  switch (stageKey) {
    case 'input':
      return <div>{stages.input}</div>;
    case 'ownership':
      return <div>owner = {stages.ownership ?? '—'}</div>;
    case 'profile':
      return <div>{stages.profile}</div>;
    case 'engine':
      return stages.engine ? (
        <div>
          <div>throttle {stages.engine.throttle.toFixed(2)}</div>
          <div>steering {stages.engine.steering.toFixed(2)}</div>
          <div>armed {String(stages.engine.armed)}</div>
        </div>
      ) : (
        <div>—</div>
      );
    case 'sender':
      return <div>{stages.sender}</div>;
    case 'frame':
      return stages.frame ? (
        <div>
          <div>seq {stages.frame.seq}</div>
          <div>ttlMs {stages.frame.ttlMs}</div>
        </div>
      ) : (
        <div>—</div>
      );
    case 'relay':
      return <div>{stages.relay}</div>;
    case 'firmware':
      return <div>{stages.firmware}</div>;
    case 'mix':
      return (
        <div>
          <div>L {wheels.left.toFixed(2)}</div>
          <div>R {wheels.right.toFixed(2)}</div>
        </div>
      );
    case 'ack':
      return <div>{stages.ack !== null ? `seq ${stages.ack}` : '—'}</div>;
    case 'rtt':
      return <div>{stages.rtt !== null ? `${stages.rtt} ms` : '—'}</div>;
    default:
      return null;
  }
}

function fmt(value: number | undefined): string {
  return (value ?? 0).toFixed(2);
}
