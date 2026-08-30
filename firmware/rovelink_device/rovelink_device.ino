// RoveLink firmware — control logic for differential-drive robot.
//
// This file contains only control logic: mixing a ControlFrame into motor power,
// moving the gripper, and entering safe state when the link drops or the
// frame expires. None of this touches hardware directly: everything goes through
// RobotHardware (hardware.h), which has two implementations selected at
// compile time via HARDWARE_SIMULATION (config.h):
//
//   HARDWARE_SIMULATION 1 → SimulatedHardware  → ESP32-S3 test board
//   HARDWARE_SIMULATION 0 → RealHardware       → original robot car
//
// Connectivity lives separately in network.h: control logic never calls WiFi.*
// directly, only checks if network is available. WSS transport lives in
// transport.h/transport.cpp: control logic never calls WebSocketsClient
// directly, only subscribes to its callbacks.

#include <Arduino.h>

#include "config.h"
#include "hardware.h"
#include "network.h"
#include "transport.h"

// Must match CONTROL_TTL_MS from protocol/src/protocol.ts.
const unsigned long TTL_CONTROL_MS = 500;

// --- Driving state (equivalent of ControlState in protocol) ---
struct ControlState
{
  float throttle; // -1..1
  float steering; // -1..1
  char gripper;   // 'i' idle, 'o' open, 'c' close
  bool armed;
};

const ControlState SAFE_STATE = {0.0f, 0.0f, 'i', false};

ControlState currentState = SAFE_STATE;
unsigned long lastFrameMs = 0;
long lastSeq = -1;
bool linkAlive = false;

// --- Control session (Problem 4) ---
//
// Which control session is currently authoritative, and whether it has
// established its disarmed baseline yet. Both are changed ONLY by
// onSessionChanged() (driven by the relay-authored `controller.session`
// message) — never by a ControlFrame. A ControlFrame that doesn't match
// activeSession is simply rejected; it can never adopt itself as the new
// session, which is what stops a delayed frame from an old session rolling
// activeSession backward after a newer one has already taken over.
//
// Starts empty: no real session id the relay mints is ever "", so the very
// first ControlFrame this device receives after boot is guaranteed to
// mismatch and be rejected until a real controller.session arrives — the
// device cannot be driven merely by reconnecting.
char activeSession[CONTROL_SESSION_ID_LEN] = "";
// False until the first ControlFrame matching activeSession establishes the
// disarmed baseline. While false, an armed=true frame is rejected outright
// (see applyControlFrame) — a fresh session can only ever be armed by an
// explicit, later Arm action, never by inheriting whatever the operator's
// UI happened to say a moment before the session changed.
bool sessionReady = false;

float clampAxis(float v)
{
  if (isnan(v))
    return 0.0f;
  if (v > 1.0f)
    return 1.0f;
  if (v < -1.0f)
    return -1.0f;
  return v;
}

// Differential mixing: steering is subtracted from one wheel and added to the other.
void applyMotors(float throttle, float steering)
{
  hwApplyMotors(clampAxis(throttle + steering), clampAxis(throttle - steering));
}

// Safe state: where we fall to on disarm, emergency stop, TTL expiry, or link loss.
// No memory of what was happening before. `reason` prints to Serial before shutdown.
void enterSafeState(const char *reason)
{
  Serial.print("[STOP] ");
  Serial.println(reason);

  currentState = SAFE_STATE;
  hwStopMotors();
  hwLinkLed(false);
}

// The ONLY function allowed to change activeSession — driven exclusively by
// the relay-authored `controller.session` message (see transport.cpp), never
// by a ControlFrame. Forces safe state before adopting the new session, and
// resets both the seq baseline and the readiness gate: the new session must
// re-establish its own disarmed baseline before anything can arm it (see
// applyControlFrame).
void onSessionChanged(const char *sessionId)
{
  Serial.print("[SESSION] active id=");
  Serial.println(sessionId);

  enterSafeState("session-change");
  strlcpy(activeSession, sessionId, sizeof(activeSession));
  lastSeq = -1;
  sessionReady = false;
}

// Apply a decoded frame. A frame only ever does two things: (1) if it
// matches the currently active session and hasn't been seen before, it may
// establish that session's disarmed baseline or, once the baseline is
// established, drive the vehicle; (2) otherwise it is rejected outright. It
// can NEVER itself change activeSession — see onSessionChanged().
void applyControlFrame(long seq, unsigned long sentAt, unsigned long ttlMs,
                       const char *sessionId, float throttle, float steering, char gripper,
                       bool armed)
{
  (void)sentAt;
  (void)ttlMs;

  if (strcmp(sessionId, activeSession) != 0)
  {
    // Not the current session — e.g. a delayed frame from a controller that
    // has since been replaced/reconnected. Silently dropped: this can never
    // roll activeSession backward, and never happen frequently enough in
    // normal operation to be worth logging every occurrence.
    return;
  }

  if (seq <= lastSeq)
    return;
  lastSeq = seq;
  lastFrameMs = millis();

  Serial.print("[CONTROL] seq=");
  Serial.print(seq);
  Serial.print(" throttle=");
  Serial.print(clampAxis(throttle), 2);
  Serial.print(" steering=");
  Serial.print(clampAxis(steering), 2);
  Serial.print(" armed=");
  Serial.println(armed ? "true" : "false");

  if (!sessionReady)
  {
    if (armed)
    {
      // A fresh session can never be armed by its first accepted frame,
      // even though this frame legitimately belongs to it: the operator's
      // browser may simply still have had armed=true from a moment ago.
      // Remain SAFE_STATE and wait for an explicit armed=false frame to
      // establish the baseline — only THEN can a later armed=true frame
      // actually arm the vehicle.
      Serial.println("[SESSION] armed=true rejected before disarmed baseline");
      return;
    }
    sessionReady = true;
    Serial.println("[SESSION] disarmed baseline established");
    // Falls through: an armed=false frame is itself safely appliable below.
  }

  if (!armed)
  {
    enterSafeState("disarmed");
    return;
  }

  currentState.throttle = clampAxis(throttle);
  currentState.steering = clampAxis(steering);
  currentState.gripper = gripper;
  currentState.armed = true;

  applyMotors(currentState.throttle, currentState.steering);
  hwApplyGripper(currentState.gripper);
  hwLinkLed(true);
}

// Link watchdog: if frames stop arriving, the car stops on its own. This prevents
// the car from continuing when WiFi drops.
void watchTtl()
{
  if (!currentState.armed)
    return;
  if (millis() - lastFrameMs > TTL_CONTROL_MS)
    enterSafeState("ttl");
}

// Bridge between network layer and control:
//
//   network disconnected → control invalid → RobotHardware stop
//
// We don't stop motors here: we just invalidate the link and let the normal
// logic (link-lost / TTL) do the actual shutdown. This way, safe state has
// a single owner.
bool previousNetworkConnected = false;

void watchNetwork()
{
  const bool connected = networkConnected();
  if (previousNetworkConnected && !connected)
    linkAlive = false;
  previousNetworkConnected = connected;
}

// Same idea as watchNetwork(), but watching WSS: if the relay link drops
// even though WiFi is still up (e.g., Worker restarts), the vehicle must
// also enter safe state without waiting for TTL.
bool previousWssConnected = false;

void watchWssLink()
{
  const bool connected = transportConnected();
  if (previousWssConnected && !connected)
    linkAlive = false;
  previousWssConnected = connected;
}

// --- Transport → control bridge ---
//
// transport.cpp already validated message version and shape: we just mark the
// link as alive and go through the same path as the simulation console
// (applyControlFrame / enterSafeState). No callback in this section touches
// WebSocketsClient or RobotHardware directly.

void onControlReceived(const ControlFrameIn &frame)
{
  linkAlive = true;
  applyControlFrame(frame.seq, millis(), TTL_CONTROL_MS, frame.controlSessionId, frame.throttle,
                    frame.steering, frame.gripper, frame.armed);
}

// Deliberately untouched by session/seq: emergency-stop must work regardless
// of which session is active or in flight (see onSessionChanged /
// applyControlFrame) — a safety action must never be filterable by ordering
// logic that exists only to arbitrate normal driving frames.
void onEmergencyStopReceived()
{
  enterSafeState("emergency");
}

// Minimal protocol telemetry at a moderate rate (enough for the dashboard to
// see RSSI, ackSeq, and driving state).
const unsigned long TELEMETRY_MS = 300; // ~3.3 Hz, within 2-5 Hz target
unsigned long lastTelemetryMs = 0;

void sendTelemetry()
{
  if (!transportConnected())
    return;
  if (millis() - lastTelemetryMs < TELEMETRY_MS)
    return;
  lastTelemetryMs = millis();
  transportSendTelemetry(networkRssi(), currentState.armed, currentState.throttle,
                         currentState.steering, lastSeq, activeSession);
}

#if HARDWARE_SIMULATION

// --- Simulation console ---
//
// Without WSS transport, no ControlFrame arrives, so in simulation mode
// they're injected manually via Serial to exercise the logic and watchdog.
// This disappears from the real car's binary.
//
//   c <seq> <throttle> <steering> <armed 0|1>   ControlFrame
//   s                                           emergency stop
//   go | gc                                     gripper open / close
//   ?                                           help

const unsigned long HEARTBEAT_MS = 10000;
unsigned long lastHeartbeatMs = 0;

char consoleLine[96];
size_t consoleLineLength = 0;

// The console has no relay to mint it a real session, so it plays the same
// role locally: the first `c` after boot (or after a real controller.session
// took over) establishes this fixed id as active, going through the exact
// same onSessionChanged() + disarmed-baseline path a real session would. In
// practice this means a `c ... 1` (armed) command right after boot or after
// a network session took over needs a `c ... 0` first to establish the
// baseline, same as a real fresh controller session would.
static const char *CONSOLE_SESSION = "console";

void printConsoleHelp()
{
  Serial.println("[SIM] c <seq> <throttle> <steering> <armed 0|1> | s | go | gc | ?");
  Serial.println("[SIM] after a session change, first `c` must be armed=0 to establish baseline");
}

void executeConsoleLine(char *line)
{
  if (line[0] == '\0')
    return;

  if (strcmp(line, "s") == 0)
  {
    enterSafeState("emergency");
    return;
  }
  if (strcmp(line, "go") == 0)
  {
    currentState.gripper = 'o';
    hwApplyGripper('o');
    return;
  }
  if (strcmp(line, "gc") == 0)
  {
    currentState.gripper = 'c';
    hwApplyGripper('c');
    return;
  }
  if (line[0] == 'c' && (line[1] == ' ' || line[1] == '\0'))
  {
    long seq = 0;
    float throttle = 0.0f;
    float steering = 0.0f;
    int armed = 1;
    if (sscanf(line + 1, "%ld %f %f %d", &seq, &throttle, &steering, &armed) < 3)
    {
      printConsoleHelp();
      return;
    }
    // Console acts as link: once the first frame arrives, TTL takes over.
    linkAlive = true;
    if (strcmp(activeSession, CONSOLE_SESSION) != 0)
      onSessionChanged(CONSOLE_SESSION);
    applyControlFrame(seq, millis(), TTL_CONTROL_MS, CONSOLE_SESSION, throttle, steering,
                      currentState.gripper, armed != 0);
    return;
  }

  printConsoleHelp();
}

void pumpConsole()
{
  while (Serial.available() > 0)
  {
    char c = (char)Serial.read();
    if (c == '\r')
      continue;
    if (c == '\n')
    {
      consoleLine[consoleLineLength] = '\0';
      executeConsoleLine(consoleLine);
      consoleLineLength = 0;
      continue;
    }
    if (consoleLineLength + 1 < sizeof(consoleLine))
      consoleLine[consoleLineLength++] = c;
  }
}

// Heartbeat: if this keeps printing after several minutes, the watchdog
// hasn't reset.
void heartbeat()
{
  if (millis() - lastHeartbeatMs < HEARTBEAT_MS)
    return;
  lastHeartbeatMs = millis();
  Serial.print("[ALIVE] uptime=");
  Serial.print(millis() / 1000);
  Serial.print("s wifi=");
  Serial.print(networkStatusText());
  Serial.print(" wss=");
  Serial.print(transportStatusText());
  if (networkConnected())
  {
    Serial.print(" rssi=");
    Serial.print(networkRssi());
  }
  Serial.println();
}

#endif // HARDWARE_SIMULATION

void setup()
{
  // Serial first and only Serial: if something crashes after this, at least
  // the banner already printed. On the S3, the previous boot died in
  // pinMode/servo.attach of the legacy pinout before opening the port.
  Serial.begin(SERIAL_BAUD);

  Serial.println();
  Serial.println("[BOOT] RoveLink firmware");
  Serial.print("[BOARD] ");
  Serial.println(hwBoardName());
  Serial.print("[MODE] ");
  Serial.println(hwModeName());
  Serial.print("[DEVICE] ");
  Serial.println(ROBOT_ID);

  hwSetup();

#if HARDWARE_SIMULATION
  lastHeartbeatMs = millis();
#endif

  Serial.println();
  // Doesn't wait for WiFi association: returns immediately and networkLoop()
  // handles the rest.
  networkSetup();

  // [READY] prints from loop() once the network resolves its first attempt,
  // not here: until then we don't know if we have connectivity or Internet.

  // WSS is only attempted when networkOnline() is true (transportLoop()
  // decides alone); here we just register the callbacks.
  transportOnControl(onControlReceived);
  transportOnEmergencyStop(onEmergencyStopReceived);
  transportOnSessionChange(onSessionChanged);
  transportSetup();
}

// [READY] prints once, when we know whether the network came online,
// just connected, or is down.
bool readyPrinted = false;

void announceReady()
{
  if (readyPrinted || !networkResolved())
    return;
  readyPrinted = true;
  Serial.println("[READY]");
}

void loop()
{
  networkLoop();
  announceReady();
  watchNetwork();

  transportLoop();
  watchWssLink();
  sendTelemetry();

#if HARDWARE_SIMULATION
  pumpConsole();
  heartbeat();
#endif

  if (!linkAlive && currentState.armed)
    enterSafeState("link-lost");

  watchTtl();

  // Without this, the loop spins without yielding CPU and the IDLE task
  // can't feed the task watchdog: this is the other half of TG1WDT_SYS_RST.
  delay(1);
}
