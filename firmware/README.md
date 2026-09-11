# ESP32 Firmware

WiFi + WSS client + differential-drive control logic for the RoveLink robot.

## Architecture

```
WSS
 ↓
transport.cpp: decodes JSON, validates version and shape
 ↓
callbacks (transportOnControl / transportOnEmergencyStop)
 ↓
rovelink_device.ino: applyControlFrame() / enterSafeState()
 ↓
RobotHardware
```

## Status by Layer

| Layer                               | Status                       |
| ----------------------------------- | ---------------------------- |
| WiFi STA + DHCP                     | Done                         |
| WSS client (outbound)               | Done, compiled               |
| `device.register`                   | Done                         |
| ControlFrame reception + validation | Done                         |
| TTL watchdog                        | Done                         |
| Analog motors (PWM proportional)    | Done (HARDWARE_SIMULATION 0) |
| Gripper servo                       | Done (HARDWARE_SIMULATION 0) |
| Telemetry (RSSI, ackSeq)            | Done                         |
| Reconnection with backoff           | Done                         |
| Link LED + beep feedback            | Done (HARDWARE_SIMULATION 0) |
| Camera power line (GPIO25)          | **Not implemented — deliberately** |

**Not yet validated**: physical ESP32 hardware + deployed Worker.

## Firmware targets

| Directory | Board | FQBN | Purpose |
|---|---|---|---|
| `rovelink_device/` | Wemos D1 R32 | `esp32:esp32:esp32` | The car. Physically validated at commit `f5d3306`. |
| `rovelink_camera_smoketest/` | AI-Thinker ESP32-CAM | `esp32:esp32:esp32cam` | Camera hardware only — no Wi-Fi, no TLS, no protocol, no secrets. |
| `rovelink_camera/` | AI-Thinker ESP32-CAM | `esp32:esp32:esp32cam` | Full RoveLink video publisher over WSS/TLS. |

See `docs/hardware-demo-runbook.md` for how these three map onto the three
independent test levels, and `scripts/preflight-hardware.sh` to check that all
of them still build.

## Camera Power (GPIO25) — deliberately NOT implemented

The original car's Wemos D1 R32 used GPIO25 as a power-enable line for a
*separate* ESP32-CAM board — not a signal into the camera itself.

There is **no `hwCameraPower()` in this firmware, by choice.** An earlier
draft added one (driving GPIO25 LOW at boot, never called from anywhere) and it
was reverted, because:

1. **The car is known-good at `f5d3306` and cannot be re-validated before the
   demo.** Both boards live at the university. Driving a pin that the validated
   firmware left alone is a real, untested behaviour change — GPIO25 goes from
   floating to actively driven — on the one piece of hardware that currently
   works. That is not worth it for code nothing calls.
2. **The premise is unverified.** On the ESP32-CAM itself GPIO25 is **VSYNC**, a
   different signal on a different chip. That the car's GPIO25 powers *this*
   camera is an assumption nobody has confirmed on the present hardware.
3. **Nothing needs it.** No RoveLink protocol message carries a camera-power
   command, and the first camera streaming test is done with the ESP32-CAM
   **independently powered** precisely so this variable is removed.

Treat GPIO25 as its own physical experiment, to be run *after* the camera demo
works. Wiring it up later would need a new `RemoteMessage` type in
`protocol.ts`, a handler in `transport.cpp`, and a control in `web/`.

## Hardware Simulation

`config.h` defines `HARDWARE_SIMULATION`:

- `1` → `SimulatedHardware` (ESP32-S3 dev board, no GPIO touched)
- `0` → `RealCarHardware` (Wemos D1 R32, physical robot)

The control logic is identical in both modes. Only the hardware layer changes.

## Required Libraries

```bash
arduino-cli lib install "WebSockets@2.7.2"
arduino-cli lib install "ArduinoJson@7.4.3"
# Only for HARDWARE_SIMULATION 0:
arduino-cli lib install "ESP32Servo@3.2.1"
```

## Compile

```bash
# ESP32-S3 (hardware simulation)
arduino-cli compile --fqbn esp32:esp32:esp32s3 firmware/rovelink_device

# Real robot (set HARDWARE_SIMULATION 0 in config.h first)
arduino-cli compile --fqbn esp32:esp32:esp32 firmware/rovelink_device
```

## WiFi Credentials

`wifi_secrets.h` is not versioned. Create it from the template:

```bash
cp firmware/rovelink_device/wifi_secrets.example.h \
   firmware/rovelink_device/wifi_secrets.h
```

Edit with your SSID and password. Without this file, compilation fails with
a clear `#error` message.

## Relay Configuration

Edit `relay_config.h` to set the relay endpoint:

- `RELAY_PROFILE_LOCAL`: for `wrangler dev` (no TLS, use LAN IP)
- `RELAY_PROFILE_CLOUDFLARE`: for deployed Worker (WSS + TLS)

## Serial Output

```text
[BOOT] RoveLink firmware
[BOARD] ESP32-S3
[MODE] HARDWARE SIMULATION
[DEVICE] robot-01

[WIFI] connecting ssid=your-network
[WIFI] connected
[WIFI] ip=192.168.1.42
[NET] online
[READY]

[WSS] connecting host=rovelink-relay.example.workers.dev:443
[WSS] connected
[WSS] registering robot=robot-01
[WSS] registered
```

## Simulation Console

In `HARDWARE_SIMULATION 1` mode, inject control frames via Serial (115200 baud):

| Command                                     | Effect               |
| ------------------------------------------- | -------------------- |
| `c <seq> <throttle> <steering> <armed 0/1>` | Apply a ControlFrame |
| `s`                                         | Emergency stop       |
| `go` / `gc`                                 | Open / close gripper |
| `?`                                         | Help                 |
