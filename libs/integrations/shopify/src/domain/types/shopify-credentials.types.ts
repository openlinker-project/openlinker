/**
 * Shopify Credentials Types
 *
 * Shape of the credentials payload encrypted at rest in
 * `integration_credentials`: a pre-issued Admin API access token, or the app's
 * client id + secret for the client-credentials grant (live, L-C1: works for an
 * app and a store in the same organization and needs no redirect endpoint).
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyCredentials {
  /** Pre-issued Admin API access token (`shpat_...`). Wins over the client pair when present. */
  readonly accessToken?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
}
