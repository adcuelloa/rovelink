#pragma once

#include "camera_config.h"

#define VIDEO_RELAY_PROFILE_LOCAL 0
#define VIDEO_RELAY_PROFILE_CLOUDFLARE 1

// Active video relay profile.
//
// LOCAL is the default here — deliberately, not a placeholder: as of this
// pass, `rovelink-video-relay` has never been deployed to Cloudflare under
// either account this repo has access to (verified with `wrangler
// deployments list` — the Worker does not exist yet, see
// firmware/rovelink_camera/README.md's BLOCKER section). Today's first live
// test can only reach a video relay running locally (`wrangler dev` in
// video-relay/, on the same LAN as the camera). Switch to
// VIDEO_RELAY_PROFILE_CLOUDFLARE once video-relay is actually deployed and
// VIDEO_RELAY_HOST below is filled in with the real hostname — do not
// invent one before then.
#define VIDEO_RELAY_PROFILE VIDEO_RELAY_PROFILE_LOCAL

#if VIDEO_RELAY_PROFILE == VIDEO_RELAY_PROFILE_LOCAL

// `pnpm --filter @rovelink/video-relay dev` (wrangler dev). Use the LAN IP
// of the machine running it — matches the port convention already used by
// web/.env.example's VITE_VIDEO_RELAY_URL (8788, distinct from the control
// relay's own local wrangler dev on 8787).
#define VIDEO_RELAY_HOST "192.168.1.100"
#define VIDEO_RELAY_PORT 8788
#define VIDEO_RELAY_USE_TLS 0

#elif VIDEO_RELAY_PROFILE == VIDEO_RELAY_PROFILE_CLOUDFLARE

// BLOCKER (see README.md): no deployed video-relay hostname exists yet.
// Fill this in with the real hostname only after
// `pnpm --filter @rovelink/video-relay deploy` (or a custom route) has
// actually run — never invent one.
#define VIDEO_RELAY_HOST "REPLACE_WITH_DEPLOYED_VIDEO_RELAY_HOSTNAME"
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
