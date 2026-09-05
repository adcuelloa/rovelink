#pragma once

#include <stddef.h>
#include <stdint.h>

// Initializes the OV2640 via esp_camera_init(), using the PSRAM or
// no-PSRAM settings from camera_config.h depending on psramFound(). Unlike
// the old firmware's infinite blocking `do {} while (err != ESP_OK)` retry
// loop at boot, this makes ONE attempt and returns whether it succeeded —
// a real sensor init failure here is a wiring/hardware fault, not something
// that resolves itself on retry, and blocking setup() indefinitely would
// leave WiFi/the video publisher unreachable too, which only makes remote
// debugging harder. See README.md.
bool cameraCaptureSetup();

// True if `len` bytes at `buf` look like a complete JPEG (starts with the
// SOI marker 0xFFD8, ends with EOI 0xFFD9) — the same cheap structural
// check protocol/src/video.ts's isJpeg() / video-relay's room.ts apply on
// the relay side. Not a full decode.
bool cameraIsJpegFrame(const uint8_t *buf, size_t len);
