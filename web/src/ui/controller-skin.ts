/**
 * Controller diagram colour ("skin") — a purely cosmetic operator
 * preference. The Gamepad API exposes no body colour, so this is chosen,
 * not detected. Plain `localStorage`, same pattern as video/preference.ts:
 * anything missing or malformed falls back to the default skin.
 */

export interface ControllerSkin {
  /** Grips and touchpad. */
  readonly shell: string;
  /** Centre section behind the sticks. */
  readonly core: string;
}

export interface SkinPreset {
  readonly id: string;
  readonly label: string;
  readonly skin: ControllerSkin;
}

export const SKIN_PRESETS: readonly SkinPreset[] = [
  { id: 'glacier', label: 'Glacier', skin: { shell: '#eceef0', core: '#1c1d22' } },
  { id: 'midnight', label: 'Midnight', skin: { shell: '#2a2c33', core: '#16171b' } },
  { id: 'crimson', label: 'Crimson', skin: { shell: '#b0212e', core: '#1a1a1f' } },
  { id: 'cobalt', label: 'Cobalt', skin: { shell: '#2f4fb3', core: '#15182a' } },
  { id: 'violet', label: 'Violet', skin: { shell: '#6b4fb0', core: '#1b1726' } },
  { id: 'rose', label: 'Rose', skin: { shell: '#e9b6c8', core: '#f3ecef' } },
];

export const DEFAULT_SKIN: ControllerSkin = SKIN_PRESETS[1]!.skin;

const STORAGE_KEY = 'rovelink.controllerSkin.v1';

const DARK_INK = '#15151a';
const LIGHT_INK = '#f4f5f7';

export const isHexColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

function channel(hex: string, offset: number): number {
  const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return c <= 0.040_45 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour, 0 (black) .. 1 (white). */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** Outline/glyph colour that stays legible on `background`. The 0.18
 * crossover is where dark and light ink have equal contrast. */
export const inkFor = (background: string): string =>
  luminance(background) > 0.18 ? DARK_INK : LIGHT_INK;

export function presetFor(skin: ControllerSkin): SkinPreset | null {
  return (
    SKIN_PRESETS.find(
      (p) =>
        p.skin.shell.toLowerCase() === skin.shell.toLowerCase() &&
        p.skin.core.toLowerCase() === skin.core.toLowerCase(),
    ) ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadSkin(storage: Pick<Storage, 'getItem'> = localStorage): ControllerSkin {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_SKIN;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_SKIN;
    const { shell, core } = parsed;
    if (!isHexColor(shell) || !isHexColor(core)) return DEFAULT_SKIN;
    return { shell, core };
  } catch {
    // Corrupted JSON or storage disabled: the default is always safe.
    return DEFAULT_SKIN;
  }
}

export function saveSkin(
  skin: ControllerSkin,
  storage: Pick<Storage, 'setItem'> = localStorage,
): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ shell: skin.shell, core: skin.core }));
  } catch {
    // Storage unavailable: the colour just won't survive a reload.
  }
}

/** The CSS custom properties the diagram's stylesheet reads. */
export function skinProperties(skin: ControllerSkin): Readonly<Record<string, string>> {
  return {
    '--pad-shell': skin.shell,
    '--pad-core': skin.core,
    '--pad-ink': inkFor(skin.shell),
    '--pad-core-ink': inkFor(skin.core),
  };
}

export function applySkin(
  target: { readonly style: Pick<CSSStyleDeclaration, 'setProperty'> },
  skin: ControllerSkin,
): void {
  for (const [name, value] of Object.entries(skinProperties(skin))) {
    target.style.setProperty(name, value);
  }
}
