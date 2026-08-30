#pragma once

// Device token (`token` field of `device.register`, see
// protocol/src/protocol.ts). The relay now REQUIRES this to match the
// `DEVICE_SECRET` Worker secret (`wrangler secret put DEVICE_SECRET` in
// relay/) before it will mark this device registered — see room.ts
// #handleDeviceRegister. A missing or wrong token gets the socket closed
// with CLOSE_CODE.AUTH_FAILED and the device never goes online.
//
// Copy to `device_secrets.h` (in .gitignore) and put the real token there:
//
//   cp firmware/rovelink_device/device_secrets.example.h \
//      firmware/rovelink_device/device_secrets.h
//
// `device_secrets.h` is NEVER versioned. Unlike `wifi_secrets.h`, this file
// is still optional at compile time: if missing, transport.cpp falls back to
// DEVICE_TOKEN "" so the sketch still builds, but an empty token can never
// authenticate against a real DEVICE_SECRET, so the device will never come
// online against a relay with auth enabled.
//
// Never print DEVICE_TOKEN to Serial: transport.cpp does not, and no other
// file should either.

#define DEVICE_TOKEN "REPLACE_WITH_REAL_DEVICE_SECRET"
