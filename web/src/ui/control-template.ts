/**
 * Console layout. It is static and inserted once: it appears complete on the
 * first frame with initial values already set, and from then on only data
 * changes.
 *
 * The main piece is the chassis: a top-down view of the cart where each wheel
 * shows the power the firmware is going to give it. It is not decoration; it
 * is the same differential mix that the ESP32 applies.
 */

const WHEEL = (id: string, klass: string): string => `
  <div class="wheel ${klass}" id="wheel-${id}" data-direction="forward">
    <i class="wheel__axle"></i>
    <i class="wheel__power"></i>
  </div>`;

const DATA_POINT = (id: string, label: string, value: string, help?: string): string => `
  <div class="bus__data">
    <dt class="label"${help !== undefined ? ` title="${help}"` : ''}>${label}</dt>
    <dd class="bus__value" id="${id}">${value}</dd>
  </div>`;

const CONTROL_BUTTON = (axis: string, value: string, label: string, glyph: string): string => `
  <button type="button" class="key" data-axis="${axis}" data-value="${value}"
          aria-label="${label}">${glyph}</button>`;

export const CONTROL_TEMPLATE = `
<div class="console">
  <header class="status-bar area-header">
    <p class="identifier">
      <span class="brand">RoveLink</span>
      <span class="label">Robot</span>
      <b id="robot-id-value">robot-01</b>
    </p>
    <p class="status-light" id="chip-robot" data-health="offline" role="status"
       title="Online: the robot is actively responding. Unresponsive: no recent response from the robot. Offline: the robot is no longer connected.">Offline</p>
    <p class="status-light" id="chip-armed" data-on="false" role="status"
       title="Armed: the robot will move on command. Safe: driving inputs are ignored.">Safe</p>
    <p class="label flex items-center gap-2">
      Transport: <b>WebSocket</b>
    </p>
    <button type="button" class="label hover:text-ice" id="btn-logout" title="Clear the stored controller key">
      Log out
    </button>
  </header>

  <section class="module area-video" id="video-panel" aria-labelledby="video-title">
    <div class="module__header">
      <h2 id="video-title" class="label">Camera</h2>
      <button type="button" class="label hover:text-ice" id="btn-video-toggle" aria-pressed="true"
              title="Stops viewing only — does not power off the robot's camera">
        Video: On
      </button>
    </div>
    <div class="p-3">
      <div class="video-frame" id="video-frame" data-state="disconnected">
        <canvas id="video-canvas" width="640" height="480"></canvas>
        <p class="video-status" id="video-status">Video off</p>
      </div>
    </div>
    <dl class="bus border-groove border-t">
      ${DATA_POINT('video-fps', 'FPS', '0')}
      ${DATA_POINT('video-bitrate', 'Bitrate', '—')}
      ${DATA_POINT('video-dropped', 'Dropped', '0')}
      ${DATA_POINT('video-age', 'Frame age', '—')}
    </dl>
  </section>

  <section class="module area-controls" aria-labelledby="controls-title">
    <div class="module__header">
      <h2 id="controls-title" class="label">Controls</h2>
      <button type="button" class="label hover:text-ice" id="btn-link">
        Disconnect
      </button>
    </div>

    <div class="flex flex-wrap items-stretch gap-2 p-3">
      <button type="button" class="button" id="btn-arm" aria-pressed="false">Arm</button>
      <button type="button" class="button" id="btn-disarm">Disarm</button>
      <button type="button" class="e_stop" id="btn-stop">Emergency stop</button>
    </div>

    <div class="touch_controls border-groove border-t" aria-label="Touch controls">
      ${CONTROL_BUTTON('throttle', '1', 'Forward', '▲')}
      ${CONTROL_BUTTON('steering', '-1', 'Left', '◀')}
      ${CONTROL_BUTTON('steering', '1', 'Right', '▶')}
      ${CONTROL_BUTTON('throttle', '-1', 'Reverse', '▼')}
      <button type="button" class="key key--wide" data-gripper="open">Open</button>
      <button type="button" class="key key--wide" data-gripper="close">Close</button>
    </div>

    <p class="text-ice-2 border-groove border-t px-3 py-2 text-[0.7rem] leading-relaxed">
      <b class="text-ice">W A S D</b> or arrows to drive ·
      <b class="text-ice">Q</b> / <b class="text-ice">E</b> gripper ·
      <b class="text-ice">Z</b> arm and disarm ·
      <b class="text-ice">Space</b> emergency stop.
    </p>
  </section>

  <section class="module area-chassis" id="drive-panel" data-armed="false"
           aria-labelledby="chassis-title">
    <div class="module__header">
      <h1 id="chassis-title" class="label">Differential drive</h1>
      <p class="label" id="controller-status">Controller: not detected</p>
      <button type="button" class="label hover:text-ice" id="btn-controller-settings">
        Controller settings
      </button>
    </div>

    <div class="grid place-items-center px-3 py-4">
      <div class="chassis" id="chassis" data-armed="false" role="img"
           aria-label="Top-down view of the cart showing each wheel power">
        <div class="chassis__body">
          <i class="chassis__axle" style="top: 22%"></i>
          <i class="chassis__axle" style="top: 78%"></i>
          <i class="chassis__centerline"></i>
        </div>

        <div class="gripper" id="gripper" data-gripper="idle">
          <i class="gripper__jaw"></i>
          <i class="gripper__jaw"></i>
        </div>

        ${WHEEL('left-front', 'wheel--left wheel--front')}
        ${WHEEL('right-front', 'wheel--right wheel--front')}
        ${WHEEL('left-rear', 'wheel--left wheel--rear')}
        ${WHEEL('right-rear', 'wheel--right wheel--rear')}
      </div>
    </div>

    <div class="readings">
      <div>
        <p class="label">Throttle</p>
        <output class="reading__value" id="throttle-value">0%</output>
      </div>
      <div>
        <p class="label">Steering</p>
        <output class="reading__value" id="steering-value">0%</output>
      </div>
      <div>
        <p class="label">PWM L / R</p>
        <output class="reading__value" id="wheel-values">0 / 0</output>
      </div>
      <div class="justify-self-end">
        <p class="label mb-1">Stick</p>
        <div class="pad">
          <div class="pad__crosshair"></div>
          <div class="pad__dot" id="pad-dot"></div>
        </div>
      </div>
    </div>
  </section>

  <aside class="module area-bus" aria-labelledby="bus-title">
    <div class="module__header">
      <h2 id="bus-title" class="label">Bus</h2>
    </div>
    <dl class="bus">
      ${DATA_POINT('tel-connection', 'Link', 'Disconnected')}
      ${DATA_POINT('tel-lastseen', 'Last seen', '—', 'Time since the robot last sent real telemetry')}
      ${DATA_POINT('tel-control-rtt', 'Control RTT', 'Measuring…', 'Command round trip: browser → relay → robot → relay → browser')}
      ${DATA_POINT('tel-rtt', 'Relay RTT', '—', 'Browser ↔ RoveLink server only — never touches the robot')}
      ${DATA_POINT('tel-estop-rtt', 'E-stop RTT', '—', 'Round trip time for the last emergency-stop acknowledgement')}
      ${DATA_POINT('tel-rssi', 'RSSI', '—', "Robot's WiFi signal strength — closer to 0 dBm is stronger")}
      ${DATA_POINT('tel-gripper', 'Gripper', 'idle')}
      ${DATA_POINT('tel-throttle', 'Robot thr', '0%')}
      ${DATA_POINT('tel-steering', 'Robot str', '0%')}
    </dl>
    <details class="bus-debug border-groove border-t">
      <summary class="label cursor-pointer px-3 py-2">Diagnostics</summary>
      <dl class="bus">
        ${DATA_POINT('tel-seq', 'Seq', '0')}
        ${DATA_POINT('tel-sent', 'TX', '0')}
        ${DATA_POINT('tel-received', 'RX', '0')}
      </dl>
    </details>
  </aside>

  <details class="module area-events">
    <summary class="module__header cursor-pointer">
      <span class="label">Events</span>
      <span class="label">Debug</span>
    </summary>
    <div class="log-toolbar">
      <button type="button" class="label hover:text-ice" id="btn-log-clear">Clear</button>
    </div>
    <ol id="log-control" class="log"></ol>
  </details>

  <p id="announcements-control" class="sr-only" role="status" aria-live="polite"></p>
</div>
`;
