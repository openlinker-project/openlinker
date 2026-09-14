/**
 * Channel Exclusion Map
 *
 * Reshapes the `GET /analytics/coverage/by-connection` aggregate (#2713)
 * into a per-channel (`sourceConnectionId`) count map (#2481, epic #2452
 * Phase 8, reshaped by #2714) — the input `ChannelSalesTable` needs to
 * decide which `AnalyticsExclusionNote`s a row gets. Grouping happens
 * server-side now (`GROUP BY sourceConnectionId`), so this is a pure
 * re-index rather than a count — `buildChannelExclusionMap` has exactly one
 * caller (`ChannelSalesTable`), which is why the reshape happened in place
 * rather than adding a second function.
 *
 * @module apps/web/src/features/analytics/lib
 */
import type { AnalyticsCoverageByConnection, CoverageCategory } from '../api/analytics-coverage.types';

/** Tax categories, plus currency — the categories a channel total can be under-counted by. `product-matching` is deliberately excluded: a `source_deleted`/`awaiting_mapping` order fails to resolve to *any* channel-scoped total in the first place, so it was never counted anywhere to be silently missing from. */
export type CrossReferenceableCategory = Extract<CoverageCategory, 'currency' | 'tax-a' | 'tax-b' | 'tax-c'>;
export const CROSS_REFERENCEABLE_CATEGORIES: readonly CrossReferenceableCategory[] = [
  'currency',
  'tax-a',
  'tax-b',
  'tax-c',
];

/** `connectionId -> category -> this channel's own affected-order count for it`. */
export type ChannelExclusionMap = Map<string, Map<CrossReferenceableCategory, number>>;

export function buildChannelExclusionMap(
  byConnection: AnalyticsCoverageByConnection | undefined
): ChannelExclusionMap {
  const rowsByCategory = new Map(
    (byConnection?.categories ?? []).map((entry) => [entry.category, entry.rows])
  );
  const map: ChannelExclusionMap = new Map();
  for (const category of CROSS_REFERENCEABLE_CATEGORIES) {
    // `.set()`, not an accumulate — the backend's own `GROUP BY
    // sourceConnectionId` (#2713) already guarantees at most one row per
    // `(category, sourceConnectionId)` pair, so there is nothing to sum
    // here, unlike the pre-#2714 client-side counting this replaced.
    for (const row of rowsByCategory.get(category) ?? []) {
      const byCategory = map.get(row.sourceConnectionId) ?? new Map<CrossReferenceableCategory, number>();
      byCategory.set(category, row.affectedCount);
      map.set(row.sourceConnectionId, byCategory);
    }
  }
  return map;
}
