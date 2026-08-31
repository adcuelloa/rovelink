# Architecture

## Overview

RoveLink connects a browser-based control dashboard to an ESP32 robot through a
Cloudflare relay. Both the browser and the robot are WebSocket clients that
open outbound connections to the relay. The relay routes messages between them.

## Components

### Web Dashboard (`web/`)

- Vite + TypeScript + Tailwind CSS, vanilla DOM (no framework)
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
  [protocol.md](protocol.md))

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
2. ESP32 opens WSS to relay → sends device.register
3. Browser opens WSS to relay → sends controller.register
4. Relay publishes room (deviceOnline: true, controllerOnline: true)
5. Browser sends ControlFrame → relay forwards to ESP32
6. ESP32 sends Telemetry → relay forwards to browser
7. On controller disconnect → relay sends emergency-stop to device
8. On any link loss → both sides fall back to safe state
```

## Design Principles

- **Outbound only**: no port forwarding, no public IPs, no NAT traversal
- **Latest state wins**: `seq` field discards stale frames
- **TTL watchdog**: frames older than 250 ms are ignored
- **Safe state by default**: disconnection = motors off
- **Shared logic**: `differentialMix()` and `ControlState` are defined once
  in `protocol/` and used identically by web and firmware
