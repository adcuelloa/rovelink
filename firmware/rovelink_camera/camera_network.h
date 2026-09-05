#pragma once

// WiFi STA + DHCP for the camera board. Deliberately simpler than
// firmware/rovelink_device/network.cpp: that file also runs a separate
// DNS+TCP "internet probe" task to distinguish "associated to the AP" from
// "usable Internet" before the control link is trusted. The camera doesn't
// need that distinction — video_publisher.cpp's own WSS connect attempt
// (gated on cameraNetworkConnected()) already is the real reachability
// test, so a second, separate probe here would just duplicate it.

// No fixed IP: always DHCP (see README.md's NETWORK ARCHITECTURE section —
// the camera does not need a stable LAN IP for outbound RoveLink video).
void cameraNetworkSetup();

// Non-blocking; call every loop() iteration.
void cameraNetworkLoop();

bool cameraNetworkConnected();

// "down" | "connecting" | "connected", for the periodic [STATS] line.
const char *cameraNetworkStatusText();
