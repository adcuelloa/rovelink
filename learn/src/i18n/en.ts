import type { ConceptCopy, UiStrings } from './types.ts';

export const EN_CONCEPTS: Record<string, ConceptCopy> = {
  human: {
    title: 'You',
    plain: "You're the one holding the controller — or your fingers on the keyboard.",
  },
  browser: {
    title: 'Browser',
    plain: 'Your browser tab turns whatever you press into a stream of driving commands.',
  },
  'cloud-relay': {
    title: 'Cloudflare Relay',
    plain:
      "A small always-on server in the cloud passes your commands along to the robot — and only your commands, nobody else's.",
  },
  robot: {
    title: 'Robot',
    plain: 'The robot checks that what arrived actually makes sense, then turns its wheels.',
  },
  'input-device': {
    title: 'Input device',
    plain: 'Whatever you touch to drive: a keyboard, a game controller, or on-screen buttons.',
    technical:
      'Three input sources exist side by side: keyboard, Gamepad API, and touch. Exactly one drives at a time (see Input Ownership).',
  },
  'keyboard-input': {
    title: 'Keyboard input',
    plain:
      'W/A/S/D or the arrow keys drive; Space stops; Q/E open and close the gripper; Z arms/disarms.',
    technical:
      'listenKeyboard() maps KeyboardEvent.code to a KeyAction, tracks a held-key set, and derives throttle/steering by canceling opposite keys (forward+backward = 0). Typing in a form field is excluded so the page never steals keystrokes from an input box.',
    why: 'Keyboard support means anyone can test or demo RoveLink with nothing but a laptop — no gamepad required.',
    failure:
      'If the tab loses focus or the page goes to the background with a key held, RoveLink releases every key immediately (blur / visibilitychange) — a held key can never keep driving from an unfocused tab.',
    tryIt: 'Click into the lab and hold W — watch the pipeline light up below.',
  },
  'gamepad-input': {
    title: 'Gamepad (Gamepad API)',
    plain: 'A real USB/Bluetooth controller, read straight from the browser — no plugin needed.',
    technical:
      'listenGamepad() samples navigator.getGamepads() on requestAnimationFrame, diffs the raw axes/buttons against the previous frame, and only publishes when something actually changed — a still stick produces zero events.',
    why: "Sampling on rAF and diffing avoids flooding the rest of the pipeline with 60 identical readings a second when the stick isn't moving.",
    tryIt: 'Connect a controller and move the stick — the lab shows live axis and button values.',
  },
  'touch-input': {
    title: 'Touch controls',
    plain: 'On-screen buttons for driving from a phone or tablet, held the same way a key is held.',
    technical:
      'pointerdown/pointerup on the on-screen buttons set the same throttle/steering axes as keyboard, captured per-pointer so a finger sliding off a button still releases correctly.',
  },
  'input-ownership': {
    title: 'Input ownership',
    plain:
      'Only one input source drives at a time, so keyboard and controller commands never get added together.',
    technical:
      'InputOwnership tracks exactly one active source (keyboard | touch | gamepad). Each source claims ownership on its own "meaningful activity" rule — a keydown, a stick crossing its deadzone, a touch press — never a fixed priority order. Only the active source\'s axes/gripper ever reach ControlEngine.',
    why: 'Without single ownership, a stray gamepad reading and a held key could sum into an unintended, unpredictable throttle.',
    alternatives: [
      'Sum all active sources together (rejected — unpredictable, and unsafe if two sources disagree on direction).',
      'Fixed priority list, e.g. gamepad always wins (rejected — surprising when you pick the keyboard back up).',
    ],
    tryIt: 'Hold a key, then touch the on-screen pad — watch ownership hand off.',
  },
  'controller-profile': {
    title: 'Controller profile',
    plain: 'A named preset that decides what each button and stick means — Racing or Stick.',
    technical:
      'A ControllerProfile is data, not code: throttle/steering mapping, deadzone, and every button binding. evaluateProfile() turns raw semantic control values into the same GamepadInput shape the rest of the pipeline already expects. Arm/Disarm/gripper/E-stop are always single ButtonControls, never an axis — an analog stick literally cannot be wired to arm the robot.',
    why: 'Data-driven profiles let an operator pick — or eventually customize — bindings without branching code per controller layout.',
    alternatives: [
      'Custom: clone a preset and edit it (validated at load time by profile-validate.ts, since localStorage is untrusted input).',
    ],
    tryIt: 'The Racing profile is active by default: R2/L2 for throttle, left stick for steering.',
  },
  'control-engine': {
    title: 'ControlEngine',
    plain:
      "ControlEngine is the browser's current idea of what the robot should be doing right now.",
    technical:
      'Holds one ControlState (throttle, steering, gripper, armed) — never a queue. Every write replaces the previous value (latest-state-wins); normalizeState() clamps axes to -1..1 and rejects anything malformed before it becomes state. Listeners are only notified past a small threshold, to avoid re-rendering on analog stick noise.',
    why: "A queue would let stale commands play back after the operator has already moved on — the robot must only ever act on 'what do I want right now', never a history of what was pressed.",
    tryIt: 'Watch this panel update live as you drive in the lab below.',
  },
  'control-sender': {
    title: 'ControlSender',
    plain: 'Decides when a driving update is actually worth sending over the network.',
    technical:
      "Wraps decideSend() (see Rhythm) against a RobotTransport: on every ControlEngine change it either sends now, waits for the next rate-limited tick, or skips. A setInterval heartbeat re-sends the current state periodically so the vehicle's TTL watchdog never expires while the operator holds the stick still.",
    why: 'Sending 60 identical packets a second while the stick is centered would waste bandwidth and make the link harder to reason about.',
    failure:
      'On reconnect, reset() clears the rhythm baseline so the very first state after reconnecting is sent immediately, without waiting for the next rate-limited window.',
  },
  rhythm: {
    title: 'Send rhythm',
    plain:
      'The rule for how often to talk to the robot: right away for a real change, steadily otherwise, and never for nothing.',
    technical:
      'decideSend() returns immediate (arm/disarm, gripper change, stop, or going idle), rate (a significant axis change, throttled to hzMax), heartbeat (idle/held steady, resent every heartbeatMs to feed the TTL watchdog), or skip.',
    why: "heartbeatMs must stay comfortably below the frame TTL (protocol's CONTROL_TTL_MS) — otherwise ordinary network jitter, not an actual disconnect, would trip the watchdog.",
    tryIt: 'Hold the stick steady and watch the decision badge cycle between rate and heartbeat.',
  },
  'websocket-transport': {
    title: 'WebSocket transport',
    plain: "The always-open pipe between your browser and the robot's cloud relay.",
    technical:
      'WebSocketTransport owns the live socket: connect/reconnect, encoding outgoing ControlFrames, and decoding RemoteMessages back into typed events the rest of the app consumes (room presence, telemetry, RTT, control acks).',
  },
  'control-protocol': {
    title: 'Control protocol',
    plain: 'The exact shape of a driving message — what fields it has and what they mean.',
    technical:
      'A versioned JSON envelope (protocol.ts). A ControlFrame carries seq, sentAt, ttlMs, throttle, steering, gripper, and armed. There is no command queue at the protocol level either: the highest seq wins (isNewerFrame) and an old one is simply discarded, never replayed.',
    why: 'Versioning in v lets the wire format evolve without breaking firmware that is already flashed and deployed in the field.',
    safetyImpact:
      "ttlMs travels inside the frame itself, so the receiving end's watchdog doesn't depend on a separately-configured timeout matching the sender's assumption.",
  },
  'control-relay': {
    title: 'Relay (Cloudflare Worker)',
    plain: "Routes your commands to the right robot and checks that you're allowed to drive it.",
    technical:
      "A Cloudflare Worker that authenticates and routes each socket to the Durable Object room for its robotId (see robot-room). It holds no driving state itself and keeps no queue: a frame that can't be delivered immediately is simply gone, because a newer one would replace it anyway.",
  },
  'robot-room': {
    title: 'RobotRoom (Durable Object)',
    plain:
      "The specific cloud process assigned to your one robot — it's what actually forwards your commands.",
    technical:
      'One RobotRoom Durable Object instance per robotId, using the WebSocket Hibernation API so it can sleep between packets without dropping the connection. It enforces one live controller and one live device per room, stamps every forwarded frame with the authoritative control session, and demotes/evicts stale sockets on a periodic alarm sweep.',
    why: 'Hibernation means idle time between control packets costs nothing — the room does not need to stay warm just to hold a socket open.',
    alternatives: [
      'A stateless Worker with an external database for presence (rejected — a Durable Object gives one authoritative in-memory owner per robot for free, with no race between concurrent requests).',
    ],
  },
  'control-session': {
    title: 'Control session',
    plain:
      'A fresh ID the relay hands out every time a controller connects, so an old, delayed command can never sneak back in and override a newer one.',
    technical:
      'Minted server-side (crypto.randomUUID()) the moment a controller registration is accepted — never client-supplied. Stamped onto every forwarded ControlFrame from Attachment.controlSessionId, and pushed to the device as an explicit controller.session message before any frame from that session can arrive.',
    why: 'Sequence numbers alone only order frames within one connection\'s lifetime; a reconnect needs a way to say "this is a new controller lifetime" that a stale, delayed frame from the old one can never forge.',
    safetyImpact:
      "A delayed frame carrying an old session id is dropped outright by the firmware (see Firmware validation) — it can never roll the robot's active session backward.",
  },
  'firmware-transport': {
    title: 'Firmware transport',
    plain: "The robot's own connection back to the cloud relay.",
    technical:
      'A WebSocket Secure (WSS) client on the ESP32 that decodes RemoteMessages and dispatches them to the control layer (onControlReceived, onSessionChanged, onEmergencyStopReceived) — control logic never touches the network client directly.',
  },
  'firmware-control': {
    title: 'Firmware validation',
    plain:
      'Before moving anything, the robot double-checks: is this really the current controller, is this command newer than the last one, and is it safe to arm?',
    technical:
      'applyControlFrame() rejects a frame outright if its session id does not match activeSession, or if seq <= lastSeq (stale/duplicate/reordered). A freshly changed session additionally requires one explicit armed=false frame to establish its "disarmed baseline" before any armed=true frame is honored — the operator\'s UI could still have said armed a moment before the session changed.',
    why: "Never trusting a fresh session's very first frame to be armed removes an entire class of accidental-motion-on-reconnect bugs.",
    safetyImpact:
      'A link-loss watchdog (watchTtl) independently forces safe state if no accepted frame has arrived within CONTROL_TTL_MS, regardless of session/seq state.',
    tryIt: 'Run the Session & Sequence experiment to see a stale-session frame get dropped live.',
  },
  'differential-mix': {
    title: 'Differential mix',
    plain: 'Turns "how fast" and "which way" into two separate numbers, one per wheel.',
    technical:
      'differentialMix(throttle, steering) = { left: throttle + steering, right: throttle - steering }, each clamped to -1..1. This exact function is shared between protocol/src/mix.ts and (as applyMotors) the firmware — dashboard and robot compute the identical result, not a lookalike approximation.',
    why: 'A shared pure function means the dashboard can show precisely what the robot will do, with no drift between "what the UI predicts" and "what actually happens".',
  },
  'robot-hardware': {
    title: 'Robot hardware',
    plain:
      "A generic two-wheel rover — not RoveLink's specific chassis, just enough to show how differential drive behaves.",
    technical:
      'RobotHardware is an abstraction with two implementations selected at compile time: SimulatedHardware (an ESP32-S3 test board) and RealHardware (the physical car). Control logic calls only hwApplyMotors/hwStopMotors/hwApplyGripper — it never touches GPIO directly.',
  },
  motors: {
    title: 'Motors',
    plain: "The wheels actually turning — power below a small minimum doesn't move them at all.",
    technical:
      'wheelPwm(value) maps a clamped -1..1 magnitude onto the PWM byte the firmware writes to ENA/ENB, scaled from PWM_MIN (the minimum that overcomes motor static friction) to PWM_MAX. Below MOTOR_THRESHOLD the motor is left un-energized rather than buzzing at a PWM too low to move it.',
  },
  'control-ack': {
    title: 'Control ACK',
    plain:
      'The robot tells the browser back "yes, I actually did that" — proof of action, not just proof the message arrived.',
    technical:
      'Sent by firmware only after a frame passes session/seq validation and its resulting state has been applied — never for a rejected frame. The browser correlates it against a locally-tracked pending-send timestamp (PendingAckTracker) to compute Control RTT, kept deliberately separate from Relay RTT (a plain ping/pong to the edge).',
    why: "Relay RTT only proves the network path to Cloudflare is fast; Control ACK is the only signal that proves the physical robot did something, which is why they're never merged into one number.",
  },
  'safe-state': {
    title: 'Safe state',
    plain:
      'The known state the robot falls back to whenever something goes wrong — all axes zeroed, disarmed.',
    technical:
      "SAFE_STATE: { throttle: 0, steering: 0, gripper: 'idle', armed: false }. enterSafeState() applies it synchronously, stops motors, and turns off the link LED. Invoked on session change, disarm, TTL expiry, link loss, and emergency stop.",
    why: 'A single, explicitly defined fallback prevents partial stops or accidental re-arm — the robot is either being actively controlled or it is in safe state.',
    safetyImpact:
      "Every safety path converges to the same known state, so the robot's behavior after any failure is predictable.",
  },
  'safe-baseline': {
    title: 'Safe baseline',
    plain:
      "A fresh session must send one disarmed frame before it can arm — preventing the browser's cached armed state from inheriting across a reconnect.",
    technical:
      'After onSessionChanged(), sessionReady is false. The first accepted frame must be armed=false to establish the baseline. Only then can a subsequent armed=true frame arm the vehicle. An armed=true frame before baseline is rejected but still consumes its seq.',
    why: 'Without the baseline gate, a browser that refreshes while armed could immediately resume driving with stale state — a dangerous reconnect bug.',
    safetyImpact:
      'Eliminates an entire class of accidental-motion-on-reconnect bugs by forcing an explicit, safe handoff.',
  },
  'message-ordering': {
    title: 'Message ordering (seq)',
    plain:
      'Only the highest sequence number advances — stale or duplicate frames are silently dropped.',
    technical:
      'isNewerFrame() returns frame.seq > lastSeq. If seq <= lastSeq, the frame is rejected without ACK. lastSeq resets to -1 on session change. A frame rejected for armed-before-baseline still consumes its seq.',
    why: 'Networks can delay, reorder, or replay frames. Seq prevents a stale command from overriding a newer one.',
  },
  'ttl-watchdog': {
    title: 'TTL watchdog',
    plain:
      'If the operator says "drive forward" and then the network silently disappears, the robot stops on its own.',
    technical:
      "CONTROL_TTL_MS = 500ms. The firmware's watchTtl() checks if the vehicle is armed and no accepted frame has arrived within the TTL window. Heartbeat re-sends every 150ms (DEFAULT_RHYTHM.heartbeatMs), test-enforced to stay below TTL/2. The device uses its own millis() clock, not the browser's sentAt.",
    why: 'Without TTL, a network dropout would leave the robot driving on its last command indefinitely — the watchdog is the autonomous safety net.',
    safetyImpact:
      'The heartbeat margin (150ms × 2 = 300ms < 500ms TTL) ensures ordinary jitter never trips the watchdog, while real disconnects are caught within half a second.',
  },
  'emergency-stop': {
    title: 'Emergency stop',
    plain:
      'A distinct safety command that bypasses every gate — session, seq, baseline, armed, TTL — and always works.',
    technical:
      'emergency-stop is a separate message type, deliberately session/seq-independent. The relay forwards it without stamping controlSessionId. The firmware\'s onEmergencyStopReceived goes straight to enterSafeState("emergency"). Always acked immediately (never delayed like normal control ACK). Controller disconnect also triggers E-stop (gated on registered).',
    why: 'Normal control has gates for safety, but those same gates could prevent a timely stop in an emergency. E-stop exists outside the gate chain.',
    safetyImpact:
      'E-stop is the only path that works regardless of session state, armed state, or link status.',
  },
};

export const EN_UI: UiStrings = {
  levels: { plain: 'Overview', technical: 'Technical Details', code: 'Source Code' },
  passport: {
    what: 'What',
    why: 'Why this design',
    plain: 'Overview',
    technical: 'Technical Details',
    advantages: 'Advantages',
    disadvantages: 'Disadvantages',
    alternatives: 'Alternatives considered',
    tradeoffs: 'Tradeoffs',
    failure: 'Failure mode',
    safetyImpact: 'Safety impact',
    tests: 'Tests',
    tryIt: 'Try it',
    source: 'SOURCE',
    test: 'TEST',
    viewSource: 'View source',
    viewTest: 'View test',
    close: 'Close',
  },
  facts: {
    implemented: 'IMPLEMENTED',
    rationale: 'RATIONALE',
    alternative: 'ALTERNATIVE',
    simulation: 'SIMULATION',
    measured: 'MEASURED',
  },
  explorer: {
    search: 'Find a concept…',
    resetLayout: 'Reset layout',
    resetView: 'Reset view',
    fit: 'Fit',
    nodeList: 'All concepts',
    upstream: 'Feeds into this',
    downstream: 'This feeds into',
    noSelection: 'Select a node to see what it does, why it exists, and the real code behind it.',
  },
  story: {
    title: 'Control Journey',
    previous: 'Previous',
    next: 'Next',
    play: 'Play',
    pause: 'Pause',
    step: 'Step',
    of: 'of',
  },
  lab: {
    simulation: 'SIMULATION',
    connected: 'connected',
    disconnected: 'disconnected',
    noGamepad: 'No gamepad detected — connect one and press a button.',
    experimentValues: 'EXPERIMENT VALUES',
    latency: 'latency',
    resetDefaults: 'Reset to RoveLink defaults',
    cutConnection: 'Cut connection',
    restoreConnection: 'Restore connection',
    reconnectController: 'Reconnect controller',
    emergencyStop: 'Emergency stop',
    stages: {
      input: 'INPUT',
      ownership: 'OWNERSHIP',
      profile: 'PROFILE',
      engine: 'CONTROLENGINE',
      sender: 'CONTROLSENDER',
      frame: 'CONTROL FRAME',
      relay: 'RELAY (SIM)',
      firmware: 'FIRMWARE (SIM)',
      mix: 'DIFFERENTIAL MIX',
      ack: 'ACK',
      rtt: 'CONTROL RTT (SIM)',
    },
  },
};
