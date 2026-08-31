/**
 * Inline SVG, top-down PlayStation-style controller diagram.
 *
 * Not trademark-accurate product art — an intuitive interactive map. Every
 * region carries `data-control="<PhysicalControl>"` and a matching
 * `id="ctrl-<PhysicalControl>"`, so the settings view can look elements up
 * directly for live highlighting without re-querying by position.
 */

import { ALL_CONTROLS } from '../control/controls.ts';
import type { PhysicalControl } from '../control/controls.ts';

interface Shape {
  readonly control: PhysicalControl;
  readonly label: string;
  readonly svg: string;
}

const RECT = (control: PhysicalControl, label: string, x: number, y: number, w: number, h: number, r = 6): Shape => ({
  control,
  label,
  svg: `<rect data-control="${control}" id="ctrl-${control}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"></rect>`,
});

const CIRCLE = (control: PhysicalControl, label: string, cx: number, cy: number, radius: number): Shape => ({
  control,
  label,
  svg: `<circle data-control="${control}" id="ctrl-${control}" cx="${cx}" cy="${cy}" r="${radius}"></circle>`,
});

const shapes: readonly Shape[] = [
  // Triggers
  RECT('L2', 'L2', 18, 10, 62, 16, 8),
  RECT('R2', 'R2', 320, 10, 62, 16, 8),
  // Bumpers
  RECT('L1', 'L1', 18, 30, 62, 14, 6),
  RECT('R1', 'R1', 320, 30, 62, 14, 6),
  // Create / Options
  RECT('Create', 'Create', 154, 60, 34, 14, 7),
  RECT('Options', 'Options', 212, 60, 34, 14, 7),
  // D-pad (four arms of a cross)
  RECT('DPadUp', '', 95, 92, 16, 18, 3),
  RECT('DPadDown', '', 95, 128, 16, 18, 3),
  RECT('DPadLeft', '', 77, 110, 18, 16, 3),
  RECT('DPadRight', '', 113, 110, 18, 16, 3),
  // Face buttons (Triangle/Circle/Cross/Square cross layout)
  RECT('Triangle', '△', 291, 92, 18, 18, 4),
  RECT('Circle', '○', 310, 111, 18, 18, 4),
  RECT('Cross', '✕', 291, 130, 18, 18, 4),
  RECT('Square', '□', 272, 111, 18, 18, 4),
  // Sticks (outer = axis pair, inner = L3/R3 click)
  CIRCLE('LeftStickX', '', 120, 168, 26),
  CIRCLE('L3', 'L3', 120, 168, 10),
  CIRCLE('RightStickX', '', 280, 168, 26),
  CIRCLE('R3', 'R3', 280, 168, 10),
];

/** The two stick outlines are drawn from LeftStickX/RightStickX but also
 * represent the paired Y axis — highlighting keys off both. */
const STICK_AXIS_PAIRS: Readonly<Partial<Record<PhysicalControl, PhysicalControl>>> = {
  LeftStickX: 'LeftStickY',
  RightStickX: 'RightStickY',
};

export const CONTROLLER_DIAGRAM_SVG = `
<svg viewBox="0 0 400 210" class="controller-diagram__svg" role="img" aria-label="Controller layout">
  <rect x="4" y="4" width="392" height="200" rx="60" class="controller-diagram__body"></rect>
  ${shapes.map((s) => s.svg).join('\n  ')}
</svg>`;

export { STICK_AXIS_PAIRS };
export const DIAGRAM_CONTROLS: readonly PhysicalControl[] = ALL_CONTROLS;
