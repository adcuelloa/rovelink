/**
 * Remote control dashboard.
 *
 *   keyboard / gamepad / touch → ControlEngine → ControlSender → RobotTransport
 *
 * This view only wires the layers and paints: it does not compute axes or
 * speak the protocol, so changing transport does not touch it.
 */

import { clearControllerKey } from './auth/controller-key.ts';
import { ControlEngine } from './control/engine.ts';
import { listenGamepad, NO_GAMEPAD } from './control/gamepad.ts';
import type { GamepadState } from './control/gamepad.ts';
import { listenKeyboard } from './control/keyboard.ts';
import { normalizeGamepadName } from './control/mapping.ts';
import { InputOwnership } from './control/ownership.ts';
import { loadProfile } from './control/profile-store.ts';
import type { ControllerProfile } from './control/profile.ts';
import { computeDeviceHealth, formatLastSeen } from './health/device-health.ts';
import { ControlSender } from './transport/sender.ts';
import type { TransportEvent, RobotTransport, AlertLevel } from './transport/types.ts';
import {
  getConfiguredRelayUrl,
  getConfiguredRobotId,
  getConfiguredVideoRelayUrl,
  WebSocketTransport,
} from './transport/websocket.ts';
import { CONTROL_TEMPLATE } from './ui/control-template.ts';
import { mountControllerSettings } from './ui/controller-settings.ts';
import { $ } from './ui/dom.ts';
import { Instruments } from './ui/instruments.ts';
import { mountVideoPanel } from './ui/video-panel.ts';

const MAX_EVENTS = 40;

export interface ControlViewOptions {
  /** The operator needs to (re-)enter a controller credential: either the
   * relay rejected the current one (transport already stopped retrying and
   * discarded it), or the operator explicitly logged out. Return to the
   * login prompt. */
  readonly onNeedsLogin: (reason: string) => void;
  readonly session?: ControlSession;
}

/**
 * An already-connected, already-AUTHENTICATED transport/sender pair — this
 * session already received the relay's controller.session for it (see
 * auth/handshake.ts and main.ts). This view never opens a socket or
 * decides authentication itself; it is only ever mounted after the fact.
 * Omitted only for the "no relay configured" dev/misconfiguration
 * fallback, where a harmless no-op transport is used instead.
 */
export interface ControlSession {
  readonly transport: RobotTransport;
  readonly sender: ControlSender;
  /** Every event the transport emitted during the pre-mount handshake, in
   * order — a real WebSocket OPEN, a room presence broadcast, telemetry,
   * etc. can all legitimately arrive before this view's own transport
   * listener exists to see them live. Replayed once, in order, right
   * after subscribing, so the first paint reflects reality rather than a
   * stale "just mounted" default. */
  readonly priorEvents: readonly TransportEvent[];
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

  // Video (Problem 7D §1): a ticket source only ever exists when this is a
  // real, already-authenticated WebSocketTransport session — the no-op
  // fallback transport below implements no such thing, and video simply
  // stays unavailable rather than ever being handed a fake credential
  // path. Never gated on `relay` alone: an unauthenticated/misconfigured
  // control session must never let video start either (§3).
  const videoPanel = mountVideoPanel(
    options.session && options.session.transport instanceof WebSocketTransport
      ? options.session.transport
      : null,
    { videoRelayUrl: getConfiguredVideoRelayUrl(), robotId },
  );

  function log(level: AlertLevel, text: string): void {
    const li = document.createElement('li');
    li.dataset.level = level;
    const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const timeEl = document.createElement('span');
    timeEl.className = 'log__time';
    timeEl.textContent = time;
    li.append(timeEl, `  ${text}`);
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
  // The data-driven profile system (Problem 6): which physical controls
  // mean what. Loaded once at mount, and swapped only through the settings
  // panel's safe stop/restart sequence below — never mutated on a running
  // listener (see gamepad.ts's GamepadOptions doc).
  let activeProfile: ControllerProfile = loadProfile();

  function updateGamepadStatus(): void {
    if (!gamepadState.connected) {
      instruments.update({ gamepad: 'not detected' });
      return;
    }
    const name = normalizeGamepadName(gamepadState.id);
    const suffix = ownership.active === 'gamepad' ? 'active' : 'connected';
    instruments.update({ gamepad: `${name} — ${activeProfile.name} · ${suffix}` });
  }

  const applyAxes = (): void => engine.axes(ownership.axes.throttle, ownership.axes.steering);
  const applyGripper = (): void => engine.gripper(ownership.gripper);

  // --- transport ------------------------------------------------------------
  let transport: RobotTransport;
  let sender: ControlSender;
  let linked = false;

  // --- device freshness (Problem 8A) -----------------------------------------
  // `performance.now()`-based, entirely local: only ever advanced by real
  // device-originated evidence ('device-activity'), never by a control
  // frame the operator sent, a relay pong, or a bare 'robot' presence
  // broadcast. Ticked on a local display timer (updateDeviceHealth, wired
  // below) rather than only on new transport events, so "Last seen" keeps
  // counting up even while nothing new arrives.
  let lastDeviceActivityAt: number | null = null;

  function updateDeviceHealth(): void {
    const now = performance.now();
    const deviceOnline = instruments.readings.robotOnline;
    instruments.update({
      deviceHealth: computeDeviceHealth(deviceOnline, lastDeviceActivityAt, now),
      lastSeenText: formatLastSeen(lastDeviceActivityAt, now),
    });
  }

  // Control RTT arrives on every accepted/applied driving frame — smoothed
  // with a light EWMA (Problem 8A §G) so the reading doesn't jump around
  // with every single sample while driving continuously. E-stop RTT is
  // shown as its last raw sample instead: e-stops are rare, discrete safety
  // events where averaging would hide the actual number that matters.
  const CONTROL_RTT_EWMA_ALPHA = 0.25;
  let controlRttEwma: number | null = null;

  function handleTransport(event: TransportEvent): void {
    switch (event.kind) {
      case 'state':
        instruments.update({ connection: event.state });
        linkButton.textContent = event.state === 'disconnected' ? 'Connect' : 'Disconnect';
        linked = event.state !== 'disconnected';
        if (event.state === 'disconnected') {
          engine.safeState();
          sender.reset();
          // Control loss must close video immediately — a security
          // property, not cosmetic (Problem 7D §8): video must never stay
          // live, or auto-reconnect, once this connection is no longer
          // authenticated.
          videoPanel.onControlLost();
        }
        return;
      case 'robot':
        instruments.update({ robotOnline: event.online });
        updateDeviceHealth();
        return;
      case 'device-activity':
        lastDeviceActivityAt = event.at;
        updateDeviceHealth();
        return;
      case 'relay-rtt':
        instruments.update({ rtt: event.ms });
        return;
      case 'control-rtt':
        controlRttEwma =
          controlRttEwma === null
            ? event.ms
            : controlRttEwma + CONTROL_RTT_EWMA_ALPHA * (event.ms - controlRttEwma);
        instruments.update({ controlRtt: Math.round(controlRttEwma) });
        return;
      case 'estop-rtt':
        instruments.update({ estopRtt: event.ms });
        log('info', `e-stop ack round trip: ${event.ms} ms`);
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
        videoPanel.onControlLost();
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
        // A fresh session's RTT samples must never be averaged together
        // with the previous one's (Problem 8A §N: "no stale samples from
        // previous session") — restart the EWMA from empty rather than
        // carry a number computed before this reconnect.
        controlRttEwma = null;
        instruments.update({ controlRtt: null });
        log('info', 'control session established — disarmed');
        // Video is only ever allowed to start in direct response to this
        // same authoritative event (Problem 7D §3) — never merely because
        // a socket opened.
        videoPanel.onControlAuthenticated();
        return;
    }
  }

  let unsubscribeTransport: () => void;

  // --- configuration check --------------------------------------------------
  if (options.session) {
    transport = options.session.transport;
    sender = options.session.sender;
    unsubscribeTransport = transport.subscribe(handleTransport);
    log('info', `transport: ${transport.name}`);
    sender.start(() => engine.state);
    // Everything the transport emitted before this listener existed —
    // WebSocket OPEN, a room presence broadcast, the controller.session
    // that authenticated it, maybe telemetry — replays through the exact
    // same handler a live reconnect uses (not a hand-copied duplicate of
    // its logic), in the order it originally happened, so nothing about
    // the UI or the device's session-readiness baseline is stuck at a
    // stale "just mounted" default. Any LATER occurrence of any of these
    // (e.g. a Problem 2 reconnect while this view stays mounted) is caught
    // live by this same handler as normal.
    for (const event of options.session.priorEvents) handleTransport(event);
  } else {
    // Not authenticated — either no relay is configured at all, or a
    // caller bug skipped the handshake. Either way, never open a live
    // socket without going through it: show a clear error state and wire
    // a harmless no-op transport so the rest of the UI doesn't crash.
    instruments.update({ connection: 'disconnected' });
    linkButton.disabled = true;
    linkButton.textContent = relay === undefined ? 'No relay configured' : 'Not authenticated';
    log(
      'error',
      relay === undefined
        ? 'VITE_RELAY_URL is not set — cannot connect'
        : 'no authenticated session — refusing to connect',
    );
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
  }

  // Local display timer only — sends nothing over the network. Keeps "Last
  // seen" counting up and re-evaluates Online/Unresponsive even when no new
  // transport event has arrived recently.
  const deviceHealthTimer = setInterval(updateDeviceHealth, 200);
  updateDeviceHealth();

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

  // Re-invokable rather than a one-shot const: the settings panel and a
  // profile switch both need to stop this listener and start a fresh one
  // against the (possibly new) activeProfile — see openControllerSettings
  // below. A fresh listener re-baselines against whatever is currently
  // held (Problem 5's connect-time baseline fix), so switching mid-hold
  // never carries stale movement into the new profile.
  function startGamepadListener(): () => void {
    return listenGamepad(
      window,
      {
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
      },
      { profile: activeProfile },
    );
  }

  let unsubscribeGamepad = startGamepadListener();

  const stopButton = $('#btn-stop', HTMLButtonElement);

  function emergencyStop(): void {
    engine.emergencyStop();
    sender.emergencyStop();
    announcements.textContent = 'Emergency stop';
    log('error', 'EMERGENCY STOP');
    // Momentary confirmation on the button itself (Problem 9 §4) — the
    // announcement above covers screen readers, this covers a sighted
    // operator glancing at the button they just pressed.
    stopButton.classList.remove('e_stop--fired');
    // Force reflow so re-triggering while the animation is still running
    // restarts it, instead of the class no-op'ing because it was never
    // removed from the DOM's perspective.
    void stopButton.offsetWidth;
    stopButton.classList.add('e_stop--fired');
  }

  // --- controller settings ----------------------------------------------------
  // Opening the panel forces SAFE_STATE and stops the driving gamepad
  // listener entirely — the settings view polls navigator.getGamepads() on
  // its own from there, with no reference to ControlEngine, so a captured
  // control physically cannot drive the robot (see controller-settings.ts).
  // Closing starts a fresh listener against whatever profile ended up
  // active — Problem 5's connect-time baseline means currently-held
  // controls are ignored until released/re-pressed, and the operator must
  // explicitly Arm again either way.
  let closeSettings: (() => void) | null = null;

  function openControllerSettings(): void {
    if (closeSettings !== null) return;
    engine.safeState();
    unsubscribeGamepad();
    log('info', 'controller settings opened — disarmed');
    closeSettings = mountControllerSettings({
      onClose: (profile) => {
        closeSettings = null;
        activeProfile = profile;
        unsubscribeGamepad = startGamepadListener();
        updateGamepadStatus();
        log('info', `controller settings closed — profile: ${profile.name}`);
      },
    });
  }

  const abort = new AbortController();
  const { signal } = abort;

  $('#btn-controller-settings', HTMLButtonElement).addEventListener(
    'click',
    openControllerSettings,
    {
      signal,
    },
  );

  $('#btn-arm', HTMLButtonElement).addEventListener('click', () => engine.arm(true), { signal });
  $('#btn-disarm', HTMLButtonElement).addEventListener('click', () => engine.arm(false), {
    signal,
  });
  stopButton.addEventListener('click', emergencyStop, { signal });

  $('#btn-log-clear', HTMLButtonElement).addEventListener(
    'click',
    () => {
      logList.replaceChildren();
    },
    { signal },
  );

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
    clearInterval(deviceHealthTimer);
    closeSettings?.();
    unsubscribeKeyboard();
    unsubscribeGamepad();
    unsubscribeEngine();
    sender.stop();
    unsubscribeTransport();
    transport.disconnect();
    instruments.destroy();
    videoPanel.destroy();
  };
}
