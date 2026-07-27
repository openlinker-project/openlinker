/**
 * Offer Mappings Service
 *
 * Thin pass-through over `OfferMappingRepositoryPort` exposing the two
 * read shapes sibling contexts need. Created in #718 to remove direct
 * cross-context value-imports of the repository port from the `content`
 * context (and any future caller with the same need).
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferMappingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import type {
  OfferMappingPagination,
  PaginatedOfferMappings,
  ProductListingsCoverage,
} from '../../domain/types/offer-mapping.types';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '../../listings.tokens';
import type { IOfferMappingsService } from './offer-mappings.service.interface';

// Per-call input cap for the per-product coverage read (#1720) - keeps the
// grouped identifier_mappings query page-scoped.
const MAX_COVERAGE_PRODUCT_IDS = 200;

@Injectable()
export class OfferMappingsService implements IOfferMappingsService {
  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly repository: OfferMappingRepositoryPort
  ) {}

  async findForVariant(
    connectionId: string,
    variantId: string,
    pagination: OfferMappingPagination = { limit: 100, offset: 0 }
  ): Promise<PaginatedOfferMappings> {
    return this.repository.findMany({ connectionId, internalId: variantId }, pagination);
  }

  async countForVariants(
    connectionId: string,
    variantIds: ReadonlyArray<string>
  ): Promise<Map<string, number>> {
    if (variantIds.length === 0) return new Map();
    return this.repository.countByConnectionAndVariants(connectionId, variantIds);
  }

  async countListedVariantsByProducts(
    productIds: readonly string[]
  ): Promise<readonly ProductListingsCoverage[]> {
    // Empty input short-circuits without a repo call; the size cap protects
    // the grouped query from unbounded IN-lists - callers page their input
    // (#1720; mirrors the inventory aggregate seam's cap).
    if (productIds.length === 0) return [];
    if (productIds.length > MAX_COVERAGE_PRODUCT_IDS) {
      throw new Error(
        `countListedVariantsByProducts accepts at most ${String(MAX_COVERAGE_PRODUCT_IDS)} productIds per call (got ${String(productIds.length)})`
      );
    }
    return this.repository.countListedVariantsByProducts(productIds);
  }
}
