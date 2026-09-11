/**
 * Return line -> order line resolution (#3171)
 *
 * Answers, for one returned line, WHICH order line it came from — so
 * `ReturnLine.resolvedOrderLineId` can hold the `orderSnapshot.items[].id` the
 * rest of the platform already keys on (`reservations.orderLineId`,
 * `shipment_lines.lineId`, `FulfillmentWorkLine.orderLineId`).
 *
 * Why this exists at all: the credit-note correction path matched disposed
 * return lines against the issued invoice **by product name** — the one axis
 * guaranteed to collide — and then escalated the collision to the operator as
 * an `ambiguous` line with a two-option picker. That question is unanswerable
 * (the operator holds a parcel; `InvoiceLine` carries no id and no SKU, and
 * both candidates carry the same name) and it is manufactured: OpenLinker
 * builds the invoice itself from `order.items` in order, so invoice line N is
 * `order.items[N-1]`, and the return line arrives carrying `sku` and
 * `unitPrice`. Resolving here removes the collision instead of delegating it.
 *
 * Pure by contract: no I/O, no injected dependency, no argument mutation — the
 * shape `return-correction-matching.domain-service.ts` and
 * `evaluateSalesDocumentRules` already hold, and what makes this rule testable
 * against a table of fixtures rather than a database.
 *
 * **It refuses rather than guesses.** `NrWierszaFa` is mandatory in every
 * permitted FA(3) correction method, so a guessed line is an unauditable entry
 * in a document filed with the tax office. An unresolved line is a reported
 * state, never a default.
 *
 * @module libs/core/src/returns/domain/domain-services
 */

/**
 * The subset of an order line this rule needs, supplied by the CALLER.
 *
 * Structurally satisfied by `OrderItem` (`@openlinker/core/orders`), which is
 * how the order's data reaches this context without `returns` importing an
 * orders service — ADR-053's "order data enters as arguments" discipline,
 * applied to a context that would otherwise take a 14-module edge for one read.
 */
export interface ResolvableOrderLine {
  /** `orderSnapshot.items[].id` — the value that gets persisted. */
  id: string;
  quantity: number;
  price: number;
  sku?: string;
}

/** The subset of a returned line this rule reads. */
export interface ResolvableReturnLine {
  sku: string | null;
  /**
   * Per-unit price as the source reported it. The tie-breaker, and the field
   * `returns.service.ts` already persists into `rawPayload` and never reads.
   */
  unitPrice: number | null;
}

/**
 * Why a line could not be resolved. A closed vocabulary, because the caller
 * reports these and a free-form string cannot be counted or acted on.
 */
export const ReturnOrderLineUnresolvedReasonValues = [
  /** The return line carries neither a SKU nor a unit price — nothing to match on. */
  'no-axis',
  /** Matched nothing on any available axis. */
  'no-candidate',
  /** Several order lines survived every axis. Never collapsed into a pick. */
  'ambiguous',
] as const;

export type ReturnOrderLineUnresolvedReason =
  (typeof ReturnOrderLineUnresolvedReasonValues)[number];

/** Which axis settled it — carried so the resolution is auditable, not just correct. */
export const ReturnOrderLineMatchAxisValues = ['sku', 'sku+price', 'price'] as const;
export type ReturnOrderLineMatchAxis = (typeof ReturnOrderLineMatchAxisValues)[number];

export type ReturnOrderLineResolution =
  | { status: 'resolved'; orderLineId: string; matchedOn: ReturnOrderLineMatchAxis }
  | { status: 'unresolved'; reason: ReturnOrderLineUnresolvedReason };

/**
 * SKUs are operator-authored identifiers, not prose: trimmed, but NOT
 * case-folded and NOT diacritic-folded. The folding argument that applies to a
 * product name (`normalizeCorrectionLineName`) is about display text; a SKU
 * that differs in case is a different SKU in every catalogue this platform
 * reads.
 */
function normalizeSku(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Money compared at minor units, so 189 and 189.00 are the same price. */
function samePrice(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Resolve one returned line to at most one order line.
 *
 * Axis order is strongest-first, and each axis only ever NARROWS the survivors
 * from the previous one — so a price match can settle a SKU tie without ever
 * being able to select a line the SKU already excluded.
 *
 * 1. **SKU**, exact after trim. One survivor ⇒ resolved.
 * 2. **Unit price**, as the tie-break among same-SKU survivors. This is exactly
 *    the duplicate-line case the picker existed for.
 * 3. Price alone, when the return line carries no SKU at all.
 *
 * Product NAME is deliberately not an axis: its collisions are what this rule
 * exists to remove, and reintroducing it as a fallback would reintroduce the
 * ambiguity one layer down.
 */
export function resolveReturnLineOrderLine(
  line: ResolvableReturnLine,
  orderLines: readonly ResolvableOrderLine[]
): ReturnOrderLineResolution {
  const sku = normalizeSku(line.sku);
  const unitPrice =
    typeof line.unitPrice === 'number' && Number.isFinite(line.unitPrice) ? line.unitPrice : null;

  if (sku !== null) {
    const bySku = orderLines.filter((candidate) => normalizeSku(candidate.sku) === sku);

    if (bySku.length === 1) {
      return { status: 'resolved', orderLineId: bySku[0].id, matchedOn: 'sku' };
    }

    if (bySku.length > 1) {
      if (unitPrice === null) {
        return { status: 'unresolved', reason: 'ambiguous' };
      }
      const byPrice = bySku.filter((candidate) => samePrice(candidate.price, unitPrice));
      return byPrice.length === 1
        ? { status: 'resolved', orderLineId: byPrice[0].id, matchedOn: 'sku+price' }
        : { status: 'unresolved', reason: byPrice.length === 0 ? 'no-candidate' : 'ambiguous' };
    }

    // The SKU matched nothing. Falling back to price here would resolve a line
    // the SKU positively excluded, which is a wrong answer rather than a
    // missing one — so the axis order is a narrowing, never a retry.
    return { status: 'unresolved', reason: 'no-candidate' };
  }

  // No SKU. Without a price either there is no axis at all — narrowing here
  // rather than up front is what keeps the price branch cast-free.
  if (unitPrice === null) {
    return { status: 'unresolved', reason: 'no-axis' };
  }

  const byPrice = orderLines.filter((candidate) => samePrice(candidate.price, unitPrice));
  if (byPrice.length === 1) {
    return { status: 'resolved', orderLineId: byPrice[0].id, matchedOn: 'price' };
  }
  return { status: 'unresolved', reason: byPrice.length === 0 ? 'no-candidate' : 'ambiguous' };
}
