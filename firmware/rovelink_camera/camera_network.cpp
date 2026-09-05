#include "camera_network.h"

#include <Arduino.h>
#include <WiFi.h>

#include "camera_config.h"

// wifi_secrets.h is not versioned (see .gitignore). Same pattern as
// firmware/rovelink_device/network.cpp: fail compilation here with a clear
// message rather than a mysterious "WIFI_SSID was not declared" later.
#if defined(__has_include)
#if !__has_include("wifi_secrets.h")
#error "Missing wifi_secrets.h: copy firmware/rovelink_camera/wifi_secrets.example.h to firmware/rovelink_camera/wifi_secrets.h and put your network there."
#endif
#endif

#include "wifi_secrets.h"

#if !defined(WIFI_SSID) || !defined(WIFI_PASSWORD)
#error "wifi_secrets.h must define WIFI_SSID and WIFI_PASSWORD (see wifi_secrets.example.h)."
#endif

static const unsigned long CONNECTION_TIMEOUT_MS = 15000;
static const unsigned long BACKOFF_MIN_MS = 1000;
static const unsigned long BACKOFF_MAX_MS = 30000;

enum NetworkState
{
  NET_CONNECTING,
  NET_CONNECTED,
};

static NetworkState state = NET_CONNECTING;
static bool hadPreviousConnection = false;
static unsigned long attemptStartMs = 0;
static unsigned long nextAttemptMs = 0;
static unsigned long backoffMs = BACKOFF_MIN_MS;

static void attemptConnect()
{
  Serial.print("[WIFI] connecting ssid=");
  Serial.println(WIFI_SSID);
  WiFi.disconnect(false, false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  state = NET_CONNECTING;
  attemptStartMs = millis();
}

static void scheduleRetry()
{
  nextAttemptMs = millis() + backoffMs;
  Serial.print("[WIFI] retry in ");
  Serial.print(backoffMs / 1000);
  Serial.println("s");
  backoffMs = min(backoffMs * 2, BACKOFF_MAX_MS);
}

void cameraNetworkSetup()
{
  WiFi.mode(WIFI_STA);
  // This state machine owns retry/backoff; the core's own auto-retry would
  // compete with it (same reasoning as network.cpp).
  WiFi.setAutoReconnect(false);
  // Critical for latency (old firmware's own finding, verified in
  // ~/Projects/compiladores/firmware/carro_pinza_wifi/CameraWebServerHTTP.ino):
  // WiFi modem-sleep adds tens of ms of delay per packet.
  WiFi.setSleep(false);

  if (strcmp(WIFI_SSID, "your-ssid") == 0)
    Serial.println("[WIFI] wifi_secrets.h still has the example SSID");

  attemptConnect();
}

void cameraNetworkLoop()
{
  const bool associated = WiFi.status() == WL_CONNECTED;

  if (associated)
  {
    if (state != NET_CONNECTED)
    {
      Serial.println(hadPreviousConnection ? "[WIFI] reconnected" : "[WIFI] connected");
      Serial.print("[WIFI] ip=");
      Serial.println(WiFi.localIP());
      hadPreviousConnection = true;
      state = NET_CONNECTED;
      backoffMs = BACKOFF_MIN_MS;
    }
    return;
  }

  if (state == NET_CONNECTED)
  {
    Serial.println("[WIFI] disconnected");
    scheduleRetry();
    state = NET_CONNECTING;
    return;
  }

  // Still NET_CONNECTING: either waiting out a scheduled backoff, or
  // waiting to see if the in-flight association attempt succeeds/times out.
  if (nextAttemptMs != 0 && (long)(millis() - nextAttemptMs) >= 0)
  {
    nextAttemptMs = 0;
    attemptConnect();
    return;
  }
  if (nextAttemptMs == 0 && millis() - attemptStartMs > CONNECTION_TIMEOUT_MS)
  {
    Serial.println("[WIFI] connect timeout");
    scheduleRetry();
  }
}

bool cameraNetworkConnected()
{
  return state == NET_CONNECTED;
}

const char *cameraNetworkStatusText()
{
  if (state == NET_CONNECTED)
    return "connected";
  return nextAttemptMs != 0 ? "down" : "connecting";
}
