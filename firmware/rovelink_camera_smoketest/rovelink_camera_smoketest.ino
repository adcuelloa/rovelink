// RoveLink ESP32-CAM HARDWARE SMOKE TEST — Level 2 of three test levels
// (see docs/hardware-demo-runbook.md).
//
// PURPOSE: isolate CAMERA HARDWARE from NETWORKING. If this sketch prints
// healthy frames, the board, the OV2640 ribbon, PSRAM and the power supply
// are all good, and any failure seen later in the full RoveLink publisher
// (firmware/rovelink_camera) is a Wi-Fi/TLS/relay problem, not a hardware
// one. That split is the entire reason this sketch exists: during a short
// university session there is no time to debug "no video" when it could be
// either layer.
//
// DELIBERATELY ABSENT: Wi-Fi, TLS, WebSocket, the RoveLink video protocol,
// any HTTP server, and any secrets file. This sketch has ZERO
// configuration and ZERO external dependencies beyond the esp32 core, so
// it always compiles and always runs — there is nothing to get wrong.
//
// The camera configuration below is a faithful copy of the known-good
// AI-Thinker settings recovered from
// ~/Projects/compiladores/firmware/carro_pinza_wifi/ (CameraWebServerHTTP.ino
// + camera_pins.h, CAMERA_MODEL_AI_THINKER). That project is NOT modified
// and remains usable as the Level 1 fallback.

#include <Arduino.h>
#include <esp_camera.h>

// --- AI-Thinker ESP32-CAM pinout (OV2640) ---
// camera_pins.h, CAMERA_MODEL_AI_THINKER block. Inlined rather than shared
// with firmware/rovelink_camera: Arduino sketches are independent compile
// units, and this sketch's whole value is having no external file it can
// be out of sync with.
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

// AI-Thinker onboard red status LED. Inverted logic: LOW = on.
#define CAM_PIN_STATUS_LED 33

#define SERIAL_BAUD 115200
// "Moderate rate": fast enough to spot intermittent corruption within a few
// seconds, slow enough that the serial log stays readable while watching it
// scroll during the session.
#define CAPTURE_INTERVAL_MS 500

static bool cameraReady = false;
static unsigned long framesOk = 0;
static unsigned long framesBad = 0;

// Same cheap structural check the relay applies (protocol/src/video.ts
// isJpeg): SOI 0xFFD8 at the start, EOI 0xFFD9 at the end. Catches exactly
// the truncated/corrupt frames that a bad ribbon seat or an over-clocked
// XCLK produce, which is what this smoke test is hunting for.
static bool looksLikeJpeg(const uint8_t *buf, size_t len)
{
  if (buf == NULL || len < 4)
    return false;
  return buf[0] == 0xFF && buf[1] == 0xD8 && buf[len - 2] == 0xFF && buf[len - 1] == 0xD9;
}

static bool cameraSetup()
{
  // Zero-init FIRST. An uninitialized camera_config_t leaves garbage in any
  // field not explicitly assigned — including sccb_i2c_port, which the old
  // firmware never assigned and which was traced there to real, intermittent
  // JPEG corruption (sensor/SCCB config, including the JPEG compression
  // table, silently failing to apply). Preserved deliberately.
  camera_config_t config = {};
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
  config.sccb_i2c_port = -1; // -1 = autoselect (see zero-init note above)
  // 20MHz, not 24MHz: 24MHz over-clocks the OV2640 on AI-Thinker boards and
  // produces colour-block/cut-frame corruption. Validated value, unchanged.
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  const bool psram = psramFound();
  if (psram)
  {
    config.frame_size = FRAMESIZE_VGA; // 640x480
    config.jpeg_quality = 12;
    config.fb_count = 2; // double buffer: capture continues while one is held
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;
  }
  else
  {
    // Safe fallback: no PSRAM means no room for VGA or a second buffer.
    // Reaching this branch on a real AI-Thinker board is itself a finding —
    // see the [PSRAM] warning in setup().
    config.frame_size = FRAMESIZE_QQVGA; // 160x120
    config.jpeg_quality = 18;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK)
  {
    Serial.print("[CAM] FAIL esp_camera_init err=0x");
    Serial.println(err, HEX);
    Serial.println("[CAM] check: ribbon cable seated, 5V supply, board is AI-Thinker");
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s != NULL)
  {
    // Sensor is mounted upside down on the AI-Thinker board — same
    // orientation correction as the known-good firmware.
    s->set_vflip(s, 1);
    s->set_hmirror(s, 0);
    Serial.print("[CAM] sensor PID=0x");
    Serial.println(s->id.PID, HEX);
  }
  return true;
}

void setup()
{
  Serial.begin(SERIAL_BAUD);
  delay(200); // let USB-serial settle so the banner is not half-lost
  Serial.println();
  Serial.println("========================================");
  Serial.println("[BOOT] RoveLink ESP32-CAM SMOKE TEST");
  Serial.println("[BOOT] no wifi / no tls / no relay");
  Serial.println("========================================");

  pinMode(CAM_PIN_STATUS_LED, OUTPUT);
  digitalWrite(CAM_PIN_STATUS_LED, LOW); // inverted logic: LOW = on

  // PSRAM is reported BEFORE camera init, because it decides which config
  // branch runs above — if this says false on a board that should have it,
  // that is the finding, and VGA was never attempted.
  const bool psram = psramFound();
  Serial.print("[PSRAM] found=");
  Serial.print(psram ? "true" : "false");
  Serial.print(" size=");
  Serial.print(ESP.getPsramSize());
  Serial.print(" free=");
  Serial.println(ESP.getFreePsram());
  if (!psram)
    Serial.println("[PSRAM] WARNING: no PSRAM — falling back to QQVGA/160x120");

  Serial.print("[HEAP] free=");
  Serial.println(ESP.getFreeHeap());

  cameraReady = cameraSetup();
  Serial.println(cameraReady ? "[CAM] init OK" : "[CAM] init FAILED");
  Serial.println(cameraReady ? "[READY] capturing..." : "[READY] halted (no camera)");
}

static unsigned long lastCaptureMs = 0;

void loop()
{
  if (!cameraReady)
  {
    // Nothing to do but stay alive and obviously-failed on the serial log.
    delay(2000);
    Serial.println("[CAM] init failed at boot — power-cycle after checking the ribbon cable");
    return;
  }

  if (millis() - lastCaptureMs < CAPTURE_INTERVAL_MS)
  {
    delay(1); // yield so the IDLE task can feed the task watchdog
    return;
  }
  lastCaptureMs = millis();

  const unsigned long t0 = millis();
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb == NULL)
  {
    framesBad += 1;
    Serial.println("[FRAME] esp_camera_fb_get() returned NULL");
    return; // nothing acquired, so nothing to return
  }
  const unsigned long captureMs = millis() - t0;

  const bool jpegOk = looksLikeJpeg(fb->buf, fb->len);
  if (jpegOk)
    framesOk += 1;
  else
    framesBad += 1;

  Serial.print("[FRAME] ");
  Serial.print(fb->width);
  Serial.print("x");
  Serial.print(fb->height);
  Serial.print(" bytes=");
  Serial.print(fb->len);
  Serial.print(" captureMs=");
  Serial.print(captureMs);
  Serial.print(" jpeg=");
  Serial.print(jpegOk ? "ok" : "CORRUPT");
  Serial.print(" ok=");
  Serial.print(framesOk);
  Serial.print(" bad=");
  Serial.println(framesBad);

  // EVERY successful esp_camera_fb_get() is matched by exactly one return,
  // on every path above. Leaking even one framebuffer with fb_count=2
  // wedges capture within two frames.
  esp_camera_fb_return(fb);
}
