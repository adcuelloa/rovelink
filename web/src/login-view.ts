/**
 * Operator credential prompt: the first thing shown when no controller key
 * exists yet for this tab, and where control-view.ts sends the operator
 * back on an auth-failed close.
 *
 * This view does NOT decide when the operator is authenticated — it only
 * collects the key and reflects the authenticating/error state main.ts's
 * handshake drives it through. See auth/handshake.ts for why a bare
 * WebSocket open is never treated as success.
 */

import { $ } from './ui/dom.ts';
import { LOGIN_TEMPLATE } from './ui/login-template.ts';

export interface LoginOptions {
  /** Fires with the entered key on submit. Does not itself mean success —
   * the caller drives `setAuthenticating`/`showError` from there. */
  readonly onSubmit: (key: string) => void;
  /** Set when arriving here because the relay rejected the previous key. */
  readonly errorText?: string;
}

export interface LoginHandle {
  /** Disables the form and swaps the button label while a connection
   * attempt is in flight, so the operator can't double-submit. */
  readonly setAuthenticating: (authenticating: boolean) => void;
  /** Shows an error without unmounting — the operator stays on this same
   * screen with whatever they typed still in the field. */
  readonly showError: (text: string) => void;
  readonly unmount: () => void;
}

export function mountLogin(app: HTMLElement, options: LoginOptions): LoginHandle {
  app.innerHTML = LOGIN_TEMPLATE;

  const form = $('#login-form', HTMLFormElement);
  const input = $('#controller-key', HTMLInputElement);
  const error = $('#login-error', HTMLParagraphElement);
  const submitButton = $('#login-submit', HTMLButtonElement);

  if (options.errorText !== undefined) {
    error.textContent = options.errorText;
    error.hidden = false;
  }

  const abort = new AbortController();
  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      const key = input.value.trim();
      if (key.length === 0) return;
      options.onSubmit(key);
    },
    { signal: abort.signal },
  );

  input.focus();

  function setAuthenticating(authenticating: boolean): void {
    input.disabled = authenticating;
    submitButton.disabled = authenticating;
    submitButton.textContent = authenticating ? 'Authenticating…' : 'Connect';
    if (authenticating) error.hidden = true;
  }

  function showError(text: string): void {
    error.textContent = text;
    error.hidden = false;
  }

  return { setAuthenticating, showError, unmount: () => abort.abort() };
}
