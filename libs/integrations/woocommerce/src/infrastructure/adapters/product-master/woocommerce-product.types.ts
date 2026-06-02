/**
 * WooCommerce Product API Types
 *
 * TypeScript shapes for WooCommerce REST API v3 product-related responses.
 * Used exclusively by WooCommerceProductMasterAdapter and
 * WooCommerceProductMapper to deserialize WC API payloads.
 *
 * All fields are declared as optional where the WC API may omit them
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
  weight?: string;
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
  weight?: string;
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
