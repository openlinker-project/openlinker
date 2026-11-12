/**
 * Shopify Credentials Types
 *
 * Shape of the credentials payload encrypted at rest in
 * `integration_credentials`. Three ways to reach the Admin API:
 *
 *   - a pre-issued Admin API access token (`accessToken` only), used as is;
 *   - the app's client id + secret, exchanged through the client-credentials
 *     grant for a ~24 h token (works only for a store in the app's own
 *     organization, L-C1); the minted token lives in the cache, never here;
 *   - an OAuth install (`grant: 'oauth'`), for a store in another
 *     organization: an EXPIRING offline token plus a rotating refresh token,
 *     both written here and replaced on every refresh.
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyCredentials {
  /** Pre-issued token, or the current OAuth access token when `grant` is `'oauth'`. */
  readonly accessToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  /** Set by the OAuth install; absent for the two other modes. */
  readonly grant?: 'oauth';
  readonly refreshToken?: string;
  /** ISO instant the OAuth access token expires at. */
  readonly expiresAt?: string;
  /** ISO instant the OAuth refresh token expires at (90 days after issue). */
  readonly refreshTokenExpiresAt?: string;
}

/** How a set of credentials reaches the API; derived, never stored. */
export const ShopifyCredentialModeValues = ['access-token', 'client-credentials', 'oauth'] as const;
export type ShopifyCredentialMode = (typeof ShopifyCredentialModeValues)[number];
