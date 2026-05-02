/**
 * Allegro HTTP Client Types
 *
 * Type definitions for the Allegro HTTP client's token-refresh contract.
 * Kept in a dedicated `.types.ts` file per Engineering Standards "Type
 * Definitions in Separate Files".
 *
 * @module libs/integrations/allegro/src/infrastructure/http
 */

/**
 * Token Refresh Result
 *
 * Returned by a `TokenRefreshCallback` to the HTTP client after an
 * OAuth refresh. Carries the new access token and, when available, the
 * updated expiration so the client can cache it and avoid triggering
 * another proactive refresh immediately.
 */
export interface TokenRefreshResult {
  accessToken: string;
  expiresAt?: Date | string;
}

/**
 * Token Refresh Callback
 *
 * Invoked by `AllegroHttpClient` on both proactive and reactive (401)
 * refresh paths. Implementations are responsible for serializing refresh
 * attempts across processes (e.g., via Redis lock in
 * `AllegroTokenRefreshService`).
 */
export type TokenRefreshCallback = (connectionId: string) => Promise<TokenRefreshResult>;

/**
 * Reason a reactive (401) token refresh did not succeed (#499).
 *
 *  - `no-callback` — no `tokenRefreshCallback` was registered on the
 *    `AllegroConnectionTokenState`. Should be impossible at runtime in
 *    production wiring; treated as auth failure for safety.
 *  - `credential-rejected` — the auth endpoint responded with 4xx/5xx,
 *    or the local pre-flight check rejected (missing refresh token /
 *    client credentials). Non-retryable: requires manual re-auth.
 *  - `network-failure` — the auth endpoint could not be reached
 *    (DNS / TLS / connection refused / abort / `TypeError: fetch failed`).
 *    Transient: callers should retry with backoff.
 */
export const RefreshOutcomeReasonValues = [
  'no-callback',
  'credential-rejected',
  'network-failure',
] as const;
export type RefreshOutcomeReason = (typeof RefreshOutcomeReasonValues)[number];

/**
 * Tagged-result return type for
 * `AllegroConnectionTokenState.refreshOnUnauthorized` (#499). Replaces the
 * previous lossy `boolean`, which collapsed transient network failures
 * into the same path as genuine credential rejection — the worker
 * classifier then marked otherwise-retryable jobs dead on attempt 1.
 */
export type RefreshOnUnauthorizedOutcome =
  | { ok: true }
  | { ok: false; reason: RefreshOutcomeReason; cause?: Error };
