export interface RoverViewProps {
  readonly left: number;
  readonly right: number;
  readonly armed: boolean;
}

/**
 * A generic educational top-down differential rover — NOT the final
 * physical RoveLink chassis, just enough to show differentialMix()'s
 * output (see @rovelink/protocol) as motion.
 */
export function RoverView({ left, right, armed }: RoverViewProps) {
  const turn = right - left; // >0 spins toward the faster (right-relative) side
  const bodyRotation = Math.max(-18, Math.min(18, turn * 18));
  return (
    <div style={{ textAlign: 'center', padding: '0.6rem 0' }}>
      <svg
        className="rl-rover"
        width={160}
        height={160}
        viewBox="0 0 160 160"
        role="img"
        aria-label="Logical drive model"
      >
        <g transform={`translate(80 80) rotate(${bodyRotation})`}>
          <rect
            x={-38}
            y={-55}
            width={16}
            height={40}
            rx={3}
            fill={armed ? 'var(--rl-ok)' : '#666'}
            opacity={Math.max(0.25, Math.abs(left))}
          />
          <rect
            x={22}
            y={-55}
            width={16}
            height={40}
            rx={3}
            fill={armed ? 'var(--rl-ok)' : '#666'}
            opacity={Math.max(0.25, Math.abs(right))}
          />
          <rect
            x={-38}
            y={15}
            width={16}
            height={40}
            rx={3}
            fill={armed ? 'var(--rl-ok)' : '#666'}
            opacity={Math.max(0.25, Math.abs(left))}
          />
          <rect
            x={22}
            y={15}
            width={16}
            height={40}
            rx={3}
            fill={armed ? 'var(--rl-ok)' : '#666'}
            opacity={Math.max(0.25, Math.abs(right))}
          />
          <rect
            x={-30}
            y={-45}
            width={60}
            height={90}
            rx={10}
            fill={armed ? 'var(--rl-accent)' : '#3a3f47'}
          />
          <polygon points="0,-50 -8,-36 8,-36" fill="#111" />
        </g>
      </svg>
      <div style={{ fontFamily: 'var(--rl-mono)', fontSize: '0.72rem', opacity: 0.7 }}>
        L {left.toFixed(2)} · R {right.toFixed(2)} · logical drive model
      </div>
    </div>
  );
}
