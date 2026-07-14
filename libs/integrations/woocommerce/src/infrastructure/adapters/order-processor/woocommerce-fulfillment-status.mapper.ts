/**
 * WooCommerce Fulfillment Status Mapper
 *
 * Pure mapper from a WooCommerce order's `status` field to the neutral
 * `FulfillmentStatusSnapshot` (#834 / #1550) — the WC → neutral read direction,
 * counterpart to the neutral → WC write direction owned by
 * {@link WC_ORDER_STATUS_MAP}. Reuses the shared WC status vocabulary from
 * `woocommerce-order-status.types.ts` (#1549) — there is a single source of
 * truth for the WooCommerce status set across every order sub-capability.
 *
 * **Status mapping rules** (conservative v1):
 *
 * - `completed` → `delivered`. WC has no distinct shipped/in-transit/delivered
 *   states — `completed` is the terminal fulfilled state and never transitions
 *   further, so it projects to the terminal neutral `delivered` (+ `deliveredAt`
 *   read from `date_completed_gmt`, falling back to `date_modified_gmt`).
 * - `cancelled` → `cancelled`.
 * - `refunded` → `cancelled`. A refund is a terminal reversal of the order; the
 *   writeback (#1549) already treats `refunded` as terminal alongside
 *   `completed`, so the read side mirrors it onto the only neutral terminal-
 *   reversal value available.
 * - `pending` / `processing` / `on-hold` / `failed` → `null`. The shop has not
 *   yet fulfilled the order (awaiting payment, processing, on hold, or a failed
 *   payment) — projection-only skip.
 * - An unknown / absent status → `null` (defensive: treat as not-yet-acted).
 *
 * **Tracking**: always `null`. WooCommerce core has no order-level tracking
 * field (it lives in the third-party Shipment Tracking plugin's meta_data),
 * mirroring the same limitation `updateFulfillment` documents on the write side.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 */
import type { FulfillmentStatus, FulfillmentStatusSnapshot } from '@openlinker/core/orders';
import { FULFILLMENT_STATUS } from '@openlinker/core/orders';

import type { WooCommerceOrderResponse } from './woocommerce-order.types';
import { WC_ORDER_STATUS_VALUES, type WooCommerceOrderStatus } from './woocommerce-order-status.types';

/**
 * WooCommerce status → neutral `FulfillmentStatus`. Keyed off the shared
 * {@link WooCommerceOrderStatus} vocabulary so a new WC status can't be added in
 * one place without the compiler flagging the missing branch here. `null` marks
 * the pre-fulfillment states the sync service skips (projection-only semantics).
 */
export const WC_FULFILLMENT_STATUS_MAP: Record<WooCommerceOrderStatus, FulfillmentStatus | null> = {
  pending: null,
  processing: null,
  'on-hold': null,
  completed: FULFILLMENT_STATUS.Delivered,
  cancelled: FULFILLMENT_STATUS.Cancelled,
  refunded: FULFILLMENT_STATUS.Cancelled,
  failed: null,
};

/**
 * Map a raw WooCommerce order `status` string to the neutral fulfillment status.
 * Returns `null` for pre-fulfillment states and for any unknown / absent value.
 */
export function mapWooCommerceStatus(status: string | undefined): FulfillmentStatus | null {
  if (status === undefined || !isKnownWooCommerceStatus(status)) {
    return null;
  }
  return WC_FULFILLMENT_STATUS_MAP[status];
}

/**
 * Project a WooCommerce order response onto the neutral fulfillment snapshot.
 * `deliveredAt` is populated only on the `delivered` transition, read from the
 * order's completion timestamp.
 */
export function mapToFulfillmentStatusSnapshot(
  order: WooCommerceOrderResponse,
): FulfillmentStatusSnapshot {
  const status = mapWooCommerceStatus(order.status);
  const deliveredAt =
    status === FULFILLMENT_STATUS.Delivered
      ? parseDate(order.date_completed_gmt ?? order.date_modified_gmt)
      : null;

  return {
    status,
    trackingNumber: null,
    deliveredAt,
  };
}

function isKnownWooCommerceStatus(status: string): status is WooCommerceOrderStatus {
  return (WC_ORDER_STATUS_VALUES as readonly string[]).includes(status);
}

/**
 * WooCommerce serialises GMT timestamps without a zone suffix (e.g.
 * `2026-07-14T10:30:00`). Append `Z` when no explicit offset is present so it
 * parses as UTC rather than local time. Returns `null` for absent / unparseable
 * values.
 */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const normalised = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const parsed = new Date(normalised);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
