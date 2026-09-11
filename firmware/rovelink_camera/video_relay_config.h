#pragma once

#include "camera_config.h"

#define VIDEO_RELAY_PROFILE_LOCAL 0
#define VIDEO_RELAY_PROFILE_CLOUDFLARE 1

// Active video relay profile.
//
// CLOUDFLARE is the default: `rovelink-video-relay` is now actually
// deployed (verified — see docs/hardware-demo-runbook.md's Cloudflare
// checklist), so the production transport described in
// firmware/rovelink_camera/README.md is reachable from any network with
// Internet access. That matters for the university session specifically:
// the camera is on the university's Wi-Fi, not on a LAN shared with a
// laptop running `wrangler dev`, so LOCAL would require extra setup the
// session is supposed to avoid.
//
// LOCAL is kept only as a bench fallback for developing against
// `wrangler dev` on the same LAN. It is NOT the production path and must
// never be shipped as one.
#define VIDEO_RELAY_PROFILE VIDEO_RELAY_PROFILE_CLOUDFLARE

#if VIDEO_RELAY_PROFILE == VIDEO_RELAY_PROFILE_LOCAL

// `pnpm --filter @rovelink/video-relay dev` (wrangler dev). Use the LAN IP
// of the machine running it — matches the port convention already used by
// web/.env.example's VITE_VIDEO_RELAY_URL (8788, distinct from the control
// relay's own local wrangler dev on 8787).
#define VIDEO_RELAY_HOST "192.168.1.100"
#define VIDEO_RELAY_PORT 8788
#define VIDEO_RELAY_USE_TLS 0

#elif VIDEO_RELAY_PROFILE == VIDEO_RELAY_PROFILE_CLOUDFLARE

// Real deployed hostname, from `wrangler deploy` output in video-relay/
// (workers.dev subdomain `cuello`), confirmed serving
// {"ok":true,"service":"rovelink-video-relay"} on GET /health over TLS.
//
// TLS TRUST: this host's chain is
//   leaf CN=cuello.workers.dev -> GTS WE1 -> GTS Root R4
// and GTS Root R4 is one of the three roots already in
// cloudflare_ca_certs.h — verified with `openssl s_client`, the same chain
// the already-validated control relay (rovelink-relay.cuello.dev) uses. No
// new trust material is needed, and no insecure fallback exists here.
#define VIDEO_RELAY_HOST "rovelink-video-relay.cuello.workers.dev"
#define VIDEO_RELAY_PORT 443
#define VIDEO_RELAY_USE_TLS 1

#else
#error "Unknown VIDEO_RELAY_PROFILE"
#endif

// /video/<ROBOT_ID>/publisher (video-relay/src/route.ts) — a different path
// shape and role vocabulary from the control relay's /robot/<id>/device on
// purpose (see route.ts's own comment): the two relays are separate
// Workers, and a client pointed at the wrong one fails to parse rather than
// silently misbehaving.
#define VIDEO_RELAY_PATH_PUBLISHER "/video/" ROBOT_ID "/publisher"
