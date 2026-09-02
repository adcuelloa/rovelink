/**
 * Controller settings panel: profile switcher, live diagram, and the
 * Steam-style "press a control to bind" rebind flow.
 *
 * Safety is structural, not a runtime flag: this module polls
 * `navigator.getGamepads()` on its own, independently of the driving
 * `listenGamepad` instance, and never imports ControlEngine or
 * ControlSender. There is no code path from anything captured here to the
 * robot — see control-view.ts for the stop/safeState-on-open and
 * fresh-listener-on-close sequence that surrounds this.
 */

import { actionForControl, BINDING_ACTIONS } from '../control/binding-lookup.ts';
import type { BindingAction } from '../control/binding-lookup.ts';
import { detectActivation } from '../control/capture.ts';
import type { ButtonControl, PhysicalControl } from '../control/controls.ts';
import {
  ALL_CONTROLS,
  isAxisControl,
  readSemantic,
  ZERO_SEMANTIC_VALUES,
} from '../control/controls.ts';
import type { GamepadReading } from '../control/mapping.ts';
import { DEFAULT_DEADZONE, normalizeGamepadName } from '../control/mapping.ts';
import { loadProfile, resetToRacing, resetToStick, saveProfile } from '../control/profile-store.ts';
import { describeIssue, validateProfile } from '../control/profile-validate.ts';
import type { ControllerProfile, ProfileId } from '../control/profile.ts';
import { evaluateProfile, RACING_PROFILE, STICK_PROFILE, toCustom } from '../control/profile.ts';
import { STICK_AXIS_PAIRS } from './controller-diagram.ts';
import { CONTROLLER_SETTINGS_TEMPLATE } from './controller-settings-template.ts';
import { $ } from './dom.ts';

export interface ControllerSettingsOptions {
  /** Called when the panel closes, with whatever profile ended up active. */
  readonly onClose: (profile: ControllerProfile) => void;
}

type RebindStep =
  | { readonly kind: 'button'; readonly action: 'arm' | 'disarm' | 'gripperOpen' | 'gripperClose' }
  | { readonly kind: 'steering-axis' }
  | { readonly kind: 'throttle-axis' }
  | { readonly kind: 'throttle-reverse'; readonly forward: ButtonControl }
  | { readonly kind: 'estop-a' }
  | { readonly kind: 'estop-b'; readonly first: ButtonControl };

/** Plain-language distinction between the presets (Problem 9 §14) — an
 * operator should never have to read profile JSON to know what each one
 * means. Custom's line is generated from the live profile itself, since
 * its bindings vary by definition. */
const PROFILE_DESCRIPTION: Readonly<Record<'racing' | 'stick', string>> = {
  racing: 'R2 forward · L2 reverse · Left Stick steering',
  stick: 'Left Stick drives and steers',
};

function profileDescription(profile: ControllerProfile): string {
  if (profile.id === 'racing' || profile.id === 'stick') return PROFILE_DESCRIPTION[profile.id];
  return `Your own bindings — steering on ${profile.steering.axis}`;
}

function bindingLabel(profile: ControllerProfile, action: BindingAction): string {
  switch (action) {
    case 'throttle':
      return profile.throttle.mode === 'axis'
        ? `${profile.throttle.axis}${profile.throttle.invert ? ' (inverted)' : ''}`
        : `${profile.throttle.forward} / ${profile.throttle.reverse}`;
    case 'steering':
      return `${profile.steering.axis}${profile.steering.invert ? ' (inverted)' : ''}`;
    case 'gripperOpen':
      return profile.gripperOpen;
    case 'gripperClose':
      return profile.gripperClose;
    case 'arm':
      return profile.arm;
    case 'disarm':
      return profile.disarm;
    case 'emergencyStop':
      return `${profile.emergencyStop.a} + ${profile.emergencyStop.b}`;
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function mountControllerSettings(options: ControllerSettingsOptions): () => void {
  const container = document.createElement('div');
  container.innerHTML = CONTROLLER_SETTINGS_TEMPLATE;
  document.body.append(container);

  const overlay = $('#settings-overlay', HTMLDivElement);
  const closeButton = $('#settings-close', HTMLButtonElement);
  const statusLine = $('#settings-controller-status', HTMLElement);
  const captureLine = $('#settings-capture', HTMLParagraphElement);
  const conflictList = $('#settings-conflicts', HTMLUListElement);
  const liveLeftStick = $('#live-left-stick', HTMLElement);
  const liveRightStick = $('#live-right-stick', HTMLElement);
  const liveL2 = $('#live-l2', HTMLMeterElement);
  const liveR2 = $('#live-r2', HTMLMeterElement);
  const liveThrottle = $('#live-throttle', HTMLElement);
  const liveSteering = $('#live-steering', HTMLElement);
  const profileDescriptionLine = $('#profile-description', HTMLParagraphElement);

  let activeProfile: ControllerProfile = loadProfile();
  let customDraft: ControllerProfile =
    activeProfile.id === 'custom' ? activeProfile : toCustom(RACING_PROFILE);
  let rebindStep: RebindStep | null = null;
  let previousValues = ZERO_SEMANTIC_VALUES;
  let gamepadId: string | null = null;
  let animation: number | null = null;

  function setCaptureMessage(text: string | null): void {
    if (text === null) {
      captureLine.hidden = true;
      captureLine.textContent = '';
    } else {
      captureLine.hidden = false;
      captureLine.textContent = text;
    }
  }

  function showConflicts(profile: ControllerProfile): void {
    const issues = validateProfile(profile);
    conflictList.innerHTML = '';
    if (issues.length === 0) {
      conflictList.hidden = true;
      return;
    }
    conflictList.hidden = false;
    for (const issue of issues) {
      const li = document.createElement('li');
      li.textContent = describeIssue(issue);
      conflictList.append(li);
    }
  }

  function refreshProfileTabs(): void {
    for (const id of ['racing', 'stick', 'custom'] as const) {
      $(`#profile-${id}`, HTMLButtonElement).setAttribute(
        'aria-pressed',
        String(activeProfile.id === id),
      );
    }
    profileDescriptionLine.textContent = profileDescription(activeProfile);
  }

  function refreshBindingList(): void {
    for (const action of BINDING_ACTIONS) {
      $(`#binding-${action}`, HTMLOutputElement).textContent = bindingLabel(activeProfile, action);
    }
  }

  /** A profile is only ever shown/kept active if it passes validation —
   * an invalid draft is reported and discarded, never applied. */
  function tryApplyProfile(draft: ControllerProfile): boolean {
    const issues = validateProfile(draft);
    if (issues.length > 0) {
      showConflicts(draft);
      return false;
    }
    activeProfile = draft;
    if (draft.id === 'custom') customDraft = draft;
    saveProfile(draft);
    refreshProfileTabs();
    refreshBindingList();
    showConflicts(draft);
    return true;
  }

  function selectPreset(id: ProfileId): void {
    rebindStep = null;
    setCaptureMessage(null);
    if (id === 'racing') tryApplyProfile(RACING_PROFILE);
    else if (id === 'stick') tryApplyProfile(STICK_PROFILE);
    else tryApplyProfile(customDraft);
  }

  /** Editing a preset always edits a Custom copy — presets stay immutable. */
  function draftBase(): ControllerProfile {
    return activeProfile.id === 'custom' ? activeProfile : toCustom(activeProfile);
  }

  function startCapture(step: RebindStep, message: string): void {
    rebindStep = step;
    setCaptureMessage(message);
  }

  function finishCapture(control: PhysicalControl): void {
    if (rebindStep === null) return;
    const step = rebindStep;
    const base = draftBase();

    switch (step.kind) {
      case 'button': {
        if (isAxisControl(control)) return; // a stick can never bind arm/disarm/gripper
        applyAndClose({ ...base, [step.action]: control });
        return;
      }
      case 'steering-axis': {
        if (!isAxisControl(control)) return;
        applyAndClose({
          ...base,
          steering: { axis: control, invert: false, deadzone: DEFAULT_DEADZONE.stick },
        });
        return;
      }
      case 'throttle-axis': {
        // Rebind Throttle accepts either input: a stick movement commits
        // axis mode immediately, a button press instead starts the
        // two-step split forward/reverse capture (section 4 supports
        // both throttle modes from one "Rebind" affordance).
        if (isAxisControl(control)) {
          applyAndClose({
            ...base,
            throttle: {
              mode: 'axis',
              axis: control,
              invert: false,
              deadzone: DEFAULT_DEADZONE.stick,
            },
          });
        } else {
          startCapture(
            { kind: 'throttle-reverse', forward: control },
            `Forward: ${control}. Now press the reverse control…`,
          );
        }
        return;
      }
      case 'throttle-reverse': {
        if (isAxisControl(control) || control === step.forward) return;
        applyAndClose({
          ...base,
          throttle: { mode: 'split', forward: step.forward, reverse: control },
        });
        return;
      }
      case 'estop-a': {
        if (isAxisControl(control)) return;
        startCapture(
          { kind: 'estop-b', first: control },
          `First: ${control}. Now press the second control…`,
        );
        return;
      }
      case 'estop-b': {
        if (isAxisControl(control) || control === step.first) return;
        applyAndClose({ ...base, emergencyStop: { a: step.first, b: control } });
        return;
      }
    }
  }

  function applyAndClose(draft: ControllerProfile): void {
    rebindStep = null;
    const applied = tryApplyProfile(draft);
    setCaptureMessage(
      applied ? null : 'That control conflicts with an existing binding — not applied.',
    );
  }

  // --- wiring: profile tabs --------------------------------------------------
  for (const id of ['racing', 'stick', 'custom'] as const) {
    $(`#profile-${id}`, HTMLButtonElement).addEventListener('click', () => selectPreset(id));
  }

  // --- wiring: rebind (buttons and, via the same function, diagram clicks) ---
  // One entry point per action so the diagram's click-to-rebind (Problem 9
  // §13) drives the exact same capture flow as its binding-list button —
  // never a second, parallel path to a rebind.
  function startRebindFor(action: BindingAction): void {
    switch (action) {
      case 'arm':
        startCapture({ kind: 'button', action: 'arm' }, 'Press a control for Arm…');
        return;
      case 'disarm':
        startCapture({ kind: 'button', action: 'disarm' }, 'Press a control for Disarm…');
        return;
      case 'gripperOpen':
        startCapture(
          { kind: 'button', action: 'gripperOpen' },
          'Press a control for Gripper open…',
        );
        return;
      case 'gripperClose':
        startCapture(
          { kind: 'button', action: 'gripperClose' },
          'Press a control for Gripper close…',
        );
        return;
      case 'steering':
        startCapture({ kind: 'steering-axis' }, 'Move the stick to use for steering…');
        return;
      case 'emergencyStop':
        startCapture({ kind: 'estop-a' }, 'Press the first Emergency Stop control…');
        return;
      case 'throttle':
        // Two ways to bind throttle (section 4): a single stick axis, or
        // two split controls. A stick movement vs. a button press during
        // capture disambiguates which the operator means, so one
        // "Rebind" trigger covers both — see finishCapture's
        // 'throttle-axis' case: an axis activation commits it immediately
        // as axis mode, a button activation instead starts the two-step
        // split forward/reverse capture.
        startCapture(
          { kind: 'throttle-axis' },
          'Move a stick for stick-axis throttle, or press a button for split forward/reverse…',
        );
        return;
      default: {
        const exhaustive: never = action;
        return exhaustive;
      }
    }
  }

  for (const action of BINDING_ACTIONS) {
    $(`#rebind-${action}`, HTMLButtonElement).addEventListener('click', () =>
      startRebindFor(action),
    );
  }

  // --- wiring: reset ------------------------------------------------------
  $('#reset-racing', HTMLButtonElement).addEventListener('click', () => {
    activeProfile = resetToRacing();
    customDraft = activeProfile.id === 'custom' ? activeProfile : customDraft;
    refreshProfileTabs();
    refreshBindingList();
    showConflicts(activeProfile);
  });
  $('#reset-stick', HTMLButtonElement).addEventListener('click', () => {
    activeProfile = resetToStick();
    refreshProfileTabs();
    refreshBindingList();
    showConflicts(activeProfile);
  });

  // --- wiring: click-to-rebind on the diagram itself (Problem 9 §13) --------
  // A click on a control's silhouette is a shortcut into the exact same
  // capture flow as that control's binding-list "Rebind" button — never a
  // second path to the robot, and never bypassable while a capture is
  // already in progress.
  let diagramInfoTimeout: ReturnType<typeof setTimeout> | null = null;

  function activateDiagramControl(control: PhysicalControl): void {
    if (rebindStep !== null) return; // a capture is already in progress
    const action = actionForControl(activeProfile, control);
    if (action === null) {
      if (diagramInfoTimeout !== null) clearTimeout(diagramInfoTimeout);
      setCaptureMessage(`${control} — not currently bound to an action.`);
      diagramInfoTimeout = setTimeout(() => {
        diagramInfoTimeout = null;
        if (rebindStep === null) setCaptureMessage(null);
      }, 2200);
      return;
    }
    if (diagramInfoTimeout !== null) {
      clearTimeout(diagramInfoTimeout);
      diagramInfoTimeout = null;
    }
    startRebindFor(action);
  }

  for (const control of ALL_CONTROLS) {
    const el = document.getElementById(`ctrl-${control}`);
    if (el === null) continue;
    el.addEventListener('click', () => activateDiagramControl(control));
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      activateDiagramControl(control);
    });
  }

  // --- wiring: close --------------------------------------------------------
  function close(): void {
    unmount();
    options.onClose(activeProfile);
  }
  closeButton.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  // --- independent live poll: no reference to ControlEngine anywhere here ---
  function tick(): void {
    animation = requestAnimationFrame(tick);
    const pad = navigator.getGamepads().find((g) => g !== null);
    if (!pad) {
      if (gamepadId !== null) {
        gamepadId = null;
        statusLine.textContent = 'Controller: not detected';
      }
      return;
    }
    if (pad.id !== gamepadId) {
      gamepadId = pad.id;
      statusLine.textContent = `Controller: ${normalizeGamepadName(pad.id)} — connected`;
    }

    const reading: GamepadReading = {
      axes: pad.axes,
      buttons: pad.buttons.map((b) => b.pressed),
      buttonValues: pad.buttons.map((b) => b.value),
    };
    const values = readSemantic(reading);

    liveLeftStick.textContent = `X ${values.LeftStickX.toFixed(2)} · Y ${values.LeftStickY.toFixed(2)}`;
    liveRightStick.textContent = `X ${values.RightStickX.toFixed(2)} · Y ${values.RightStickY.toFixed(2)}`;
    liveL2.value = values.L2;
    liveR2.value = values.R2;
    const input = evaluateProfile(values, activeProfile);
    liveThrottle.textContent = `${Math.round(input.throttle * 100)}%`;
    liveSteering.textContent = `${Math.round(input.steering * 100)}%`;

    for (const control of ALL_CONTROLS) {
      const el = document.getElementById(`ctrl-${control}`);
      if (el === null) continue;
      const active = isAxisControl(control)
        ? Math.abs(values[control]) > DEFAULT_DEADZONE.stick ||
          Math.abs(values[STICK_AXIS_PAIRS[control] ?? control]) > DEFAULT_DEADZONE.stick
        : values[control] > 0.5;
      el.classList.toggle('controller-diagram__active', active);
    }

    if (rebindStep !== null) {
      const control = detectActivation(previousValues, values);
      if (control !== null) finishCapture(control);
    }
    previousValues = values;
  }
  animation = requestAnimationFrame(tick);

  refreshProfileTabs();
  refreshBindingList();
  showConflicts(activeProfile);

  function unmount(): void {
    if (animation !== null) cancelAnimationFrame(animation);
    animation = null;
    if (diagramInfoTimeout !== null) clearTimeout(diagramInfoTimeout);
    diagramInfoTimeout = null;
    container.remove();
  }

  return unmount;
}
