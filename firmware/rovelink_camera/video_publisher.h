#pragma once

#include <stddef.h>
#include <stdint.h>

// WSS publisher for the existing RoveLink video protocol
// (protocol/src/video.ts, video-relay/). Speaks EXACTLY that protocol:
// publisher.register -> wait for publisher.accepted -> frame header JSON +
// binary JPEG per frame. Never invents a second video architecture.
//
// Mirrors firmware/rovelink_device/transport.cpp's structure and
// conventions (same WebSocketsClient library, same backoff pattern, same
// lazy-connect-only-once-network-is-up gating) — this is a different wire
// protocol (VideoMessage, not RemoteMessage) and a different relay, but the
// same trust model and the same non-blocking discipline.

// Registers the WebSocketsClient event handler. Does not connect yet:
// videoPublisherLoop() only starts the WSS connection once
// cameraNetworkConnected() is true, exactly like transportLoop() gates on
// networkOnline() in the control firmware.
void videoPublisherSetup();

// Non-blocking; call every loop() iteration.
void videoPublisherLoop();

// true once WSS is open AND publisher.accepted has been received on this
// connection — only then is videoPublisherSendFrame() meaningful.
bool videoPublisherReady();

// Sends one frame: a `frame` header (JSON text) immediately followed by
// `len` bytes of JPEG (binary). No-op if not videoPublisherReady(), if
// `len` is 0, or if `len` exceeds MAX_JPEG_BYTES (camera_config.h) — the
// caller (rovelink_camera.ino) already checks these, this is a defensive
// second check, not the primary gate. A failed/partial send is dropped,
// never retried: the next call simply sends the next (newer) frame — see
// README.md's backpressure section.
void videoPublisherSendFrame(const uint8_t *jpeg, size_t len, int width, int height);

// "down" | "registering" | "publishing", for the periodic [STATS] line.
const char *videoPublisherStatusText();

// --- Diagnostics for the periodic [STATS] line (README.md's DIAGNOSTICS
// section). All are read-only accessors: nothing here changes publisher
// behaviour, and none of them can expose VIDEO_PUBLISHER_SECRET.

// Relay-minted stream session id, or "" when not currently accepted.
const char *videoPublisherSessionId();

// seq of the most recent frame ATTEMPTED on this session (see the
// monotonicity note in videoPublisherSendFrame).
long videoPublisherSeq();

// Byte length of the most recent JPEG handed to videoPublisherSendFrame(),
// whether or not the send succeeded. 0 before the first frame.
size_t videoPublisherLastFrameBytes();

// Count of frames whose header send failed (transport could not keep up or
// the socket died mid-frame). These are DROPPED, never queued or retried.
unsigned long videoPublisherSendFailures();

// Why the last disconnect happened, as a short stable token — "none",
// "wifi-lost", "socket-closed", or "rejected". Printed on reconnect so a
// scrolling log says WHICH failure mode is recurring, rather than just
// showing repeated "disconnected" lines.
const char *videoPublisherLastCloseReason();
