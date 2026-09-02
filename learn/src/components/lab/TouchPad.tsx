import type { Gripper } from '@rovelink/protocol';
import { useRef } from 'react';

export interface TouchPadProps {
  readonly onAxes: (throttle: number, steering: number) => void;
  readonly onGripper: (gripper: Gripper) => void;
  readonly locale?: 'en' | 'es';
}

const GRIPPER_LABELS = {
  en: { open: 'Open', close: 'Close' },
  es: { open: 'Abrir', close: 'Cerrar' },
} as const;

function PadButton({
  label,
  onDown,
  onUp,
}: {
  readonly label: string;
  readonly onDown: () => void;
  readonly onUp: () => void;
}) {
  return (
    <button
      type="button"
      className="rl-btn"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {label}
    </button>
  );
}

/**
 * On-screen touch controls, held the same way a keyboard key is held
 * (pointerdown claims, pointerup/pointercancel releases). The wiring
 * mirrors web/src/control-view.ts's touch section, reimplemented here
 * rather than imported: that logic is inline in a DOM-template-coupled
 * view function, not an exported pure module.
 */
export function TouchPad({ onAxes, onGripper, locale = 'en' }: TouchPadProps) {
  const axes = useRef({ throttle: 0, steering: 0 });
  const gripperLabels = GRIPPER_LABELS[locale];

  function press(axis: 'throttle' | 'steering', value: number): void {
    axes.current = { ...axes.current, [axis]: value };
    onAxes(axes.current.throttle, axes.current.steering);
  }

  function release(axis: 'throttle' | 'steering'): void {
    axes.current = { ...axes.current, [axis]: 0 };
    onAxes(axes.current.throttle, axes.current.steering);
  }

  return (
    <div className="rl-btn-row" style={{ justifyContent: 'center', marginTop: '0.6rem' }}>
      <PadButton label="▲" onDown={() => press('throttle', 1)} onUp={() => release('throttle')} />
      <PadButton label="▼" onDown={() => press('throttle', -1)} onUp={() => release('throttle')} />
      <PadButton label="◀" onDown={() => press('steering', -1)} onUp={() => release('steering')} />
      <PadButton label="▶" onDown={() => press('steering', 1)} onUp={() => release('steering')} />
      <PadButton
        label={gripperLabels.open}
        onDown={() => onGripper('open')}
        onUp={() => onGripper('idle')}
      />
      <PadButton
        label={gripperLabels.close}
        onDown={() => onGripper('close')}
        onUp={() => onGripper('idle')}
      />
    </div>
  );
}
