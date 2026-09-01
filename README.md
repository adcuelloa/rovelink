# RoveLink

> RoveLink is an open-source, low-latency web platform for remotely controlling
> robots over the Internet.

## Overview

RoveLink connects a browser-based control dashboard to an ESP32 robot through a
Cloudflare relay. The robot needs no public IP and no inbound firewall rules:
both the browser and the ESP32 establish outbound WebSocket connections to the
relay, which simply forwards messages between them.

The control interface renders a top-down view of a differential-drive chassis.
Each wheel shows the exact PWM the firmware will apply, computed by the same
`differentialMix()` function shared between the web client and the ESP32.

## Architecture

```
Gamepad / Keyboard / Touch
            │
            ▼
       RoveLink Web
        (browser)
            │ WSS
            ▼
      RoveLink Relay
   Cloudflare Worker + DO
            │ WSS
            ▼
        ESP32 Robot
```

- The **browser** and the **robot** are both WebSocket clients that open
  outbound connections to the relay.
- The **relay** (Cloudflare Worker + Durable Object) routes messages between
  controller and device. It does not interpret robot physics.
- The **ESP32** never accepts incoming connections. It connects out to the relay
  over WSS with TLS certificate validation.

## Features

- WebSocket control with JSON protocol (`v1`)
- Shared-secret authentication for devices and controllers, ticket-based
  authorization for video viewers
- TLS with CA root validation (ISRG X1, GTS R1, GTS R4)
- ESP32 firmware: WiFi STA + DHCP, WSS client, reconnection with backoff
- Gamepad API with standard mapping
- Keyboard fallback (WASD / arrows)
- Touch controls for mobile
- Analog throttle and steering with deadzone
- Latest-state-wins (no command queue)
- TTL-based link watchdog (500 ms)
- Emergency stop (desarms + zeroes all axes immediately)
- Hardware simulation mode for ESP32-S3 development boards
- Cloudflare Durable Objects for relay rooms
- Telemetry: RSSI, ackSeq, throttle/steering echo
- Reconnection on link loss (WiFi and WSS)
- Live video streaming via a dedicated video relay (separate Worker/DO from
  the control relay)

## Repository Structure

```
rovelink/
├── protocol/             @rovelink/protocol — shared types, codec, differential mix
├── web/                  @rovelink/web — Vite + TypeScript + Tailwind control dashboard
├── relay/                @rovelink/relay — Cloudflare Worker + Durable Object (control)
├── video-relay/          @rovelink/video-relay — Cloudflare Worker + Durable Object (video)
├── robot-sim/            @rovelink/robot-sim — desktop robot simulator (no hardware, see docs/demo.md)
├── demo/                 @rovelink/demo — `pnpm dev:demo` orchestrator (see docs/demo.md)
├── firmware/             ESP32 sketch (WiFi + WSS + control logic)
├── docs/                 Architecture, protocol, auth, and safety documentation — see docs/README.md
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE               Apache 2.0
├── pnpm-workspace.yaml
└── package.json
```

## Try RoveLink without hardware

No ESP32, ESP32-CAM, or DualSense required — this runs the real control and
video protocols end to end against a desktop robot simulator and a
simulated camera.

```bash
pnpm install
pnpm dev:demo
```

1. The terminal prints a temporary **Demo controller key**
2. Open the printed local Web URL
3. Enter that key into the normal login form
4. The simulated robot appears **Online**
5. The simulated camera appears **Live**
6. Drive it with keyboard (WASD/arrows) or a gamepad if one is attached

Press `Ctrl+C` to stop — every process it started is cleaned up, including
the ephemeral secrets it generated. See
[docs/demo.md](docs/demo.md) for what's real vs. simulated, the robot
simulator's fidelity boundary, and artificial-latency/chaos options.

## Quick Start

### Prerequisites

- Node.js >= 24.20.0
- pnpm 12

### Web Dashboard

```bash
pnpm install
pnpm dev
# → http://localhost:5173
```

Without an ESP32 or Cloudflare deployment, the dashboard starts with
`MockTransport` — a simulated robot in the browser. You can drive, arm/disarm,
open/close the gripper, and trigger emergency stop.

### Relay

```bash
pnpm dev:relay
# → http://localhost:8787
```

Uses `wrangler dev`. The relay is stateless per room — no database, no
environment variables required.

### ESP32 Firmware

```bash
# Install dependencies
arduino-cli lib install "WebSockets@2.7.2"
arduino-cli lib install "ArduinoJson@7.4.3"

# Copy WiFi credentials
cp firmware/wifi_secrets.example.h \
   firmware/wifi_secrets.h
# Edit wifi_secrets.h with your WiFi SSID and password

# Compile for ESP32-S3 (hardware simulation mode)
arduino-cli compile \
  --fqbn esp32:esp32:esp32s3 \
  firmware
```

See `firmware/README.md` for full details on WSS
configuration, TLS, and hardware modes.

## Development

```bash
pnpm install        # install all workspace dependencies
pnpm dev            # web dashboard at http://localhost:5173
pnpm dev:relay      # relay at http://localhost:8787
pnpm dev:demo       # full hardwareless stack — see docs/demo.md
pnpm check          # format + lint + typecheck + tests
pnpm build          # build all packages
```

## Controls

| Input                | Action                |
| -------------------- | --------------------- |
| `W` / `↑`            | Forward               |
| `S` / `↓`            | Reverse               |
| `A` / `←`, `D` / `→` | Turn                  |
| `Q` / `E` (hold)     | Open / close gripper  |
| `Z`                  | Toggle arm/disarm     |
| `Space`              | Emergency stop        |
| Left stick (gamepad) | Throttle and steering |

## Environment Variables

| Variable               | Where  | Default    | Purpose                                    |
| ---------------------- | ------ | ---------- | ------------------------------------------ |
| `VITE_RELAY_URL`       | `web/` | —          | WSS base URL of the control relay          |
| `VITE_VIDEO_RELAY_URL` | `web/` | —          | WSS base URL of the video relay (optional) |
| `VITE_ROBOT_ID`        | `web/` | `robot-01` | Robot ID to connect to                     |

Without `VITE_RELAY_URL` the WebSocket option is disabled in the UI. Without
`VITE_VIDEO_RELAY_URL` the video panel is disabled rather than failing.

The relays themselves are configured with **secrets**, not `VITE_*`
variables (`DEVICE_SECRET`, `CONTROLLER_SECRET`, `VIDEO_PUBLISHER_SECRET`,
`VIDEO_TICKET_SECRET`) — see
[docs/authentication.md](docs/authentication.md) for what each one proves
and [relay/README.md](relay/README.md) /
[video-relay/README.md](video-relay/README.md) for how to set them, both
locally (`.dev.vars`) and on a deployed Worker (`wrangler secret put`).

## Documentation

See [docs/README.md](docs/README.md) for the full documentation index
(architecture, wire protocols, authentication, safety) and a suggested
reading order for new contributors.

## Current Status

**Status: experimental / pre-1.0**

- Web dashboard with MockTransport: fully functional
- Protocol, codec, and differential mix: defined and tested
- Relay (Worker + Durable Object): tested with `wrangler dev`
- WebSocket transport (browser ↔ relay): tested end-to-end in local dev
- Authentication (device/controller shared-secret, video viewer tickets):
  implemented and tested
- Video relay (Worker + Durable Object) and live video viewer: implemented,
  tested with `wrangler dev` and the `video-relay/src/dev/*-cli.ts` tools;
  no camera firmware yet (see Roadmap)
- ESP32 firmware: compiled but not yet validated on physical hardware

## Roadmap

- Physical ESP32 WSS validation with deployed Worker
- ESP32-CAM firmware for the video publisher role (only a dev CLI exists today)
- DualSense-specific button profile
- Real differential-drive hardware testing
- Wi-Fi provisioning (no manual SSID entry)
- Binary control protocol (replacing JSON)
- Multi-robot management

## Safety

RoveLink can control physical hardware. Built-in safety mechanisms include:

- **Armed state**: motors only respond when explicitly armed
- **Emergency stop**: immediately desarms and zeros all outputs
- **TTL watchdog**: stale control frames cause the robot to stop
- **Link loss**: disconnection triggers safe state on both sides
- **Latest-state-wins**: old commands are never replayed

Software safety is not a replacement for hardware emergency stops. Always test
in a safe environment with physical power cutoff available.

## Origin

RoveLink originated as an evolution of a university robotics project and was
later redesigned as a general-purpose Internet teleoperation platform.

## License

[Apache 2.0](LICENSE)
