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
}

/** A minted access token as kept in the process memo and the host cache. */
export interface AmazonAccessTokenEntry {
  readonly token: string;
  readonly expiresAtMs: number;
}
