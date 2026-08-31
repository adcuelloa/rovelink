/**
 * Operator credential prompt, shown before the control dashboard mounts.
 *
 * See web/src/auth/controller-key.ts for why this exists at all: the
 * controller secret cannot live in the built JS bundle, so it has to be
 * typed in at runtime instead.
 */
export const LOGIN_TEMPLATE = `
<div class="grid min-h-dvh place-items-center px-3 py-3">
  <form id="login-form" class="module w-full max-w-sm" aria-labelledby="login-title" novalidate>
    <div class="module__header">
      <h1 id="login-title" class="label">RoveLink — operator key</h1>
    </div>
    <div class="grid gap-3 p-4">
      <label class="label" for="controller-key">Controller key</label>
      <input
        id="controller-key"
        name="controller-key"
        type="password"
        autocomplete="off"
        spellcheck="false"
        class="field"
        required
      />
      <p id="login-error" class="text-alert text-[0.68rem] leading-relaxed" role="alert" hidden></p>
      <button type="submit" id="login-submit" class="button">Connect</button>
      <p class="text-ice-2 text-[0.65rem] leading-relaxed">
        Held only in this tab (sessionStorage) and sent inside the encrypted
        WebSocket connection. Never stored in the app build, never sent anywhere else.
      </p>
    </div>
  </form>
</div>
`;
