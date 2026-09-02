/**
 * Inline SVG, top-down DualSense-style controller diagram (Problem 9 §11).
 *
 * An original vector silhouette built from primitives — proportioned and
 * laid out to read as a modern dual-grip controller (asymmetric grip pods,
 * a top touchpad, curved shoulder triggers), not a copy of any
 * manufacturer's asset, and carrying no manufacturer logos or trademarks.
 *
 * Every *interactive* region (the physical controls this app actually
 * binds — see control/controls.ts) carries `data-control="<PhysicalControl>"`
 * and a matching `id="ctrl-<PhysicalControl>"`, so the settings view can
 * look elements up directly for live highlighting and click-to-rebind
 * without re-querying by position. The body outline, touchpad, and PS/home
 * roundel are decorative only — this app has no bindable "touchpad" or
 * "home" physical control — and carry no such attributes.
 */

import { ALL_CONTROLS } from '../control/controls.ts';
import type { PhysicalControl } from '../control/controls.ts';

interface Shape {
  readonly control: PhysicalControl;
  readonly label: string;
  readonly svg: string;
}

const TITLE = (control: PhysicalControl, label: string): string =>
  `<title>${label.length > 0 ? label : control}</title>`;

const RECT = (
  control: PhysicalControl,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
  r = 6,
): Shape => ({
  control,
  label,
  svg: `<g data-control="${control}" id="ctrl-${control}" tabindex="0" role="button" aria-label="${label.length > 0 ? label : control}" class="controller-diagram__control">${TITLE(control, label)}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"></rect></g>`,
});

const CIRCLE = (
  control: PhysicalControl,
  label: string,
  cx: number,
  cy: number,
  radius: number,
  glyph = '',
): Shape => ({
  control,
  label,
  svg: `<g data-control="${control}" id="ctrl-${control}" tabindex="0" role="button" aria-label="${label.length > 0 ? label : control}" class="controller-diagram__control">${TITLE(control, label)}<circle cx="${cx}" cy="${cy}" r="${radius}"></circle>${glyph}</g>`,
});

/** Small vector glyphs for the face buttons — geometric shapes, not a
 * manufacturer's typeface or logo. */
const GLYPH_TRIANGLE = (cx: number, cy: number): string =>
  `<path class="controller-diagram__glyph" d="M ${cx} ${cy - 7} L ${cx + 6.5} ${cy + 5} L ${cx - 6.5} ${cy + 5} Z"></path>`;
const GLYPH_CIRCLE = (cx: number, cy: number): string =>
  `<circle class="controller-diagram__glyph" cx="${cx}" cy="${cy}" r="6.5"></circle>`;
const GLYPH_CROSS = (cx: number, cy: number): string =>
  `<path class="controller-diagram__glyph" d="M ${cx - 5} ${cy - 5} L ${cx + 5} ${cy + 5} M ${cx + 5} ${cy - 5} L ${cx - 5} ${cy + 5}"></path>`;
const GLYPH_SQUARE = (cx: number, cy: number): string =>
  `<rect class="controller-diagram__glyph" x="${cx - 5.5}" y="${cy - 5.5}" width="11" height="11"></rect>`;

const shapes: readonly Shape[] = [
  // Triggers — curved bars above the shoulder line.
  RECT('L2', 'L2', 138, 4, 104, 20, 10),
  RECT('R2', 'R2', 238, 4, 104, 20, 10),
  // Bumpers
  RECT('L1', 'L1', 143, 28, 92, 22, 9),
  RECT('R1', 'R1', 245, 28, 92, 22, 9),
  // Create / Options — flank the touchpad's lower edge.
  RECT('Create', 'Create', 183, 136, 30, 14, 7),
  RECT('Options', 'Options', 267, 136, 30, 14, 7),
  // D-pad (four arms of a cross), upper-left cluster
  RECT('DPadUp', 'D-pad up', 147, 187, 16, 20, 3),
  RECT('DPadDown', 'D-pad down', 147, 227, 16, 20, 3),
  RECT('DPadLeft', 'D-pad left', 125, 209, 20, 16, 3),
  RECT('DPadRight', 'D-pad right', 165, 209, 20, 16, 3),
  // Face buttons, upper-right cluster — each a round cap with its printed
  // glyph, matching the real controller (the shape is round; the symbol
  // is what differs).
  CIRCLE('Triangle', 'Triangle', 325, 187, 11, GLYPH_TRIANGLE(325, 187)),
  CIRCLE('Circle', 'Circle', 347, 209, 11, GLYPH_CIRCLE(347, 209)),
  CIRCLE('Cross', 'Cross', 325, 231, 11, GLYPH_CROSS(325, 231)),
  CIRCLE('Square', 'Square', 303, 209, 11, GLYPH_SQUARE(303, 209)),
  // Sticks (outer = axis pair, inner = L3/R3 click) — same lower row,
  // level with each other (the PlayStation layout, unlike Xbox's diagonal
  // offset — see module doc).
  CIRCLE('LeftStickX', '', 175, 271, 28),
  CIRCLE('L3', 'L3 (stick click)', 175, 271, 12),
  CIRCLE('RightStickX', '', 305, 271, 28),
  CIRCLE('R3', 'R3 (stick click)', 305, 271, 12),
];

/** The two stick outlines are drawn from LeftStickX/RightStickX but also
 * represent the paired Y axis — highlighting keys off both. */
const STICK_AXIS_PAIRS: Readonly<Partial<Record<PhysicalControl, PhysicalControl>>> = {
  LeftStickX: 'LeftStickY',
  RightStickX: 'RightStickY',
};

/**
 * Original top-down silhouette: a central bridge (housing the touchpad,
 * Create/Options, and the PS/home roundel) flaring into two rounded grip
 * pods, with a concave notch between them — the proportions that read as
 * "dual-grip modern controller" without tracing any specific product.
 */
const BODY_PATH = `M 190 54
C 165 54 150 68 150 92
L 150 136
C 96 140 40 158 22 208
C 6 254 18 302 60 324
C 92 340 130 332 148 300
C 158 282 160 260 158 238
C 172 246 208 250 240 250
C 272 250 308 246 322 238
C 320 260 322 282 332 300
C 350 332 388 340 420 324
C 462 302 474 254 458 208
C 440 158 384 140 330 136
L 330 92
C 330 68 315 54 290 54
Z`;

// No role="img"/aria-label on the <svg> itself: that would flatten the
// whole subtree into a single presentational image, hiding every
// interactive <g role="button"> control below from assistive tech. The
// group wrapper below carries the label instead, so the diagram reads as
// a labeled group of individually-focusable buttons — required for
// click-to-rebind (Problem 9 §13) to be keyboard/screen-reader reachable,
// not just mouse-only.
export const CONTROLLER_DIAGRAM_SVG = `
<div role="group" aria-label="Controller layout — activate a control to rebind it">
<svg viewBox="0 0 480 340" class="controller-diagram__svg">
  <path d="${BODY_PATH}" class="controller-diagram__body"></path>
  <rect x="170" y="70" width="140" height="60" rx="12" class="controller-diagram__touchpad"></rect>
  <circle cx="240" cy="172" r="9" class="controller-diagram__home"></circle>
  ${shapes.map((s) => s.svg).join('\n  ')}
</svg>
</div>`;

export { STICK_AXIS_PAIRS };
export const DIAGRAM_CONTROLS: readonly PhysicalControl[] = ALL_CONTROLS;
