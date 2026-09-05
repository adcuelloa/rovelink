#include "camera_capture.h"

#include <Arduino.h>
#include <esp_camera.h>

#include "camera_config.h"

bool cameraCaptureSetup()
{
  camera_config_t config = {}; // zero-init first: an uninitialized sccb_i2c_port
                                // caused intermittent JPEG corruption in the old
                                // firmware — see the fix note below and README.md.
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = CAM_PIN_D0;
  config.pin_d1 = CAM_PIN_D1;
  config.pin_d2 = CAM_PIN_D2;
  config.pin_d3 = CAM_PIN_D3;
  config.pin_d4 = CAM_PIN_D4;
  config.pin_d5 = CAM_PIN_D5;
  config.pin_d6 = CAM_PIN_D6;
  config.pin_d7 = CAM_PIN_D7;
  config.pin_xclk = CAM_PIN_XCLK;
  config.pin_pclk = CAM_PIN_PCLK;
  config.pin_vsync = CAM_PIN_VSYNC;
  config.pin_href = CAM_PIN_HREF;
  config.pin_sccb_sda = CAM_PIN_SIOD;
  config.pin_sccb_scl = CAM_PIN_SIOC;
  config.pin_pwdn = CAM_PIN_PWDN;
  config.pin_reset = CAM_PIN_RESET;
  // -1 = autoselect the I2C port. The old firmware left this field
  // untouched (garbage from an uninitialized struct) and traced a real,
  // intermittent JPEG-corruption bug to it — sensor/SCCB config
  // (including the JPEG compression table) could silently fail to apply
  // when this held garbage. Fixed at the source: see camera_config_t
  // zero-init above, and this explicit -1.
  config.sccb_i2c_port = -1;
  config.xclk_freq_hz = CAM_XCLK_FREQ_HZ;
  config.pixel_format = PIXFORMAT_JPEG;

  if (psramFound())
  {
    config.frame_size = CAM_PSRAM_FRAMESIZE;
    config.jpeg_quality = CAM_PSRAM_JPEG_QUALITY;
    config.fb_count = CAM_PSRAM_FB_COUNT;
    config.fb_location = CAMERA_FB_IN_PSRAM;
    // Always returns the newest completed frame, discarding older ones
    // still in the driver's ring buffer — the camera driver's OWN
    // latest-frame-wins policy, on top of which video_publisher.cpp adds
    // its own (dropping a frame outright if the WSS send doesn't keep up).
    config.grab_mode = CAMERA_GRAB_LATEST;
  }
  else
  {
    // No PSRAM: no memory for large frames or a second buffer — drop to
    // the minimum (same fallback the old firmware used).
    config.frame_size = CAM_NO_PSRAM_FRAMESIZE;
    config.jpeg_quality = CAM_NO_PSRAM_JPEG_QUALITY;
    config.fb_count = CAM_NO_PSRAM_FB_COUNT;
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK)
  {
    Serial.print("[CAM] esp_camera_init failed: 0x");
    Serial.println(err, HEX);
    return false;
  }

  // Sensor is mounted upside down on the AI-Thinker board (old firmware's
  // own finding) — corrected the same way here.
  sensor_t *s = esp_camera_sensor_get();
  if (s != NULL)
  {
    s->set_vflip(s, CAM_VFLIP);
    s->set_hmirror(s, CAM_HMIRROR);
  }
  return true;
}

bool cameraIsJpegFrame(const uint8_t *buf, size_t len)
{
  if (buf == NULL || len < 4)
    return false;
  return buf[0] == 0xFF && buf[1] == 0xD8 && buf[len - 2] == 0xFF && buf[len - 1] == 0xD9;
}
