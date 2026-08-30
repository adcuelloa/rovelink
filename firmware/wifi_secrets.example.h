#pragma once

// WiFi credentials template.
//
// Copy to `wifi_secrets.h` (in .gitignore) and put your real network there:
//
//   cp firmware/wifi_secrets.example.h \
//      firmware/wifi_secrets.h
//
// `wifi_secrets.h` is NEVER versioned. This example file is, so it has
// no real credentials.
//
// Without `wifi_secrets.h`, network.cpp aborts compilation with an #error.

#define WIFI_SSID "your-ssid"
#define WIFI_PASSWORD "your-password"
