/**
 * WooCommerce Order Adapter Types
 *
 * Request and response shapes for WooCommerce REST API v3 order and customer
 * operations, plus the OL OrderStatus → WC status mapping constant.
 *
 * All response fields are declared optional where the WC API may omit them.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 */
import type { OrderStatus } from '@openlinker/core/orders';

// ─── Status map ───────────────────────────────────────────────────────────────
// Exported as a constant so tests can import and verify it without instantiating
// the adapter (DRY, single source of truth for the WC status mapping).

export const WC_ORDER_STATUS_MAP: Record<OrderStatus, string> = {
  pending:    'pending',
  processing: 'processing',
  shipped:    'completed',
  delivered:  'completed',
  cancelled:  'cancelled',
  refunded:   'refunded',
};

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
