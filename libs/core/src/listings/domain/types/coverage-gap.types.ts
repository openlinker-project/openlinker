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
 * tell "there are more" from "this is everything".
 */
export interface CoverageGapsResult {
  items: CoverageGapItem[];
  totalCount: number;
}
