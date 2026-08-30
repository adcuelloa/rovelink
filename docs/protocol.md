# Protocol

## Version

Current protocol version: **1** (`v: 1`)

The version field is included in every message. The relay and firmware reject
messages with unrecognized versions.

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
  "token": "optional-device-token"
}
```

### controller.register

Sent by the browser after connecting to the relay.

```json
{
  "v": 1,
  "type": "controller.register",
  "robotId": "robot-01",
  "token": "optional-operator-token"
}
```

### control

Control frame from browser to robot. Carries the current driving state.

```json
{
  "v": 1,
  "type": "control",
  "seq": 42,
  "sentAt": 1700000000000,
  "ttlMs": 250,
  "throttle": 0.75,
  "steering": -0.25,
  "gripper": "idle",
  "armed": true
}
```

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
  "rssi": -55,
  "throttle": 0.75,
  "steering": -0.25,
  "armed": true
}
```

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

## Properties

- **Latest state wins**: only the frame with the highest `seq` is applied
- **TTL**: frames older than `ttlMs` (default 250 ms) are discarded
- **No command queue**: the robot always applies the most recent state
- **Emergency stop**: immediate, bypasses normal control flow
- **Link loss**: disconnection triggers safe state on all sides
