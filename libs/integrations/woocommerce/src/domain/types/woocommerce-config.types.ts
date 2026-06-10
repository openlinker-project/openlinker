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
  // Must be an https:// URL.
  // Validated at save-time by WooCommerceConnectionConfigShapeValidatorAdapter:
  //   @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  // Trailing slash is stripped by WooCommerceHttpClient before use.
  // https-only is enforced: WC REST transmits consumerKey:consumerSecret on
  // every request (Basic Auth = cleartext over http), so http is rejected at
  // the config shape validator boundary.
  siteUrl: string;
}
