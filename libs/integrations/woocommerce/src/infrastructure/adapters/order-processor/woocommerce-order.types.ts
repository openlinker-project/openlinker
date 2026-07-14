/**
 * WooCommerce Order Adapter Types
 *
 * Request and response shapes for WooCommerce REST API v3 order and customer
 * operations.
 *
 * All response fields are declared optional where the WC API may omit them.
 *
 * The OL `OrderStatus` → WC status map and the WC status vocabulary live in the
 * dedicated `woocommerce-order-status.types.ts` module (shared across the order
 * sub-capabilities); they are re-exported here for import-path stability.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 */

// ─── Status map (re-exported from the dedicated status module) ──────────────────

export { WC_ORDER_STATUS_MAP, WC_ORDER_STATUS_VALUES } from './woocommerce-order-status.types';
export type { WooCommerceOrderStatus } from './woocommerce-order-status.types';

// ─── Order shapes ─────────────────────────────────────────────────────────────

export interface WooCommerceOrderAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface WooCommerceLineItemRequest {
  product_id: number;
  variation_id?: number;
  quantity: number;
  /**
   * `price` is read-only in WC REST API — it reflects catalog price, not buyer-paid price.
   * Use `subtotal` / `total` to pin the buyer-paid amounts. Sending `price` has no effect
   * (WC silently ignores it) but we omit it to keep the payload clean.
   */
  subtotal?: string;
  total?: string;
  name?: string;
}

export interface WooCommerceShippingLineRequest {
  method_id: string;
  method_title: string;
  total: string;
}

export interface WooCommerceOrderCreateRequest {
  status: string;
  customer_id?: number;
  billing?: WooCommerceOrderAddress;
  shipping?: WooCommerceOrderAddress;
  line_items: WooCommerceLineItemRequest[];
  shipping_lines?: WooCommerceShippingLineRequest[];
  payment_method?: string;
  payment_method_title?: string;
  set_paid?: boolean;
  meta_data?: Array<{ key: string; value: string }>;
}

export interface WooCommerceOrderUpdateRequest {
  status: string;
}

export interface WooCommerceOrderResponse {
  id?: number;
  number?: string;
  status?: string;
  /** GMT timestamp WC stamps when an order transitions to `completed`. */
  date_completed_gmt?: string;
  /** GMT timestamp of the order's last modification — `deliveredAt` fallback. */
  date_modified_gmt?: string;
}

// ─── Customer shapes ──────────────────────────────────────────────────────────

export interface WooCommerceCustomerCreateRequest {
  email: string;
  first_name?: string;
  last_name?: string;
}

export interface WooCommerceCustomerResponse {
  id?: number;
  email?: string;
  first_name?: string;
  last_name?: string;
}
