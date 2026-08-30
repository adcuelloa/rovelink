// Transport layer: WebSocketsClient (Links2004/arduinoWebSockets) as WSS
// client to Cloudflare relay. See transport.h for the contract with control
// logic.
//
// Rules for this layer:
//   - the ESP32 never accepts incoming connections: only opens one outgoing to
//     RELAY_HOST/RELAY_PORT (relay_config.h);
//   - nothing blocks transportLoop(): same discipline as network.cpp;
//   - WSS is only attempted when networkOnline() is true. If network drops,
//     disconnect and stop trying until it returns;
//   - reconnection with bounded exponential backoff, never restarts ESP32;
//   - incoming messages are validated (version, structure) before delivery via
//     callback: this layer doesn't trust the other end.

#include "transport.h"

#include "config.h"
#include "network.h"
#include "relay_config.h"
#include "cloudflare_ca_certs.h"

#if defined(__has_include)
#if __has_include("device_secrets.h")
#include "device_secrets.h"
#endif
#endif
#ifndef DEVICE_TOKEN
#define DEVICE_TOKEN ""
#endif

#include <ArduinoJson.h>
#include <WebSocketsClient.h>

// Must match PROTOCOL_VERSION in protocol/src/protocol.ts.
static const int PROTOCOL_VERSION = 1;

static const unsigned long BACKOFF_MIN_MS = 1000;
static const unsigned long BACKOFF_MAX_MS = 30000;

static WebSocketsClient wsClient;

static TransportControlCb cbControl = nullptr;
static TransportEmergencyCb cbEmergencyStop = nullptr;

static bool wsStarted = false;     // begin()/beginSslWithCA() already called this network session
static bool connected = false;     // WStype_CONNECTED seen this session
static bool registered = false;    // device.register already sent on this connection
static bool hadPriorConnection = false;
static unsigned long backoffMs = BACKOFF_MIN_MS;

static char gripperFromText(const char *text)
{
  if (text == nullptr)
    return 'i';
  if (strcmp(text, "open") == 0)
    return 'o';
  if (strcmp(text, "close") == 0)
    return 'c';
  return 'i';
}

// Minimal shape of a valid ControlFrame (see isControlFrame in
// protocol/src/protocol.ts). Axes are not clamped here: the .ino does it
// in applyControlFrame(), which is the sole gateway to the control model.
static bool isControlValid(JsonVariantConst m)
{
  return m["seq"].is<long>() && m["throttle"].is<float>() && m["steering"].is<float>() &&
         m["gripper"].is<const char *>() && m["armed"].is<bool>();
}

static void sendRegistration()
{
  Serial.print("[WSS] registering robot=");
  Serial.println(ROBOT_ID);

  JsonDocument doc;
  doc["v"] = PROTOCOL_VERSION;
  doc["type"] = "device.register";
  doc["robotId"] = ROBOT_ID;
  doc["firmware"] = FIRMWARE_VERSION;
  if (strlen(DEVICE_TOKEN) > 0)
    doc["token"] = DEVICE_TOKEN;

  String output;
  serializeJson(doc, output);
  wsClient.sendTXT(output);

  registered = true;
  Serial.println("[WSS] registered");
}

static void onConnect()
{
  connected = true;
  Serial.println(hadPriorConnection ? "[WSS] reconnected" : "[WSS] connected");
  hadPriorConnection = true;
  backoffMs = BACKOFF_MIN_MS;
  wsClient.setReconnectInterval(backoffMs);
  sendRegistration();
}

static void handleText(uint8_t *payload, size_t length)
{
  JsonDocument doc;
  if (deserializeJson(doc, payload, length) != DeserializationError::Ok)
    return;

  JsonVariantConst m = doc.as<JsonVariantConst>();
  if (!m["v"].is<int>() || m["v"].as<int>() != PROTOCOL_VERSION)
    return;
  if (!m["type"].is<const char *>())
    return;

  const char *type = m["type"];

  if (strcmp(type, "control") == 0)
  {
    if (!isControlValid(m))
      return;

    ControlFrameIn frame;
    frame.seq = m["seq"].as<long>();
    frame.throttle = m["throttle"].as<float>();
    frame.steering = m["steering"].as<float>();
    frame.gripper = gripperFromText(m["gripper"].as<const char *>());
    frame.armed = m["armed"].as<bool>();

    Serial.print("[RX] control seq=");
    Serial.println(frame.seq);

    if (cbControl != nullptr)
      cbControl(frame);
    return;
  }

  if (strcmp(type, "emergency-stop") == 0)
  {
    Serial.println("[RX] emergency-stop");
    if (cbEmergencyStop != nullptr)
      cbEmergencyStop();
    return;
  }

  // "room", "pong", other registrations: not for this device, ignore.
}

static void onWsEvent(WStype_t type, uint8_t *payload, size_t length)
{
  switch (type)
  {
  case WStype_CONNECTED:
    onConnect();
    break;

  case WStype_TEXT:
    handleText(payload, length);
    break;

  case WStype_DISCONNECTED:
    Serial.print("[WSS] disconnected");

    if (payload != nullptr && length > 0)
    {
      Serial.print(" reason=");
      Serial.write(payload, length);
    }

    Serial.println();

    connected = false;
    registered = false;
    break;

  case WStype_ERROR:
    Serial.print("[WSS] error");

    if (payload != nullptr && length > 0)
    {
      Serial.print(" reason=");
      Serial.write(payload, length);
    }

    Serial.println();
    break;

  default:
    break;
  }
}

static void startConnection()
{
  Serial.print("[WSS] connecting host=");
  Serial.print(RELAY_HOST);
  Serial.print(":");
  Serial.println(RELAY_PORT);

#if RELAY_USE_TLS
#if RELAY_TLS_INSECURE_DEV_ONLY
  Serial.println(
      "[WSS] WARNING: RELAY_TLS_INSECURE_DEV_ONLY=1, certificate not validated. "
      "For testing only: never leave this enabled.");
  wsClient.beginSSL(RELAY_HOST, RELAY_PORT, RELAY_PATH_DEVICE, (const uint8_t *)nullptr, "");
#else
  wsClient.beginSslWithCA(RELAY_HOST, RELAY_PORT, RELAY_PATH_DEVICE, CLOUDFLARE_CA_CERTS, "");
#endif
#else
  wsClient.begin(RELAY_HOST, RELAY_PORT, RELAY_PATH_DEVICE, "");
#endif
}

static void scheduleRetry()
{
  Serial.print("[WSS] retry in ");
  Serial.print(backoffMs / 1000);
  Serial.println("s");
  wsClient.setReconnectInterval(backoffMs);
  backoffMs = min(backoffMs * 2, BACKOFF_MAX_MS);
}

void transportOnControl(TransportControlCb cb)
{
  cbControl = cb;
}

void transportOnEmergencyStop(TransportEmergencyCb cb)
{
  cbEmergencyStop = cb;
}

void transportSetup()
{
  wsClient.onEvent(onWsEvent);
}

void transportLoop()
{
  const bool online = networkOnline();

  if (!online)
  {
    if (wsStarted)
    {
      wsClient.disconnect();
      wsStarted = false;
      connected = false;
      registered = false;
    }
    return;
  }

  if (!wsStarted)
  {
    startConnection();
    wsStarted = true;
    return; // first attempt happens on the next loop() iteration
  }

  wsClient.loop();

  const bool connectedNow = wsClient.isConnected();
  if (connected && !connectedNow)
  {
    Serial.println("[WSS] disconnected");
    connected = false;
    registered = false;
    scheduleRetry();
  }
}

bool transportConnected()
{
  return connected && registered;
}

const char *transportStatusText()
{
  if (transportConnected())
    return "online";
  if (wsStarted)
    return "connecting";
  return "down";
}

void transportSendTelemetry(int rssi, bool armed, float throttle, float steering, long ackSeq)
{
  if (!transportConnected())
    return;

  JsonDocument doc;
  doc["v"] = PROTOCOL_VERSION;
  doc["type"] = "telemetry";
  doc["sentAt"] = millis();
  doc["ackSeq"] = ackSeq;
  doc["rssi"] = rssi;
  doc["throttle"] = throttle;
  doc["steering"] = steering;
  doc["armed"] = armed;

  String output;
  serializeJson(doc, output);
  wsClient.sendTXT(output);
}
