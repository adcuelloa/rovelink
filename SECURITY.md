# Security Policy

RoveLink controls physical hardware over the Internet. Security is critical.

## Scope

The following are considered security-relevant:

- Authentication bypass (unauthorized robot control)
- Unauthorized access to a robot's control channel
- Replay attacks (re-sending old control frames)
- WebSocket / TLS issues (certificate validation failures, downgrade attacks)
- Device impersonation (registering as a robot you don't own)
- Denial of service that affects safety (e.g., preventing emergency stop)
- Exposure of secrets (WiFi credentials, device tokens, relay URLs)

## Reporting

If you discover a security vulnerability, please report it privately via
GitHub Security Advisories once this repository has that feature enabled.

**Do not open a public issue for security vulnerabilities.**

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Current Security Design

RoveLink includes several safety mechanisms by design:

- **Armed state**: motors only respond when explicitly armed
- **Emergency stop**: immediately desarms and zeros all outputs
- **TTL watchdog**: stale control frames cause the robot to stop
- **Link loss**: disconnection triggers safe state on both browser and firmware
- **Latest-state-wins**: old commands are never replayed
- **TLS with CA root validation**: the ESP32 validates the relay's certificate
  against known CA roots (ISRG X1, GTS R1, GTS R4)
- **Shared-secret authentication**: the `token` field in `device.register`
  and `controller.register` is verified against `DEVICE_SECRET` /
  `CONTROLLER_SECRET` (constant-time comparison); an invalid or missing
  token closes the connection
- **Video relay authorization**: publishers authenticate with a shared
  secret; viewers present a short-lived signed ticket, minted by the
  control relay for an already-authenticated controller and verified by the
  video relay via a secret shared only between the two Workers

## Known Limitations

- No rate limiting on the relay
- JSON wire format (no binary protocol yet)

These are tracked in the project roadmap.
