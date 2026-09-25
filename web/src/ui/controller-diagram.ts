/**
 * Inline SVG DualSense diagram (Problem 9 §11) with live input rendering.
 *
 * Geometry comes from daidr/dualsense-tester (MIT) — see dualsense-paths.ts
 * for the attribution and the licence text. That source's manufacturer
 * logo is left out; a plain home roundel sits in its place.
 *
 * Every *interactive* region (the physical controls this app actually
 * binds — see control/controls.ts) carries `data-control="<PhysicalControl>"`
 * and a matching `id="ctrl-<PhysicalControl>"`, so the settings view can
 * look elements up directly for live highlighting and click-to-rebind
 * without re-querying by position. The body, touchpad, mute button and home
 * roundel are decorative only — this app has no bindable "touchpad" or
 * "home" physical control — and carry no such attributes.
 *
 * Colour comes from CSS custom properties (`--pad-shell`, `--pad-core`,
 * `--pad-ink`, `--pad-core-ink`) — see controller-skin.ts.
 */

import { ALL_CONTROLS, isAxisControl, isPressed } from '../control/controls.ts';
import type { PhysicalControl, SemanticValues } from '../control/controls.ts';
import { DEFAULT_DEADZONE } from '../control/mapping.ts';
import {
  BODY_FILL,
  BUMPER_L1,
  BUMPER_R1,
  CREATE_BUTTON,
  CREATE_ICON,
  DPAD,
  FACE,
  FACE_RADIUS,
  GRIP_LEFT,
  GRIP_RIGHT,
  HOME_BUTTON,
  MUTE_BUTTON,
  OPTIONS_BUTTON,
  OPTIONS_ICON,
  OUTLINE_PATHS,
  STICK_CAP_RADIUS,
  STICK_LEFT,
  STICK_RIGHT,
  STICK_TRAVEL,
  STICK_WELL_RADIUS,
  TOUCHPAD,
  TRIGGER_BOTTOM,
  TRIGGER_L2,
  TRIGGER_R2,
  TRIGGER_TOP,
  VIEWBOX,
} from './dualsense-paths.ts';

/** The two stick outlines are drawn from LeftStickX/RightStickX but also
 * represent the paired Y axis — highlighting keys off both. */
const STICK_AXIS_PAIRS: Readonly<Partial<Record<PhysicalControl, PhysicalControl>>> = {
  LeftStickX: 'LeftStickY',
  RightStickX: 'RightStickY',
};

// --- pure geometry helpers (unit-tested) -----------------------------------

/** Stick cap offset in SVG units: raw axes clamped to the unit circle, then
 * scaled to full travel — a diagonal never overshoots a cardinal. */
export function stickCapOffset(x: number, y: number): { readonly dx: number; readonly dy: number } {
  const magnitude = Math.hypot(x, y);
  const scale = magnitude > 1 ? STICK_TRAVEL / magnitude : STICK_TRAVEL;
  return { dx: x * scale, dy: y * scale };
}

/** Analog trigger fill: a rect rising from the trigger's base, clamped. */
export function triggerFillRect(value: number): { readonly y: number; readonly height: number } {
  const depth = Math.min(1, Math.max(0, value));
  const height = (TRIGGER_BOTTOM - TRIGGER_TOP) * depth;
  return { y: TRIGGER_BOTTOM - height, height };
}

/** Whether a control reads as "in use" — the rule the live highlight uses. */
export function isControlActive(values: SemanticValues, control: PhysicalControl): boolean {
  if (!isAxisControl(control)) return isPressed(values[control]);
  const pair = STICK_AXIS_PAIRS[control] ?? control;
  return (
    Math.abs(values[control]) > DEFAULT_DEADZONE.stick ||
    Math.abs(values[pair]) > DEFAULT_DEADZONE.stick
  );
}

// --- markup ----------------------------------------------------------------

const labelOf = (control: PhysicalControl, label: string): string =>
  label.length > 0 ? label : control;

const control = (c: PhysicalControl, label: string, inner: string): string =>
  `<g data-control="${c}" id="ctrl-${c}" tabindex="0" role="button" aria-label="${labelOf(c, label)}" class="controller-diagram__control"><title>${labelOf(c, label)}</title>${inner}</g>`;

const cap = (d: string): string => `<path class="controller-diagram__cap" d="${d}"></path>`;
const glyph = (d: string): string => `<path class="controller-diagram__glyph" d="${d}"></path>`;
const filledGlyph = (d: string): string =>
  `<path class="controller-diagram__glyph controller-diagram__glyph--filled" d="${d}"></path>`;

const TRIGGER_FILL_X = { L2: 125, R2: 855 } as const;
const TRIGGER_FILL_WIDTH = 140;

const trigger = (c: 'L2' | 'R2', d: string): string =>
  control(
    c,
    c,
    `<path class="controller-diagram__cap controller-diagram__cap--trigger" d="${d}"></path><rect class="controller-diagram__fill" data-fill="${c}" clip-path="url(#ds-clip-${c})" x="${TRIGGER_FILL_X[c]}" y="${TRIGGER_BOTTOM}" width="${TRIGGER_FILL_WIDTH}" height="0"></rect>`,
  );

const face = (c: 'Triangle' | 'Circle' | 'Cross' | 'Square', key: keyof typeof FACE): string =>
  control(
    c,
    c,
    `<circle class="controller-diagram__cap" cx="${FACE[key].cx}" cy="${FACE[key].cy}" r="${FACE_RADIUS}"></circle>${glyph(FACE[key].glyph)}`,
  );

const dpad = (c: PhysicalControl, label: string, key: keyof typeof DPAD): string =>
  control(c, label, `${cap(DPAD[key].shape)}${filledGlyph(DPAD[key].arrow)}`);

type Side = 'left' | 'right';
const STICK = { left: STICK_LEFT, right: STICK_RIGHT } as const;

const stickWell = (c: 'LeftStickX' | 'RightStickX', side: Side): string =>
  control(
    c,
    `${side === 'left' ? 'Left' : 'Right'} stick`,
    `<circle class="controller-diagram__cap controller-diagram__well" cx="${STICK[side].cx}" cy="${STICK[side].cy}" r="${STICK_WELL_RADIUS}"></circle>`,
  );

// The cap lives inside the L3/R3 control and moves with the stick; its
// inner <g> carries the transform so hover/focus styling stays on the group.
const stickCap = (c: 'L3' | 'R3', side: Side): string =>
  control(
    c,
    `${c} (stick click)`,
    `<g data-stick="${side}"><circle class="controller-diagram__cap controller-diagram__stick" cx="${STICK[side].cx}" cy="${STICK[side].cy}" r="${STICK_CAP_RADIUS}"></circle><circle class="controller-diagram__values controller-diagram__dot" cx="${STICK[side].cx}" cy="${STICK[side].cy}" r="4"></circle></g>`,
  );

const crosshair = (side: Side): string => {
  const { cx, cy } = STICK[side];
  return `<path class="controller-diagram__values controller-diagram__crosshair" d="M${cx - STICK_TRAVEL},${cy} H${cx + STICK_TRAVEL} M${cx},${cy - STICK_TRAVEL} V${cy + STICK_TRAVEL}"></path>`;
};

const readout = (id: string, x: number, y: number, anchor: 'start' | 'middle' | 'end'): string =>
  `<text class="controller-diagram__values controller-diagram__readout" data-readout="${id}" x="${x}" y="${y}" text-anchor="${anchor}"></text>`;

// No role="img"/aria-label on the <svg> itself: that would flatten the
// whole subtree into a single presentational image, hiding every
// interactive <g role="button"> control below from assistive tech. The
// group wrapper below carries the label instead, so the diagram reads as
// a labeled group of individually-focusable buttons — required for
// click-to-rebind (Problem 9 §13) to be keyboard/screen-reader reachable,
// not just mouse-only.
export const CONTROLLER_DIAGRAM_SVG = `
<div role="group" aria-label="Controller layout — activate a control to rebind it">
<svg viewBox="0 0 ${VIEWBOX.width} ${VIEWBOX.height}" class="controller-diagram__svg">
  <defs>
    <clipPath id="ds-clip-L2"><path d="${TRIGGER_L2}"></path></clipPath>
    <clipPath id="ds-clip-R2"><path d="${TRIGGER_R2}"></path></clipPath>
  </defs>
  <path class="controller-diagram__core" d="${BODY_FILL}"></path>
  <path class="controller-diagram__shell" d="${GRIP_LEFT}"></path>
  <path class="controller-diagram__shell" d="${GRIP_RIGHT}"></path>
  <path class="controller-diagram__shell controller-diagram__touchpad" d="${TOUCHPAD}"></path>
  ${OUTLINE_PATHS.map((d) => `<path class="controller-diagram__outline" d="${d}"></path>`).join('')}
  <path class="controller-diagram__decor" d="${MUTE_BUTTON}"></path>
  <circle class="controller-diagram__decor" cx="${HOME_BUTTON.cx}" cy="${HOME_BUTTON.cy}" r="${HOME_BUTTON.r}"></circle>
  ${trigger('L2', TRIGGER_L2)}
  ${trigger('R2', TRIGGER_R2)}
  ${control('L1', 'L1', cap(BUMPER_L1))}
  ${control('R1', 'R1', cap(BUMPER_R1))}
  ${control('Create', 'Create', `${cap(CREATE_BUTTON)}${glyph(CREATE_ICON)}`)}
  ${control('Options', 'Options', `${cap(OPTIONS_BUTTON)}${glyph(OPTIONS_ICON)}`)}
  ${dpad('DPadUp', 'D-pad up', 'up')}
  ${dpad('DPadDown', 'D-pad down', 'down')}
  ${dpad('DPadLeft', 'D-pad left', 'left')}
  ${dpad('DPadRight', 'D-pad right', 'right')}
  ${face('Triangle', 'triangle')}
  ${face('Circle', 'circle')}
  ${face('Cross', 'cross')}
  ${face('Square', 'square')}
  ${stickWell('LeftStickX', 'left')}
  ${stickWell('RightStickX', 'right')}
  ${crosshair('left')}
  ${crosshair('right')}
  ${stickCap('L3', 'left')}
  ${stickCap('R3', 'right')}
  ${readout('LeftStick', STICK_LEFT.cx, 690, 'middle')}
  ${readout('RightStick', STICK_RIGHT.cx, 690, 'middle')}
  ${readout('L2', 120, 70, 'end')}
  ${readout('R2', 997, 70, 'start')}
</svg>
</div>`;

// --- live updater ------------------------------------------------------------

export interface DiagramUpdater {
  /** Render one frame of semantic input values onto the diagram. */
  update(values: SemanticValues): void;
  /** Toggle the crosshair / numeric-readout overlay. */
  setShowValues(show: boolean): void;
}

const fmt = (n: number): string => (n < 0 ? '' : '+') + n.toFixed(2);

function setFill(el: SVGRectElement | null, value: number): void {
  if (el === null) return;
  const { y, height } = triggerFillRect(value);
  el.setAttribute('y', String(y));
  el.setAttribute('height', String(height));
}

function setStick(el: SVGGElement | null, x: number, y: number): void {
  if (el === null) return;
  const { dx, dy } = stickCapOffset(x, y);
  el.setAttribute('transform', `translate(${dx} ${dy})`);
}

function setText(el: SVGTextElement | null, text: string): void {
  if (el !== null && el.textContent !== text) el.textContent = text;
}

/**
 * Binds to an already-mounted CONTROLLER_DIAGRAM_SVG. Every element is looked
 * up once here — the per-frame `update` does no DOM queries.
 */
export function createDiagramUpdater(root: HTMLElement): DiagramUpdater {
  const controls = ALL_CONTROLS.flatMap((c) => {
    const el = root.querySelector<SVGGElement>(`#ctrl-${c}`);
    return el === null ? [] : [{ control: c, el }];
  });
  const fills = {
    L2: root.querySelector<SVGRectElement>('[data-fill="L2"]'),
    R2: root.querySelector<SVGRectElement>('[data-fill="R2"]'),
  };
  const sticks = {
    left: root.querySelector<SVGGElement>('[data-stick="left"]'),
    right: root.querySelector<SVGGElement>('[data-stick="right"]'),
  };
  const readouts = {
    LeftStick: root.querySelector<SVGTextElement>('[data-readout="LeftStick"]'),
    RightStick: root.querySelector<SVGTextElement>('[data-readout="RightStick"]'),
    L2: root.querySelector<SVGTextElement>('[data-readout="L2"]'),
    R2: root.querySelector<SVGTextElement>('[data-readout="R2"]'),
  };
  let showValues = false;

  return {
    update(values) {
      for (const { control: c, el } of controls) {
        el.classList.toggle('controller-diagram__active', isControlActive(values, c));
      }
      setFill(fills.L2, values.L2);
      setFill(fills.R2, values.R2);
      setStick(sticks.left, values.LeftStickX, values.LeftStickY);
      setStick(sticks.right, values.RightStickX, values.RightStickY);
      if (!showValues) return;
      setText(readouts.LeftStick, `X ${fmt(values.LeftStickX)}  Y ${fmt(values.LeftStickY)}`);
      setText(readouts.RightStick, `X ${fmt(values.RightStickX)}  Y ${fmt(values.RightStickY)}`);
      setText(readouts.L2, values.L2.toFixed(2));
      setText(readouts.R2, values.R2.toFixed(2));
    },
    setShowValues(show) {
      showValues = show;
      root.classList.toggle('controller-diagram--values', show);
    },
  };
}

export { STICK_AXIS_PAIRS };
export const DIAGRAM_CONTROLS: readonly PhysicalControl[] = ALL_CONTROLS;
