# Video Protocol

## Version

Current video protocol version: **1** (`v: 1`)

This is a **separate wire protocol** from the control protocol
([protocol.md](protocol.md)): a video connection never speaks `RemoteMessage`
and a control connection never speaks `VideoMessage`. The two run over
independent WebSocket connections to independent Workers
(`relay/` vs. `video-relay/`), matching how control and camera are separate
boards on the real robot. Source: `protocol/src/video.ts`.

For how a viewer obtains a `ticket` and a publisher obtains its `token`, see
[authentication.md](authentication.md).

## Frame wire shape

A camera frame is **two WebSocket messages sent back-to-back on the same
connection**: one small JSON text message (`VideoFrameHeader`), immediately
followed by one binary message containing the raw JPEG bytes. WebSocket
delivers one connection's messages in order, so the relay and the viewer can
always pair header and binary positionally — never interleaved with a
different frame's header/binary, as long as sender and relay never reorder
their own writes (they don't).

This shape was chosen over a packed binary header because it costs a
camera publisher nothing beyond what it already needs: build a small JSON
string, send it, send the framebuffer — no manual struct packing or
endianness to get right.

## Messages

### publisher.register

Publisher → relay. The first message a publisher socket may ever send; a
socket that hasn't sent one yet is "pending" — invisible to presence, and
any `frame` it sends is ignored.

```json
{ "v": 1, "type": "publisher.register", "robotId": "robot-01", "token": "video-publisher-secret" }
```

`token` is the static provisioned camera credential (`VIDEO_PUBLISHER_SECRET`),
verified the same constant-time way the control relay verifies
`device.register`.

### viewer.register

Viewer → relay. The first message a viewer socket may ever send. A pending
viewer receives no stream state, no cached frame, and its `viewer.ack` is
ignored.

```json
{ "v": 1, "type": "viewer.register", "robotId": "robot-01", "ticket": "<signed-ticket>" }
```

`ticket` is the short-lived signed token minted by the **control** relay —
see [authentication.md](authentication.md#video-ticket-based-viewer-authorization).
The video relay never issues these, only verifies them.

### publisher.accepted

Relay → publisher, sent the instant a publisher becomes authoritative for
`robotId`.

```json
{ "v": 1, "type": "publisher.accepted", "robotId": "robot-01", "streamSessionId": "..." }
```

`streamSessionId` is minted server-side, never client-supplied.

### publisher.rejected

Relay → publisher, sent instead of `publisher.accepted` on an auth failure,
immediately before the relay closes the socket with `AUTH_FAILED`.

```json
{ "v": 1, "type": "publisher.rejected", "robotId": "robot-01", "reason": "auth-failed" }
```

### frame (header)

Publisher → relay → viewers, immediately followed by one binary message of
exactly `byteLength` bytes of JPEG data. The relay never fragments or
reassembles frames: each JPEG is already a complete image.

```json
{
  "v": 1,
  "type": "frame",
  "streamSessionId": "...",
  "seq": 42,
  "capturedAtMs": 1700000000000,
  "width": 640,
  "height": 480,
  "byteLength": 18432
}
```

- `streamSessionId`: echoes the id from `publisher.accepted`; lets a viewer
  tell a frame from a fresh publisher connection apart from a stale one
- `seq`: monotonically increasing within one `streamSessionId`, starting at
  1 — a new session may safely reuse `seq=1`
- `capturedAtMs`: the publisher's own clock, **not** synchronized with the
  relay's or a viewer's — only meaningful as a latency estimate when
  publisher and viewer share a clock domain
- `byteLength`: validated against `MAX_JPEG_BYTES` (256 KiB) before the
  relay ever buffers the binary that follows; an oversized declared length
  is rejected at the header with `OVERSIZED_FRAME`

### viewer.ack

Viewer → relay: explicit application-level flow control. Cloudflare's
Workers `WebSocket` exposes neither `bufferedAmount` nor a send-completion
callback, so the relay cannot trust its own send buffer as a backpressure
signal. Instead, each viewer may have **at most one frame in flight**; a new
frame arriving while one is already outstanding is skipped for that viewer
(not queued), and only a matching `viewer.ack` releases credit for the next
one.

```json
{ "v": 1, "type": "viewer.ack", "streamSessionId": "...", "seq": 42 }
```

This is flow control, not reliable delivery: an old frame is never
retransmitted because it went unacked — a viewer that acks is always handed
the *newest* available frame, never a backlog. An ack must match the
recorded in-flight frame **exactly** (same `streamSessionId` and `seq`); a
mismatched ack (wrong session, wrong seq, or no frame in flight — including a
duplicate ack after the first already released credit) is ignored.

### stream

Relay → viewer(s): published whenever publisher presence changes for
`robotId`, and once immediately on a viewer's own connect so it never has to
guess the current state.

```json
{ "v": 1, "type": "stream", "robotId": "robot-01", "publisherOnline": true, "streamSessionId": "..." }
```

`streamSessionId` is present only while `publisherOnline` is true.

## Properties

- **No frame queue**: the relay keeps a single latest-frame slot per room,
  always overwritten by the newest complete frame; a slow viewer skips
  frames, it never falls behind on a backlog
- **Per-viewer credit**: at most one frame in flight per viewer, enforced by
  `viewer.ack` (see above) — independent of whatever the WebSocket transport
  is doing underneath
- **Frames are ephemeral**: nothing is ever persisted to Durable Object
  storage; the cached "latest frame" lives only in memory and does not
  survive the room hibernating
- **Authenticated takeover**: a new, validly authenticated publisher may
  replace an already-live one (`PUBLISHER_REPLACED`) — models a real camera
  rebooting without a clean disconnect; an *invalid* new publisher can never
  evict the incumbent
- **Structural JPEG check**: the relay verifies each binary payload starts
  with the JPEG SOI marker (`0xFFD8`) and ends with EOI (`0xFFD9`) before
  caching or forwarding it — a cheap sanity check, not a full decode

See [authentication.md](authentication.md#close-codes) for the full video
relay close-code table.

## Local testing without a camera

`video-relay/src/dev/publisher-cli.ts` and `video-relay/src/dev/viewer-cli.ts`
are Node CLIs that speak this protocol exactly as a real ESP32-CAM and
browser tab eventually would, so the whole stream path — including the
control-relay ticket handoff — can be exercised without physical hardware.
See [video-relay/README.md](../video-relay/README.md#local-testing-without-a-camera).
