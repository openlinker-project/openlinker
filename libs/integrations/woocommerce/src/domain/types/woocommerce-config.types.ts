/**
 * WooCommerce Connection Config Types
 *
 * Non-secret per-connection configuration for the WooCommerce REST API v3
 * adapter. The only required field at v1 is `siteUrl` — the root URL of the
 * WordPress/WooCommerce installation.
 *
 * @module libs/integrations/woocommerce/src/domain/types
 */
import type { WooCommerceOrdersConfig } from './woocommerce-orders-config.types';

export interface WooCommerceConnectionConfig {
  // Must be an https:// URL.
  // Validated at save-time by WooCommerceConnectionConfigShapeValidatorAdapter:
  //   @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  // Trailing slash is stripped by WooCommerceHttpClient before use.
  // HTTPS is required — WC REST transmits consumerKey:consumerSecret as
  // Basic Auth on every request; http:// would send credentials in cleartext.
  // localhost and 127.x are accepted for local development (HTTPS not needed
  // on loopback since traffic stays on the same machine).
  siteUrl: string;

  /** OrderSource capability configuration (#876). */
  orders?: WooCommerceOrdersConfig;
}
