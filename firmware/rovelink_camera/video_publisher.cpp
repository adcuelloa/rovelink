#include "video_publisher.h"

#include "camera_config.h"
#include "camera_network.h"
#include "cloudflare_ca_certs.h"
#include "video_relay_config.h"

#if defined(__has_include)
#if __has_include("video_secrets.h")
#include "video_secrets.h"
#endif
#endif
#ifndef VIDEO_PUBLISHER_SECRET
#define VIDEO_PUBLISHER_SECRET ""
#endif

#include <ArduinoJson.h>
#include <WebSocketsClient.h>

static const unsigned long BACKOFF_MIN_MS = 1000;
static const unsigned long BACKOFF_MAX_MS = 30000;

static WebSocketsClient wsClient;

static bool wsStarted = false; // begin()/beginSslWithCA() already called this network session
static bool connected = false; // WStype_CONNECTED seen this session
static bool accepted = false;  // publisher.accepted received on this connection
static unsigned long backoffMs = BACKOFF_MIN_MS;

static char streamSessionId[VIDEO_SESSION_ID_LEN] = "";
static long seq = 0;

// --- Diagnostics only (video_publisher.h). Never influence send/reconnect
// behaviour; exist so the [STATS] line can distinguish "connected but not
// authenticated", "authenticated but sending nothing", and "sending but the
// transport keeps failing" — three very different faults that otherwise
// look identical from outside.
static size_t lastFrameBytes = 0;
static unsigned long sendFailures = 0;
static const char *lastCloseReason = "none";

static void scheduleRetry()
{
  Serial.print("[VIDEO] retry in ");
  Serial.print(backoffMs / 1000);
  Serial.println("s");
  wsClient.setReconnectInterval(backoffMs);
  backoffMs = min(backoffMs * 2, BACKOFF_MAX_MS);
}

static void sendRegister()
{
  Serial.println("[VIDEO] registering publisher");
  JsonDocument doc;
  doc["v"] = VIDEO_PROTOCOL_VERSION;
  doc["type"] = "publisher.register";
  doc["robotId"] = ROBOT_ID;
  doc["token"] = VIDEO_PUBLISHER_SECRET;
  String output;
  serializeJson(doc, output);
  wsClient.sendTXT(output);
}

static void handleText(uint8_t *payload, size_t length)
{
  JsonDocument doc;
  if (deserializeJson(doc, payload, length) != DeserializationError::Ok)
  {
    Serial.println("[VIDEO] malformed JSON");
    return;
  }

  JsonVariantConst m = doc.as<JsonVariantConst>();
  if (!m["v"].is<int>() || m["v"].as<int>() != VIDEO_PROTOCOL_VERSION)
    return;
  if (!m["type"].is<const char *>())
    return;

  const char *type = m["type"];
  Serial.print("[VIDEO][RX] type=");
  Serial.println(type);

  if (strcmp(type, "publisher.accepted") == 0)
  {
    if (m["streamSessionId"].is<const char *>())
      strlcpy(streamSessionId, m["streamSessionId"].as<const char *>(), sizeof(streamSessionId));
    else
      streamSessionId[0] = '\0';
    // A new streamSessionId always restarts seq at 0 (first sent frame is
    // seq=1) — see protocol/src/video.ts: "a new session may safely reuse
    // seq=1". Applies identically on first connect and on every
    // reconnect/re-register.
    seq = 0;
    accepted = true;
    Serial.print("[VIDEO] accepted streamSessionId=");
    Serial.println(streamSessionId);
    return;
  }

  if (strcmp(type, "publisher.rejected") == 0)
  {
    // The relay closes the socket itself right after this (AUTH_FAILED);
    // WStype_DISCONNECTED will follow and drive the normal reconnect path.
    // Nothing to do here except stop treating this connection as accepted.
    Serial.print("[VIDEO] rejected reason=");
    Serial.println(m["reason"].is<const char *>() ? m["reason"].as<const char *>() : "?");
    accepted = false;
    // Records WHY, so the reconnect that follows is attributable. The
    // reason string itself is relay-supplied and carries no credential.
    lastCloseReason = "rejected";
    return;
  }

  // "stream" is a viewer-facing message; a publisher receiving it (or
  // anything else unrecognized) has nothing to do with it.
}

static void onWsEvent(WStype_t type, uint8_t *payload, size_t length)
{
  switch (type)
  {
  case WStype_CONNECTED:
    connected = true;
    backoffMs = BACKOFF_MIN_MS;
    wsClient.setReconnectInterval(backoffMs);
    Serial.print("[VIDEO] connected (previous close: ");
    Serial.print(lastCloseReason);
    Serial.println(")");
    sendRegister();
    break;

  case WStype_TEXT:
    handleText(payload, length);
    break;

  case WStype_DISCONNECTED:
    // "rejected" is preserved if publisher.rejected already explained this
    // disconnect; otherwise the socket died on its own.
    if (strcmp(lastCloseReason, "rejected") != 0)
      lastCloseReason = "socket-closed";
    Serial.print("[VIDEO] disconnected reason=");
    Serial.println(lastCloseReason);
    connected = false;
    accepted = false;
    streamSessionId[0] = '\0';
    // Covers WiFi loss, WSS loss, and a takeover by another publisher
    // (PUBLISHER_REPLACED) identically: on the next successful connection,
    // sendRegister() runs again from WStype_CONNECTED above, and a fresh
    // streamSessionId/seq is adopted from whatever publisher.accepted
    // comes back — never a reboot, just the library's own reconnect.
    scheduleRetry();
    break;

  case WStype_ERROR:
    Serial.print("[VIDEO] error");
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

void videoPublisherSetup()
{
  wsClient.onEvent(onWsEvent);
  // Does not connect yet: videoPublisherLoop() only starts the WSS
  // connection once cameraNetworkConnected() is true.
}

void videoPublisherLoop()
{
  const bool online = cameraNetworkConnected();

  if (!online)
  {
    if (wsStarted)
    {
      // Deliberate teardown because the NETWORK went away, not because the
      // relay misbehaved: recorded as its own reason, and the backoff is
      // reset so the first attempt after Wi-Fi returns is immediate rather
      // than inheriting a long relay-side backoff that no longer applies.
      lastCloseReason = "wifi-lost";
      wsClient.disconnect();
      wsStarted = false;
      connected = false;
      accepted = false;
      streamSessionId[0] = '\0';
      backoffMs = BACKOFF_MIN_MS;
    }
    return;
  }

  if (!wsStarted)
  {
    Serial.print("[VIDEO] connecting host=");
    Serial.print(VIDEO_RELAY_HOST);
    Serial.print(":");
    Serial.println(VIDEO_RELAY_PORT);
#if VIDEO_RELAY_USE_TLS
    // Same shared root-CA trust material as the control firmware (see
    // cloudflare_ca_certs.h's header comment) — validation is by root CA,
    // not by leaf/hostname, so it works for the video relay's Cloudflare
    // hostname too. Never insecure: no setInsecure()/fingerprint escape
    // hatch, matching README.md's TLS section.
    wsClient.beginSslWithCA(VIDEO_RELAY_HOST, VIDEO_RELAY_PORT, VIDEO_RELAY_PATH_PUBLISHER,
                            CLOUDFLARE_CA_CERTS, "");
#else
    wsClient.begin(VIDEO_RELAY_HOST, VIDEO_RELAY_PORT, VIDEO_RELAY_PATH_PUBLISHER, "");
#endif
    wsStarted = true;
    return; // first attempt happens on the next loop() iteration
  }

  wsClient.loop();
}

bool videoPublisherReady()
{
  return connected && accepted;
}

void videoPublisherSendFrame(const uint8_t *jpeg, size_t len, int width, int height)
{
  if (!videoPublisherReady())
    return;
  if (jpeg == nullptr || len == 0 || len > MAX_JPEG_BYTES)
    return;

  // Incremented on every attempt, whether or not the sends below actually
  // succeed: seq only needs to be monotonically increasing within one
  // streamSessionId (protocol/src/video.ts), not contiguous, so a dropped
  // attempt safely just leaves a gap rather than risking two frames ever
  // sharing one seq.
  seq += 1;
  lastFrameBytes = len;

  JsonDocument doc;
  doc["v"] = VIDEO_PROTOCOL_VERSION;
  doc["type"] = "frame";
  doc["streamSessionId"] = streamSessionId;
  doc["seq"] = seq;
  // Publisher's own clock, millis()-derived — exactly what
  // protocol/src/video.ts's VideoFrameHeader.capturedAtMs doc comment
  // anticipates for real firmware (not epoch time, not synchronized with
  // the relay/viewer; only meaningful as a same-clock-domain latency
  // estimate on this one device).
  doc["capturedAtMs"] = (int64_t)millis();
  doc["width"] = width;
  doc["height"] = height;
  doc["byteLength"] = (uint32_t)len;

  String header;
  serializeJson(doc, header);

  // sendTXT()/sendBIN() are BLOCKING calls in this library (bounded by its
  // own WEBSOCKETS_TCP_TIMEOUT, 5s) — there is no async completion
  // callback to build a "sending" flag around, unlike the Node `ws`
  // package used by video-relay/src/dev/publisher-cli.ts. That is fine
  // for this policy: capture-latest -> one blocking send attempt -> return
  // the framebuffer -> next tick captures whatever is newest by then. No
  // frame is ever queued or retried — see README.md's backpressure
  // section.
  if (!wsClient.sendTXT(header))
  {
    // Header failed: never send an orphan binary with no preceding header
    // for it. Counted, not retried — the next tick sends a NEWER frame.
    sendFailures += 1;
    return;
  }

  wsClient.sendBIN(const_cast<uint8_t *>(jpeg), len);
  // sendBIN()'s own result is not otherwise acted on: if it fails/partial-
  // sends, the relay's pendingHeader for THIS header is simply left
  // unmatched and is harmlessly overwritten by the next frame's header on
  // the next tick (video-relay/src/room.ts #handleFrameHeader always
  // overwrites pendingHeader) — never retried here.
}

const char *videoPublisherSessionId()
{
  return streamSessionId;
}

long videoPublisherSeq()
{
  return seq;
}

size_t videoPublisherLastFrameBytes()
{
  return lastFrameBytes;
}

unsigned long videoPublisherSendFailures()
{
  return sendFailures;
}

const char *videoPublisherLastCloseReason()
{
  return lastCloseReason;
}

const char *videoPublisherStatusText()
{
  if (accepted)
    return "publishing";
  if (connected)
    return "registering";
  return "down";
}
