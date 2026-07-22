/**
 * Offer Category Types
 *
 * Unified category type returned by `OfferManagerPort.fetchCategories`.
 * Platform-agnostic representation of a marketplace offer-taxonomy node.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface OfferCategory {
  id: string;
  name: string;
  parentId: string | null;
  leaf: boolean;
}

/**
 * One node of a category breadcrumb path, ordered root -> leaf.
 * Returned by `CategoryPathReader.fetchCategoryPath` so the FE can render a
 * human-readable "Root > ... > Leaf" trail instead of the raw category id.
 */
export interface CategoryPathSegment {
  id: string;
  name: string;
}
