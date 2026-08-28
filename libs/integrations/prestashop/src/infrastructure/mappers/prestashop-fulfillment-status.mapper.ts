/**
 * PrestaShop Fulfillment Status Mapper
 *
 * Pure mappers from PrestaShop's order + state model to the neutral
 * `FulfillmentStatusSnapshot` (#834). Three exported helpers, all sync +
 * side-effect-free:
 *
 *   - `mapToFulfillmentStatusSnapshot(order, state, trackingNumber)` —
 *     the projection mapping; takes a pre-resolved `trackingNumber` so the
 *     caller controls whether the carriers WS fetch was needed.
 *   - `extractTrackingFromOrder(order)` — read the legacy on-order
 *     `shipping_number` field (`null` if absent/empty).
 *   - `extractTrackingFromCarriers(orderCarriers)` — first non-empty
 *     `tracking_number` across the supplied carrier rows.
 *
 * The split lets `PrestashopOrderProcessorManagerAdapter.getFulfillmentStatus`
 * lazy-fetch `order_carriers` only when `shipping_number` is empty —
 * halving WS round-trips at scale, since most operators populate
 * `shipping_number` directly when they print the label.
 *
 * **Status mapping rules** (conservative v1):
 *
 * - `state.delivered === '1'` → `'delivered'` (+ `deliveredAt = order.date_upd`).
 * - `state.shipped === '1' && state.delivered !== '1'` → `'dispatched'`
 *   (PS has handed off to carrier).
 * - `state.name` reads as a cancellation → `'cancelled'`. The vocabulary and
 *   its documented gaps live in one place, `prestashop-order-state-semantics`,
 *   which both this mapper and the order-status derivation now share.
 * - Otherwise → `status: null` (PS has not yet acted on the order —
 *   projection-only skip).
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */

import type {
  FulfillmentStatus,
  FulfillmentStatusSnapshot,
} from '@openlinker/core/orders';
import { FULFILLMENT_STATUS } from '@openlinker/core/orders';

import type {
  PrestashopOrder,
  PrestashopOrderCarrier,
} from './prestashop.mapper.interface';
import { isCancelledOrderState, isTruthyStateFlag } from './prestashop-order-state-semantics';
import type { PrestashopOrderState } from '../../domain/types/prestashop-options.types';

export function mapToFulfillmentStatusSnapshot(
  order: PrestashopOrder,
  state: PrestashopOrderState | null,
  trackingNumber: string | null,
): FulfillmentStatusSnapshot {
  const status = mapStatus(state);
  const dateUpd = parseDate(order.date_upd);
  const deliveredAt = status === FULFILLMENT_STATUS.Delivered ? dateUpd : null;

  return {
    status,
    trackingNumber,
    deliveredAt,
  };
}

/**
 * Read the legacy `shipping_number` field directly off the PS order.
 * Returns `null` when absent / non-string / empty so the caller can fall
 * back to the carriers fetch without re-narrowing.
 *
 * `shipping_number` is not in the typed `PrestashopOrder` surface; it's a
 * direct-on-order field accessed via the index signature. Narrow `unknown`
 * per engineering-standards §"Type Safety".
 */
export function extractTrackingFromOrder(order: PrestashopOrder): string | null {
  const shippingNumber = (order as Record<string, unknown>)['shipping_number'];
  if (typeof shippingNumber === 'string' && shippingNumber.length > 0) {
    return shippingNumber;
  }
  return null;
}

/**
 * First non-empty `tracking_number` across the supplied carrier rows, or
 * `null` if none.
 */
export function extractTrackingFromCarriers(
  orderCarriers: readonly PrestashopOrderCarrier[],
): string | null {
  for (const row of orderCarriers) {
    const tracking = row.tracking_number;
    if (typeof tracking === 'string' && tracking.length > 0) {
      return tracking;
    }
  }
  return null;
}

function mapStatus(state: PrestashopOrderState | null): FulfillmentStatus | null {
  if (!state) return null;
  if (isTruthyStateFlag(state.delivered)) {
    return FULFILLMENT_STATUS.Delivered;
  }
  if (isTruthyStateFlag(state.shipped)) {
    return FULFILLMENT_STATUS.Dispatched;
  }
  // One cancellation vocabulary for the whole adapter (#2607 review). This
  // mapper carried its own copy, so a fix to one left the other wrong.
  if (isCancelledOrderState(state)) {
    return FULFILLMENT_STATUS.Cancelled;
  }
  return null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
