/**
 * WooCommerce Order Status Vocabulary and Mapping
 *
 * The shared, single source of truth for translating between OpenLinker's
 * neutral `OrderStatus` and WooCommerce's own order-status vocabulary. Kept in a
 * dedicated `*.types.ts` module (per the `as const` convention) so every
 * WooCommerce order sub-capability reuses the same map and vocabulary without
 * duplication:
 * - `OrderStatusWriteback` / `OrderFulfillmentUpdater` / `createOrder` (#1549) —
 *   neutral → WC direction via {@link WC_ORDER_STATUS_MAP}.
 * - `FulfillmentStatusReader` (#1550) — WC → neutral direction, keyed off
 *   {@link WooCommerceOrderStatus}.
 * - `DestinationOptionsReader` (#1551) — enumerates the WC status vocabulary via
 *   {@link WC_ORDER_STATUS_VALUES}.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 */
import type { OrderStatus } from '@openlinker/core/orders';

/**
 * The WooCommerce core order-status vocabulary (WC REST API v3). Declared as a
 * runtime array so consumers can enumerate it (option pickers, validation)
 * without an enum runtime artifact.
 */
export const WC_ORDER_STATUS_VALUES = [
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
] as const;

/** A WooCommerce core order status. */
export type WooCommerceOrderStatus = (typeof WC_ORDER_STATUS_VALUES)[number];

/**
 * Neutral `OrderStatus` → WooCommerce status. Lossy best-effort: WC has no
 * distinct `shipped` state, so both `shipped` and `delivered` collapse onto
 * `completed`. Exported so tests and sibling sub-capabilities verify it without
 * instantiating an adapter.
 */
export const WC_ORDER_STATUS_MAP: Record<OrderStatus, WooCommerceOrderStatus> = {
  pending: 'pending',
  processing: 'processing',
  shipped: 'completed',
  delivered: 'completed',
  cancelled: 'cancelled',
  refunded: 'refunded',
};
