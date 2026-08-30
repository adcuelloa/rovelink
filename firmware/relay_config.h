#pragma once

#include "config.h"

#define RELAY_PROFILE_LOCAL 0
#define RELAY_PROFILE_CLOUDFLARE 1

// Active relay profile.
#define RELAY_PROFILE RELAY_PROFILE_CLOUDFLARE

#if RELAY_PROFILE == RELAY_PROFILE_LOCAL

// `pnpm dev:relay` / `wrangler dev`.
// Use the LAN IP of the machine running the relay.
#define RELAY_HOST "192.168.1.100"
#define RELAY_PORT 8787
#define RELAY_USE_TLS 0
#define RELAY_TLS_INSECURE_DEV_ONLY 0

#elif RELAY_PROFILE == RELAY_PROFILE_CLOUDFLARE

#define RELAY_HOST "rovelink-relay.cuello.workers.dev"
#define RELAY_PORT 443
#define RELAY_USE_TLS 1

// Development escape hatch only. Keep disabled in normal builds.
#define RELAY_TLS_INSECURE_DEV_ONLY 0

#else
#error "Unknown RELAY_PROFILE"
#endif

// /robot/<ROBOT_ID>/device
#define RELAY_PATH_DEVICE "/robot/" ROBOT_ID "/device"