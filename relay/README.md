# @rovelink/relay

Cloudflare Worker + Durable Object `RobotRoom`. See the root
[README](../README.md) for design decisions; this file covers deployment.
For the full credential model see
[docs/authentication.md](../docs/authentication.md).

## Local (`wrangler dev`)

```bash
cp relay/.dev.vars.example relay/.dev.vars
# edit relay/.dev.vars — VIDEO_TICKET_SECRET must match video-relay/.dev.vars

pnpm dev:relay      # http://localhost:8787, ws://localhost:8787/robot/<id>/<role>
```

Used by `firmware/rovelink_device/relay_config.h` in
`RELAY_PROFILE_LOCAL` (no TLS) and `web/.env.example`
(`VITE_RELAY_URL=ws://localhost:8787`).

## Deploy to Cloudflare

Requires a Cloudflare account and, on first use,
`npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in the environment).

```bash
npx wrangler secret put DEVICE_SECRET        # from relay/
npx wrangler secret put CONTROLLER_SECRET
npx wrangler secret put VIDEO_TICKET_SECRET  # must match video-relay's VIDEO_TICKET_SECRET exactly

pnpm --filter @rovelink/relay deploy
```

`wrangler deploy` fails loudly if any of the three is missing (see the
`secrets` block in `wrangler.jsonc`) rather than silently deploying a relay
that rejects every auth check. Beyond that, `RobotRoom` uses only the
Durable Object binding declared in `wrangler.jsonc` (`ROOMS`) — no database
or queues. The free tier is sufficient (SQLite classes).

`wrangler deploy` prints the public endpoint, e.g.:

```text
https://rovelink-relay.<your-subdomain>.workers.dev
```

(`your-subdomain` is assigned by Cloudflare on first Worker deployment;
also visible in `npx wrangler deployments list` or the dashboard.)

## Configure the other endpoints

**Firmware** (`firmware/rovelink_device/relay_config.h`):

```cpp
#define RELAY_PROFILE RELAY_PROFILE_CLOUDFLARE
// ...
#define RELAY_HOST "rovelink-relay.<your-subdomain>.workers.dev"
#define RELAY_PORT 443
```

**Frontend** (`web/.env.local`, copied from `.env.example`):

```bash
VITE_RELAY_URL=wss://rovelink-relay.<your-subdomain>.workers.dev
VITE_ROBOT_ID=robot-01
```

## Verify

```bash
curl https://rovelink-relay.<your-subdomain>.workers.dev/health
# {"ok":true,"service":"rovelink-relay"}
```

## Tests

```bash
pnpm --filter @rovelink/relay test   # route.ts, pure, no workerd
```
