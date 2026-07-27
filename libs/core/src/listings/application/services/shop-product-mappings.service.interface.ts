/**
 * Shop Product Mappings Service Interface
 *
 * Cross-context read seam over `ShopProductMappingRepositoryPort` - the
 * shop-side sibling of `IOfferMappingsService` (#718). Exposes the
 * per-product coverage read the products cockpit needs so callers never
 * value-import the repository port directly.
 *
 * @module libs/core/src/listings/application/services
 */
import type { ProductListingsCoverage } from '../../domain/types/offer-mapping.types';

export interface IShopProductMappingsService {
  /**
   * Count DISTINCT listed variants per (product, connection) for the given
   * product IDs, scoped to `entityType = 'ShopProduct'` (#1838 follow-up
   * fix - a product published to a shop connection previously reported zero
   * coverage on the products cockpit because only offer mappings were read).
   * Pairs with zero listed variants are omitted. Empty input returns [] without
   * hitting the database; input is capped at 200 IDs per call.
   */
  countListedVariantsByProducts(
    productIds: readonly string[]
  ): Promise<readonly ProductListingsCoverage[]>;
}
