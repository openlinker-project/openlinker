/**
 * Shopify Connection Config Types
 *
 * Shape of the `Connection.config` JSONB blob of a Shopify connection, and
 * the normalised form the client builder works with.
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyConnectionConfig {
  /** The shop's permanent `*.myshopify.com` domain (never a custom storefront domain). */
  readonly storeDomain: string;
  /** Admin API version, one of `SHOPIFY_SUPPORTED_API_VERSIONS`; the default when absent. */
  readonly apiVersion?: string;
  /**
   * The ONE Shopify location OpenLinker reads and writes stock at, as a
   * Location GID or its numeric id. Absent means the shop's primary location.
   * OpenLinker runs as a single warehouse until multi-location support
   * arrives with a WMS, so stock at any other location is invisible.
   */
  readonly locationId?: string;
  /**
   * Quantity reported for a variant whose inventory Shopify does not track
   * (`tracked: false`, "always available"). Absent means
   * `SHOPIFY_DEFAULT_UNMANAGED_STOCK_QUANTITY` (1000, the WooCommerce
   * convention, L-I1).
   */
  readonly unmanagedStockQuantity?: number;
  /**
   * ISO 3166-1 alpha-2 country the catalogue's tax rate is computed for
   * (`ProductTaxRateReader`). Absent means the shop's own billing country.
   */
  readonly salesCountryIso2?: string;
  /**
   * Opt-in (#3977, C20): a refund OpenLinker confirms is sent to Shopify as a
   * `refundCreate`, which moves the buyer's money on Shopify Payments. Absent
   * or false: a confirmed refund is only recorded, as made outside OpenLinker.
   */
  readonly refundsThroughShopify?: boolean;
}

/** `ShopifyConnectionConfig` after validation and normalisation. */
export interface ShopifyResolvedConfig {
  readonly storeDomain: string;
  readonly apiVersion: string;
  /** Location GID, or null when the primary location is resolved at runtime. */
  readonly locationGid: string | null;
  readonly unmanagedStockQuantity: number | null;
  readonly salesCountryIso2: string | null;
  readonly refundsThroughShopify: boolean;
}
