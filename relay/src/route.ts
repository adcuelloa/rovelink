/**
 * Relay routes: `/robot/<id>/<role>`.
 *
 * Pure function so routing can be tested without starting a Worker.
 */

import type { Role } from '@rovelink/protocol';

export interface Route {
  readonly robotId: string;
  readonly role: Role;
}

// Lowercase, digits, and hyphens: the id travels in a URL and names the
// Durable Object.
const VALID_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const isRole = (value: string): value is Role => value === 'controller' || value === 'device';

export function parseRoute(pathname: string): Route | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'robot') return null;

  const robotId = parts[1] ?? '';
  const role = parts[2] ?? '';
  if (!VALID_ID.test(robotId) || !isRole(role)) return null;
  return { robotId, role };
}
