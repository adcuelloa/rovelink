# Safety

RoveLink controls physical hardware. Safety mechanisms are built into the
design from the start, not added as an afterthought.

## Armed State

Motors only respond when `armed` is `true` in the control frame. When
disarmed, the robot enters safe state regardless of throttle/steering values.

## Emergency Stop

The emergency stop immediately:

1. Disarms the robot
2. Zeros all motor outputs
3. Resets the gripper to idle
4. Cannot be overridden until explicitly re-armed

Emergency stop can be triggered by:

- The operator (keyboard `Space`, gamepad button, or touch button)
- The relay (when the controller disconnects)
- The firmware (on TTL timeout or link loss)

## TTL Watchdog

Each control frame includes a `ttlMs` field (default 250 ms). If no valid
frame arrives within that window, the firmware enters safe state. This
prevents the robot from continuing to move if the connection is lost.

## Link Loss

Both the browser and the firmware independently handle disconnection:

- **Browser**: resets to safe state, disables motor output
- **Firmware**: monitors both WiFi and WSS connectivity; either dropping
  triggers safe state via `watchNetwork()` and `watchWssLink()`

## Latest State Wins

The `seq` field in control frames ensures that only the most recent command
is applied. Old or reordered frames are discarded. This prevents:

- Replay of stale commands
- Execution of outdated movement states
- Accumulation of queued commands

## Hardware Simulation

`HARDWARE_SIMULATION` mode compiles the firmware without touching any GPIO.
All physical actions are printed to Serial. This allows safe testing of
control logic without risk of unexpected motor movement.

## Limitations

- No rate limiting on the relay
- Software safety is not a replacement for hardware emergency stops

Always test in a safe environment with physical power cutoff available.
