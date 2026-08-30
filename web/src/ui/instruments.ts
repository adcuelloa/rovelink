/**
 * Console rendering.
 *
 * Nothing writes to the DOM directly: readings are accumulated and flushed a
 * single time per frame, and only the fields that changed. This way the control
 * loop can run at 60 Hz without dragging down the browser.
 */

import type { Gripper } from '@rovelink/protocol';
import { differentialMix, wheelPwm } from '@rovelink/protocol';

import type { TransportState } from '../transport/types.ts';
import { $ } from './dom.ts';

export interface Readings {
  readonly throttle: number;
  readonly steering: number;
  readonly gripper: Gripper;
  readonly armed: boolean;
  readonly robotOnline: boolean;
  readonly connection: TransportState;
  readonly rtt: number | null;
  readonly rssi: number | null;
  readonly seq: number;
  readonly sent: number;
  readonly received: number;
  readonly gamepad: string;
  readonly transport: string;
  readonly telThrottle: number;
  readonly telSteering: number;
}

export const INITIAL_READINGS: Readings = {
  throttle: 0,
  steering: 0,
  gripper: 'idle',
  armed: false,
  robotOnline: false,
  connection: 'disconnected',
  rtt: null,
  rssi: null,
  seq: 0,
  sent: 0,
  received: 0,
  gamepad: 'not detected',
  transport: 'WebSocket',
  telThrottle: 0,
  telSteering: 0,
};

const CONNECTION_TEXT: Record<TransportState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
};

/** Gripper jaw opening, in degrees per side. */
const GRIPPER_ANGLE: Record<Gripper, number> = { idle: 10, open: 26, close: 0 };

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export class Instruments {
  readonly #chassis = $('#chassis', HTMLElement);
  readonly #gripper = $('#gripper', HTMLElement);
  readonly #dot = $('#pad-dot', HTMLElement);
  readonly #wheels = {
    left: [$('#wheel-left-front', HTMLElement), $('#wheel-left-rear', HTMLElement)],
    right: [$('#wheel-right-front', HTMLElement), $('#wheel-right-rear', HTMLElement)],
  };
  readonly #throttleValue = $('#throttle-value', HTMLOutputElement);
  readonly #steeringValue = $('#steering-value', HTMLOutputElement);
  readonly #wheelsValue = $('#wheel-values', HTMLOutputElement);
  readonly #robotChip = $('#chip-robot', HTMLElement);
  readonly #armedChip = $('#chip-armed', HTMLElement);
  readonly #gamepadStatus = $('#controller-status', HTMLElement);
  readonly #armButton = $('#btn-arm', HTMLButtonElement);
  readonly #linkValue = $('#tel-connection', HTMLElement);
  readonly #rttValue = $('#tel-rtt', HTMLElement);
  readonly #rssiValue = $('#tel-rssi', HTMLElement);
  readonly #seqValue = $('#tel-seq', HTMLElement);
  readonly #sentValue = $('#tel-sent', HTMLElement);
  readonly #receivedValue = $('#tel-received', HTMLElement);
  readonly #gripperValue = $('#tel-gripper', HTMLElement);
  readonly #telThrottle = $('#tel-throttle', HTMLElement);
  readonly #telSteering = $('#tel-steering', HTMLElement);
  readonly #transportValue = $('#transport-name', HTMLElement);

  #current: Readings = INITIAL_READINGS;
  #painted: Readings = INITIAL_READINGS;
  #animation: number | null = null;

  get readings(): Readings {
    return this.#current;
  }

  update(partial: Partial<Readings>): void {
    this.#current = { ...this.#current, ...partial };
    if (this.#animation !== null) return;
    this.#animation = requestAnimationFrame(() => {
      this.#animation = null;
      this.#flush();
    });
  }

  destroy(): void {
    if (this.#animation !== null) cancelAnimationFrame(this.#animation);
    this.#animation = null;
  }

  #flush(): void {
    const a = this.#current;
    const p = this.#painted;

    if (a.throttle !== p.throttle || a.steering !== p.steering) {
      this.#drawTraction(a.throttle, a.steering);
    }
    if (a.throttle !== p.throttle) {
      this.#throttleValue.textContent = percent(a.throttle);
      this.#dot.style.setProperty('--y', String(-a.throttle));
    }
    if (a.steering !== p.steering) {
      this.#steeringValue.textContent = percent(a.steering);
      this.#dot.style.setProperty('--x', String(a.steering));
    }

    if (a.gripper !== p.gripper) {
      this.#gripper.dataset.gripper = a.gripper;
      this.#gripper.style.setProperty('--a', `${GRIPPER_ANGLE[a.gripper]}deg`);
      this.#gripperValue.textContent = a.gripper;
    }

    if (a.armed !== p.armed) {
      this.#chassis.dataset.armed = String(a.armed);
      this.#armedChip.textContent = a.armed ? 'Armed' : 'Safe';
      this.#armedChip.dataset.on = String(a.armed);
      this.#armButton.setAttribute('aria-pressed', String(a.armed));
    }
    if (a.robotOnline !== p.robotOnline) {
      this.#robotChip.textContent = a.robotOnline ? 'Online' : 'Offline';
      this.#robotChip.dataset.on = String(a.robotOnline);
    }

    if (a.connection !== p.connection) this.#linkValue.textContent = CONNECTION_TEXT[a.connection];
    if (a.rtt !== p.rtt) this.#rttValue.textContent = a.rtt === null ? '—' : `${a.rtt} ms`;
    if (a.rssi !== p.rssi) this.#rssiValue.textContent = a.rssi === null ? '—' : `${a.rssi} dBm`;
    if (a.seq !== p.seq) this.#seqValue.textContent = String(a.seq);
    if (a.sent !== p.sent) this.#sentValue.textContent = String(a.sent);
    if (a.received !== p.received) this.#receivedValue.textContent = String(a.received);
    if (a.telThrottle !== p.telThrottle) this.#telThrottle.textContent = percent(a.telThrottle);
    if (a.telSteering !== p.telSteering) this.#telSteering.textContent = percent(a.telSteering);
    if (a.transport !== p.transport) this.#transportValue.textContent = a.transport;
    if (a.gamepad !== p.gamepad) this.#gamepadStatus.textContent = `Controller: ${a.gamepad}`;

    this.#painted = a;
  }

  /** All four wheels display the PWM the firmware would write to ENA/ENB. */
  #drawTraction(throttle: number, steering: number): void {
    const wheels = differentialMix(throttle, steering);
    this.#drawSide(this.#wheels.left, wheels.left);
    this.#drawSide(this.#wheels.right, wheels.right);
    this.#wheelsValue.textContent = `${wheelPwm(wheels.left)} / ${wheelPwm(wheels.right)}`;
  }

  #drawSide(wheels: readonly HTMLElement[], value: number): void {
    const direction = value < 0 ? 'reverse' : 'forward';
    for (const wheel of wheels) {
      wheel.style.setProperty('--m', String(Math.abs(value)));
      if (wheel.dataset.direction !== direction) wheel.dataset.direction = direction;
    }
  }
}
