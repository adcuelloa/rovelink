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

**Not yet validated**: physical ESP32 hardware + deployed Worker.

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
