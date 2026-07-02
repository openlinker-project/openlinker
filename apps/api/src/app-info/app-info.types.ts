/**
 * App Info Types & API Version Constants
 *
 * Single source of truth for the HTTP API version. `API_VERSION` feeds the
 * NestJS URI-versioning config in `main.ts` (`defaultVersion`) AND the runtime
 * version surface (`GET /v1/health`), so the routed prefix and the reported
 * `api` field can never drift. See ADR-029 (Axis 3) / RELEASING.md.
 *
 * @module apps/api/src/app-info
 */

/** Bare API version fed to NestJS `enableVersioning({ defaultVersion })`. */
export const API_VERSION = '1';

/** URI-prefixed label (`v1`) reported by the version surface. */
export const API_VERSION_LABEL = `v${API_VERSION}`;

/** Resolved runtime identity of the running process. */
export interface AppInfo {
  /** Product (release) version — the `vX.Y.Z` tag the artifact was built from. */
  version: string;
  /** HTTP API version label (e.g. `v1`). */
  api: string;
}
