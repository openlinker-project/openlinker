/**
 * Amazon Access Token Types
 *
 * The contract the SP-API client needs from whatever supplies its LWA access
 * token, and the cached form of a minted token.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */

/** Supplies the LWA access token every SP-API call carries in `x-amz-access-token`. */
export interface AmazonAccessTokenSource {
  getAccessToken(): Promise<string>;
  /**
   * Forget `token` after Amazon refused it (HTTP 401), so the next
   * `getAccessToken()` mints a fresh one instead of replaying it until its
   * stated expiry. Optional: a source that cannot forget simply omits it.
   */
  invalidate?(token: string): Promise<void>;
}

/** A minted access token as kept in the process memo and the host cache. */
export interface AmazonAccessTokenEntry {
  readonly token: string;
  readonly expiresAtMs: number;
}
