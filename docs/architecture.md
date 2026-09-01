# Architecture

## Overview

RoveLink connects a browser-based control dashboard to an ESP32 robot through a
Cloudflare relay. Both the browser and the robot are WebSocket clients that
open outbound connections to the relay. The relay routes messages between them.

## Components

### Web Dashboard (`web/`)

- Vite + TypeScript + Tailwind CSS, vanilla DOM (no framework)
- Login gate: the driving UI is not mounted until the relay confirms
  authentication (`auth/handshake.ts`) — see
  [authentication.md](authentication.md#operator-login-web-dashboard)
- Gamepad API for physical controllers
- Keyboard fallback (WASD / arrows)
- Touch controls for mobile
- MockTransport for development without hardware
- WebSocketTransport for real relay connections

### Relay (`relay/`)

- Cloudflare Worker with WebSocket Hibernation API
- One Durable Object (`RobotRoom`) per robot room
- Routes messages between `controller` and `device` sockets
- Sends `emergency-stop` when a controller disconnects
- Publishes `room` presence messages to both ends
- Stateless per connection: no database, no queues

### Video Relay (`video-relay/`)

- Separate Cloudflare Worker + Durable Object (`VideoRoom`) from the control
  relay — an isolated deployment so video load or a crashed video room can
  never affect robot control
- Forwards JPEG frames from an authenticated publisher to authenticated
  viewers
- Publishers authenticate with a shared secret; viewers present a
  short-lived signed ticket minted by the control relay (see
  [authentication.md](authentication.md))
- Wire protocol: [video-protocol.md](video-protocol.md)

### Protocol (`protocol/`)

- Shared types, codec, and differential wheel mix
- JSON wire format (versioned: `v: 1`)
- Used by web client, relay, and ESP32 firmware
- See [protocol.md](protocol.md) for message details

### Firmware (`firmware/`)

- ESP32 Arduino sketch
- WiFi STA + DHCP (no static IP)
- WSS client (outbound only, never accepts incoming)
- TLS validation via CA root certificates
- Reconnection with exponential backoff
- Hardware abstraction layer (`RobotHardware`)
  - `SimulatedHardware`: for ESP32-S3 dev boards (no GPIO)
  - `RealCarHardware`: for the physical robot (Wemos D1 R32)

## Connection Lifecycle

```text
1. ESP32 boots → WiFi connects → Internet probe succeeds
2. ESP32 opens WSS to relay → sends device.register (DEVICE_SECRET)
3. Operator types their key into the login screen → browser opens WSS to
   relay → sends controller.register (CONTROLLER_SECRET)
4. Relay verifies both tokens, mints a controlSessionId, sends
   controller.session to the device and the controller, and publishes room
   (deviceOnline: true, controllerOnline: true) — only now does the browser
   mount the driving UI
5. Browser sends ControlFrame → relay stamps controlSessionId → forwards to
   ESP32
6. ESP32 sends Telemetry → relay forwards to browser
7. On controller disconnect → relay sends emergency-stop to device
8. On any link loss → both sides fall back to safe state
9. (Optional) Browser requests a video ticket from the control relay, then
   connects to the separate video relay to view the camera feed — see
   authentication.md
```

See [authentication.md](authentication.md) for the full credential model and
close-code reference.

## Design Principles

- **Outbound only**: no port forwarding, no public IPs, no NAT traversal
- **Latest state wins**: `seq` field discards stale frames
- **TTL watchdog**: frames older than `ttlMs` (default 500 ms) are ignored
- **Safe state by default**: disconnection = motors off
- **Shared logic**: `differentialMix()` and `ControlState` are defined once
  in `protocol/` and used identically by web and firmware
