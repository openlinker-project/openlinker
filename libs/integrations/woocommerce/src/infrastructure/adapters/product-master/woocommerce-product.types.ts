/**
 * WooCommerce Product API Types
 *
 * TypeScript request and response shapes for WooCommerce REST API v3
 * product-related payloads. Used by WooCommerceProductMasterAdapter and
 * WooCommerceProductMapper to serialize write requests and deserialize
 * API responses.
 *
 * All response fields are declared as optional where the WC API may omit them
 * (e.g. `price` is empty string on variable products, `meta_data` may be
 * absent on minimal-scope API keys).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-master
 */

export interface WooCommerceProduct {
  id?: number;
  name?: string;
  slug?: string;
  type?: 'simple' | 'variable' | 'grouped' | 'external';
  status?: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  description?: string;
  categories?: Array<{ id: number; name: string; slug: string }>;
  images?: Array<{ id: number; src: string; alt: string }>;
  attributes?: Array<{ id: number; name: string; position: number; options: string[] }>;
  variations?: number[];
  stock_quantity?: number | null;  // null = stock tracking disabled
  manage_stock?: boolean;
  stock_status?: string;           // 'instock' | 'outofstock' | 'onbackorder'
  weight?: string;
  /** Tax class SLUG, not a rate. `''` is the store's "standard" class (#2054). */
  tax_class?: string;
  tax_status?: 'taxable' | 'shipping' | 'none';
  date_created?: string;
  date_modified?: string;
  meta_data?: WooCommerceMetaEntry[];
}

export interface WooCommerceProductVariation {
  id?: number;
  sku?: string;
  price?: string;
  regular_price?: string;
  attributes?: Array<{ id: number; name: string; option: string }>;
  image?: { id: number; src: string } | null;
  stock_quantity?: number | null;  // null = stock tracking disabled
  manage_stock?: boolean;
  stock_status?: string;           // 'instock' | 'outofstock' | 'onbackorder'
  weight?: string;
  /**
   * Tax class SLUG. `'parent'` means "whatever the product says" and is the
   * WooCommerce default for a variation (#2054) - neither a rate of its own
   * nor a gap.
   */
  tax_class?: string;
  tax_status?: 'taxable' | 'shipping' | 'none';
  date_created?: string;
  date_modified?: string;
  meta_data?: WooCommerceMetaEntry[];
}

export interface WooCommerceProductCategory {
  id?: number;
  name?: string;
  slug?: string;
  parent?: number;
  count?: number;
}

export interface WooCommerceMetaEntry {
  id?: number;
  key: string;
  value: unknown;
}

export interface WooCommerceProductWriteRequest {
  name?: string;
  sku?: string;
  description?: string;
  regular_price?: string;
  weight?: string;
  status?: string;
  type?: string;
  categories?: Array<{ id: number }>;
}

export interface WooCommerceVariationWriteRequest {
  sku?: string;
  regular_price?: string;
  weight?: string;
  attributes?: Array<{ name: string; option: string }>;
}

/**
 * One row of the store's tax table (`GET /wp-json/wc/v3/taxes`).
 *
 * `rate` is a percent STRING (`'23.0000'`), not a fraction. `country` is empty
 * on a wildcard row that applies everywhere.
 */
export interface WooCommerceTaxRate {
  id?: number;
  country?: string;
  state?: string;
  postcode?: string;
  city?: string;
  rate?: string;
  name?: string;
  priority?: number;
  compound?: boolean;
  shipping?: boolean;
  order?: number;
  class?: string;
}

/** One row of `GET /wp-json/wc/v3/settings/general`. */
export interface WooCommerceGeneralSetting {
  id?: string;
  value?: string | string[];
}
