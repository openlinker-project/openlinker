/**
 * Ean Category Matcher Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can
 * resolve marketplace categories from variant EANs in a batch declare
 * `implements OfferManagerPort, EanCategoryMatcher`. The sibling-but-
 * distinct `CategoryBarcodeMatcher` capability is the single-barcode
 * version; this one is the batch + rich-envelope shape consumed by the
 * #726 bulk-listing review table (#736 / #740).
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferManagerPort } from '../offer-manager.port';
import type {
  BatchCategoryByEanInput,
  EanMatchResult,
} from '../../types/ean-category-match.types';

export interface EanCategoryMatcher {
  /**
   * Resolve marketplace categories for N variant EANs in one batch.
   *
   * - Variants without an EAN (`null`, empty string, whitespace-only) return
   *   `{ kind: 'no-ean' }` and never produce an HTTP call.
   * - Per-EAN HTTP failures collapse to `{ kind: 'no-match' }` (no-throw
   *   contract, mirrors #431); the batch never aborts on per-item failure.
   * - Returned map is keyed by `variantId`. Every input item has exactly
   *   one map entry.
   *
   * Call sites narrow via `isEanCategoryMatcher(adapter)`.
   */
  resolveCategoriesForBatchByEan(
    input: BatchCategoryByEanInput,
  ): Promise<Map<string, EanMatchResult>>;
}

export function isEanCategoryMatcher(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & EanCategoryMatcher {
  return (
    typeof (adapter as Partial<EanCategoryMatcher>).resolveCategoriesForBatchByEan ===
    'function'
  );
}
