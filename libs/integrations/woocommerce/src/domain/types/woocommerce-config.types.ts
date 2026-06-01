/**
 * WooCommerce Connection Config Types
 *
 * Non-secret per-connection configuration for the WooCommerce REST API v3
 * adapter. The only required field at v1 is `siteUrl` — the root URL of the
 * WordPress/WooCommerce installation.
 *
 * @module libs/integrations/woocommerce/src/domain/types
 */

export interface WooCommerceConnectionConfig {
  // Must include protocol (http:// or https://).
  // Validated at save-time by WooCommerceConnectionConfigShapeValidatorAdapter:
  //   @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  // Trailing slash is stripped by WooCommerceHttpClient before use.
  // HTTP is accepted but HTTPS is strongly recommended — WC REST transmits
  // consumerKey:consumerSecret on every request (Basic Auth = cleartext over HTTP).
  // HTTPS enforcement is intentionally left to the FE form layer, consistent
  // with Allegro and InPost validators which also don't enforce it.
  siteUrl: string;
}
