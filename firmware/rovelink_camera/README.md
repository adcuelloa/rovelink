# ESP32-CAM Firmware (video publisher)

AI-Thinker ESP32-CAM firmware that publishes real JPEG frames into the
**existing** RoveLink video protocol (`protocol/src/video.ts`,
`video-relay/`, `web/src/video/`). A separate binary and a separate
physical board from `firmware/rovelink_device` (the control Wemos) — see
`docs/architecture.md`'s Video Relay section and Problem 7A's own finding
that control and video already run over independent connections because
robot and camera are different boards.

```
ESP32-CAM
  -> WiFi (DHCP, STA)
  -> outbound WSS/TLS
  -> RoveLink video relay (video-relay/)
  -> authenticated publisher.register
  -> [frame header JSON, binary JPEG] per frame
  -> browser viewer (already implemented, unchanged by this firmware)
```

## Files

| File                    | Responsibility                                    |
| ------------------------ | -------------------------------------------------- |
| `rovelink_camera.ino`     | setup()/loop(), orchestrates the other three below |
| `camera_config.h`         | Board pins, resolution/JPEG/PSRAM settings, FPS     |
| `camera_capture.cpp/.h`   | `esp_camera_init()`, JPEG structural check          |
| `camera_network.cpp/.h`   | WiFi STA + DHCP, reconnect with backoff             |
| `video_publisher.cpp/.h`  | WSS publisher state machine + frame send            |
| `video_relay_config.h`    | LOCAL / CLOUDFLARE relay profile                    |
| `cloudflare_ca_certs.h`   | Shared root-CA trust material (see its own header)  |
| `wifi_secrets.h`          | Local-only, gitignored (own copy — see below)       |
| `video_secrets.h`         | Local-only, gitignored (`VIDEO_PUBLISHER_SECRET`)   |

## Old firmware audit (source of truth)

Recovered directly from `~/Projects/compiladores/firmware/carro_pinza_wifi/`
(`CameraWebServerHTTP.ino`, `board_config.h`, `camera_pins.h`,
`app_httpd.cpp`) — reference only, never modified:

- Board: `CAMERA_MODEL_AI_THINKER` (has PSRAM)
- OV2640 @ XCLK 20MHz (24MHz caused intermittent JPEG corruption on this
  hardware — a documented, verified finding, not a guess)
- `PIXFORMAT_JPEG`; with PSRAM: VGA 640x480, quality 12, `fb_count=2`,
  `CAMERA_FB_IN_PSRAM`, `CAMERA_GRAB_LATEST`; without: QQVGA 160x120,
  quality 18, `fb_count=1`, `CAMERA_FB_IN_DRAM`, `CAMERA_GRAB_WHEN_EMPTY`
- `sccb_i2c_port = -1` (autoselect) — fixes a real, sourced bug: an
  uninitialized `camera_config_t` left this field garbage, which
  intermittently broke sensor/JPEG-table configuration
- Vertical flip applied (sensor mounted upside down on this board)
- `WiFi.setSleep(false)` — the old firmware's own comment calls this
  "CRITICAL FOR LATENCY" (modem-sleep adds tens of ms per packet)
- Old firmware also set max TX power and 240MHz CPU; this firmware keeps
  240MHz (board default) but does not set TX power explicitly — no
  latency issue observed yet to justify it; revisit if range/reliability
  becomes a problem during physical testing

**Deliberately NOT preserved**: the old static IP (`192.168.0.51`) and the
local `esp_http_server` MJPEG-on-port-80 architecture. This firmware makes
an outbound WSS connection instead — no HTTP server, no fixed IP, and the
browser never needs to know the camera's LAN address (see Network
Architecture below). This is a deliberate redesign of the transport, not a
preservation of the old one, per the task that produced this firmware.

## Network Architecture

DHCP only, `WiFi.setSleep(false)` kept. The camera may share the same WiFi
network as the Wemos but does **not** need a stable LAN IP: RoveLink's
video relay is reached the same way the control relay is — an outbound
WSS connection, the relay/browser never dial into the camera.

## Publisher Protocol

Implements `protocol/src/video.ts` exactly, no new message types invented:

1. WSS connects to `/video/<ROBOT_ID>/publisher` (`video-relay/src/route.ts`).
2. Sends `publisher.register { v, robotId, token }` immediately on connect
   (`token` = `VIDEO_PUBLISHER_SECRET`).
3. Waits for `publisher.accepted { streamSessionId }` before sending any
   frame — a `publisher.rejected` (auth failure) is logged and the relay
   closes the socket itself; the normal reconnect path picks it up.
4. Per frame: `esp_camera_fb_get()` → verify JPEG SOI/EOI markers → verify
   `byteLength <= MAX_JPEG_BYTES` (256 KiB, must match
   `protocol/src/video.ts`) → send `frame` header (JSON text) → send JPEG
   (binary) → `esp_camera_fb_return()`.
5. `seq` resets to 0 on every new `streamSessionId` (first sent frame is
   seq=1) — including on reconnect and on takeover by a fresh
   registration, matching the protocol's own "a new session may safely
   reuse seq=1" semantics.

## TLS / Trust

Reuses the exact same root-CA bundle as `firmware/rovelink_device`
(`cloudflare_ca_certs.h` — literal copy, see its own header comment for
why it's a copy and not a shared `#include`). Validation is by root CA,
not leaf/hostname, so it works for the video relay's Cloudflare hostname
too, whatever that ends up being once deployed. No insecure-TLS escape
hatch for the Cloudflare profile — matches `firmware/rovelink_device`'s
own TLS policy.

## Backpressure / Low Latency

`WebSocketsClient::sendTXT()`/`sendBIN()` are **blocking calls** in this
library version (Links2004/arduinoWebSockets 2.7.2) — bounded by the
library's own 5s TCP timeout, no async completion callback like the `ws`
package used in `video-relay/src/dev/publisher-cli.ts`. Given that, the
policy is: capture the newest frame → one blocking send attempt → return
the framebuffer → next tick captures whatever is newest by then. No frame
is ever queued, retried, or resent. A failed/partial binary send just
leaves the relay's `pendingHeader` for that one header unmatched, which is
harmlessly overwritten by the next frame's header (see
`video-relay/src/room.ts` — `pendingHeader` is always overwritten, never
merged). `CAMERA_GRAB_LATEST` (PSRAM path) already gives the camera driver
its own latest-frame-wins behavior underneath this.

## Reconnect

WiFi loss, WSS loss, and an authenticated takeover by another publisher
(`PUBLISHER_REPLACED`) are all handled identically: `WStype_DISCONNECTED`
resets `connected`/`accepted`/`streamSessionId`, schedules a backoff retry
(1s → 30s, same shape as `firmware/rovelink_device/transport.cpp`), and on
the next successful connection re-registers and adopts whatever
`streamSessionId` comes back. **Never reboots** as an ordinary reconnect
strategy.

## GPIO25 / Wemos Camera Power

The car's Wemos uses GPIO25 to power the separate camera board. The real-car
firmware holds that pin LOW briefly during boot, then drives it HIGH and keeps
it on; this camera firmware then boots and connects normally. GPIO25 on the
ESP32-CAM itself remains **VSYNC** and is unrelated.

## Video relay: DEPLOYED (resolved 2026-09-10)

This section previously recorded a blocker — `rovelink-video-relay` did not
exist on either Cloudflare account. **That is resolved.** The Worker is
deployed and healthy:

| | |
|---|---|
| Video relay | `wss://rovelink-video-relay.cuello.workers.dev` |
| Control relay | `wss://rovelink-relay.cuello.dev` |
| Account | `Andrés Cuello account` (`8ddbff42…`) |

`VIDEO_RELAY_PROFILE` in `video_relay_config.h` is therefore now
`VIDEO_RELAY_PROFILE_CLOUDFLARE` (port 443, TLS on) — the production
transport, reachable from any network with Internet access rather than only
from a LAN shared with a laptop running `wrangler dev`.

Both Worker secrets are set, and `VIDEO_TICKET_SECRET` is byte-for-byte
identical on the two relays. That was not assumed — it was proved end to end
against the deployed infrastructure: the control relay minted a viewer
ticket, the video relay accepted it, and 698 frames flowed from the
simulated publisher with `dup=0 ooo=0` at ~200 ms latency. See
`docs/hardware-demo-runbook.md` §2 to repeat that test at any time.

**TLS trust:** this host's chain is
`leaf CN=cuello.workers.dev -> GTS WE1 -> GTS Root R4`, and GTS Root R4 is
already one of the three roots in `cloudflare_ca_certs.h` — the same chain
the already-validated control relay uses. No new trust material was needed,
and there is no insecure fallback in this firmware.

A **first** deploy of a Worker cannot use `wrangler secret put` (the Worker
does not exist yet, so there is nothing to attach a secret to). It needs:

```bash
npx wrangler deploy --secrets-file <file>   # NAME=value lines
```

Subsequent deploys preserve the existing secrets.

## Required Libraries

```bash
arduino-cli lib install "WebSockets@2.7.2"
arduino-cli lib install "ArduinoJson@7.4.3"
```

(`esp_camera.h` ships with the `esp32:esp32` core itself — no separate
library.)

## Compile

```bash
arduino-cli compile --fqbn esp32:esp32:esp32cam firmware/rovelink_camera
```

## Secrets

```bash
cp firmware/rovelink_camera/wifi_secrets.example.h \
   firmware/rovelink_camera/wifi_secrets.h
cp firmware/rovelink_camera/video_secrets.example.h \
   firmware/rovelink_camera/video_secrets.h
```

Both are gitignored. `video_secrets.h`'s `VIDEO_PUBLISHER_SECRET` must
match whatever `VIDEO_PUBLISHER_SECRET` the video relay is actually
running with (`video-relay/.dev.vars` for local `wrangler dev`, or the
deployed Worker's own secret once it exists).

## Serial Output

```text
[BOOT] RoveLink camera firmware
[BOARD] AI-Thinker ESP32-CAM (robot-01)
[CAM] camera ready
[WIFI] connecting ssid=your-network
[WIFI] connected
[WIFI] ip=192.168.1.55
[READY]
[VIDEO] connecting host=192.168.1.100:8788
[VIDEO] connected
[VIDEO] registering publisher
[VIDEO][RX] type=publisher.accepted
[VIDEO] accepted streamSessionId=...
[STATS] wifi=connected video=publishing sent=42 dropped=0
```
