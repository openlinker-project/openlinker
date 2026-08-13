/**
 * Coverage Gap Types
 *
 * Type definitions for the coverage-gaps "needs attention" aggregate (#1983):
 * variants listed on one listing-capable connection but missing from another.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * One variant that is listed on at least one, but not every, listing-capable
 * connection. `missingFromConnectionIds` is always non-empty — a variant
 * listed everywhere is not reported.
 */
export interface CoverageGapItem {
  variantId: string;
  productId: string;
  listedOnConnectionIds: string[];
  missingFromConnectionIds: string[];
}

/**
 * Bounded/paged result of the coverage-gaps read. `totalCount` is the number
 * of gap items found before the page-size cap was applied, so a caller can
 * tell "there are more" from "this is everything" — but only within the
 * `MAX_COVERAGE_GAP_CANDIDATES` (500) most-recently-mapped variants
 * considered as candidates. On a catalogue with more listed variants than
 * that, `totalCount` silently caps at whatever gap count the top-500 pool
 * produces; it is not the true count across the whole catalogue.
 */
export interface CoverageGapsResult {
  items: CoverageGapItem[];
  totalCount: number;
}
