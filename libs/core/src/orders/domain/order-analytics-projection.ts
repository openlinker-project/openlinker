/**
 * orderAnalyticsProjection — derive the #1985 read-model scalars + line items from an Order
 *
 * Pure derivation (no I/O): called by `OrderRecordService.persistOrder` at the
 * moment a `ready` order is persisted, to populate the denormalized
 * `OrderRecord` scalars (`placedAt`/`currency`/`taxTreatment`/`totalAmount`)
 * and the `order_line_items` rows — see ADR-039 for the persistence-strategy
 * decision. Deliberately never throws: a malformed/partial `Order` degrades to
 * `null` scalars or an empty item list rather than failing the whole ingest.
 *
 * @module libs/core/src/orders/domain
 */
import type { Order, PriceTaxTreatment } from './types/order.types';

/**
 * Order-level analytics scalars denormalized onto `OrderRecord` (#1985).
 */
export interface OrderAnalyticsScalars {
  placedAt: Date | null;
  currency: string | null;
  taxTreatment: PriceTaxTreatment | null;
  totalAmount: number | null;
}

/**
 * Derive the 4 order-level scalars from an already-resolved {@link Order}.
 * Pure function of its own argument — no I/O, never throws.
 */
export function deriveOrderAnalyticsScalars(order: Order): OrderAnalyticsScalars {
  return {
    placedAt: order.placedAt ?? null,
    currency: order.totals?.currency ?? null,
    taxTreatment: order.totals?.taxTreatment ?? null,
    totalAmount: typeof order.totals?.total === 'number' ? order.totals.total : null,
  };
}

/**
 * One order line, projected for `order_line_items` (#1985). Plain data shape
 * (not the `OrderLineItem` domain entity) — `id`/`createdAt` are assigned by
 * the persistence layer, not derived here.
 */
export interface OrderLineItemDraft {
  lineNumber: number;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  sourceConnectionId: string;
  placedAt: Date | null;
}

/**
 * Derive one draft line item per entry in `order.items[]`. `lineNumber` is the
 * array index — the identity key `OrderRecordRepository.upsertWithLineItems`
 * uses to replace a prior write for the same order idempotently. Returns `[]`
 * for an order with no items (never throws).
 */
export function deriveOrderLineItems(
  order: Order,
  sourceConnectionId: string
): OrderLineItemDraft[] {
  const placedAt = order.placedAt ?? null;
  return (order.items ?? []).map((item, lineNumber) => ({
    lineNumber,
    productId: item.productId,
    variantId: item.variantId ?? null,
    quantity: item.quantity,
    unitPrice: item.price,
    sourceConnectionId,
    placedAt,
  }));
}
