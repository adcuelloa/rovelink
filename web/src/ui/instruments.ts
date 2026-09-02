/**
 * Console rendering.
 *
 * Nothing writes to the DOM directly: readings are accumulated and flushed a
 * single time per frame, and only the fields that changed. This way the control
 * loop can run at 60 Hz without dragging down the browser.
 */

import type { Gripper } from '@rovelink/protocol';
import { differentialMix, wheelPwm } from '@rovelink/protocol';

import type { DeviceHealth } from '../health/device-health.ts';
import { rssiQuality, rttQuality, SIGNAL_QUALITY_LABEL } from '../health/quality.ts';
import type { TransportState } from '../transport/types.ts';
import { $ } from './dom.ts';

export interface Readings {
  readonly throttle: number;
  readonly steering: number;
  readonly gripper: Gripper;
  readonly armed: boolean;
  readonly robotOnline: boolean;
  /** Online/Unresponsive/Offline (Problem 8A) — see health/device-health.ts.
   * `robotOnline` above stays the raw relay-authoritative presence: it is
   * what control-view.ts reads back (via `instruments.readings`) to
   * recompute this on its local freshness timer, without needing its own
   * separate copy of relay presence. */
  readonly deviceHealth: DeviceHealth;
  /** Pre-formatted by health/device-health.ts's formatLastSeen — Instruments
   * only paints, it does not compute freshness or own a clock. */
  readonly lastSeenText: string;
  readonly connection: TransportState;
  /** Relay RTT: browser <-> Cloudflare edge, never touching the device. */
  readonly rtt: number | null;
  /** Control RTT: browser -> relay -> device -> relay -> browser, smoothed
   * (EWMA, see control-view.ts). `null` before the first sample of the
   * current session — rendered as "Measuring…", never a fabricated 0. */
  readonly controlRtt: number | null;
  /** Last E-stop round trip, same path as Control RTT but for an
   * emergency-stop specifically — raw, not smoothed (Problem 8A). */
  readonly estopRtt: number | null;
  readonly rssi: number | null;
  readonly seq: number;
  readonly sent: number;
  readonly received: number;
  readonly gamepad: string;
  readonly telThrottle: number;
  readonly telSteering: number;
}

export const INITIAL_READINGS: Readings = {
  throttle: 0,
  steering: 0,
  gripper: 'idle',
  armed: false,
  robotOnline: false,
  deviceHealth: 'offline',
  lastSeenText: '—',
  connection: 'disconnected',
  rtt: null,
  controlRtt: null,
  estopRtt: null,
  rssi: null,
  seq: 0,
  sent: 0,
  received: 0,
  gamepad: 'not detected',
  telThrottle: 0,
  telSteering: 0,
};

const CONNECTION_TEXT: Record<TransportState, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  connected: 'Connected',
};

const DEVICE_HEALTH_TEXT: Record<DeviceHealth, string> = {
  online: 'Online',
  unresponsive: 'Unresponsive',
  offline: 'Offline',
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
  readonly #controlRttValue = $('#tel-control-rtt', HTMLElement);
  readonly #estopRttValue = $('#tel-estop-rtt', HTMLElement);
  readonly #lastSeenValue = $('#tel-lastseen', HTMLElement);
  readonly #rssiValue = $('#tel-rssi', HTMLElement);
  readonly #seqValue = $('#tel-seq', HTMLElement);
  readonly #sentValue = $('#tel-sent', HTMLElement);
  readonly #receivedValue = $('#tel-received', HTMLElement);
  readonly #gripperValue = $('#tel-gripper', HTMLElement);
  readonly #telThrottle = $('#tel-throttle', HTMLElement);
  readonly #telSteering = $('#tel-steering', HTMLElement);

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
    if (a.deviceHealth !== p.deviceHealth) {
      this.#robotChip.textContent = DEVICE_HEALTH_TEXT[a.deviceHealth];
      this.#robotChip.dataset.health = a.deviceHealth;
    }

    if (a.connection !== p.connection) this.#linkValue.textContent = CONNECTION_TEXT[a.connection];
    if (a.rtt !== p.rtt) this.#rttValue.textContent = a.rtt === null ? '—' : `${a.rtt} ms`;
    if (a.controlRtt !== p.controlRtt) {
      // Quality band is a reading aid alongside the number (Problem 9 §6) —
      // the raw ms value always stays, nothing is ever hidden behind it.
      this.#controlRttValue.textContent =
        a.controlRtt === null
          ? 'Measuring…'
          : `${a.controlRtt} ms · ${SIGNAL_QUALITY_LABEL[rttQuality(a.controlRtt)]}`;
    }
    if (a.estopRtt !== p.estopRtt) {
      this.#estopRttValue.textContent = a.estopRtt === null ? '—' : `${a.estopRtt} ms`;
    }
    if (a.lastSeenText !== p.lastSeenText) this.#lastSeenValue.textContent = a.lastSeenText;
    if (a.rssi !== p.rssi) {
      this.#rssiValue.textContent =
        a.rssi === null ? '—' : `${a.rssi} dBm · ${SIGNAL_QUALITY_LABEL[rssiQuality(a.rssi)]}`;
    }
    if (a.seq !== p.seq) this.#seqValue.textContent = String(a.seq);
    if (a.sent !== p.sent) this.#sentValue.textContent = String(a.sent);
    if (a.received !== p.received) this.#receivedValue.textContent = String(a.received);
    if (a.telThrottle !== p.telThrottle) this.#telThrottle.textContent = percent(a.telThrottle);
    if (a.telSteering !== p.telSteering) this.#telSteering.textContent = percent(a.telSteering);
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
