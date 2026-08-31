#pragma once

#include <Arduino.h>

// Connectivity layer: WiFi STA mode + DHCP + Internet verification only.
// No WebSocket, TLS, MQTT, or provisioning yet—those are for later phases.
//
//   Control logic (rovelink_device.ino)
//         ↓ asks                         ↓ never calls WiFi.* directly
//   Network (this header)
//         └── WiFi (Arduino ESP32) + Internet probe
//
// Everything is non-blocking: networkLoop() never waits on the radio.
// Internet verification (DNS + short TCP), which does block, runs in a
// separate task so control TTL and safe state keep their normal cadence.

// Network layer state, from least to most connected.
enum NetworkState
{
  NETWORK_OFF,        // networkSetup() not yet called
  NETWORK_CONNECTING, // WiFi.begin() in progress or waiting for next retry
  NETWORK_CONNECTED,  // associated to AP and has DHCP IP
  NETWORK_ONLINE      // plus, the probe reached an Internet host
};

// Start the radio in STA mode and launch the first connection attempt.
// Doesn't wait: returns immediately.
void networkSetup();

// Pump the state machine. Call each loop iteration. Never blocks.
void networkLoop();

// true if associated to AP and has valid IP (says nothing about Internet).
bool networkConnected();

// true if additionally the last probe reached an Internet host.
bool networkOnline();

// RSSI in dBm, or 0 if no link.
int networkRssi();

// State as text for logs: "down", "connected", or "online".
const char *networkStatusText();

// true once the layer resolved its first attempt (connected and probed, or
// failed). Prevents [READY] from printing before we know network state.
bool networkResolved();
