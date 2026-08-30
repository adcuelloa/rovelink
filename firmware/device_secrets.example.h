#pragma once

// Device token template (optional `token` field of `device.register`,
// see protocol/src/protocol.ts). The relay currently does NOT require it
// (see PHASE-1.md, "Deliberately pending" #4): this phase leaves the slot
// ready without locking into a full authentication scheme.
//
// Copy to `device_secrets.h` (in .gitignore) and put the real token there
// when the relay starts requiring it:
//
//   cp firmware/device_secrets.example.h \
//      firmware/device_secrets.h
//
// `device_secrets.h` is NEVER versioned. Unlike `wifi_secrets.h`, this file
// is optional: if missing, transport.cpp uses DEVICE_TOKEN "" (no token)
// instead of failing to compile, because it's not needed to connect right now.

#define DEVICE_TOKEN ""
