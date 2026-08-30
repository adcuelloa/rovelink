#pragma once

// Relay endpoint: the only place where this address lives. No loose
// hosts in transport.cpp or in the .ino.
//
// Change the active profile (RELAY_PROFILE, below) and recompile. No need
// to touch anything else to switch from "wrangler dev" on the LAN to Cloudflare
// deployed.

#include "config.h"

#define RELAY_PROFILE_LOCAL 0
#define RELAY_PROFILE_CLOUDFLARE 1

// --- Active profile ---------------------------------------------------------
#define RELAY_PROFILE RELAY_PROFILE_CLOUDFLARE

#if RELAY_PROFILE == RELAY_PROFILE_LOCAL

// `pnpm dev:relay` (wrangler dev). Replace with the IP of the machine running
// wrangler on the same network as the ESP32: "localhost" won't work from the ESP32.
#define RELAY_HOST "192.168.1.100"
#define RELAY_PORT 8787
#define RELAY_USE_TLS 0

// wrangler dev does not speak TLS: nothing insecure to enable here.
#define RELAY_TLS_INSECURE_DEV_ONLY 0

#else // RELAY_PROFILE_CLOUDFLARE

// Replace "YOUR-SUBDOMAIN" with the one assigned by `wrangler deploy` (shown in its
// output and in `npx wrangler deployments list`). No protocol, no path.
#define RELAY_HOST "robot-relay.YOUR-SUBDOMAIN.workers.dev"
#define RELAY_PORT 443
#define RELAY_USE_TLS 1

// Escape valve ONLY for a first physical test if the certificate cannot
// be validated yet for some reason (e.g., ESP32 clock very out of sync).
// NEVER for the final architecture: with this active anyone in the path
// could impersonate the relay. See the README in this folder ("TLS Decision")
// before touching this value.
//   0 → real CA root validation (see cloudflare_ca_certs.h). Default.
//   1 → WiFiClientSecure::setInsecure(), with a warning at boot.
#define RELAY_TLS_INSECURE_DEV_ONLY 0

#endif

// "/robot/<ROBOT_ID>/device" — see relay/src/route.ts. ROBOT_ID comes from
// config.h so the robot id has a single source of truth.
#define RELAY_PATH_DEVICE "/robot/" ROBOT_ID "/device"
