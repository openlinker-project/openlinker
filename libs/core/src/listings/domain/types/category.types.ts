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
