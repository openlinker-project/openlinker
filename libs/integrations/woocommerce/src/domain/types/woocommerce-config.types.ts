/**
 * WooCommerce Connection Config Types
 *
 * Non-secret per-connection configuration for the WooCommerce REST API v3
 * adapter. The only required field at v1 is `siteUrl` — the root URL of the
 * WordPress/WooCommerce installation.
 *
 * @module libs/integrations/woocommerce/src/domain/types
 */

/**
 * Fallback quantity reported for a WooCommerce product/variation that has
 * `manage_stock=false` and `stock_status='instock'`. WC does not track a
 * numeric quantity for unmanaged-stock products — it only flags in/out of
 * stock. Master inventory is authoritative downstream, so reporting 0 here
 * would de-list a sellable product on every marketplace. The cap is a finite
 * "treat as plenty available" stand-in; operators may override it per
 * connection via `inventory.unmanagedStockQuantity`.
 */
import type { WooCommerceOrdersConfig } from './woocommerce-orders-config.types';

export const DEFAULT_UNMANAGED_STOCK_QUANTITY = 1000;

export interface WooCommerceInventoryConfig {
  // Quantity reported for manage_stock=false + stock_status='instock' products.
  // Defaults to DEFAULT_UNMANAGED_STOCK_QUANTITY when absent.
  unmanagedStockQuantity?: number;
}

export interface WooCommerceConnectionConfig {
  // Must include protocol (http:// or https://).
  // Validated at save-time by WooCommerceConnectionConfigShapeValidatorAdapter:
  //   @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  // Trailing slash is stripped by WooCommerceHttpClient before use.
  // HTTP is accepted but HTTPS is strongly recommended — WC REST transmits
  // consumerKey:consumerSecret on every request (Basic Auth = cleartext over HTTP).
  // HTTPS enforcement is intentionally left to the FE form layer; the
  // config shape validator does not enforce transport security.
  siteUrl: string;

  // Optional per-connection inventory tuning (#969).
  inventory?: WooCommerceInventoryConfig;

  /** OrderSource capability configuration (#876). */
  orders?: WooCommerceOrdersConfig;
}
