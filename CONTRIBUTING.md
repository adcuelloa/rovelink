# Contributing to RoveLink

Thanks for your interest in contributing to RoveLink.

## Setup

```bash
pnpm install
```

Requires Node.js >= 24.20.0 and pnpm 12.

## Before submitting

1. Run the full check:

```bash
pnpm check
```

This runs formatting, linting, type checking, and all tests.

2. Build to verify:

```bash
pnpm build
```

## Running parts individually

```bash
pnpm dev            # web dashboard at http://localhost:5173
pnpm dev:relay      # relay at http://localhost:8787
```

## What to contribute

- **Bug fixes** — include a test if the fix covers logic changes.
- **Small, focused improvements** — one concern per pull request.
- **Protocol changes** — discuss in a GitHub issue first. The protocol is
  shared between the web client, relay, and ESP32 firmware, so changes must
  be coordinated across all three.

## What not to commit

- `.env.local`, `.env` — use `.env.example` as a template.
- `wifi_secrets.h`, `device_secrets.h` — use the `.example.h` files.
- `node_modules/`, `dist/`, `.wrangler/` — already gitignored.

## Code style

- TypeScript: strict mode, no `any`, consistent type imports.
- English variable/function names in source code.
- Formatting: `oxfmt` (run `pnpm fmt:check`).
- Linting: `oxlint` (run `pnpm lint`).

## Firmware

ESP32 firmware changes should compile for both:

- `esp32:esp32:esp32s3` (hardware simulation mode)
- `esp32:esp32:esp32` (real car hardware)

Do not change pin assignments without documenting the hardware impact.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open public issues for security
vulnerabilities.
