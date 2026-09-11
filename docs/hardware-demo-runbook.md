# RoveLink hardware-demo runbook

**Purpose:** the university session is for *flashing and physical validation only*.
No architecture work, no dependency installation, ideally no compilation.

Everything in this document was prepared and verified on **2026-09-10** with no
physical hardware attached — both boards live at the university.

Run `scripts/preflight-hardware.sh` before leaving. If it prints
`PREFLIGHT PASSED`, you can go offline immediately and still do the whole session.

---

## 0. Three independent test levels

The levels exist so a failure localises itself. Always go **up** the levels, and
when something breaks, drop **down** one to find out which layer owns the fault.

| Level | What it is | Proves | Needs network? |
|---|---|---|---|
| **1** | Old known-good firmware, `~/Projects/compiladores/firmware/carro_pinza_wifi/` | The physical camera + your flashing setup work at all | LAN only |
| **2** | `firmware/rovelink_camera_smoketest/` | OV2640 + PSRAM + ribbon + power — **no networking at all** | No |
| **3** | `firmware/rovelink_camera/` | Wi-Fi + TLS + relay auth + browser render | Internet |

> **Level 1 is a read-only fallback.** `~/Projects/compiladores` is *not modified*
> by any of this work and stays usable exactly as it was.

**Level 2 is the important one.** It has zero configuration and zero secrets, so
it cannot be misconfigured. If Level 2 shows clean JPEG frames and Level 3 shows
no video, the camera hardware is *proven good* and the problem is entirely in
Wi-Fi/TLS/relay — which saves the session.

---

## 1. Cloudflare configuration (verified 2026-09-10)

Both Workers are deployed and healthy. **No secret values appear in this file.**

| Item | Value | Status |
|---|---|---|
| Control relay | `wss://rovelink-relay.cuello.dev` | deployed, `/health` 200 |
| Video relay | `wss://rovelink-video-relay.cuello.workers.dev` | deployed, `/health` 200 |
| Cloudflare account | `Andrés Cuello account` (`8ddbff42…`) | — |

### Required secrets

| Secret | Where it lives | Set? |
|---|---|---|
| `VIDEO_PUBLISHER_SECRET` | video relay (Worker secret) | yes |
| `VIDEO_PUBLISHER_SECRET` | `firmware/rovelink_camera/video_secrets.h` (gitignored, mode 600) | yes — **must equal** the Worker's |
| `VIDEO_TICKET_SECRET` | control relay (Worker secret) | yes |
| `VIDEO_TICKET_SECRET` | video relay (Worker secret) | yes — **must be byte-for-byte identical** to the control relay's |
| `DEVICE_SECRET` | control relay + `firmware/rovelink_device/device_secrets.h` | yes |
| `CONTROLLER_SECRET` | control relay; typed into the browser at login | yes |

`VIDEO_TICKET_SECRET` matching across **both** relays was not assumed — it was
proved end to end: the control relay minted a ticket, the video relay accepted
it, and frames flowed. See §2.

### Web environment (`web/.env.local`, gitignored)

```
VITE_RELAY_URL=wss://rovelink-relay.cuello.dev
VITE_VIDEO_RELAY_URL=wss://rovelink-video-relay.cuello.workers.dev
VITE_ROBOT_ID=robot-01
```

If `VITE_VIDEO_RELAY_URL` is unset the video panel is *disabled*, not broken —
so a missing value looks like "no video panel", not like a bug.

### Re-deploying (only if you must)

```bash
cd video-relay
CLOUDFLARE_ACCOUNT_ID=8ddbff42e3037fa589656135e804081b npx wrangler deploy
```

A **first** deploy of a Worker cannot use `wrangler secret put` (the Worker does
not exist yet); it needs `npx wrangler deploy --secrets-file <file>` with
`NAME=value` lines. Later deploys keep the existing secrets.

---

## 2. Validating the cloud path **without the camera**

Already done once and repeatable at any time — this is how you prove the whole
cloud/browser half still works when the ESP32-CAM is not in your hands.

```bash
# terminal 1 — simulated publisher (no camera hardware involved)
cd video-relay
VIDEO_RELAY_URL=wss://rovelink-video-relay.cuello.workers.dev \
ROBOT_ID=robot-01 FPS=10 DURATION_S=120 \
VIDEO_PUBLISHER_SECRET='<the real publisher secret>' \
node --experimental-strip-types src/dev/publisher-cli.ts

# terminal 2 — viewer, via the REAL deployed control-relay ticket flow
cd video-relay
VIDEO_RELAY_URL=wss://rovelink-video-relay.cuello.workers.dev \
CONTROL_RELAY_URL=wss://rovelink-relay.cuello.dev \
ROBOT_ID=robot-01 DURATION_S=20 \
CONTROLLER_SECRET='<the real controller secret>' \
node --experimental-strip-types src/dev/viewer-cli.ts
```

Measured result (2026-09-10, deployed infrastructure):

```
publisher: frames sent=698 skipped=0 elapsed=82.7s avgFps=8.44 avgKBps=158.7
viewer:    received=117 dropped=77 dup=0 ooo=0 latency≈200ms reconnects=0
```

`dup=0 ooo=0` is the important part: no duplicate or out-of-order frames.
`dropped` is the *intended* latest-frame-wins backpressure, not an error —
the relay skips stale frames for a viewer that has not acked yet.

> **Note:** `CONTROLLER_SECRET` in `relay/.dev.vars` is stored **quoted**. Strip
> the quotes when exporting it, or auth fails with close code `4003`.

### Browser check

```bash
cd web && pnpm build && pnpm exec vite preview --port 4173 --host 127.0.0.1
```

Open <http://127.0.0.1:4173/>, enter the controller key, and confirm the video
panel paints frames while the publisher above is running.

---

## 3. The session, step by step

Each step has **one diagnostic** and **one fallback**. Do not improvise past a
failed step — take the fallback.

### A. Plug in the ESP32-CAM

AI-Thinker ESP32-CAM has no USB. You need an FTDI/CH340 3.3V USB-TTL adapter:

| Adapter | ESP32-CAM |
|---|---|
| 5V | 5V |
| GND | GND |
| TX | U0R |
| RX | U0T |

> ⚠️ **Power the ESP32-CAM independently** for the first camera test. Do **not**
> rely on the car's GPIO25 line (see §5). Many USB-TTL adapters cannot supply the
> ~300 mA peak the OV2640 draws; brownout looks exactly like a dead camera.

- **Diagnostic:** `dmesg | tail -20`
- **Fallback:** try another USB cable/port, then a separate 5V supply (common GND).

### B. Identify the serial port

- **Diagnostic:** `arduino-cli board list`
- **Fallback:** `ls -l /dev/ttyUSB* /dev/ttyACM*` — the AI-Thinker with a
  CH340/FTDI adapter is almost always `/dev/ttyUSB0`.

### C. Serial permissions (Linux)

On this machine `kingdavid` is already in the `uucp` group, which owns
`/dev/ttyUSB*` on Arch — so this should just work.

- **Diagnostic:** `ls -l /dev/ttyUSB0 && id -nG`
- **Fallback:** if the group is not active in the current shell, **do not use
  `sg`** (it misbehaves here). Use:
  ```bash
  newgrp uucp <<'EOF'
  arduino-cli upload --input-dir artifacts/hardware-demo/esp32cam-smoketest \
    -b esp32:esp32:esp32cam -p /dev/ttyUSB0
  EOF
  ```

### D. Enter flashing mode

The AI-Thinker ESP32-CAM has **no auto-reset circuit**. You must do this by hand:

1. Jumper **GPIO0 → GND**
2. Tap the **RST** button (or power-cycle)
3. Start the upload
4. Remove the GPIO0 jumper and tap **RST** again to run

- **Diagnostic:** if you see `Failed to connect to ESP32: Wrong boot mode detected`,
  GPIO0 was not grounded at reset.
- **Fallback:** hold GPIO0 to GND, tap RST, and start the upload *within ~2s*.

### E. Upload the smoke-test binary (Level 2)

**Verified command — uploads an already-compiled build, no recompilation:**

```bash
arduino-cli upload \
  --input-dir artifacts/hardware-demo/esp32cam-smoketest \
  -b esp32:esp32:esp32cam \
  -p /dev/ttyUSB0
```

*(Verified 2026-09-10: arduino-cli 1.4.1 accepted these flags, resolved the
binaries and invoked esptool v5.3.1, failing only because no board was attached.
`arduino-cli upload` does **not** compile.)*

- **Diagnostic:** add `-v` for the full esptool command line.
- **Fallback — compile from source** (works offline, everything is installed):
  ```bash
  arduino-cli compile --fqbn esp32:esp32:esp32cam \
    -u -p /dev/ttyUSB0 firmware/rovelink_camera_smoketest
  ```

### F. Monitor serial

```bash
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

- **Diagnostic:** no output at all → wrong baud, or TX/RX swapped.
- **Fallback:** swap TX/RX (this is the single most common wiring mistake).

### G. Verify PSRAM / camera / JPEG

Expected:

```
[BOOT] RoveLink ESP32-CAM SMOKE TEST
[PSRAM] found=true size=4194304 free=4188000
[CAM] profile=psram quality=12 fb_count=2 xclk=20MHz
[CAM] sensor PID=0x26
[CAM] init OK
[FRAME] 640x480 bytes=18342 captureMs=71 jpeg=ok ok=1 bad=0
```

- `PID=0x26` is the OV2640. `jpeg=ok` means intact SOI/EOI markers.
- `bad=` must stay at 0. Rising `bad=` means corrupt frames → reseat the ribbon.
- **Diagnostic:** `[PSRAM] found=false` → the board is not a real AI-Thinker, or
  PSRAM is faulty; it will fall back to 160x120.
- **Fallback:** if `esp_camera_init failed`, reseat the ribbon (gold contacts
  toward the board), verify 5V, then drop to **Level 1** and flash the old
  known-good firmware from `~/Projects/compiladores` to decide whether the
  *camera module itself* is dead.

**Do not proceed to Level 3 until Level 2 is clean.**

### H. Upload the RoveLink camera binary (Level 3)

```bash
arduino-cli upload \
  --input-dir artifacts/hardware-demo/esp32cam-rovelink \
  -b esp32:esp32:esp32cam \
  -p /dev/ttyUSB0
```

> ⚠️ `firmware/rovelink_camera/wifi_secrets.h` is baked into this binary at
> **compile** time. If the university Wi-Fi differs from what is in that file,
> edit it and recompile — this is the one case that needs a compile on site:
> ```bash
> arduino-cli compile --fqbn esp32:esp32:esp32cam \
>   --output-dir artifacts/hardware-demo/esp32cam-rovelink \
>   firmware/rovelink_camera
> ```
> The ESP32 cannot use WPA2-Enterprise networks with this firmware — use a
> phone hotspot or a WPA2-Personal SSID.

### I. Monitor Wi-Fi

```
[WIFI] connecting ssid=<ssid>
[WIFI] connected
[WIFI] ip=10.0.0.42 rssi=-58dBm
```

- **Diagnostic:** `rssi` worse than about **−75 dBm** predicts a stream that
  connects and then stalls.
- **Fallback:** move closer to the AP, or use a phone hotspot.

### J. Monitor TLS / WSS

```
[VIDEO] connecting host=rovelink-video-relay.cuello.workers.dev:443
[VIDEO] connected (previous close: none)
```

- **Diagnostic:** connects then immediately disconnects → TLS handshake failure.
  From the laptop on the same network:
  `curl -v https://rovelink-video-relay.cuello.workers.dev/health`
- **Fallback:** a captive portal or a TLS-intercepting proxy will break this and
  cannot be worked around from the firmware (certificate validation is
  deliberately strict, with no insecure escape hatch). Use a phone hotspot.

### K. Verify `publisher.accepted`

```
[VIDEO] registering publisher
[VIDEO][RX] type=publisher.accepted
[VIDEO] accepted streamSessionId=0a21210e-...
[STATS] wifi=connected rssi=-58dBm video=publishing session=0a21… seq=142 \
        jpegBytes=18342 fps=9.4 sent=142 dropped=0 sendFail=0 lastClose=none heap=143210
```

- **Diagnostic:** `[VIDEO][RX] type=publisher.rejected` → the token in
  `video_secrets.h` does not match the Worker's `VIDEO_PUBLISHER_SECRET`.
- **Fallback:** re-set the Worker secret and rewrite `video_secrets.h` with the
  same value, then recompile.

`video=publishing` with `seq` climbing and `sendFail=0` means the camera side is
completely healthy. Anything wrong after this point is browser-side.

### L. Open the browser

```bash
cd web && pnpm build && pnpm exec vite preview --port 4173 --host 127.0.0.1
```

Open <http://127.0.0.1:4173/> and enter the controller key.

- **Diagnostic:** no video panel at all → `VITE_VIDEO_RELAY_URL` was unset at
  **build** time (it is baked in by Vite). Rebuild after fixing `.env.local`.
- **Fallback:** run the CLI viewer from §2 — if the CLI sees frames and the
  browser does not, the fault is in the browser/render layer, not the relay.

### M. Verify live image

You should see live video with roughly 150–350 ms of latency.

- **Diagnostic:** panel present but black → check the browser console for
  `stream` messages and `publisherOnline`.
- **Fallback:** confirm `[STATS] video=publishing` is still climbing on serial;
  if it is, the camera is fine and the issue is the viewer/ticket path.

---

## 4. If everything fails — the guaranteed fallback

Flash the old known-good firmware and demo the original LAN MJPEG stream:

```
~/Projects/compiladores/firmware/carro_pinza_wifi/
```

That project is untouched by this work. It uses a **fixed IP** (`192.168.0.51`)
and expects the `Clase_Linux` network, so it only works on that LAN — which is
exactly why it is a fallback and not the production path.

---

## 5. GPIO25 — a separate, unvalidated physical item

**Do not assume GPIO25 on the car powers the ESP32-CAM.**

On the *car* (Wemos D1 R32), GPIO25 was used by the old firmware as a
power-enable line for a separate camera board. On the *ESP32-CAM itself*,
GPIO25 is **VSYNC** — a completely different signal on a different chip.

This has never been validated on the current hardware, so it is deliberately
**not implemented** in the car firmware: driving a pin on a board that is
already known-good, for an effect nobody has confirmed, is exactly how a
validated car stops being validated.

Treat it as its own experiment, *after* the camera demo works, and only with the
ESP32-CAM independently powered.

---

## 6. Command reference

```bash
# Preflight (run before leaving)
./scripts/preflight-hardware.sh
SKIP_COMPILE=1 ./scripts/preflight-hardware.sh   # fast checks only

# Upload pre-compiled (no recompilation)
arduino-cli upload --input-dir artifacts/hardware-demo/<target> \
  -b <fqbn> -p /dev/ttyUSB0

# Compile from source (fallback)
arduino-cli compile --fqbn esp32:esp32:esp32     firmware/rovelink_device
arduino-cli compile --fqbn esp32:esp32:esp32cam  firmware/rovelink_camera_smoketest
arduino-cli compile --fqbn esp32:esp32:esp32cam  firmware/rovelink_camera

# Compile + upload in one step
arduino-cli compile --fqbn esp32:esp32:esp32cam -u -p /dev/ttyUSB0 \
  firmware/rovelink_camera_smoketest

# Serial monitor
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200
```

### Pinned versions (all installed locally — no downloads needed)

| Component | Version |
|---|---|
| arduino-cli | 1.4.1 |
| esp32:esp32 core | 3.3.11 |
| esptool | 5.3.1 |
| ArduinoJson | 7.4.3 |
| WebSockets | 2.7.2 |
| ESP32Servo | 3.2.1 |

### FQBNs

| Board | FQBN |
|---|---|
| Wemos D1 R32 (original car) | `esp32:esp32:esp32` |
| AI-Thinker ESP32-CAM | `esp32:esp32:esp32cam` |
