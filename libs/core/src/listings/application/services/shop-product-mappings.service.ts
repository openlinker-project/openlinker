/**
 * Shop Product Mappings Service
 *
 * Thin pass-through over `ShopProductMappingRepositoryPort` - the shop-side
 * sibling of `OfferMappingsService` (#718). Created for the #1838 follow-up
 * fix that closes the products cockpit coverage gap: a product published to
 * a shop (WooCommerce) connection previously showed no listings-coverage
 * indication because only `entityType = 'Offer'` mappings fed the coverage
 * pipeline.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IShopProductMappingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ShopProductMappingRepositoryPort } from '../../domain/ports/shop-product-mapping-repository.port';
import type { ProductListingsCoverage } from '../../domain/types/offer-mapping.types';
import { SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN } from '../../listings.tokens';
import type { IShopProductMappingsService } from './shop-product-mappings.service.interface';

// Mirrors OfferMappingsService.MAX_COVERAGE_PRODUCT_IDS - keeps the grouped
// identifier_mappings query page-scoped.
const MAX_COVERAGE_PRODUCT_IDS = 200;

@Injectable()
export class ShopProductMappingsService implements IShopProductMappingsService {
  constructor(
    @Inject(SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN)
    private readonly repository: ShopProductMappingRepositoryPort
  ) {}

  async countListedVariantsByProducts(
    productIds: readonly string[]
  ): Promise<readonly ProductListingsCoverage[]> {
    if (productIds.length === 0) return [];
    if (productIds.length > MAX_COVERAGE_PRODUCT_IDS) {
      throw new Error(
        `countListedVariantsByProducts accepts at most ${String(MAX_COVERAGE_PRODUCT_IDS)} productIds per call (got ${String(productIds.length)})`
      );
    }
    return this.repository.countListedVariantsByProducts(productIds);
  }
}
