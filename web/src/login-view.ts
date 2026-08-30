/**
 * Operator credential prompt: the first thing shown when no controller key
 * exists yet for this tab, and where control-view.ts sends the operator
 * back on an auth-failed close.
 */

import { setControllerKey } from './auth/controller-key.ts';
import { $ } from './ui/dom.ts';
import { LOGIN_TEMPLATE } from './ui/login-template.ts';

export interface LoginOptions {
  /** Called once a key has been entered and stored; does not itself verify
   * the key against the relay — that happens on the first `connect()`, and
   * an invalid key sends the operator straight back here. */
  readonly onSubmit: () => void;
  /** Set when arriving here because the relay rejected the previous key. */
  readonly errorText?: string;
}

export function mountLogin(app: HTMLElement, options: LoginOptions): () => void {
  app.innerHTML = LOGIN_TEMPLATE;

  const form = $('#login-form', HTMLFormElement);
  const input = $('#controller-key', HTMLInputElement);
  const error = $('#login-error', HTMLParagraphElement);

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
      setControllerKey(key);
      options.onSubmit();
    },
    { signal: abort.signal },
  );

  input.focus();

  return () => abort.abort();
}
