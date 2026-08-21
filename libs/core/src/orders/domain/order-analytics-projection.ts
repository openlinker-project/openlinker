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
  /**
   * The settled per-line tax rate, transcribed from the order snapshot (#2250).
   *
   * TRANSCRIBED, never settled here. The snapshot is the only place a rate is
   * decided (ADR-052 § 4); this row is the queryable copy, so an analytics read
   * never has to expand JSON to answer "which lines carry which rate".
   */
  taxRate: string | null;
  /**
   * Which system stated it - `shop` or `channel` - or `null` when nothing did.
   *
   * Carried alongside the rate rather than derived from it, because *no rate*,
   * *never read* and *pre-rollout* are three different facts and a single null
   * rate cannot tell them apart (#2245 F3).
   */
  taxSource: string | null;
  /** When that system was last read. Shown, never enforced: there is no freshness rule. */
  taxRateReadAt: Date | null;
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
  return order.items.map((item, lineNumber) => ({
    lineNumber,
    productId: item.productId,
    variantId: item.variantId ?? null,
    quantity: item.quantity,
    unitPrice: item.price,
    sourceConnectionId,
    placedAt,
    // #2250 — a straight copy. Parsing or defaulting here would make the row
    // disagree with the snapshot it transcribes, and the snapshot is the one
    // that issues documents.
    taxRate: item.taxRate ?? null,
    taxSource: item.taxSource ?? null,
    taxRateReadAt: item.taxRateReadAt ? new Date(item.taxRateReadAt) : null,
  }));
}
