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
  // Must include the https:// protocol.
  // Validated at save-time by WooCommerceConnectionConfigShapeValidatorAdapter:
  //   @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  // Trailing slash is stripped by WooCommerceHttpClient before use.
  // HTTPS is required — WC REST transmits consumerKey:consumerSecret on every
  // request (Basic Auth), so cleartext HTTP is rejected at save-time.
  siteUrl: string;
}
