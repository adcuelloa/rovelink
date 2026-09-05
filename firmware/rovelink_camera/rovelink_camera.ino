// RoveLink ESP32-CAM firmware — video publisher for the EXISTING RoveLink
// video protocol (protocol/src/video.ts, video-relay/). A separate binary
// from firmware/rovelink_device on purpose: the control Wemos and the
// camera are two physically separate ESP32 boards (see README.md).
//
//   ESP32-CAM -> WiFi -> outbound WSS/TLS -> RoveLink video relay
//     -> authenticated publisher.register -> publisher.accepted
//     -> [frame header JSON, binary JPEG] per frame
//     -> browser viewer (already implemented: web/src/video/)
//
// This file only orchestrates: camera capture (camera_capture.h), WiFi
// (camera_network.h), and the WSS publisher (video_publisher.h). None of
// them call into each other's internals directly.

#include <Arduino.h>
#include <esp_camera.h>

#include "camera_capture.h"
#include "camera_config.h"
#include "camera_network.h"
#include "video_publisher.h"

static bool cameraReady = false;
unsigned long framesSent = 0;
unsigned long framesDropped = 0;

// One-time boot confirmation, not a continuous light — same behavior as
// the old firmware's `enable_led(true); delay(1000); enable_led(false);`.
static void blinkFlashOnce()
{
  pinMode(CAM_PIN_FLASH_LED, OUTPUT);
  digitalWrite(CAM_PIN_FLASH_LED, HIGH);
  delay(150);
  digitalWrite(CAM_PIN_FLASH_LED, LOW);
}

void setup()
{
  Serial.begin(SERIAL_BAUD);
  Serial.println();
  Serial.println("[BOOT] RoveLink camera firmware");
  Serial.print("[BOARD] AI-Thinker ESP32-CAM (");
  Serial.print(ROBOT_ID);
  Serial.println(")");

  // Status LED: inverted logic (LOW = on), "has voltage" indicator — same
  // as the old firmware, on from boot for the whole session.
  pinMode(CAM_PIN_STATUS_LED, OUTPUT);
  digitalWrite(CAM_PIN_STATUS_LED, LOW);

  cameraReady = cameraCaptureSetup();
  if (!cameraReady)
  {
    // Deliberately does not halt here: WiFi/the video publisher still come
    // up below, so the board stays reachable for remote debugging even
    // with a dead/miswired sensor (see camera_capture.h).
    Serial.println("[CAM] camera init FAILED — no frames will be captured");
  }
  else
  {
    Serial.println("[CAM] camera ready");
    blinkFlashOnce();
  }

  cameraNetworkSetup();
  videoPublisherSetup();

  Serial.println("[READY]");
}

unsigned long lastFrameMs = 0;

static void publishTick()
{
  if (!cameraReady || !videoPublisherReady())
    return;
  if (millis() - lastFrameMs < FRAME_INTERVAL_MS)
    return;
  lastFrameMs = millis();

  camera_fb_t *fb = esp_camera_fb_get();
  if (fb == NULL)
    return; // transient capture hiccup; try again next tick, nothing queued

  if (fb->len > 0 && fb->len <= MAX_JPEG_BYTES && cameraIsJpegFrame(fb->buf, fb->len))
  {
    videoPublisherSendFrame(fb->buf, fb->len, fb->width, fb->height);
    framesSent += 1;
  }
  else
  {
    // Oversized or fails the JPEG structural check: dropped here, before
    // ever reaching the relay (which would otherwise close the connection
    // on an oversized frame — see video_publisher.cpp / video-relay's
    // OVERSIZED_FRAME).
    framesDropped += 1;
  }
  // Always returned promptly, whether or not the frame was sent: with
  // fb_count=2 (PSRAM path) this is what lets the driver keep capturing
  // into the OTHER buffer while this one's blocking WSS send runs.
  esp_camera_fb_return(fb);
}

const unsigned long STATS_INTERVAL_MS = 10000;
unsigned long lastStatsMs = 0;

// Heartbeat-style status line: if this keeps printing with a sane wifi/
// video state, the loop hasn't wedged.
static void printStats()
{
  if (millis() - lastStatsMs < STATS_INTERVAL_MS)
    return;
  lastStatsMs = millis();
  Serial.print("[STATS] wifi=");
  Serial.print(cameraNetworkStatusText());
  Serial.print(" video=");
  Serial.print(videoPublisherStatusText());
  Serial.print(" sent=");
  Serial.print(framesSent);
  Serial.print(" dropped=");
  Serial.println(framesDropped);
}

void loop()
{
  cameraNetworkLoop();
  videoPublisherLoop(); // internally gated on cameraNetworkConnected()

  publishTick();
  printStats();

  // Without this, the loop spins without yielding CPU and the IDLE task
  // can't feed the task watchdog (same reasoning as rovelink_device.ino).
  delay(1);
}
