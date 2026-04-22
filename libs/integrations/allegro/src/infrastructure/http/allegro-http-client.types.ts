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
