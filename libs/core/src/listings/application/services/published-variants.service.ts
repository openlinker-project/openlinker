/**
 * Published Variants Service
 *
 * Backs the destination-aware duplicate guard (#1837). Unions two
 * connection-scoped mapping reads - `OfferMappingRepositoryPort` (marketplace
 * offers) and `ShopProductMappingRepositoryPort` (online-shop products) - to
 * report which of the supplied variant ids are already published on a
 * destination. Because a connection carries only one listing-mapping kind, the
 * union is destination-kind-agnostic and never double-counts; the FE resolves
 * the marketplace-vs-shop *wording* from the connection's capabilities.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IPublishedVariantsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import { ShopProductMappingRepositoryPort } from '../../domain/ports/shop-product-mapping-repository.port';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { IPublishedVariantsService } from './published-variants.service.interface';

// Per-call input cap - keeps the two grouped identifier_mappings queries
// page-scoped; callers page their input above this. Generously sized for a
// full 100-product batch fanned out to variants.
const MAX_PUBLISHED_CHECK_VARIANT_IDS = 1000;

@Injectable()
export class PublishedVariantsService implements IPublishedVariantsService {
  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappingRepository: OfferMappingRepositoryPort,
    @Inject(SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN)
    private readonly shopProductMappingRepository: ShopProductMappingRepositoryPort
  ) {}

  async getPublishedVariantIds(
    connectionId: string,
    variantIds: ReadonlyArray<string>
  ): Promise<string[]> {
    const unique = [...new Set(variantIds)];
    if (unique.length === 0) return [];
    if (unique.length > MAX_PUBLISHED_CHECK_VARIANT_IDS) {
      throw new Error(
        `getPublishedVariantIds accepts at most ${String(MAX_PUBLISHED_CHECK_VARIANT_IDS)} variantIds per call (got ${String(unique.length)})`
      );
    }

    const [offerCounts, shopCounts] = await Promise.all([
      this.offerMappingRepository.countByConnectionAndVariants(connectionId, unique),
      this.shopProductMappingRepository.countByConnectionAndVariants(connectionId, unique),
    ]);

    const published = new Set<string>([...offerCounts.keys(), ...shopCounts.keys()]);
    return [...published];
  }
}
