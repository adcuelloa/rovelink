# @rovelink/relay

Cloudflare Worker + Durable Object `RobotRoom`. See the root
[README](../README.md) for design decisions; this file covers deployment.

## Local (`wrangler dev`)

```bash
pnpm dev:relay      # http://localhost:8787, ws://localhost:8787/robot/<id>/<role>
```

Used by `firmware/carro/relay_config.h` in
`RELAY_PROFILE_LOCAL` (no TLS) and `web/.env.example`
(`VITE_RELAY_URL=ws://localhost:8787`).

## Deploy to Cloudflare

Requires a Cloudflare account and, on first use,
`npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in the environment).

```bash
pnpm --filter @rovelink/relay deploy
```

No environment variables or secrets required: `RobotRoom` uses only the
Durable Object binding declared in `wrangler.jsonc` (`ROOMS`). The free
tier is sufficient (SQLite classes).

`wrangler deploy` prints the public endpoint, e.g.:

```text
https://rovelink-relay.<your-subdomain>.workers.dev
```

(`your-subdomain` is assigned by Cloudflare on first Worker deployment;
also visible in `npx wrangler deployments list` or the dashboard.)

## Configure the other endpoints

**Firmware** (`firmware/carro/relay_config.h`):

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
