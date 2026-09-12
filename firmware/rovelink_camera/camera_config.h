#pragma once

// Build configuration for the ESP32-CAM video publisher.
//
// Separate binary from firmware/rovelink_device on purpose: the control
// Wemos and the camera are two physically separate ESP32 boards (Problem
// 7A), and must remain two separate Arduino sketches/compiles — see
// firmware/rovelink_camera/README.md.

// Must match ROBOT_ID in firmware/rovelink_device/config.h: the video relay
// and the control relay both key their Durable Object room by this same id,
// and the browser correlates one robot's control connection with its video
// connection through it (see docs/architecture.md).
#define ROBOT_ID "robot-01"
#define SERIAL_BAUD 115200

// --- AI-Thinker ESP32-CAM pinout (OV2640) ---
// Recovered from ~/Projects/compiladores/firmware/carro_pinza_wifi/camera_pins.h,
// CAMERA_MODEL_AI_THINKER block. This firmware targets only this one board
// (esp32:esp32:esp32cam), so the pins are given directly rather than
// reproducing that file's multi-board #ifdef ladder.
#define CAM_PIN_PWDN 32
#define CAM_PIN_RESET -1
#define CAM_PIN_XCLK 0
#define CAM_PIN_SIOD 26
#define CAM_PIN_SIOC 27
#define CAM_PIN_D7 35
#define CAM_PIN_D6 34
#define CAM_PIN_D5 39
#define CAM_PIN_D4 36
#define CAM_PIN_D3 21
#define CAM_PIN_D2 19
#define CAM_PIN_D1 18
#define CAM_PIN_D0 5
#define CAM_PIN_VSYNC 25
#define CAM_PIN_HREF 23
#define CAM_PIN_PCLK 22

// AI-Thinker flash LED (bright white, next to the lens). Old firmware used
// this only as a brief "camera ready" confirmation blink, never as a
// continuous light — kept the same way here (see rovelink_camera.ino).
#define CAM_PIN_FLASH_LED 4
// AI-Thinker onboard red status LED. Inverted logic: LOW = on, HIGH = off.
#define CAM_PIN_STATUS_LED 33

// 20MHz, not 24MHz: the old firmware's own comment documents that 24MHz
// over-clocks the OV2640 on this board and produces intermittent JPEG
// corruption (color-block artifacts, cut frames). Verified against source,
// not changed here — see AUDIT in README.md.
#define CAM_XCLK_FREQ_HZ 20000000

// --- Resolution / JPEG settings ---
// Reused as-is from the old firmware's validated PSRAM/no-PSRAM split
// (Problem 7A brief: low latency over image quality for the first remote
// test). CAMERA_GRAB_LATEST (PSRAM path) means esp_camera_fb_get() always
// returns the newest completed frame, discarding any older ones still in
// the driver's own ring buffer — this is the camera driver's OWN
// latest-frame-wins policy, on top of which the publisher adds its own
// (see video_publisher.cpp).
#define CAM_PSRAM_FRAMESIZE FRAMESIZE_QVGA // 320x240
#define CAM_PSRAM_JPEG_QUALITY 20
#define CAM_PSRAM_FB_COUNT 2

#define CAM_NO_PSRAM_FRAMESIZE FRAMESIZE_QQVGA // 160x120
#define CAM_NO_PSRAM_JPEG_QUALITY 18
#define CAM_NO_PSRAM_FB_COUNT 1

// Sensor mounted upside down on the AI-Thinker board (old firmware's own
// finding) — corrected the same way here.
#define CAM_VFLIP 1
#define CAM_HMIRROR 0

// --- Publisher cadence ---
// Matches the default already used by the reference Node publisher
// (video-relay/src/dev/publisher-cli.ts's FPS env var default) and sits
// inside the ~15-30 KB/frame VGA/quality-12 estimate MAX_JPEG_BYTES was
// sized against (see protocol/src/video.ts). Low latency over image
// quality for this first remote test — do not raise resolution or FPS
// without new evidence from a live test. la
#define TARGET_FPS 15
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS)

// --- Video wire protocol (protocol/src/video.ts) ---
// Hardcoded here the same way firmware/rovelink_device/transport.cpp
// hardcodes PROTOCOL_VERSION/CONTROL_SESSION_ID_LEN for the control
// protocol: this is a separate C++ binary that cannot import the TS
// source, so these constants are kept in sync by hand and must match
// protocol/src/video.ts exactly.
#define VIDEO_PROTOCOL_VERSION 1
// streamSessionId is a relay-minted UUIDv4 (36 chars) + terminator, with
// headroom — same sizing rationale as CONTROL_SESSION_ID_LEN.
#define VIDEO_SESSION_ID_LEN 40
// Must match MAX_JPEG_BYTES in protocol/src/video.ts exactly: an oversized
// declared byteLength gets the publisher's connection closed by the relay
// (OVERSIZED_FRAME), so this is checked BEFORE sending, not left for the
// relay to enforce.
#define MAX_JPEG_BYTES (256 * 1024)

// Firmware version, reported nowhere on the wire yet (the video protocol
// carries no firmware-version field) — kept for parity with
// rovelink_device's FIRMWARE_VERSION and future debugging.
#define FIRMWARE_VERSION "0.1.0"
