import type { Story } from './types.ts';

/**
 * "From R2 to the motors" — the guided tour. Each beat focuses one node on
 * the SAME graph the explorer renders; nothing here is a separate diagram.
 * `example` values are illustrative, real-shaped simulation data, not a
 * live capture — the passport still links to the real source of truth.
 */
export const R2_TO_MOTORS_STORY: Story = {
  id: 'r2-to-motors',
  steps: [
    { nodeId: 'input-device' },
    { nodeId: 'gamepad-input', example: { control: 'R2', value: 0.82 } },
    { nodeId: 'controller-profile', example: { profile: 'Racing', throttle: 0.82, steering: 0.0 } },
    { nodeId: 'input-ownership', example: { owner: 'gamepad' } },
    { nodeId: 'control-engine', example: { throttle: 0.82, steering: 0, armed: true } },
    { nodeId: 'control-sender', example: { decision: 'rate' } },
    { nodeId: 'control-protocol', example: { seq: 381, ttlMs: 500 } },
    { nodeId: 'websocket-transport' },
    { nodeId: 'control-relay' },
    { nodeId: 'robot-room' },
    { nodeId: 'control-session', example: { sessionId: 'a1b2c3d4…' } },
    { nodeId: 'firmware-transport' },
    { nodeId: 'firmware-control', example: { session: 'ok', seq: 'ok', baseline: 'ready' } },
    { nodeId: 'differential-mix', example: { left: 0.82, right: 0.82 } },
    { nodeId: 'robot-hardware' },
    { nodeId: 'motors' },
    { nodeId: 'control-ack', example: { seq: 381 } },
  ],
};

export const STORIES: readonly Story[] = [R2_TO_MOTORS_STORY];
