/**
 * HTTP API version the frontend speaks (#1133 / ADR-029 Axis 3).
 *
 * The backend serves every route under `/v1`; the client pins the API major it
 * targets. Single source for both URL builders (the api-client and the JWT
 * session adapter) so they can never drift when a future `/v2` ships. Backend
 * version-neutral routes (inbound webhooks, the Allegro OAuth callback) are not
 * called through the FE client, so a blanket prefix is safe.
 *
 * @module apps/web/src/shared/config
 */

/** URI version segment prepended to every API path (leading slash, no trailing). */
export const API_VERSION_PREFIX = '/v1';

/**
 * Prepend the version segment to a path unless it is already versioned.
 * Normalizes a missing leading slash so callers can pass `orders` or `/orders`.
 */
export function withApiVersion(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (normalizedPath === API_VERSION_PREFIX || normalizedPath.startsWith(`${API_VERSION_PREFIX}/`)) {
    return normalizedPath;
  }
  return `${API_VERSION_PREFIX}${normalizedPath}`;
}
