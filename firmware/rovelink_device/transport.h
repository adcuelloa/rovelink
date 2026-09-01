#pragma once

#include <Arduino.h>

// Transport layer: WSS client to Cloudflare relay.
//
//   WSS
//    ↓
//   decode/validate (here)
//    ↓
//   control logic (rovelink_device.ino, via callbacks below)
//    ↓
//   RobotHardware
//
// This module knows nothing about motors, gripper, or watchdog: it only
// speaks the protocol (protocol/src/protocol.ts, as JSON) and delivers
// decoded frames with verified structure. The ESP32 is a CLIENT: it opens
// the outgoing connection to the relay, never accepts incoming connections.
//
// The relay address lives in relay_config.h, not here.

// Max length of a controlSessionId (relay-minted, currently a UUIDv4 —
// 36 chars + terminator), with headroom.
#define CONTROL_SESSION_ID_LEN 40

// A ControlFrame already decoded with correct structure (equivalent to the
// `ControlFrame` from protocol.ts, without sentAt/ttlMs: see the note in
// applyControlFrame() in the .ino about why those two fields aren't compared
// directly—the ESP32's clock is not synced with the browser's).
//
// controlSessionId identifies which control session this frame belongs to
// (relay-stamped, never client-set — see protocol.ts ControlFrame). It is
// carried here for the .ino to COMPARE against its own activeSession; a
// ControlFrame can never itself change what session is active — see
// transportOnSessionChange() below for the only thing that can.
struct ControlFrameIn
{
  long seq;
  char controlSessionId[CONTROL_SESSION_ID_LEN];
  float throttle;
  float steering;
  char gripper; // 'i' idle, 'o' open, 'c' close
  bool armed;
};

typedef void (*TransportControlCb)(const ControlFrameIn &frame);
// `sentAt` is the browser's own clock (JS `Date.now()`, epoch milliseconds)
// echoed back unmodified in the ack below — the device never interprets or
// compares it (its own clock is not synced with the browser's; see the
// `sentAt`/`ttlMs` note in applyControlFrame()). `int64_t` rather than
// `long`/`unsigned long` (32-bit on this platform, would truncate an
// epoch-millisecond value) or `double` (round-trips exactly only up to
// 2^53, and ArduinoJson's default double serialization can lose precision
// well before that) — a JS integer timestamp round-trips exactly through
// int64_t with no such risk.
typedef void (*TransportEmergencyCb)(int64_t sentAt);
// Relay-authored `controller.session` message: the ONLY thing that may
// change which control session is currently active on this device. See
// protocol.ts ControlSession and room.ts #sendControlSession.
typedef void (*TransportSessionCb)(const char *sessionId);

// Register callbacks before transportSetup(). No queue: each call delivers
// the latest decoded frame, never an old one.
void transportOnControl(TransportControlCb cb);
void transportOnEmergencyStop(TransportEmergencyCb cb);
void transportOnSessionChange(TransportSessionCb cb);

// Prepare the WSS client. Doesn't connect yet: transportLoop() only connects
// when networkOnline() is true.
void transportSetup();

// Pump the WSS client. Never blocks. Must be called each loop iteration,
// just like networkLoop().
void transportLoop();

// true if WSS is open and the robot has registered on this connection.
bool transportConnected();

// "down" | "connecting" | "online", for the [ALIVE] banner.
const char *transportStatusText();

// Minimal protocol telemetry (see Telemetry in protocol.ts). Does nothing
// if not connected yet: no queue, so data that couldn't go out doesn't help
// on reconnect. ackSessionId identifies which session ackSeq belongs to —
// without it, ackSeq alone is ambiguous across two different sessions that
// both happened to reach the same number.
void transportSendTelemetry(int rssi, bool armed, float throttle, float steering, long ackSeq,
                            const char *ackSessionId);

// Control/E-stop round-trip observability (Problem 8A). Both are sent ONLY
// from the point in rovelink_device.ino where the corresponding frame has
// already passed session/seq/safety gating and its resulting logical
// control state has been applied — never for a rejected frame (wrong
// session, stale/duplicate seq, invalid, or an armed=true frame arriving
// before a fresh session's disarmed baseline is established). An ACK is
// proof of application, not proof of receipt. Both are no-ops (silently
// dropped, like transportSendTelemetry) if not currently connected —
// observability must never block or retry against the control path.
void transportSendControlAck(long seq, const char *sessionId);
void transportSendEmergencyStopAck(int64_t sentAt);
