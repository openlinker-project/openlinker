/**
 * Category Barcode Matcher Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can auto-detect
 * a marketplace category for a given product barcode declare
 * `implements CategoryBarcodeMatcher`. Returns null when the marketplace cannot
 * resolve or the match is ambiguous.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferManagerPort } from '../offer-manager.port';

export interface CategoryBarcodeMatcher {
  matchCategoryByBarcode(barcode: string): Promise<string | null>;
}

export function isCategoryBarcodeMatcher(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & CategoryBarcodeMatcher {
  return (
    typeof (adapter as Partial<CategoryBarcodeMatcher>).matchCategoryByBarcode === 'function'
  );
}
