/**
 * Remote control dashboard.
 *
 *   keyboard / gamepad / touch → ControlEngine → ControlSender → RobotTransport
 *
 * This view only wires the layers and paints: it does not compute axes or
 * speak the protocol, so changing transport does not touch it.
 */

import { clearControllerKey, getControllerKey } from './auth/controller-key.ts';
import { ControlEngine } from './control/engine.ts';
import { listenGamepad, NO_GAMEPAD } from './control/gamepad.ts';
import type { GamepadState } from './control/gamepad.ts';
import { listenKeyboard } from './control/keyboard.ts';
import { normalizeGamepadName } from './control/mapping.ts';
import { InputOwnership } from './control/ownership.ts';
import { ControlSender } from './transport/sender.ts';
import type { TransportEvent, RobotTransport, AlertLevel } from './transport/types.ts';
import {
  getConfiguredRobotId,
  getConfiguredRelayUrl,
  WebSocketTransport,
} from './transport/websocket.ts';
import { CONTROL_TEMPLATE } from './ui/control-template.ts';
import { $ } from './ui/dom.ts';
import { Instruments } from './ui/instruments.ts';

const MAX_EVENTS = 40;

export interface ControlViewOptions {
  /** The operator needs to (re-)enter a controller credential: either the
   * relay rejected the current one (transport already stopped retrying and
   * discarded it), or the operator explicitly logged out. Return to the
   * login prompt. */
  readonly onNeedsLogin: (reason: string) => void;
}

export function mountControl(app: HTMLElement, options: ControlViewOptions): () => void {
  app.innerHTML = CONTROL_TEMPLATE;

  const robotId = getConfiguredRobotId();
  $('#robot-id-value', HTMLElement).textContent = robotId;

  const instruments = new Instruments();
  const engine = new ControlEngine();
  const logList = $('#log-control', HTMLOListElement);
  const announcements = $('#announcements-control', HTMLElement);
  const linkButton = $('#btn-link', HTMLButtonElement);

  const relay = getConfiguredRelayUrl();

  function log(level: AlertLevel, text: string): void {
    const li = document.createElement('li');
    li.dataset.level = level;
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    li.textContent = `${time}  ${text}`;
    logList.prepend(li);
    while (logList.childElementCount > MAX_EVENTS) logList.lastElementChild?.remove();
  }

  // --- inputs ---------------------------------------------------------------
  // Exactly one source owns throttle/steering/gripper at a time — see
  // ownership.ts. Each source's "meaningful activity" rule (what makes it
  // claim ownership) is a one-line conditional at that source's own wiring
  // below.
  const ownership = new InputOwnership();
  let gamepadState: GamepadState = NO_GAMEPAD;

  function updateGamepadStatus(): void {
    if (!gamepadState.connected) {
      instruments.update({ gamepad: 'not detected' });
      return;
    }
    const name = normalizeGamepadName(gamepadState.id);
    const suffix = ownership.active === 'gamepad' ? 'active' : 'connected';
    instruments.update({ gamepad: `${name} — ${suffix}` });
  }

  const applyAxes = (): void => engine.axes(ownership.axes.throttle, ownership.axes.steering);
  const applyGripper = (): void => engine.gripper(ownership.gripper);

  // --- transport ------------------------------------------------------------
  let transport: RobotTransport;
  let sender: ControlSender;
  let linked = false;

  function handleTransport(event: TransportEvent): void {
    switch (event.kind) {
      case 'state':
        instruments.update({ connection: event.state });
        linkButton.textContent = event.state === 'disconnected' ? 'Connect' : 'Disconnect';
        linked = event.state !== 'disconnected';
        if (event.state === 'disconnected') {
          engine.safeState();
          sender.reset();
        }
        return;
      case 'robot':
        instruments.update({ robotOnline: event.online });
        return;
      case 'rtt':
        instruments.update({ rtt: event.ms });
        return;
      case 'telemetry':
        instruments.update({
          rssi: event.data.rssi ?? null,
          telThrottle: event.data.throttle ?? 0,
          telSteering: event.data.steering ?? 0,
        });
        return;
      case 'counters':
        instruments.update({
          sent: event.data.sent,
          received: event.data.received,
          seq: event.data.seq,
        });
        return;
      case 'alert':
        log(event.level, event.text);
        return;
      case 'auth-error':
        log('error', event.text);
        clearControllerKey();
        options.onNeedsLogin(event.text);
        return;
      case 'session-established':
        // The relay just confirmed this connection is the authoritative
        // control session. Reset local state to SAFE_STATE and force-send
        // the disarmed baseline the device's session-readiness gate
        // requires — see ControlSender.establishSessionBaseline(). This is
        // the only place either of those happens: never on a bare connect,
        // never on a room broadcast, only in direct response to the
        // relay's own authoritative notification.
        engine.safeState();
        sender.establishSessionBaseline();
        log('info', 'control session established — disarmed');
        return;
    }
  }

  let unsubscribeTransport: () => void;

  // --- configuration check --------------------------------------------------
  if (relay === undefined) {
    // No relay configured: show clear error state, do NOT fallback to mock.
    instruments.update({
      connection: 'disconnected',
    });
    linkButton.disabled = true;
    linkButton.textContent = 'No relay configured';
    log('error', 'VITE_RELAY_URL is not set — cannot connect');

    // Create a no-op transport so the rest of the UI doesn't crash.
    transport = {
      name: 'WebSocket',
      robotId,
      connect: () => Promise.resolve(),
      disconnect: () => {},
      sendControl: () => {},
      emergencyStop: () => {},
      subscribe: () => () => {},
    };
    sender = new ControlSender(transport);
    unsubscribeTransport = transport.subscribe(handleTransport);
  } else {
    transport = new WebSocketTransport({
      url: relay,
      robotId,
      token: getControllerKey() ?? undefined,
    });
    sender = new ControlSender(transport);
    unsubscribeTransport = transport.subscribe(handleTransport);

    log('info', `transport: ${transport.name}`);
    sender.start(() => engine.state);
    void transport.connect();
  }

  // --- wiring ---------------------------------------------------------------
  const unsubscribeEngine = engine.subscribe(({ state, reason }) => {
    instruments.update({
      throttle: state.throttle,
      steering: state.steering,
      gripper: state.gripper,
      armed: state.armed,
    });
    if (reason === 'arm') {
      announcements.textContent = state.armed ? 'Armed' : 'Disarmed';
      log('info', state.armed ? 'armed' : 'disarmed');
    }
    sender.update(state);
  });

  const unsubscribeKeyboard = listenKeyboard(window, {
    onAxes: (axes) => {
      ownership.setAxes('keyboard', axes);
      applyAxes();
    },
    onGripper: (gripper) => {
      ownership.setGripper('keyboard', gripper);
      applyGripper();
    },
    onAction: (action) => {
      if (action === 'stop') emergencyStop();
      else if (action === 'toggleArm') engine.toggleArm();
    },
    // Fires only on keydown, never on keyup — releasing a key must not steal
    // ownership away from whatever source is currently active.
    onActivity: () => {
      ownership.claim('keyboard');
      updateGamepadStatus();
    },
  });

  const unsubscribeGamepad = listenGamepad(window, {
    onAxes: (throttle, steering) => {
      ownership.setAxes('gamepad', { throttle, steering });
      // Values here are already deadzoned: nonzero means real, meaningful
      // stick movement, not idle RAF sampling or sub-deadzone drift.
      if (throttle !== 0 || steering !== 0) ownership.claim('gamepad');
      updateGamepadStatus();
      applyAxes();
    },
    onGripper: (gripper) => {
      ownership.setGripper('gamepad', gripper);
      // Only becoming active claims ownership; releasing back to idle must
      // not steal control from whatever source is now driving.
      if (gripper !== 'idle') ownership.claim('gamepad');
      updateGamepadStatus();
      applyGripper();
    },
    onAction: (action) => {
      // Arm/Disarm/E-stop button edges count as meaningful gamepad activity
      // too, but stay globally effective regardless of who "owns" the axes.
      ownership.claim('gamepad');
      updateGamepadStatus();
      if (action === 'stop') emergencyStop();
      else if (action === 'arm') engine.arm(true);
      else if (action === 'disarm') engine.arm(false);
    },
    onState: (state) => {
      gamepadState = state;
      updateGamepadStatus();
      log(
        'info',
        state.connected ? `gamepad: ${normalizeGamepadName(state.id)}` : 'gamepad disconnected',
      );
      if (!state.connected) {
        // Mirrors the WebSocket-transport-loss handling below: unconditional
        // safe state, whether or not the engine was armed, whether or not
        // the gamepad currently owns the axes. A vanished controller must
        // never leave the vehicle driving on stale input. The transport
        // itself is still connected here, so the ordinary sequenced update
        // (not the urgent emergencyStop bypass) reaches the robot right
        // away; rhythm.ts's decideSend already skips re-sending an
        // unchanged disarmed/idle state, so this does not spam the link
        // when the engine was already safe.
        engine.safeState('disconnect');
      }
    },
  });

  function emergencyStop(): void {
    engine.emergencyStop();
    sender.emergencyStop();
    announcements.textContent = 'Emergency stop';
    log('error', 'EMERGENCY STOP');
  }

  const abort = new AbortController();
  const { signal } = abort;

  $('#btn-arm', HTMLButtonElement).addEventListener('click', () => engine.arm(true), { signal });
  $('#btn-disarm', HTMLButtonElement).addEventListener('click', () => engine.arm(false), {
    signal,
  });
  $('#btn-stop', HTMLButtonElement).addEventListener('click', emergencyStop, { signal });

  linkButton.addEventListener(
    'click',
    () => {
      if (linked) transport.disconnect();
      else void transport.connect();
    },
    { signal },
  );

  $('#btn-logout', HTMLButtonElement).addEventListener(
    'click',
    () => {
      transport.disconnect();
      clearControllerKey();
      options.onNeedsLogin('logged out');
    },
    { signal },
  );

  // Touch buttons: active while held, same as keyboard. touchAxes is shared
  // across every button (not per-button) so forward+right held together
  // combine into one axes reading, same as the original summed version did.
  const touchAxes = { throttle: 0, steering: 0 };
  for (const button of app.querySelectorAll<HTMLButtonElement>('.key')) {
    const axis = button.dataset.axis;
    const gripper = button.dataset.gripper;
    const release = (): void => {
      if (axis === 'throttle') touchAxes.throttle = 0;
      if (axis === 'steering') touchAxes.steering = 0;
      ownership.setAxes('touch', touchAxes);
      if (gripper !== undefined) ownership.setGripper('touch', 'idle');
      // Zeroing this button's own contribution never claims ownership: a
      // release must not hand control to whatever source is now selected.
      applyAxes();
      applyGripper();
    };
    button.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        button.setPointerCapture(event.pointerId);
        ownership.claim('touch');
        updateGamepadStatus();
        const value = Number(button.dataset.value ?? 0);
        if (axis === 'throttle') touchAxes.throttle = value;
        if (axis === 'steering') touchAxes.steering = value;
        ownership.setAxes('touch', touchAxes);
        if (gripper === 'open' || gripper === 'close') ownership.setGripper('touch', gripper);
        applyAxes();
        applyGripper();
      },
      { signal },
    );
    button.addEventListener('pointerup', release, { signal });
    button.addEventListener('pointercancel', release, { signal });
  }

  return () => {
    abort.abort();
    unsubscribeKeyboard();
    unsubscribeGamepad();
    unsubscribeEngine();
    sender.stop();
    unsubscribeTransport();
    transport.disconnect();
    instruments.destroy();
  };
}
