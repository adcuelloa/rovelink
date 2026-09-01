# Protocol

## Version

Current protocol version: **1** (`v: 1`)

The version field is included in every message. The relay and firmware reject
messages with unrecognized versions.

This document covers the control protocol only (browser ↔ relay ↔ ESP32).
The video relay (publisher/viewer streaming and ticket-based auth) is a
separate wire protocol — see [video-protocol.md](video-protocol.md). For how
`token` values are provisioned and verified, and the full close-code
reference, see [authentication.md](authentication.md).

## Messages

All messages are JSON objects with `v` and `type` fields.

### device.register

Sent by the ESP32 after connecting to the relay.

```json
{
  "v": 1,
  "type": "device.register",
  "robotId": "robot-01",
  "firmware": "0.1.0",
  "token": "device-secret"
}
```

`token` is verified (constant-time comparison) against the relay's
`DEVICE_SECRET`; an invalid or missing token closes the connection.

### controller.register

Sent by the browser after connecting to the relay.

```json
{
  "v": 1,
  "type": "controller.register",
  "robotId": "robot-01",
  "token": "controller-secret"
}
```

`token` is verified against the relay's `CONTROLLER_SECRET` the same way as
`device.register`.

### controller.session

Relay-authored only — sent to a device and to the controller itself the
moment that controller's registration becomes authoritative. Never
established or changed by a `control` frame; this is what stops a delayed
frame from a previous session from ever rolling the device's active session
backward.

```json
{ "v": 1, "type": "controller.session", "robotId": "robot-01", "sessionId": "..." }
```

The relay stamps `sessionId` onto every `control` frame it forwards to the
device as `controlSessionId` (see below) — the browser never sets this
itself.

### control

Control frame from browser to robot. Carries the current driving state.

```json
{
  "v": 1,
  "type": "control",
  "seq": 42,
  "sentAt": 1700000000000,
  "ttlMs": 500,
  "throttle": 0.75,
  "steering": -0.25,
  "gripper": "idle",
  "armed": true
}
```

- `controlSessionId`: which control session this frame belongs to (see
  `controller.session` above). Absent on the browser→relay leg, where it
  doesn't exist yet; the relay adds it before forwarding to the device.
- `seq`: monotonically increasing; only the highest `seq` is obeyed
- `sentAt`: timestamp in milliseconds
- `ttlMs`: time-to-live; frame is ignored if `now - sentAt > ttlMs`
- `throttle`: -1 (reverse) to 1 (forward)
- `steering`: -1 (left) to 1 (right)
- `gripper`: `"idle"`, `"open"`, or `"close"`
- `armed`: must be `true` for motors to respond

### telemetry

Periodic status from the robot to the browser (~3 Hz).

```json
{
  "v": 1,
  "type": "telemetry",
  "sentAt": 1700000000000,
  "ackSeq": 42,
  "ackSessionId": "...",
  "rssi": -55,
  "throttle": 0.75,
  "steering": -0.25,
  "armed": true
}
```

`ackSessionId` names which control session `ackSeq` belongs to — without it,
`ackSeq` from two different sessions is ambiguous, since both can
legitimately be small numbers.

### ping / pong

RTT measurement. The browser sends `ping`, the relay answers with `pong`.

```json
{ "v": 1, "type": "ping", "id": 1, "sentAt": 1700000000000 }
{ "v": 1, "type": "pong", "id": 1, "sentAt": 1700000000000, "echoAt": 1700000000005 }
```

### emergency-stop

Can be sent by either side. The relay also generates one when the controller
disconnects.

```json
{
  "v": 1,
  "type": "emergency-stop",
  "sentAt": 1700000000000,
  "reason": "controller-disconnected"
}
```

### room

Published by the relay to both controller and device when presence changes.

```json
{
  "v": 1,
  "type": "room",
  "robotId": "robot-01",
  "deviceOnline": true,
  "controllerOnline": true
}
```

### controller.videoTicket.request / controller.videoTicket

Controller → relay → controller: the browser asks the control relay to mint
a short-lived video viewer ticket, so it can connect to the (separate) video
relay. See [authentication.md](authentication.md#video-ticket-based-viewer-authorization)
for the full flow.

```json
{ "v": 1, "type": "controller.videoTicket.request" }
```

```json
{
  "v": 1,
  "type": "controller.videoTicket",
  "robotId": "robot-01",
  "ticket": "<signed-ticket>",
  "expiresAt": 1700000045000
}
```

The request carries no credential and no `robotId`: authority comes entirely
from the requesting socket already being a registered, authenticated
controller, and the ticket is minted for exactly the robot that socket is
already authenticated to. `ticket` is opaque to the browser — it is handed
unchanged to the video relay's `viewer.register` (see
[video-protocol.md](video-protocol.md)).

## Close codes

Every registration/auth failure closes the WebSocket with a private
application close code instead of a generic disconnect — see
[authentication.md](authentication.md#close-codes) for the full table
(`OCCUPIED`, `DEVICE_REPLACED`, `AUTH_FAILED`, `REGISTRATION_TIMEOUT`).

## Properties

- **Latest state wins**: only the frame with the highest `seq` is applied
- **TTL**: frames older than `ttlMs` (default 500 ms, `CONTROL_TTL_MS`) are discarded
- **No command queue**: the robot always applies the most recent state
- **Emergency stop**: immediate, bypasses normal control flow
- **Link loss**: disconnection triggers safe state on all sides
