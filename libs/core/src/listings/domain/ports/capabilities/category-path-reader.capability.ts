/**
 * Category Path Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can resolve a
 * single category id to its full ancestor breadcrumb declare
 * `implements CategoryPathReader`. Used by the listing-detail drawer to render
 * a human "Root > ... > Leaf" trail for an offer whose payload carries only
 * `category.id` (Allegro).
 *
 * See `category-browser.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { CategoryPathSegment } from '../../types/category.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface CategoryPathReader {
  /**
   * Resolve `categoryId` to its full breadcrumb, ordered root -> leaf
   * (the leaf being `categoryId` itself).
   */
  fetchCategoryPath(categoryId: string): Promise<CategoryPathSegment[]>;
}

export function isCategoryPathReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & CategoryPathReader {
  return typeof (adapter as Partial<CategoryPathReader>).fetchCategoryPath === 'function';
}
