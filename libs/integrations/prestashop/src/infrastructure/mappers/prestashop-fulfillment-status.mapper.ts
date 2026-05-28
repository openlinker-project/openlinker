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
 * - `state.name` matches cancel-regex → `'cancelled'` (the regex-fallback
 *   gap, pending operator-configurable mapping under #862).
 *   - **Latin-script coverage**: EN (`cancel/cancelled/rejected`),
 *     FR (`annulé`), ES (`anulado`), IT (`annullato`), PT (`cancelado`),
 *     PL (`anulowano`/`anulowane`), CS/SK (`storno`), DE (`abgebrochen`),
 *     RO (`anulat`).
 *   - **Known gap — non-Latin scripts**: HU (`törölt`), RU (`отменён`),
 *     UA, BG. Storefronts in those languages will MISS cancellation
 *     detection in v1 and the row will stay in `dispatched`. Closed by
 *     #862's operator-configurable PS→OL state mapping table.
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
import type { PrestashopOrderState } from '../../domain/types/prestashop-options.types';

const TRUE_VALUES: ReadonlySet<string> = new Set(['1', 'true']);
const CANCEL_REGEX = /cancel|annul|anul|storno|reject|abge/i;

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
  if (isTruthyFlag(state.delivered)) {
    return FULFILLMENT_STATUS.Delivered;
  }
  if (isTruthyFlag(state.shipped)) {
    return FULFILLMENT_STATUS.Dispatched;
  }
  if (matchesCancel(state.name)) {
    return FULFILLMENT_STATUS.Cancelled;
  }
  return null;
}

function isTruthyFlag(value: string | number | undefined): boolean {
  if (value === undefined) return false;
  return TRUE_VALUES.has(String(value));
}

/**
 * `PrestashopOrderState.name` is either a flat string (single-language PS
 * install) or the multi-language shape `{ language: [{ '#text': … }] }` /
 * `{ language: { '#text': … } }`. Walk the shape and match on any
 * available label so multilingual stores get correct cancellation
 * detection without needing the operator to set a specific lang.
 */
function matchesCancel(name: PrestashopOrderState['name']): boolean {
  for (const label of extractAllLabels(name)) {
    if (CANCEL_REGEX.test(label)) return true;
  }
  return false;
}

function extractAllLabels(name: PrestashopOrderState['name']): readonly string[] {
  if (typeof name === 'string') return [name];
  if (name === null || name === undefined) return [];
  if (typeof name !== 'object') return [];
  const obj = name as Record<string, unknown>;
  const language = obj['language'];
  const labels: string[] = [];
  if (Array.isArray(language)) {
    for (const entry of language) {
      const label = extractTextLabel(entry);
      if (label) labels.push(label);
    }
  } else if (language && typeof language === 'object') {
    const label = extractTextLabel(language);
    if (label) labels.push(label);
  }
  return labels;
}

function extractTextLabel(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const text = (value as Record<string, unknown>)['#text'];
    if (typeof text === 'string') return text;
  }
  return null;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
