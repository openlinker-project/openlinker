/**
 * Coverage Gap Read Service
 *
 * Computes the coverage-gaps "needs attention" aggregate (#1983): for every
 * variant currently listed somewhere, which listing-capable connections it
 * is missing a listing from. Reads only OL's own persisted mapping state —
 * no adapter/external-API call.
 *
 * @module libs/core/src/listings/application/services
 * @implements {ICoverageGapReadService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { INTEGRATIONS_SERVICE_TOKEN, type IIntegrationsService } from '@openlinker/core/integrations';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import { ShopProductMappingRepositoryPort } from '../../domain/ports/shop-product-mapping-repository.port';
import type { CoverageGapItem, CoverageGapsResult } from '../../domain/types/coverage-gap.types';
import {
  OFFER_MAPPING_REPOSITORY_TOKEN,
  SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { ICoverageGapReadService } from './coverage-gap-read.service.interface';

// Caps the candidate-variant fan-in query so a large catalogue can't produce
// an unbounded per-connection scan (#1983 AC — bounded/paged output).
const MAX_COVERAGE_GAP_CANDIDATES = 500;

@Injectable()
export class CoverageGapReadService implements ICoverageGapReadService {
  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappingRepository: OfferMappingRepositoryPort,
    @Inject(SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN)
    private readonly shopProductMappingRepository: ShopProductMappingRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async findCoverageGaps(limit: number): Promise<CoverageGapsResult> {
    const capableConnectionIds = await this.resolveListingCapableConnectionIds();
    if (capableConnectionIds.length < 2) {
      // Nothing to be "missing from" with fewer than two capable connections.
      return { items: [], totalCount: 0 };
    }

    const [offerCandidates, shopCandidates] = await Promise.all([
      this.offerMappingRepository.findRecentlyListedVariantIds({ limit: MAX_COVERAGE_GAP_CANDIDATES }),
      this.shopProductMappingRepository.findRecentlyListedVariantIds({
        limit: MAX_COVERAGE_GAP_CANDIDATES,
      }),
    ]);
    const productIdByVariantId = new Map<string, string>();
    for (const row of [...offerCandidates, ...shopCandidates]) {
      productIdByVariantId.set(row.variantId, row.productId);
    }
    const candidateVariantIds = [...productIdByVariantId.keys()].slice(0, MAX_COVERAGE_GAP_CANDIDATES);
    if (candidateVariantIds.length === 0) {
      return { items: [], totalCount: 0 };
    }

    // One pair of calls per capable connection (not per variant) — bounds the
    // fan-out to O(connections), never O(variants × connections).
    const listedByConnection = new Map<string, Set<string>>();
    await Promise.all(
      capableConnectionIds.map(async (connectionId) => {
        const [offerCounts, shopCounts] = await Promise.all([
          this.offerMappingRepository.countByConnectionAndVariants(connectionId, candidateVariantIds),
          this.shopProductMappingRepository.countByConnectionAndVariants(
            connectionId,
            candidateVariantIds
          ),
        ]);
        listedByConnection.set(
          connectionId,
          new Set([...offerCounts.keys(), ...shopCounts.keys()])
        );
      })
    );

    const gaps: CoverageGapItem[] = [];
    for (const variantId of candidateVariantIds) {
      const listedOnConnectionIds: string[] = [];
      const missingFromConnectionIds: string[] = [];
      for (const connectionId of capableConnectionIds) {
        if (listedByConnection.get(connectionId)?.has(variantId)) {
          listedOnConnectionIds.push(connectionId);
        } else {
          missingFromConnectionIds.push(connectionId);
        }
      }
      // A variant listed nowhere or everywhere has nothing to report.
      if (listedOnConnectionIds.length === 0 || missingFromConnectionIds.length === 0) {
        continue;
      }
      gaps.push({
        variantId,
        productId: productIdByVariantId.get(variantId) ?? variantId,
        listedOnConnectionIds,
        missingFromConnectionIds,
      });
    }

    gaps.sort((a, b) => b.missingFromConnectionIds.length - a.missingFromConnectionIds.length);
    return { items: gaps.slice(0, limit), totalCount: gaps.length };
  }

  private async resolveListingCapableConnectionIds(): Promise<string[]> {
    const [offerManagerAdapters, productPublisherAdapters] = await Promise.all([
      this.integrationsService.listCapabilityAdapters({ capability: 'OfferManager', lazy: true }),
      this.integrationsService.listCapabilityAdapters({
        capability: 'ProductPublisher',
        lazy: true,
      }),
    ]);
    return [
      ...new Set([
        ...offerManagerAdapters.map((entry) => entry.connectionId),
        ...productPublisherAdapters.map((entry) => entry.connectionId),
      ]),
    ];
  }
}
