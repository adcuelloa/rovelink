/**
 * Boundary between the control layer and the outside world.
 *
 * Everything above (remote control, keyboard, control engine, UI) only
 * knows this interface, so swapping `MockTransport` for
 * `WebSocketTransport` touches no other layer.
 */

import type { ControlState, Telemetry } from '@rovelink/protocol';

export type TransportState = 'disconnected' | 'connecting' | 'connected';

export type AlertLevel = 'info' | 'ok' | 'error';

export interface Counters {
  readonly sent: number;
  readonly received: number;
  readonly seq: number;
}

export const INITIAL_COUNTS: Counters = { sent: 0, received: 0, seq: 0 };

export type TransportEvent =
  | { readonly kind: 'state'; readonly state: TransportState }
  | { readonly kind: 'robot'; readonly online: boolean }
  | { readonly kind: 'telemetry'; readonly data: Telemetry }
  /** Real evidence that the physical device itself produced something —
   * currently only a `telemetry` receipt, later also a `control.ack` (see
   * Problem 8A). Deliberately its own event, separate from `telemetry`'s
   * payload: this is what device-freshness/"Last seen" tracking reads, and
   * it must never be inferred from anything else — not a controller-sent
   * frame, not a relay `pong`, not a local timer, not `robot` presence. */
  | { readonly kind: 'device-activity'; readonly at: number }
  /** Round-trip time to the relay/Cloudflare edge itself (ping answered by
   * the relay, never touching the device) — named explicitly (not just
   * "rtt") to stay distinct from the device-round-trip metrics below. */
  | { readonly kind: 'relay-rtt'; readonly ms: number }
  /** browser -> relay -> device -> relay -> browser, for one accepted and
   * applied `control` frame (see `ControlAck` in protocol.ts). Never
   * fabricated for a frame the device rejected (wrong session, stale/
   * duplicate seq) — those never receive one. */
  | { readonly kind: 'control-rtt'; readonly ms: number }
  /** Same round trip as 'control-rtt', specifically for an emergency-stop
   * (see `EmergencyStopAck`) — kept distinct since it correlates by
   * `sentAt` rather than session+seq and is operationally the metric that
   * matters most for safety review. */
  | { readonly kind: 'estop-rtt'; readonly ms: number }
  | { readonly kind: 'counters'; readonly data: Counters }
  | { readonly kind: 'alert'; readonly level: AlertLevel; readonly text: string }
  /** The relay rejected the controller credential (WS close 4003
   * `auth-failed`), or no credential was configured at all: the transport
   * has already stopped retrying and discarded the bad key. The UI should
   * return to the login prompt. */
  | { readonly kind: 'auth-error'; readonly text: string }
  /** The relay has confirmed this controller is now the authoritative
   * session (`controller.session`, relay-authored only — see room.ts
   * #handleControllerRegister). The UI must reset to SAFE_STATE and the
   * sender must force-send the disarmed baseline in direct response — see
   * ControlSender.establishSessionBaseline(). Never fires merely because
   * the socket opened or a room broadcast arrived. */
  | { readonly kind: 'session-established' };

export type TransportListener = (event: TransportEvent) => void;

export interface RobotTransport {
  /** Display name in telemetry: "Mock", "WebSocket", … */
  readonly name: string;
  readonly robotId: string;
  connect(): Promise<void>;
  disconnect(): void;
  /** Current vehicle state. Not an enqueuable command: the last one wins. */
  sendControl(state: ControlState): void;
  emergencyStop(): void;
  subscribe(listener: TransportListener): () => void;
}

/** Common event distribution for all transports. */
export class Emitter {
  readonly #listeners = new Set<TransportListener>();

  subscribe(listener: TransportListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  emit(event: TransportEvent): void {
    for (const listener of this.#listeners) listener(event);
  }

  clear(): void {
    this.#listeners.clear();
  }
}
