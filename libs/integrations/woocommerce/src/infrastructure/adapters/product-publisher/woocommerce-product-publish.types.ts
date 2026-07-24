/**
 * WooCommerce Product-Publish Wire Types
 *
 * Request/response shapes for the WooCommerce REST API v3 `products`,
 * `products/{id}/variations`, and `products/categories` resources, as used by
 * `WooCommerceProductPublisherAdapter` (#1043). A single-variant / simple
 * product publishes as its own *simple* product (the pre-#1836 model,
 * unchanged). A **multi-variant** product publishes as one shared `variable`
 * parent + one `variations` subresource entry per sibling (#1836).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher
 */

/** WooCommerce native publication status values relevant to publish. */
export type WooCommerceProductStatus = 'publish' | 'draft' | 'pending' | 'private';

/**
 * Price/schedule/tax/dimension fields shared verbatim between the top-level
 * product body and the per-variation body — WooCommerce accepts the same
 * field names on both resources. Extracted so `applyCommerce` (adapter) has
 * one structural type to write against regardless of which body it targets.
 */
export interface WooCommercePriceCommerceFields {
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
  /** Tax class slug (empty string = "Standard"). */
  tax_class?: string;
  /** Tax treatment. */
  tax_status?: 'taxable' | 'shipping' | 'none';
  /** Product dimensions; each axis a string in the store's configured dimension unit. */
  dimensions?: { length?: string; width?: string; height?: string };
}

/**
 * Sparse create/update body for `POST|PUT /products`. Only supplied keys are
 * sent (WooCommerce treats omitted keys as "leave unchanged" on update). A
 * permissive index signature lets the adapter merge the command's un-modeled
 * `platformParams` (tax_class, shipping_class, …) without widening the typed
 * surface.
 */
export interface WooCommerceProductPublishRequest extends WooCommercePriceCommerceFields {
  name?: string;
  /** Product SKU / reference. Maps the neutral `PublishProductCommand.sku`. Absent for a `variable` parent (#1836) — SKU lives on each variation. */
  sku?: string;
  /** Native GTIN/EAN barcode field (WooCommerce 9.2+). Maps `PublishProductCommand.barcode`. Absent for a `variable` parent — barcode lives on each variation. */
  global_unique_id?: string;
  /** `'variable'` (#1836) declares a parent with `variations` subresource entries; `'simple'` is the pre-#1836 single-record model. */
  type?: 'simple' | 'variable';
  status?: WooCommerceProductStatus;
  regular_price?: string;
  description?: string;
  /** Short/excerpt description. Maps `PublishProductContent.shortDescription`. */
  short_description?: string;
  manage_stock?: boolean;
  stock_quantity?: number;
  /** Product weight in the store's configured weight unit (WooCommerce expects a string). */
  weight?: string;
  slug?: string;
  categories?: Array<{ id: number }>;
  /** Product tags (created on demand by name). Maps `PublishProductContent.tags`. */
  tags?: Array<{ name: string }>;
  images?: Array<{ src: string }>;
  /**
   * Product attributes. Three shapes share the array:
   * - Global-attribute linkage (#1835): `{ id, options, visible }` where `id`
   *   is the WC global-attribute (`pa_*` taxonomy) id and `options` are its
   *   term names/slugs — WC resolves the options to existing terms.
   * - Custom free-text (#1835): `{ name, options, visible }` — an ad-hoc
   *   per-product attribute with no taxonomy backing (the fallback).
   * - Variation-flagged (#1836): either shape plus `variation: true` — the
   *   parent's declared full option set for one distinguishing axis (e.g.
   *   Color: [Red, Blue]); only present on a `variable` parent.
   */
  attributes?: Array<WooCommerceProductAttribute>;
  /**
   * Arbitrary post-meta rows. Used to carry SEO title/description for the common
   * SEO plugins (Yoast / RankMath), which read product SEO from post meta rather
   * than a native WooCommerce field.
   */
  meta_data?: Array<{ key: string; value: string }>;
  [key: string]: unknown;
}

/**
 * One product-attribute wire item. `id` links a store-wide global attribute
 * (`pa_*` taxonomy); `name` names an ad-hoc custom attribute. Exactly one of the
 * two is sent per item — global linkage is preferred; custom is the fallback.
 */
export interface WooCommerceProductAttribute {
  /** Global-attribute id (`pa_*` taxonomy). Present for a linked global attribute. */
  id?: number;
  /** Custom-attribute name. Present for an ad-hoc free-text attribute. */
  name?: string;
  /** Term names/slugs (global) or free-text values (custom). */
  options: string[];
  visible: boolean;
  /**
   * Marks this attribute as a variation axis on a `variable` parent (#1836) —
   * WooCommerce requires this flag before a variation can select one of
   * `options` as its own distinguishing value. Absent/false on a plain
   * category-parameter attribute.
   */
  variation?: boolean;
}

/**
 * Sparse create/update body for `POST|PUT /products/{parentId}/variations`
 * (#1836). Carries the per-sibling fields (price/sku/stock/image/barcode) plus
 * this variation's own value for each of the parent's variation-flagged
 * attributes. Only supplied keys are sent, matching the parent body's
 * leave-unchanged-on-update convention.
 */
export interface WooCommerceVariationPublishRequest extends WooCommercePriceCommerceFields {
  /** Variation SKU / reference. Maps the neutral `PublishProductCommand.sku`. */
  sku?: string;
  /** Native GTIN/EAN barcode field. Maps `PublishProductCommand.barcode`. */
  global_unique_id?: string;
  status?: WooCommerceProductStatus;
  regular_price?: string;
  manage_stock?: boolean;
  stock_quantity?: number;
  /** Variation weight in the store's configured weight unit. */
  weight?: string;
  /** Single sideloaded image (create-only, mirroring the parent's image-churn guard, #1846 fix 7). */
  image?: { src: string };
  /**
   * This variation's own value for each parent variation-flagged attribute.
   * WC variation attributes carry a SINGULAR `option` (not the plural
   * `options` array the parent/simple-product attributes use).
   */
  attributes?: Array<{ id?: number; name?: string; option: string }>;
  [key: string]: unknown;
}

/** Minimal `products/{id}/variations` response shape the adapter reads (#1836). */
export interface WooCommerceVariationResponse {
  id: number;
  status?: WooCommerceProductStatus;
}

/** Minimal `products/attributes` response shape the adapter reads (#1835). */
export interface WooCommerceAttributeResponse {
  id: number;
  name: string;
  slug: string;
}

/** Minimal `products/attributes/{id}/terms` response shape the adapter reads (#1835). */
export interface WooCommerceAttributeTermResponse {
  id: number;
  name: string;
  slug: string;
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
