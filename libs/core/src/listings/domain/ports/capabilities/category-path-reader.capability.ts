/**
 * Category Path Reader Capability
 *
 * Optional sub-capability of `OfferManagerPort` - adapters that can resolve a
 * marketplace category id to its full root-to-leaf ancestor breadcrumb declare
 * `implements CategoryPathReader`. Complements `CategoryBrowser` (which walks
 * the tree downward one level at a time): this one walks a known leaf id
 * upward so a category auto-resolved from a variant EAN can be shown as a
 * human breadcrumb instead of a bare id.
 *
 * See `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { CategoryPathNode } from '../../types/category-path.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface CategoryPathReader {
  /**
   * Resolve a category id to its ancestor breadcrumb, ordered ROOT -> LEAF
   * (the queried category itself is the last element). Returns an empty array
   * when the id cannot be resolved.
   */
  getCategoryPath(categoryId: string): Promise<CategoryPathNode[]>;
}

export function isCategoryPathReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & CategoryPathReader {
  return typeof (adapter as Partial<CategoryPathReader>).getCategoryPath === 'function';
}
