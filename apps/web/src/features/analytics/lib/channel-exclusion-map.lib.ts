/**
 * Channel Exclusion Map
 *
 * Pure grouping of one or more Data Coverage categories' *full*
 * affected-order lists into a per-channel (`sourceConnectionId`) count map
 * (#2481, epic #2452 Phase 8) — the input `ChannelSalesTable` needs to
 * decide which `AnalyticsExclusionNote`s a row gets.
 *
 * @module apps/web/src/features/analytics/lib
 */
import type { CoverageCategory } from '../api/analytics-coverage.types';

/** Tax categories, plus currency — the categories a channel total can be under-counted by. `product-matching` is deliberately excluded: a `source_deleted`/`awaiting_mapping` order fails to resolve to *any* channel-scoped total in the first place, so it was never counted anywhere to be silently missing from. */
export type CrossReferenceableCategory = Extract<CoverageCategory, 'currency' | 'tax-a' | 'tax-b' | 'tax-c'>;
export const CROSS_REFERENCEABLE_CATEGORIES: readonly CrossReferenceableCategory[] = [
  'currency',
  'tax-a',
  'tax-b',
  'tax-c',
];

export interface CoverageOrderLite {
  internalOrderId: string;
  sourceConnectionId: string;
  /**
   * One representative line's product id (#2799) — present (possibly
   * `null`) on a `'currency'` row, absent on a tax row (see `lineRates`
   * instead). Optional here so this shared shape can widen without forcing
   * every consumer (e.g. `buildChannelExclusionMap`, which only ever needs
   * `sourceConnectionId`) to care about it.
   */
  productId?: string | null;
  /**
   * Per-line product ids (#2799) — present on a tax row, absent on a
   * currency row. `buildProductExclusionMap` (`product-exclusion-map.lib.ts`)
   * is the one consumer that reads this.
   */
  lineRates?: ReadonlyArray<{ productId: string }>;
}

/** `connectionId -> category -> this channel's own affected-order count for it`. */
export type ChannelExclusionMap = Map<string, Map<CrossReferenceableCategory, number>>;

export function buildChannelExclusionMap(
  ordersByCategory: Partial<Record<CrossReferenceableCategory, CoverageOrderLite[] | undefined>>
): ChannelExclusionMap {
  const map: ChannelExclusionMap = new Map();
  for (const category of CROSS_REFERENCEABLE_CATEGORIES) {
    for (const order of ordersByCategory[category] ?? []) {
      const byCategory = map.get(order.sourceConnectionId) ?? new Map<CrossReferenceableCategory, number>();
      byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
      map.set(order.sourceConnectionId, byCategory);
    }
  }
  return map;
}
