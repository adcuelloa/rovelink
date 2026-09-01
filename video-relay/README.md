# @rovelink/video-relay

Cloudflare Worker + Durable Object `VideoRoom`. A separate deployment from
the control relay (`@rovelink/relay`) — see the root
[README](../README.md) and [docs/architecture.md](../docs/architecture.md)
for why. This file covers deployment and local testing; for the wire
protocol and full auth model see [docs/video-protocol.md](../docs/video-protocol.md)
and [docs/authentication.md](../docs/authentication.md).

## Local (`wrangler dev`)

```bash
cp video-relay/.dev.vars.example video-relay/.dev.vars
# edit video-relay/.dev.vars — VIDEO_TICKET_SECRET must match relay/.dev.vars

pnpm --filter @rovelink/video-relay dev
# http://localhost:8787 by default; pick a different port with
# `wrangler dev --port 8788` if it collides with the control relay's own
# `wrangler dev` on your machine
```

Used by `web/.env.example` (`VITE_VIDEO_RELAY_URL`) and the dev CLI tools
below.

## Deploy to Cloudflare

Requires a Cloudflare account and, on first use,
`npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in the environment).

```bash
npx wrangler secret put VIDEO_PUBLISHER_SECRET  # from video-relay/
npx wrangler secret put VIDEO_TICKET_SECRET     # must match relay's VIDEO_TICKET_SECRET exactly

pnpm --filter @rovelink/video-relay deploy
```

`wrangler deploy` fails loudly if either secret is missing (see the
`secrets` block in `wrangler.jsonc`) rather than silently deploying a relay
that rejects every auth check. No database, queues, or additional bindings
are required beyond the `VIDEO_ROOMS` Durable Object binding already declared
in `wrangler.jsonc`.

`wrangler deploy` prints the public endpoint, e.g.:

```text
https://rovelink-video-relay.<your-subdomain>.workers.dev
```

## Configure the other endpoints

**Frontend** (`web/.env.local`, copied from `.env.example`):

```bash
VITE_VIDEO_RELAY_URL=wss://rovelink-video-relay.<your-subdomain>.workers.dev
```

Leaving `VITE_VIDEO_RELAY_URL` unset disables the video panel entirely
rather than failing.

**Camera publisher**: no firmware implementation exists yet (see the
project roadmap) — today the only publisher client is the dev CLI below.

## Local testing without a camera

Two Node CLIs under `src/dev/` speak the video protocol exactly as a real
ESP32-CAM and browser tab eventually would, so the whole stream path —
including the control-relay ticket handoff — can be exercised without
physical hardware:

```bash
# Terminal 1: control relay (needed for the viewer's ticket handoff)
pnpm --filter @rovelink/relay dev

# Terminal 2: video relay
pnpm --filter @rovelink/video-relay dev

# Terminal 3: simulated camera publisher
VIDEO_PUBLISHER_SECRET=<value from video-relay/.dev.vars> \
  pnpm --filter @rovelink/video-relay dev:publisher

# Terminal 4: viewer (goes through the control relay for a ticket first)
CONTROLLER_SECRET=<value from relay/.dev.vars> \
  pnpm --filter @rovelink/video-relay dev:viewer
```

`dev:publisher` (`src/dev/publisher-cli.ts`) generates synthetic JPEG frames
and streams them at a configurable FPS — no camera hardware or GPU required.
`dev:viewer` (`src/dev/viewer-cli.ts`) does **not** take a shortcut: it
authenticates to the control relay with `CONTROLLER_SECRET`, waits for
`controller.session`, requests a ticket, then registers with the video relay
using that ticket — the exact sequence the real dashboard runs. It measures
transport stats (frames/sec, skipped frames, latency) but does not decode or
render the JPEG.

Both CLIs read their target URLs from `VIDEO_RELAY_URL` /
`CONTROL_RELAY_URL` (defaults: `ws://localhost:8787` / `ws://localhost:8080`
— adjust to whatever ports your local `wrangler dev` instances are actually
using) and never print the secret values they were given, only whether one
was configured.

## Verify

```bash
curl https://rovelink-video-relay.<your-subdomain>.workers.dev/health
# {"ok":true,"service":"rovelink-video-relay"}
```

## Tests

```bash
pnpm --filter @rovelink/video-relay test   # route.ts + dev/ helpers (pure), then room.do.test.ts (vitest-pool-workers)
```
