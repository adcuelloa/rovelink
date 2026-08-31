import './style.css';
import { runHandshake } from './auth/handshake.ts';
import { clearControllerKey, getControllerKey, setControllerKey } from './auth/controller-key.ts';
import type { ControlSession } from './control-view.ts';
import { mountControl } from './control-view.ts';
import { mountLogin } from './login-view.ts';
import { ControlSender } from './transport/sender.ts';
import { getConfiguredRelayUrl, getConfiguredRobotId, WebSocketTransport } from './transport/websocket.ts';
import { $ } from './ui/dom.ts';

/**
 * Login gate: the control dashboard — and therefore every keyboard/touch/
 * gamepad listener it wires up — is not mounted until the relay has
 * confirmed this controller is authenticated (see auth/handshake.ts). A
 * bare WebSocket OPEN is never enough; a rejected/missing credential must
 * never expose the dashboard even briefly.
 */
const app = $('#app', HTMLDivElement);
let unmountCurrent: () => void = () => {};

function showLogin(reason?: string, autoKey?: string): void {
  unmountCurrent();
  // A plain logout isn't an error worth alarming the operator over; an
  // actually-rejected/missing credential is.
  const errorText = reason !== undefined && reason !== 'logged out' ? reason : undefined;
  const login = mountLogin(app, {
    onSubmit: (key) => attemptLogin(key, login),
    errorText,
  });
  unmountCurrent = login.unmount;
  // A stored key from a previous visit still has to pass through the same
  // gate — a stale/revoked key must not flash the dashboard either.
  if (autoKey !== undefined) attemptLogin(autoKey, login);
}

function showControl(session?: ControlSession): void {
  unmountCurrent();
  unmountCurrent = mountControl(app, { onNeedsLogin: showLogin, session });
}

function attemptLogin(key: string, login: ReturnType<typeof mountLogin>): void {
  setControllerKey(key);

  const relay = getConfiguredRelayUrl();
  if (relay === undefined) {
    // Nothing to authenticate against at all: preserve the existing
    // dev/misconfiguration fallback, which shows the dashboard in a
    // disabled error state rather than hanging on a login that can never
    // succeed.
    showControl();
    return;
  }

  const transport = new WebSocketTransport({
    url: relay,
    robotId: getConfiguredRobotId(),
    token: key,
  });
  const sender = new ControlSender(transport);

  runHandshake(transport, {
    onAuthenticating: () => login.setAuthenticating(true),
    onAuthenticated: (t, priorEvents) => showControl({ transport: t, sender, priorEvents }),
    onAuthError: (text) => {
      clearControllerKey();
      login.setAuthenticating(false);
      login.showError(text);
    },
  });
}

const storedKey = getControllerKey();
if (storedKey !== null) showLogin(undefined, storedKey);
else showLogin();
