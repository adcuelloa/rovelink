#pragma once

// Video publisher credential (`token` field of `publisher.register`, see
// protocol/src/video-ticket.ts's sibling protocol/src/video.ts). The video
// relay REQUIRES this to match its own VIDEO_PUBLISHER_SECRET
// (`wrangler secret put VIDEO_PUBLISHER_SECRET` in video-relay/, or the
// VIDEO_PUBLISHER_SECRET line in video-relay/.dev.vars for local
// `wrangler dev`) before it will accept this camera as the room's
// publisher — see video-relay/src/room.ts #handlePublisherRegister. A
// missing or wrong token gets `publisher.rejected` and the socket closed
// with CLOSE_CODE.AUTH_FAILED; the camera never gets to publish a frame.
//
// Copy to `video_secrets.h` (in .gitignore) and put the real token there:
//
//   cp firmware/rovelink_camera/video_secrets.example.h \
//      firmware/rovelink_camera/video_secrets.h
//
// `video_secrets.h` is NEVER versioned. Unlike wifi_secrets.h, this file is
// still optional at compile time: if missing, video_publisher.cpp falls
// back to VIDEO_PUBLISHER_SECRET "" so the sketch still builds, but an
// empty token can never authenticate against a real VIDEO_PUBLISHER_SECRET.
//
// Never print VIDEO_PUBLISHER_SECRET to Serial: video_publisher.cpp does
// not, and no other file should either.

#define VIDEO_PUBLISHER_SECRET "REPLACE_WITH_REAL_VIDEO_PUBLISHER_SECRET"
