/**
 * Video relay routes: `/video/<id>/<role>`.
 *
 * Deliberately a different path shape from the control relay's
 * `/robot/<id>/<role>` (see relay/src/route.ts) and a different role
 * vocabulary ('publisher'/'viewer' vs. 'controller'/'device'): the two
 * relays are separate Workers, but even if a client pointed at the wrong
 * one, the route would fail to parse rather than silently accepting a
 * connection meant for the other protocol.
 *
 * Pure function so routing can be tested without starting a Worker.
 */

import type { VideoRole } from '@rovelink/protocol';

export interface VideoRoute {
  readonly robotId: string;
  readonly role: VideoRole;
}

// Lowercase, digits, and hyphens: the id travels in a URL and names the
// Durable Object.
const VALID_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const isVideoRole = (value: string): value is VideoRole =>
  value === 'publisher' || value === 'viewer';

export function parseVideoRoute(pathname: string): VideoRoute | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'video') return null;

  const robotId = parts[1] ?? '';
  const role = parts[2] ?? '';
  if (!VALID_ID.test(robotId) || !isVideoRole(role)) return null;
  return { robotId, role };
}
