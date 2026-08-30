import './style.css';
import { getControllerKey } from './auth/controller-key.ts';
import { mountControl } from './control-view.ts';
import { mountLogin } from './login-view.ts';
import { $ } from './ui/dom.ts';

/**
 * Login gate: the control dashboard's WebSocketTransport must never open
 * the controller socket without a runtime credential (see
 * auth/controller-key.ts), so it is simply never mounted until one exists.
 * A rejected/cleared credential (control-view.ts's `onNeedsLogin`) comes
 * back through here too, tearing down the dashboard first.
 */
const app = $('#app', HTMLDivElement);
let unmountCurrent: () => void = () => {};

function showLogin(reason?: string): void {
  unmountCurrent();
  // A plain logout isn't an error worth alarming the operator over; an
  // actually-rejected/missing credential is.
  const errorText = reason !== undefined && reason !== 'logged out' ? reason : undefined;
  unmountCurrent = mountLogin(app, { onSubmit: showControl, errorText });
}

function showControl(): void {
  unmountCurrent();
  unmountCurrent = mountControl(app, { onNeedsLogin: showLogin });
}

if (getControllerKey() !== null) showControl();
else showLogin();
