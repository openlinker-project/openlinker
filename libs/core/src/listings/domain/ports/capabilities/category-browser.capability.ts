/**
 * Category Browser Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that expose the
 * marketplace's category directory declare `implements CategoryBrowser`.
 * Used by the category-resolution / mapping-editor flows.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferCategory } from '../../types/category.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface CategoryBrowser {
  fetchCategories(parentId?: string): Promise<OfferCategory[]>;
}

export function isCategoryBrowser(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & CategoryBrowser {
  return typeof (adapter as Partial<CategoryBrowser>).fetchCategories === 'function';
}
