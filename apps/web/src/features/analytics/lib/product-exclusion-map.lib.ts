/**
 * Product Exclusion Map
 *
 * Pure grouping of one or more Data Coverage categories' *full*
 * affected-order lists into a per-product (`productId`) count map (#2799),
 * mirroring `buildChannelExclusionMap` (`channel-exclusion-map.lib.ts`,
 * #2481 Phase 8) for `product-sales-table.tsx` instead of
 * `channel-sales-table.tsx`.
 *
 * `'product-matching'` is excluded from `CROSS_REFERENCEABLE_CATEGORIES`
 * for a stronger reason at the product grain than at the channel grain: a
 * `source_deleted`/`awaiting_mapping` order never resolved its item
 * reference to an internal `productId` at all (that unresolved reference
 * IS the reason the row exists), so the backend row's own `productId` is
 * always `null` — see `ProductMatchingErrorOrderRow`'s doc comment in
 * `@openlinker/core/orders`. There is no id here to group by, so this
 * function skips a `null` `productId` unconditionally rather than treating
 * it as a data gap.
 *
 * A currency row carries EVERY distinct product it touches
 * (`CurrencyMismatchOrder.lineProducts[]`, corrected per #2799 review
 * BLOCKING 1 — a single "representative" `productId` silently under-counted
 * every product past the first); a tax row carries one PER LINE
 * (`TaxCoverageOrder.lineRates[].productId`) — an order whose lines span
 * two products must annotate BOTH of that product-sales-table's rows, not
 * just the first line's. Distinct product ids are deduplicated per order
 * before counting, so a product appearing on two lines of the SAME order
 * contributes one affected-order count for it, not two.
 *
 * @module apps/web/src/features/analytics/lib
 */
import type { CrossReferenceableCategory } from './channel-exclusion-map.lib';
import { CROSS_REFERENCEABLE_CATEGORIES } from './channel-exclusion-map.lib';

export { CROSS_REFERENCEABLE_CATEGORIES };
export type { CrossReferenceableCategory };

/**
 * `product-sales-table.tsx`'s per-order shape (moved here from
 * `channel-exclusion-map.lib.ts` per #2799 review SUGGESTION 4 — this
 * module is its sole consumer; the channel-level exclusion map reads the
 * connection-level aggregate instead and has no use for product identity).
 */
export interface CoverageOrderLite {
  internalOrderId: string;
  sourceConnectionId: string;
  /**
   * Every distinct product a `'currency'` row's lines touch (#2799) —
   * absent on a tax row (see `lineRates` instead).
   */
  lineProducts?: ReadonlyArray<{ productId: string }>;
  /**
   * Per-line product ids — present on a tax row, absent on a currency row.
   */
  lineRates?: ReadonlyArray<{ productId: string }>;
}

/** `productId -> category -> this product's own affected-order count for it`. */
export type ProductExclusionMap = Map<string, Map<CrossReferenceableCategory, number>>;

/** Distinct product ids referenced by one coverage order row (currency's `lineProducts`, or tax's per-line `lineRates`). */
function distinctProductIdsOf(order: CoverageOrderLite): string[] {
  const ids = new Set<string>();
  for (const line of order.lineProducts ?? []) {
    ids.add(line.productId);
  }
  for (const line of order.lineRates ?? []) {
    ids.add(line.productId);
  }
  return [...ids];
}

export function buildProductExclusionMap(
  ordersByCategory: Partial<Record<CrossReferenceableCategory, CoverageOrderLite[] | undefined>>
): ProductExclusionMap {
  const map: ProductExclusionMap = new Map();
  for (const category of CROSS_REFERENCEABLE_CATEGORIES) {
    for (const order of ordersByCategory[category] ?? []) {
      for (const productId of distinctProductIdsOf(order)) {
        const byCategory = map.get(productId) ?? new Map<CrossReferenceableCategory, number>();
        byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
        map.set(productId, byCategory);
      }
    }
  }
  return map;
}
