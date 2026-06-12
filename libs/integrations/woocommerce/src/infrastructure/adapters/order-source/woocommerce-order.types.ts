/**
 * WooCommerce REST API v3 Order Response Types
 *
 * External platform shapes for GET /wp-json/wc/v3/orders and
 * GET /wp-json/wc/v3/orders/{id}. Not domain model entities — raw API
 * response types used exclusively by WooCommerceOrderSourceAdapter.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-source
 */

export interface WooCommerceOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  date_created_gmt: string;
  date_modified: string;
  date_modified_gmt: string;
  customer_id: number; // 0 = guest
  billing: WooCommerceBillingAddress;
  shipping: WooCommerceShippingAddress;
  line_items: WooCommerceLineItem[];
  shipping_lines: WooCommerceShippingLine[];
  total: string; // decimal string
  total_tax: string; // decimal string
  shipping_total: string; // decimal string
  currency: string; // ISO 4217
  // NOTE: WC REST API v3 has NO top-level subtotal field.
  // Derived: total - total_tax - shipping_total
}

export interface WooCommerceBillingAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
  email: string;
  phone: string;
}

export interface WooCommerceShippingAddress {
  first_name: string;
  last_name: string;
  company: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

export interface WooCommerceLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id: number; // 0 when not a variation
  quantity: number;
  sku: string;
  price: string; // unit price, decimal string
  subtotal: string; // pre-discount line total
  total: string; // post-discount line total
  image: WooCommerceLineItemImage | null;
}

export interface WooCommerceLineItemImage {
  id: number;
  src: string;
}

export interface WooCommerceShippingLine {
  id: number;
  method_id: string;
  method_title: string;
  total: string;
}
