import assert from 'node:assert/strict';
import test from 'node:test';

import { ControlEngine } from './engine.ts';
import { listenGamepad, NO_GAMEPAD } from './gamepad.ts';
import type { GamepadHandlers, GamepadLike, GamepadState, GamepadTarget } from './gamepad.ts';
import { STANDARD_MAPPING } from './mapping.ts';

/**
 * A minimal fake for `GamepadTarget` — the narrow interface `listenGamepad`
 * actually depends on (see gamepad.ts), not the full DOM `Window`/`Gamepad`.
 * That narrowing is what makes this fake possible without jsdom or unsafe
 * casts: every field below is exactly what the production code reads.
 */
interface FakePad extends GamepadLike {
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

interface FakeGamepadEvent {
  readonly gamepad: FakePad;
}

const { forward: R2, reverse: L2 } = STANDARD_MAPPING.throttleTriggers;

/**
 * Digital buttons in `pressed` get value=1; R2/L2 depth can additionally be
 * set to any 0..1 analog value via `triggers` (its own `pressed` follows the
 * Gamepad API's own ~0.5 threshold, independent of the `pressed` list).
 */
function makeButtons(
  pressed: readonly number[] = [],
  triggers: { r2?: number; l2?: number } = {},
): { pressed: boolean; value: number }[] {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  }));
  if (triggers.r2 !== undefined) buttons[R2] = { pressed: triggers.r2 > 0.5, value: triggers.r2 };
  if (triggers.l2 !== undefined) buttons[L2] = { pressed: triggers.l2 > 0.5, value: triggers.l2 };
  return buttons;
}

function makePad(overrides: Partial<FakePad> = {}): FakePad {
  return {
    id: 'Test Pad (STANDARD GAMEPAD Vendor: 0000 Product: 0000)',
    index: 0,
    mapping: 'standard',
    axes: [0, 0],
    buttons: makeButtons(),
    ...overrides,
  };
}

/**
 * `GamepadTarget` only needs two named events with a `{ signal }` option to
 * unsubscribe — a hand-rolled pub-sub is simpler and fully typed, with no
 * need for a real `EventTarget`/`Event` (or any cast) to get there.
 */
class FakeWindow implements GamepadTarget {
  #gamepads: (FakePad | null)[] = [];
  #nextId = 0;
  readonly #callbacks = new Map<number, (time: number) => void>();
  readonly #connected = new Set<(event: FakeGamepadEvent) => void>();
  readonly #disconnected = new Set<(event: FakeGamepadEvent) => void>();
  readonly navigator = { getGamepads: (): readonly (FakePad | null)[] => this.#gamepads };

  addEventListener(
    type: 'gamepadconnected' | 'gamepaddisconnected',
    listener: (event: FakeGamepadEvent) => void,
    options: { signal: AbortSignal },
  ): void {
    const listeners = type === 'gamepadconnected' ? this.#connected : this.#disconnected;
    listeners.add(listener);
    options.signal.addEventListener('abort', () => listeners.delete(listener));
  }

  requestAnimationFrame(cb: (time: number) => void): number {
    const id = ++this.#nextId;
    this.#callbacks.set(id, cb);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.#callbacks.delete(id);
  }

  /** Runs every callback currently pending, once — one RAF tick. */
  tick(): void {
    const pending = [...this.#callbacks.entries()];
    this.#callbacks.clear();
    for (const [, cb] of pending) cb(0);
  }

  plug(pad: FakePad): void {
    this.#gamepads[pad.index] = pad;
    for (const listener of this.#connected) listener({ gamepad: pad });
  }

  unplug(pad: FakePad): void {
    this.#gamepads[pad.index] = null;
    for (const listener of this.#disconnected) listener({ gamepad: pad });
  }
}

function record(): {
  handlers: GamepadHandlers;
  axesCalls: [number, number][];
  gripperCalls: string[];
  actionCalls: string[];
  stateCalls: GamepadState[];
} {
  const axesCalls: [number, number][] = [];
  const gripperCalls: string[] = [];
  const actionCalls: string[] = [];
  const stateCalls: GamepadState[] = [];
  return {
    axesCalls,
    gripperCalls,
    actionCalls,
    stateCalls,
    handlers: {
      onAxes: (t, s) => axesCalls.push([t, s]),
      onGripper: (g) => gripperCalls.push(g),
      onAction: (a) => actionCalls.push(a),
      onState: (s) => stateCalls.push(s),
    },
  };
}

test('gamepad: connecting with a centered stick sends no movement', () => {
  const target = new FakeWindow();
  const { handlers, axesCalls, stateCalls, actionCalls } = record();
  const stop = listenGamepad(target, handlers);

  target.plug(makePad());
  target.tick();

  assert.equal(stateCalls.length, 1);
  assert.equal(stateCalls[0]?.connected, true);
  assert.equal(axesCalls.length, 0);
  assert.equal(actionCalls.length, 0, 'connecting must never imply an arm/disarm/stop action');
  stop();
});

test('gamepad: connecting with the stick already off-center sends no movement either', () => {
  // A real controller can be plugged in mid-motion, or an analog stick can
  // rest slightly off true center. Whatever it reads at the instant of
  // connection is the new baseline, not a reported movement.
  const target = new FakeWindow();
  const { handlers, axesCalls } = record();
  const stop = listenGamepad(target, handlers);

  target.plug(makePad({ axes: [0, -1] })); // stick already fully forward
  target.tick();

  assert.equal(axesCalls.length, 0);
  stop();
});

test('gamepad: a button already held at the instant of connection does not fire as an edge', () => {
  // If Arm happens to already be held when the controller is detected
  // (e.g. the operator was holding it while plugging in), that must not
  // read as a fresh press and arm the vehicle.
  const target = new FakeWindow();
  const { handlers, actionCalls } = record();
  const stop = listenGamepad(target, handlers);

  target.plug(makePad({ buttons: makeButtons([STANDARD_MAPPING.buttons.arm]) }));
  target.tick();

  assert.equal(actionCalls.length, 0);
  stop();
});

test('gamepad: connecting never arms — onState carries no armed concept at all', () => {
  const target = new FakeWindow();
  const { handlers, stateCalls } = record();
  const stop = listenGamepad(target, handlers);

  target.plug(makePad());
  target.tick();

  assert.deepEqual(Object.keys(stateCalls[0] ?? {}).toSorted(), ['connected', 'id', 'mapping']);
  stop();
});

test('gamepad: moving the stick beyond the deadzone after connecting publishes steering', () => {
  const target = new FakeWindow();
  const { handlers, axesCalls } = record();
  const stop = listenGamepad(target, handlers);

  const pad = makePad();
  target.plug(pad);
  target.tick(); // baseline: centered, no publish

  pad.axes = [1, 0]; // full right
  target.tick();

  assert.deepEqual(axesCalls.at(-1), [0, 1]);
  stop();
});

test('gamepad: pressing R2 after connecting publishes forward throttle', () => {
  const target = new FakeWindow();
  const { handlers, axesCalls } = record();
  const stop = listenGamepad(target, handlers);

  const pad = makePad();
  target.plug(pad);
  target.tick(); // baseline: triggers neutral, no publish

  pad.buttons = makeButtons([], { r2: 1 });
  target.tick();

  assert.deepEqual(axesCalls.at(-1), [1, 0]);
  stop();
});

test('gamepad: pressing L2 after connecting publishes reverse throttle', () => {
  const target = new FakeWindow();
  const { handlers, axesCalls } = record();
  const stop = listenGamepad(target, handlers);

  const pad = makePad();
  target.plug(pad);
  target.tick();

  pad.buttons = makeButtons([], { l2: 1 });
  target.tick();

  assert.deepEqual(axesCalls.at(-1), [-1, 0]);
  stop();
});

test('gamepad: partial R2 depth publishes proportional throttle', () => {
  const target = new FakeWindow();
  const { handlers, axesCalls } = record();
  const stop = listenGamepad(target, handlers);

  const pad = makePad();
  target.plug(pad);
  target.tick();

  pad.buttons = makeButtons([], { r2: 0.5 });
  target.tick();

  assert.deepEqual(axesCalls.at(-1), [0.5, 0]);
  stop();
});

test('gamepad: pressing Arm after connecting fires the arm action once', () => {
  const target = new FakeWindow();
  const { handlers, actionCalls } = record();
  const stop = listenGamepad(target, handlers);

  const pad = makePad();
  target.plug(pad);
  target.tick(); // baseline: released

  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm]);
  target.tick();
  target.tick(); // holding it must not repeat the action

  assert.deepEqual(actionCalls, ['arm']);
  stop();
});

test('gamepad: disconnect zeroes local axes and gripper immediately', () => {
  const target = new FakeWindow();
  const { handlers, axesCalls, gripperCalls, stateCalls } = record();
  const stop = listenGamepad(target, handlers);

  const pad = makePad();
  target.plug(pad);
  target.tick(); // baseline: centered, released

  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.openGripper], { r2: 1 });
  target.tick(); // real movement + gripper press after connecting
  assert.deepEqual(axesCalls.at(-1), [1, 0]);
  assert.equal(gripperCalls.at(-1), 'open');

  target.unplug(pad);

  assert.deepEqual(axesCalls.at(-1), [0, 0]);
  assert.equal(gripperCalls.at(-1), 'idle');
  assert.deepEqual(stateCalls.at(-1), NO_GAMEPAD);
  stop();
});

test('gamepad: reconnecting does not replay the stale pre-disconnect reading', () => {
  const target = new FakeWindow();
  const { handlers, axesCalls } = record();
  const stop = listenGamepad(target, handlers);

  const pad = makePad();
  target.plug(pad);
  target.tick();
  pad.buttons = makeButtons([], { r2: 1 });
  target.tick();
  assert.deepEqual(axesCalls.at(-1), [1, 0]);

  target.unplug(pad);
  assert.deepEqual(axesCalls.at(-1), [0, 0]);

  // Reconnects with triggers neutral — a fresh baseline, not the old throttle=1.
  const reconnected = makePad({ index: 0 });
  target.plug(reconnected);
  target.tick();

  assert.deepEqual(axesCalls.at(-1), [0, 0]);
  stop();
});

// --- integration: listenGamepad wired directly to a real ControlEngine ----
// This is the same shape of wiring control-view.ts uses (minus the DOM/UI
// layer, which this project does not unit test — see mapping.test.ts and
// keyboard.test.ts for the established pattern of testing pure/wired logic
// without a browser). It proves the disconnect-safety and no-bypass
// properties end to end, through the real engine, not a re-implementation.

function wireToEngine(target: FakeWindow, engine: ControlEngine): () => void {
  return listenGamepad(target, {
    onAxes: (throttle, steering) => engine.axes(throttle, steering),
    onGripper: (gripper) => engine.gripper(gripper),
    onAction: (action) => {
      if (action === 'stop') engine.emergencyStop();
      else if (action === 'arm') engine.arm(true);
      else if (action === 'disarm') engine.arm(false);
    },
    onState: (state) => {
      if (!state.connected) engine.safeState('disconnect');
    },
  });
}

test('gamepad+engine: disconnect while armed forces armed=false and zero axes', () => {
  const target = new FakeWindow();
  const engine = new ControlEngine();
  const stop = wireToEngine(target, engine);

  const pad = makePad();
  target.plug(pad);
  target.tick();

  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm]);
  target.tick();
  assert.equal(engine.state.armed, true);

  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm], { r2: 1 });
  target.tick();
  assert.equal(engine.state.throttle, 1);

  target.unplug(pad);

  assert.equal(engine.state.armed, false);
  assert.equal(engine.state.throttle, 0);
  assert.equal(engine.state.steering, 0);
  assert.equal(engine.state.gripper, 'idle');
  stop();
});

test('gamepad+engine: disconnect while already disarmed remains safe', () => {
  const target = new FakeWindow();
  const engine = new ControlEngine();
  const stop = wireToEngine(target, engine);

  const pad = makePad();
  target.plug(pad);
  target.tick();
  assert.equal(engine.state.armed, false);

  target.unplug(pad);

  assert.deepEqual(engine.state, { throttle: 0, steering: 0, gripper: 'idle', armed: false });
  stop();
});

test('gamepad+engine: reconnect after disconnect stays disarmed', () => {
  const target = new FakeWindow();
  const engine = new ControlEngine();
  const stop = wireToEngine(target, engine);

  const pad = makePad();
  target.plug(pad);
  target.tick();
  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm]);
  target.tick();
  assert.equal(engine.state.armed, true);

  target.unplug(pad);
  assert.equal(engine.state.armed, false);

  const reconnected = makePad({ index: 0 });
  target.plug(reconnected);
  target.tick();

  assert.equal(engine.state.armed, false);
  stop();
});

test('gamepad+engine: the only path from a gamepad reading to engine state is through GamepadHandlers', () => {
  // GamepadHandlers exposes only primitive data callbacks (numbers, a
  // Gripper enum, a ButtonAction enum, a plain GamepadState) — there is no
  // reference to ControlEngine, WebSocketTransport, or any send path
  // reachable from `listenGamepad`'s signature, so a gamepad reading
  // structurally cannot reach the network without first going through
  // whatever calls these callbacks (control-view.ts, wiring them straight
  // into ControlEngine's own public methods, same as this test does).
  const target = new FakeWindow();
  const engine = new ControlEngine();
  const stop = wireToEngine(target, engine);

  const pad = makePad();
  target.plug(pad);
  target.tick();
  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm]);
  target.tick();
  pad.axes = [1, 0];
  target.tick();

  // Every field on engine.state came from ControlEngine's own normalization
  // (clamped, armed-gated) — never a raw pass-through of gamepad axes.
  assert.equal(engine.state.steering, 1);
  assert.ok(engine.state.steering <= 1 && engine.state.steering >= -1);
  stop();
});

test('gamepad+engine: Emergency Stop fires even when the gamepad is not the active input', () => {
  const target = new FakeWindow();
  const engine = new ControlEngine();
  const stop = wireToEngine(target, engine);

  const pad = makePad();
  target.plug(pad);
  target.tick();
  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm]);
  target.tick();
  assert.equal(engine.state.armed, true);

  // Simulate another source (e.g. keyboard) currently driving — irrelevant
  // to this test's engine, since Emergency Stop bypasses ownership entirely
  // and acts on the shared ControlEngine directly.
  const [chordA, chordB] = STANDARD_MAPPING.stopChord;
  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm, chordA, chordB]);
  target.tick();

  assert.equal(engine.state.armed, false);
  assert.deepEqual(engine.state, { throttle: 0, steering: 0, gripper: 'idle', armed: false });
  stop();
});

test('gamepad+engine: holding the E-stop chord across frames stops the vehicle exactly once', () => {
  const target = new FakeWindow();
  const engine = new ControlEngine();
  let stopCount = 0;
  const original = engine.emergencyStop.bind(engine);
  engine.emergencyStop = (): void => {
    stopCount += 1;
    original();
  };
  const stop = wireToEngine(target, engine);

  const [chordA, chordB] = STANDARD_MAPPING.stopChord;
  const pad = makePad();
  target.plug(pad);
  target.tick();
  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm]);
  target.tick();

  pad.buttons = makeButtons([STANDARD_MAPPING.buttons.arm, chordA, chordB]);
  target.tick();
  target.tick();
  target.tick();

  assert.equal(stopCount, 1);
  stop();
});
