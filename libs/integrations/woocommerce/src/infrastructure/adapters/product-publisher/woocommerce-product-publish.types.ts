/**
 * WooCommerce Product-Publish Wire Types
 *
 * Request/response shapes for the WooCommerce REST API v3 `products` and
 * `products/categories` resources, as used by `WooCommerceProductPublisherAdapter`
 * (#1043). Each OL variant publishes as its own *simple* product (the #1042
 * model is variant-keyed); the variations subresource is a deferred enhancement.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher
 */

/** WooCommerce native publication status values relevant to publish. */
export type WooCommerceProductStatus = 'publish' | 'draft' | 'pending' | 'private';

/**
 * Sparse create/update body for `POST|PUT /products`. Only supplied keys are
 * sent (WooCommerce treats omitted keys as "leave unchanged" on update). A
 * permissive index signature lets the adapter merge the command's un-modeled
 * `platformParams` (tax_class, shipping_class, …) without widening the typed
 * surface.
 */
export interface WooCommerceProductPublishRequest {
  name?: string;
  /** Product SKU / reference. Maps the neutral `PublishProductCommand.sku`. */
  sku?: string;
  /** Native GTIN/EAN barcode field (WooCommerce 9.2+). Maps `PublishProductCommand.barcode`. */
  global_unique_id?: string;
  type?: 'simple';
  status?: WooCommerceProductStatus;
  regular_price?: string;
  /** Discounted price (amount only; WooCommerce applies the store currency). */
  sale_price?: string;
  /**
   * UTC/GMT datetime the sale price becomes active. The `_gmt` variant (not the
   * site-local `date_on_sale_from`) is used so the neutral UTC input is honoured
   * regardless of the store's timezone.
   */
  date_on_sale_from_gmt?: string;
  /** UTC/GMT datetime the sale price expires (see `date_on_sale_from_gmt`). */
  date_on_sale_to_gmt?: string;
  description?: string;
  /** Short/excerpt description. Maps `PublishProductContent.shortDescription`. */
  short_description?: string;
  manage_stock?: boolean;
  stock_quantity?: number;
  /** Product weight in the store's configured weight unit (WooCommerce expects a string). */
  weight?: string;
  /** Product dimensions; each axis a string in the store's configured dimension unit. */
  dimensions?: { length?: string; width?: string; height?: string };
  /** Tax class slug (empty string = "Standard"). */
  tax_class?: string;
  /** Tax treatment. */
  tax_status?: 'taxable' | 'shipping' | 'none';
  slug?: string;
  categories?: Array<{ id: number }>;
  /** Product tags (created on demand by name). Maps `PublishProductContent.tags`. */
  tags?: Array<{ name: string }>;
  images?: Array<{ src: string }>;
  /** Per-product custom attributes (preferred over global-attribute-on-variation in v1). */
  attributes?: Array<{ name: string; options: string[]; visible: boolean }>;
  /**
   * Arbitrary post-meta rows. Used to carry SEO title/description for the common
   * SEO plugins (Yoast / RankMath), which read product SEO from post meta rather
   * than a native WooCommerce field.
   */
  meta_data?: Array<{ key: string; value: string }>;
  [key: string]: unknown;
}

/** Minimal `products` response shape the adapter reads. */
export interface WooCommerceProductResponse {
  id: number;
  status: WooCommerceProductStatus;
}

/**
 * Minimal `GET /products/{id}` response shape the status reconcile reads (#1845).
 * `status` is a broad `string` (not the publish-time union) because a live read
 * can return states the publish path never sets - notably `'trash'`.
 */
export interface WooCommerceProductStatusResponse {
  id: number;
  status: string;
}

/** Minimal `products/categories` response shape the adapter reads. */
export interface WooCommerceCategoryResponse {
  id: number;
  name: string;
  parent: number;
  slug: string;
}
