/**
 * Shopify Connection Config Types
 *
 * Shape of the `Connection.config` JSONB blob of a Shopify connection, and the
 * normalised form the factory works with.
 *
 * @module libs/integrations/shopify/src/domain/types
 */

export interface ShopifyConnectionConfig {
  /** The shop's permanent `*.myshopify.com` domain (never a custom storefront domain). */
  readonly storeDomain: string;
  /** Admin API version, `YYYY-MM`; `SHOPIFY_DEFAULT_API_VERSION` when absent. */
  readonly apiVersion?: string;
  /**
   * The ONE Shopify location OpenLinker reads and writes stock at, as a
   * Location GID or its numeric id. Absent means the shop's primary location.
   * OpenLinker runs as a single warehouse until multi-location support arrives
   * with a WMS, so stock at any other location is deliberately invisible.
   */
  readonly locationId?: string;
  /**
   * Refunds confirmed in OpenLinker are sent to Shopify as `refundCreate`
   * (money moves on Shopify Payments). Off unless exactly `true`: without it
   * a confirmed refund is recorded as made out of band, as before.
   */
  readonly refundsThroughShopify?: boolean;
}

/** `ShopifyConnectionConfig` after validation and normalisation. */
export interface ShopifyResolvedConfig {
  readonly storeDomain: string;
  readonly apiVersion: string;
  /** Location GID, or null when the primary location is resolved at runtime. */
  readonly locationGid: string | null;
  /** `config.refundsThroughShopify === true`. */
  readonly refundsThroughShopify: boolean;
}
