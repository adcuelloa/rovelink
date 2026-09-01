# Documentation

Start with the root [README](../README.md) for an overview, quick start, and
current project status. This folder covers how the system works in depth;
each package also has its own README for setup/deployment specific to that
package.

## Design and protocol

| Doc                                       | Covers                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| [architecture.md](architecture.md)        | Components, how they fit together, the connection lifecycle             |
| [protocol.md](protocol.md)                | Control wire protocol (browser ↔ relay ↔ ESP32): every message, close codes |
| [video-protocol.md](video-protocol.md)    | Video wire protocol (camera ↔ video relay ↔ browser): frame shape, flow control |
| [authentication.md](authentication.md)    | Every secret, the login flow, the video ticket handoff, close-code reference |
| [safety.md](safety.md)                    | Physical/motor safety: armed state, e-stop, TTL watchdog, link loss     |

## Setup and process

| Doc                              | Covers                                                    |
| ---------------------------------- | ------------------------------------------------------------ |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Dev setup, checks to run before submitting, code style |
| [../SECURITY.md](../SECURITY.md)         | Vulnerability reporting, security-relevant scope        |
| [../firmware/README.md](../firmware/README.md) | ESP32 firmware: compiling, hardware simulation, WiFi/relay config |
| [../relay/README.md](../relay/README.md)       | Control relay: local dev, deployment                     |
| [../video-relay/README.md](../video-relay/README.md) | Video relay: local dev, deployment, testing without a camera |

## Reading order for a new contributor

1. Root [README](../README.md) — what RoveLink is, repository layout, quick start
2. [architecture.md](architecture.md) — how the pieces connect
3. [protocol.md](protocol.md) and [authentication.md](authentication.md) — the
   wire format and trust model you'll actually be coding against
4. [safety.md](safety.md) — why the control loop is shaped the way it is
5. The README for whichever package you're changing
   (`firmware/`, `relay/`, `video-relay/`, or `web/`'s own source comments)
