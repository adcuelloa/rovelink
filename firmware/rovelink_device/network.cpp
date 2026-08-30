// Connectivity layer: WiFi STA mode with DHCP and a light Internet probe.
//
// Rules for this phase:
//   - no fixed IP: always DHCP;
//   - nothing blocks loop(): the state machine only looks at clocks and flags;
//   - the Internet probe (DNS + short TCP) does block, so it runs in a
//     separate task and networkLoop() just fires it and reads the result;
//   - passwords never print.
//
// What this layer does NOT do (later phases): WebSocket, TLS/WSS,
// certificates, MQTT, authentication, captive portal, NVS networking.

#include <Arduino.h>
#include <WiFi.h>

#include "network.h"

// --- Credentials ---
//
// wifi_secrets.h is not versioned (see .gitignore). If missing, compilation
// fails here with a message saying exactly what to do, rather than failing
// later with "WIFI_SSID was not declared".
#if defined(__has_include)
#if !__has_include("wifi_secrets.h")
#error "Missing wifi_secrets.h: copy firmware/wifi_secrets.example.h to firmware/wifi_secrets.h and put your network there."
#endif
#endif

#include "wifi_secrets.h"

#if !defined(WIFI_SSID) || !defined(WIFI_PASSWORD)
#error "wifi_secrets.h must define WIFI_SSID and WIFI_PASSWORD (see wifi_secrets.example.h)."
#endif

static_assert(sizeof(WIFI_SSID) > 1, "WIFI_SSID is empty in wifi_secrets.h.");

// Probe host. Resolved by DNS and a short TCP is opened to it: this
// distinguishes "associated to AP" from "usable Internet". Port 80 on
// purpose, no TLS: we just want to know if the path exists.
static const char *PROBE_HOST = "connectivitycheck.gstatic.com";
static const uint16_t PROBE_PORT = 80;
static const int32_t PROBE_TIMEOUT_MS = 2000;

static const unsigned long CONNECTION_TIMEOUT_MS = 15000;
static const unsigned long BACKOFF_MIN_MS = 1000;
static const unsigned long BACKOFF_MAX_MS = 30000;
static const unsigned long PROBE_PERIOD_OK_MS = 60000;
static const unsigned long PROBE_PERIOD_FAIL_MS = 15000;

// --- State ---

static NetworkState state = NETWORK_OFF;
static bool hadPreviousConnection = false;
static bool resolved = false;

static unsigned long attemptStartMs = 0;
static unsigned long nextAttemptMs = 0;
static unsigned long backoffMs = BACKOFF_MIN_MS;

static unsigned long nextProbeMs = 0;

// --- Internet Probe (separate task) ---

enum ProbeResult
{
  PROBE_OK,
  PROBE_FAIL_DNS,
  PROBE_FAIL_TCP
};

static TaskHandle_t probeTask = nullptr;
static volatile bool probeInProgress = false;
static volatile bool probeDone = false;
static volatile ProbeResult probeResult = PROBE_FAIL_DNS;

// Doesn't print: writing to Serial from two tasks interleaves lines. Leaves
// the verdict in `probeResult` and lets networkLoop() count it.
static void probeBody(void *)
{
  for (;;)
  {
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

    ProbeResult result = PROBE_FAIL_DNS;
    IPAddress target;
    if (WiFi.hostByName(PROBE_HOST, target) == 1)
    {
      WiFiClient client;
      result = client.connect(target, PROBE_PORT, PROBE_TIMEOUT_MS) ? PROBE_OK
                                                                    : PROBE_FAIL_TCP;
      client.stop();
    }

    probeResult = result;
    probeDone = true;
    probeInProgress = false;
  }
}

static void launchProbe()
{
  if (probeInProgress || probeTask == nullptr)
    return;
  probeInProgress = true;
  probeDone = false;
  xTaskNotifyGive(probeTask);
}

// --- State Machine ---

static void printLinkData()
{
  Serial.print("[WIFI] ip=");
  Serial.println(WiFi.localIP());
  Serial.print("[WIFI] gateway=");
  Serial.println(WiFi.gatewayIP());
  Serial.print("[WIFI] dns=");
  Serial.println(WiFi.dnsIP());
  Serial.print("[WIFI] rssi=");
  Serial.print(WiFi.RSSI());
  Serial.println(" dBm");
}

static void attemptConnect()
{
  Serial.print("[WIFI] connecting ssid=");
  Serial.println(WIFI_SSID);

  WiFi.disconnect(false, false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  state = NETWORK_CONNECTING;
  attemptStartMs = millis();
}

// Retry with bounded exponential backoff. Never restarts the board.
static void scheduleRetry()
{
  nextAttemptMs = millis() + backoffMs;
  Serial.print("[WIFI] retry in ");
  Serial.print(backoffMs / 1000);
  Serial.println("s");

  backoffMs *= 2;
  if (backoffMs > BACKOFF_MAX_MS)
    backoffMs = BACKOFF_MAX_MS;
}

static void onLoseLink()
{
  Serial.println("[WIFI] disconnected");
  state = NETWORK_CONNECTING;
  resolved = true;
  probeDone = false;
  backoffMs = BACKOFF_MIN_MS;
  scheduleRetry();
}

static void onGainLink()
{
  Serial.println(hadPreviousConnection ? "[WIFI] reconnected" : "[WIFI] connected");
  hadPreviousConnection = true;
  printLinkData();

  state = NETWORK_CONNECTED;
  backoffMs = BACKOFF_MIN_MS;
  nextProbeMs = millis();
}

static void handleProbe()
{
  if (!probeDone)
    return;
  probeDone = false;

  const ProbeResult result = probeResult;
  const bool wasOnline = state == NETWORK_ONLINE;

  if (result == PROBE_OK)
  {
    if (!wasOnline)
      Serial.println("[NET] online");
    state = NETWORK_ONLINE;
    nextProbeMs = millis() + PROBE_PERIOD_OK_MS;
  }
  else
  {
    if (wasOnline || !resolved)
    {
      Serial.print("[NET] offline (");
      Serial.print(result == PROBE_FAIL_DNS ? "dns" : "tcp");
      Serial.println(")");
    }
    state = NETWORK_CONNECTED;
    nextProbeMs = millis() + PROBE_PERIOD_FAIL_MS;
  }

  resolved = true;
}

void networkSetup()
{
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  // Reconnect is driven by this state machine with its own backoff;
  // the core's auto-retry would compete with it.
  WiFi.setAutoReconnect(false);
  // Without power save, remote control latency gets tens-of-ms spikes from
  // DTIM. The S3 is powered by USB, not battery.
  WiFi.setSleep(false);

  // Copying the example and forgetting to edit it is the easiest mistake
  // here, and the symptom would be an unexplained "connect timeout".
  if (strcmp(WIFI_SSID, "your-ssid") == 0)
    Serial.println("[WIFI] wifi_secrets.h still has the example SSID");

  xTaskCreate(probeBody, "probe_net", 4096, nullptr, 1, &probeTask);

  attemptConnect();
}

void networkLoop()
{
  const bool associated = WiFi.status() == WL_CONNECTED;

  switch (state)
  {
  case NETWORK_OFF:
    break;

  case NETWORK_CONNECTING:
    if (associated)
    {
      onGainLink();
      break;
    }
    // Waiting for backoff after a failure.
    if (nextAttemptMs != 0 && (long)(millis() - nextAttemptMs) >= 0)
    {
      nextAttemptMs = 0;
      attemptConnect();
      break;
    }
    // Connection attempt that exceeded timeout.
    if (nextAttemptMs == 0 && millis() - attemptStartMs > CONNECTION_TIMEOUT_MS)
    {
      Serial.println("[WIFI] connect timeout");
      resolved = true;
      scheduleRetry();
    }
    break;

  case NETWORK_CONNECTED:
  case NETWORK_ONLINE:
    if (!associated)
    {
      onLoseLink();
      break;
    }
    handleProbe();
    if (!probeInProgress && (long)(millis() - nextProbeMs) >= 0)
      launchProbe();
    break;
  }
}

bool networkConnected()
{
  return state == NETWORK_CONNECTED || state == NETWORK_ONLINE;
}

bool networkOnline()
{
  return state == NETWORK_ONLINE;
}

int networkRssi()
{
  return networkConnected() ? WiFi.RSSI() : 0;
}

const char *networkStatusText()
{
  if (state == NETWORK_ONLINE)
    return "online";
  if (state == NETWORK_CONNECTED)
    return "connected";
  return "down";
}

bool networkResolved()
{
  return resolved;
}
