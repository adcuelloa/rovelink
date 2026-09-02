import { differentialMix, wheelPwm } from '@rovelink/protocol';
import { useState } from 'react';

import { RoverView } from './lab/RoverView.tsx';

export interface DifferentialDrivePlaygroundProps {
  readonly locale: 'en' | 'es';
}

/**
 * differentialMix() and wheelPwm() here are the REAL, unmodified
 * @rovelink/protocol functions — the exact same code the firmware and the
 * production dashboard both use, not a lookalike approximation.
 */
export function DifferentialDrivePlayground({ locale }: DifferentialDrivePlaygroundProps) {
  const [throttle, setThrottle] = useState(0);
  const [steering, setSteering] = useState(0);
  const wheels = differentialMix(throttle, steering);
  const leftPwm = wheelPwm(wheels.left);
  const rightPwm = wheelPwm(wheels.right);

  return (
    <div className="rl-lab" lang={locale}>
      <div className="rl-panel">
        <label style={{ display: 'block', marginBottom: '0.8rem' }}>
          <div
            style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.75rem', marginBottom: '0.2rem' }}
          >
            throttle {throttle.toFixed(2)}
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={throttle}
            onChange={(e) => setThrottle(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ display: 'block' }}>
          <div
            style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.75rem', marginBottom: '0.2rem' }}
          >
            steering {steering.toFixed(2)}
          </div>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.01}
            value={steering}
            onChange={(e) => setSteering(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
      </div>

      <RoverView left={wheels.left} right={wheels.right} armed />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="rl-panel">
          <p className="rl-panel__title">left</p>
          <div style={{ fontFamily: 'var(--rl-mono)' }}>
            <div>mix {wheels.left.toFixed(3)}</div>
            <div>PWM {leftPwm}</div>
          </div>
        </div>
        <div className="rl-panel">
          <p className="rl-panel__title">right</p>
          <div style={{ fontFamily: 'var(--rl-mono)' }}>
            <div>mix {wheels.right.toFixed(3)}</div>
            <div>PWM {rightPwm}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
