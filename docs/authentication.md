# Authentication

RoveLink has two independent trust boundaries: the **control relay**
(`relay/`, robot driving) and the **video relay** (`video-relay/`, camera
streaming). They never share a secret directly — the video relay never sees
`CONTROLLER_SECRET`, and the control relay never sees `VIDEO_PUBLISHER_SECRET`.
This document covers all of it: what proves identity, where each secret
lives, and the full request lifecycle from a cold login to a live video
frame.

## Secrets at a glance

| Secret                   | Set on                      | Proves                                               | Verified by                           |
| ------------------------ | --------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `DEVICE_SECRET`          | control relay               | This ESP32 is the real robot                         | control relay (`device.register`)     |
| `CONTROLLER_SECRET`      | control relay               | This browser tab is an authorized operator           | control relay (`controller.register`) |
| `VIDEO_PUBLISHER_SECRET` | video relay                 | This camera is the real robot's camera               | video relay (`publisher.register`)    |
| `VIDEO_TICKET_SECRET`    | **both** relays, same value | A viewer ticket was minted by the real control relay | video relay (`viewer.register`)       |

`VIDEO_TICKET_SECRET` is the only secret shared between the two Workers —
it is what lets the video relay trust a ticket without ever talking to the
control relay or seeing `CONTROLLER_SECRET`. All four are Cloudflare Worker
secrets in production (`wrangler secret put <NAME>`, run from `relay/` or
`video-relay/`) and plain values in `relay/.dev.vars` /
`video-relay/.dev.vars` for local `wrangler dev` (see the `.dev.vars.example`
file in each package). None of the four are ever committed — see
`.gitignore`.

The ESP32 side of `DEVICE_SECRET` lives in `firmware/rovelink_device/device_secrets.h`
(copied from `device_secrets.example.h`, gitignored). There is no equivalent
file for `VIDEO_PUBLISHER_SECRET` yet — the only publisher client that exists
today is the dev CLI (`video-relay/src/dev/publisher-cli.ts`), which reads it
from the `VIDEO_PUBLISHER_SECRET` environment variable.

All four verifications use the same constant-time pattern
(`@rovelink/protocol`'s `verifyCredential` in `protocol/src/auth.ts`): both
sides are SHA-256'd before comparison, so a missing/misconfigured secret
fails closed and an attacker cannot learn the real secret's length from
timing. `CONTROLLER_SECRET`/`DEVICE_SECRET`/`VIDEO_PUBLISHER_SECRET` are
static shared credentials — there is no per-user database, so hashing them
at rest would protect nothing extra.

## Device and controller: shared-secret registration

Both the ESP32 and the browser authenticate the same way: connect, then send
a `*.register` message carrying a `token`. See
[protocol.md](protocol.md#deviceregister) for the exact message shapes.
The relay (`relay/src/room.ts`) verifies the token against `DEVICE_SECRET` /
`CONTROLLER_SECRET` before treating the socket as "registered" — an
unregistered socket is invisible to presence, receives no forwarded traffic,
and cannot drive or observe the room. A failed check closes the socket with
`CLOSE_CODE.AUTH_FAILED` (4003) and never repeats the expected value.

Registration also decides **occupancy**:

- A **device** registering with a valid token always wins: any other device
  socket for that robot (registered or still pending) is immediately demoted
  and closed with `DEVICE_REPLACED` (4002). This models the real failure mode
  — the physical robot rebooting — where the old connection often can't close
  itself cleanly.
- A **controller** registering with a valid token is rejected with `OCCUPIED`
  (4001) if another controller is already registered _and live_ (see
  [RobotRoom staleness thresholds](architecture.md)). A _stale_ incumbent
  (no heartbeat past its threshold) is reclaimed instead — the newcomer takes
  over and the stale socket is closed with `OCCUPIED`.

A newly-promoted controller is issued a server-minted `controlSessionId`
(`ControlSession` / `controller.session` message), sent to both the
controller and the current device. Every `control` frame the relay forwards
onward is re-stamped with that id — the browser can never declare its own
session. This is what stops a frame delayed from a _previous_ controller
session from ever being treated as authoritative again after a takeover.

## Operator login (web dashboard)

The dashboard never mounts the driving UI until the relay has confirmed
authentication — a bare WebSocket `OPEN` is not enough, and neither is
generic room presence (`room`, `telemetry`, etc. can legitimately arrive
before auth finishes). This is enforced by one module,
`web/src/auth/handshake.ts`: it watches the transport's event stream and
only calls `onAuthenticated` in direct response to `controller.session`; any
`auth-error` event calls `onAuthError` instead. See `main.ts` for how this
gates mounting `control-view.ts` vs. `login-view.ts`.

The operator's key itself:

- Typed into the login screen (`login-view.ts`), never baked into the build.
  It is deliberately **not** a `VITE_*` value — anything read through
  `import.meta.env` is bundled into the public JS and shipped to every
  visitor, so it cannot be a secret.
- Held in `web/src/auth/controller-key.ts`: an in-memory mirror plus
  `sessionStorage` (cleared when the tab closes), so a reload in the same
  tab doesn't force a re-type but a new tab always does.
- Sent only inside the WSS `controller.register` message.
- Cleared automatically whenever the relay reports it invalid
  (`auth-error`) — a known-bad credential is never retried silently.

## Video: ticket-based viewer authorization

The video relay is a completely separate Worker/DO (`video-relay/`, see
[architecture.md](architecture.md#video-relay-video-relay)) with its own
publisher/viewer roles, wire protocol, and close-code range — see
[video-protocol.md](video-protocol.md) for the full message reference. Its
authentication model differs by role:

**Publisher** (the robot's camera): registers the same way a device does —
`publisher.register { robotId, token }`, verified against
`VIDEO_PUBLISHER_SECRET`. A valid new publisher may take over an already-live
one (mirroring the control relay's device takeover); an invalid one can
never evict the incumbent.

**Viewer** (the browser): never holds a video credential at all. Instead:

```text
1. Browser is already authenticated to the CONTROL relay
   (controller.register succeeded, controller.session received)
2. Browser sends controller.videoTicket.request to the control relay
3. Control relay mints a ticket via mintVideoTicket(), signed with
   VIDEO_TICKET_SECRET, scoped to attachment.robotId (never a
   client-declared robotId) — see relay/src/room.ts #handleVideoTicketRequest
4. Control relay replies controller.videoTicket { ticket, expiresAt }
5. Browser opens a WSS connection to the VIDEO relay and sends
   viewer.register { robotId, ticket }
6. Video relay verifies the ticket's signature and claims against its own
   VIDEO_TICKET_SECRET (verifyVideoTicket in protocol/src/video-ticket.ts)
   — it never contacts the control relay to do this
7. On success the viewer is registered and immediately sent the current
   stream state plus the latest cached frame, if any
```

The ticket (`protocol/src/video-ticket.ts`) is a compact,
HMAC-SHA-256-signed token — `base64url(JSON payload) + '.' + base64url(signature)`
— deliberately not a JWT library, so there is no `alg` field to negotiate and
no "alg:none" footgun. Verification always checks the signature first, over
the raw payload bytes, before the JSON is ever parsed or trusted.

- **TTL: 45 seconds** (`VIDEO_TICKET_TTL_MS`) from mint to first use — long
  enough for a normal "request ticket, then dial the video WSS" round trip,
  short enough that a leaked/logged ticket is worthless within a minute. The
  ticket only authorizes _establishing_ the connection; the video relay does
  not re-check expiry against an already-live viewer socket.
- **5 second clock-skew tolerance** (`VIDEO_TICKET_CLOCK_SKEW_MS`) for a
  ticket that looks slightly future-issued, since the two Workers don't share
  a clock to the millisecond.
- A ticket is scoped to exactly one `robotId` and `role: 'viewer'`; a ticket
  minted for one robot is rejected (`wrong-robot`) against another.

## Close codes

Every rejection closes the WebSocket with a private application code
(4000-4999 range) instead of a generic disconnect, so a client (or a log)
can tell exactly why. The two relays use non-overlapping ranges on purpose —
a mixed log/trace never has to guess which relay emitted a given code.

### Control relay (`CLOSE_CODE`, `protocol/src/protocol.ts`)

| Code | Name                   | Meaning                                                          |
| ---- | ---------------------- | ---------------------------------------------------------------- |
| 4001 | `OCCUPIED`             | A live duplicate role was rejected, or a stale one was reclaimed |
| 4002 | `DEVICE_REPLACED`      | An authenticated device registration replaced this connection    |
| 4003 | `AUTH_FAILED`          | `token` missing or did not match the configured credential       |
| 4004 | `REGISTRATION_TIMEOUT` | Accepted but never registered within the pending window          |

### Video relay (`VIDEO_CLOSE_CODE`, `protocol/src/video.ts`)

| Code | Name                   | Meaning                                                                      |
| ---- | ---------------------- | ---------------------------------------------------------------------------- |
| 4102 | `PROTOCOL_VIOLATION`   | A binary frame with no header, a header with no binary, or a length mismatch |
| 4103 | `OVERSIZED_FRAME`      | Declared `byteLength` exceeded `MAX_JPEG_BYTES` (256 KiB)                    |
| 4104 | `ACK_TIMEOUT`          | A viewer's in-flight frame went unacknowledged too long                      |
| 4105 | `AUTH_FAILED`          | Publisher token or viewer ticket rejected, for any reason except expiry      |
| 4106 | `TICKET_EXPIRED`       | A well-formed, correctly signed ticket had simply passed `expiresAt`         |
| 4107 | `REGISTRATION_TIMEOUT` | Accepted but never registered within the pending window                      |
| 4108 | `PUBLISHER_REPLACED`   | A new authenticated publisher took over from this one                        |

`4101` (`PUBLISHER_OCCUPIED`) is retired: an earlier design unconditionally
rejected a second publisher; ticket-based authenticated takeover replaced
that behavior, so the number is deliberately left unassigned rather than
reused with a different meaning.

`AUTH_FAILED` is deliberately generic on both relays: wrong secret, bad
signature, tampered payload, wrong robot, and wrong role all collapse to the
same code and the same close reason string, so a failed attempt learns
nothing about _why_ it failed. `TICKET_EXPIRED` is split out because it is
the one failure an ordinary legitimate client hits often, and the correct
client behavior differs — ask for a fresh ticket and retry, rather than "the
credential itself is wrong."

## Known limitations

- No rate limiting on either relay.
- No per-viewer or per-controller identity beyond "holds the shared
  secret" — RoveLink has no user accounts.
- A video ticket has no revocation list; `ticketId` exists for a future one
  but nothing checks it today.

See [SECURITY.md](../SECURITY.md) for the vulnerability-reporting process.
