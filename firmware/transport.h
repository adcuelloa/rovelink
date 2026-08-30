#pragma once

#include <Arduino.h>

// Transport layer: WSS client to Cloudflare relay.
//
//   WSS
//    ↓
//   decode/validate (here)
//    ↓
//   control logic (remote_control_car.ino, via callbacks below)
//    ↓
//   RobotHardware
//
// This module knows nothing about motors, gripper, or watchdog: it only
// speaks the protocol (protocol/src/protocol.ts, as JSON) and delivers
// decoded frames with verified structure. The ESP32 is a CLIENT: it opens
// the outgoing connection to the relay, never accepts incoming connections.
//
// The relay address lives in relay_config.h, not here.

// A ControlFrame already decoded with correct structure (equivalent to the
// `ControlFrame` from protocol.ts, without sentAt/ttlMs: see the note in
// applyControlFrame() in the .ino about why those two fields aren't compared
// directly—the ESP32's clock is not synced with the browser's).
struct ControlFrameIn
{
  long seq;
  float throttle;
  float steering;
  char gripper; // 'i' idle, 'o' open, 'c' close
  bool armed;
};

typedef void (*TransportControlCb)(const ControlFrameIn &frame);
typedef void (*TransportEmergencyCb)();

// Register callbacks before transportSetup(). No queue: each call delivers
// the latest decoded frame, never an old one.
void transportOnControl(TransportControlCb cb);
void transportOnEmergencyStop(TransportEmergencyCb cb);

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
// on reconnect.
void transportSendTelemetry(int rssi, bool armed, float throttle, float steering, long ackSeq);
