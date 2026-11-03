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
 * **Status mapping rules** — one reading of a state for the whole adapter
 * (#3506): the status comes from `deriveOrderState`, the same derivation the
 * order feed and the outbound state resolution use, so the three cannot
 * disagree about what a state means.
 *
 * - `delivered` (a `shipped` state whose label reads as delivered) →
 *   `'delivered'` (+ `deliveredAt = order.date_upd`).
 * - `shipped` → `'dispatched'` (PS has handed off to carrier).
 * - `cancelled` → `'cancelled'`.
 * - Anything else → `status: null` (PS has not yet acted on the order —
 *   projection-only skip). `refunded` lands here too, as it always has: a
 *   refund says nothing about where the parcel is.
 *
 * The previous rule read a `state.delivered` flag PrestaShop does not have, so
 * a shop's "Delivered" state was projected as `'dispatched'` (G02-7).
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
import { deriveOrderState, type OrderStateDerivation } from './prestashop-order-state-semantics';
import type { PrestashopOrderState } from '../../domain/types/prestashop-options.types';

export function mapToFulfillmentStatusSnapshot(
  order: PrestashopOrder,
  state: PrestashopOrderState | null,
  trackingNumber: string | null,
): FulfillmentStatusSnapshot {
  const status = state === null ? null : mapStatus(deriveOrderState(state));
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

function mapStatus(derivation: OrderStateDerivation): FulfillmentStatus | null {
  switch (derivation.status) {
    case 'delivered':
      return FULFILLMENT_STATUS.Delivered;
    case 'shipped':
      return FULFILLMENT_STATUS.Dispatched;
    case 'cancelled':
      return FULFILLMENT_STATUS.Cancelled;
    default:
      return null;
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
