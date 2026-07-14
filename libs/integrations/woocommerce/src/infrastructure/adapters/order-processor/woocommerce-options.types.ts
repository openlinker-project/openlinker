/**
 * WooCommerce Destination-Options Types (#1551)
 *
 * Response shapes and vocabulary powering `DestinationOptionsReader` on
 * `WooCommerceOrderProcessorAdapter` — the option lists the connection-mappings
 * UI renders so operators can build source->destination status / carrier /
 * payment maps. Only the fields the adapter actually consumes are typed; the WC
 * REST API returns much more, ignored here to keep the surface tight.
 *
 * - Order statuses come from the static WC vocabulary (`WC_ORDER_STATUS_VALUES`)
 *   decorated with display labels — WC exposes no dedicated status-catalogue
 *   endpoint, and the core set is fixed by the WC REST API v3 contract.
 * - Payment methods come from `GET /payment_gateways`.
 * - Carriers come from `GET /shipping_methods` (see the adapter for the
 *   rationale on why WC shipping-method *types* stand in for carriers).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 */
import type { WooCommerceOrderStatus } from './woocommerce-order-status.types';

/**
 * Human-readable labels for each WC core order status, matching WooCommerce's
 * own admin wording. Used to decorate the static status vocabulary into neutral
 * `MappingOption`s.
 */
export const WC_ORDER_STATUS_LABELS: Record<WooCommerceOrderStatus, string> = {
  pending: 'Pending payment',
  processing: 'Processing',
  'on-hold': 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
  failed: 'Failed',
};

/**
 * `GET /payment_gateways` row. `id` is the stable gateway code persisted by
 * mapping config (e.g. `bacs`, `cod`, `cheque`, `paypal`); `title` is the
 * operator-facing label; `enabled` reflects whether the gateway is active in
 * the store.
 */
export interface WooCommercePaymentGateway {
  id: string;
  title?: string;
  enabled?: boolean;
}

/**
 * `GET /shipping_methods` row. WC returns the globally-registered shipping
 * *method types* (`flat_rate`, `free_shipping`, `local_pickup`, plugin-provided
 * types), not per-zone carrier instances. `id` is the stable method code;
 * `title` is the display name.
 */
export interface WooCommerceShippingMethod {
  id: string;
  title?: string;
}
