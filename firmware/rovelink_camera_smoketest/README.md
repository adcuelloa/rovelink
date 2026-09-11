# ESP32-CAM hardware smoke test (Level 2)

The one firmware target that **cannot be misconfigured**: no Wi-Fi, no TLS, no
WebSocket, no RoveLink protocol, no HTTP server, and no secrets file. It has zero
configuration and depends on nothing but the `esp32:esp32` core, so it always
compiles and always runs.

## Why it exists

To split **camera hardware** from **networking** during a short session where
there is no time to debug "no video" when it could be either layer.

- Frames here, no video in `rovelink_camera/` → the camera is **proven good**;
  the fault is Wi-Fi, TLS, auth, or the relay.
- No frames here → it is hardware: ribbon cable, power, or the module itself.

## What it does

1. Starts Serial at 115200
2. Reports PSRAM presence, size and free bytes
3. Initialises the OV2640 with the **known-good AI-Thinker configuration**
4. Captures a JPEG every 500 ms
5. Prints dimensions, byte count, capture time and a SOI/EOI integrity check
6. Returns every framebuffer on every path

## Camera settings

Recovered verbatim from the validated project at
`~/Projects/compiladores/firmware/carro_pinza_wifi/` (which is **not modified**
and remains the Level 1 fallback):

| Setting | Value | Why |
|---|---|---|
| `camera_config_t` | zero-initialised | uninitialised `sccb_i2c_port` caused intermittent JPEG corruption |
| `sccb_i2c_port` | `-1` | autoselect — the fix for the above |
| `xclk_freq_hz` | 20 MHz | 24 MHz over-clocks the OV2640 and corrupts frames |
| `pixel_format` | `PIXFORMAT_JPEG` | |
| frame size (PSRAM) | `FRAMESIZE_VGA` 640×480 | |
| `jpeg_quality` | 12 | |
| `fb_count` | 2 | double buffer: capture continues while a frame is held |
| `fb_location` | `CAMERA_FB_IN_PSRAM` | |
| `grab_mode` | `CAMERA_GRAB_LATEST` | latest-frame-wins |
| no-PSRAM fallback | QQVGA 160×120, quality 18, `fb_count` 1 | safe degradation |
| orientation | `set_vflip(1)` | sensor is mounted upside down |

## Build and flash

```bash
arduino-cli compile --fqbn esp32:esp32:esp32cam firmware/rovelink_camera_smoketest

# or upload a pre-compiled build without recompiling:
arduino-cli upload --input-dir artifacts/hardware-demo/esp32cam-smoketest \
  -b esp32:esp32:esp32cam -p /dev/ttyUSB0

arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

## Expected output

```
[BOOT] RoveLink ESP32-CAM SMOKE TEST
[PSRAM] found=true size=4194304 free=4188000
[CAM] sensor PID=0x26
[CAM] init OK
[FRAME] 640x480 bytes=18342 captureMs=71 jpeg=ok ok=1 bad=0
```

`PID=0x26` is the OV2640. `bad=` must stay at 0 — a rising count means corrupt
frames, which almost always means a poorly seated ribbon cable.

Full procedure: `docs/hardware-demo-runbook.md`.
