#pragma once

// WiFi credentials template for the camera board.
//
// Separate from firmware/rovelink_device/wifi_secrets.h: this is a
// different Arduino sketch/compile unit (different physical board), so it
// needs its own copy even when both boards join the same network. Copy to
// `wifi_secrets.h` (in .gitignore) and put your real network there:
//
//   cp firmware/rovelink_camera/wifi_secrets.example.h \
//      firmware/rovelink_camera/wifi_secrets.h
//
// `wifi_secrets.h` is NEVER versioned. This example file is, so it has
// no real credentials.
//
// Without `wifi_secrets.h`, camera_network.cpp aborts compilation with an
// #error.

#define WIFI_SSID "your-ssid"
#define WIFI_PASSWORD "your-password"
