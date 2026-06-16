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
  type?: 'simple';
  status?: WooCommerceProductStatus;
  regular_price?: string;
  description?: string;
  manage_stock?: boolean;
  stock_quantity?: number;
  slug?: string;
  categories?: Array<{ id: number }>;
  images?: Array<{ src: string }>;
  /** Per-product custom attributes (preferred over global-attribute-on-variation in v1). */
  attributes?: Array<{ name: string; options: string[]; visible: boolean }>;
  [key: string]: unknown;
}

/** Minimal `products` response shape the adapter reads. */
export interface WooCommerceProductResponse {
  id: number;
  status: WooCommerceProductStatus;
}

/** Minimal `products/categories` response shape the adapter reads. */
export interface WooCommerceCategoryResponse {
  id: number;
  name: string;
  parent: number;
  slug: string;
}
