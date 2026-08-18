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
  PUBLISHED_VARIANTS_SERVICE_TOKEN,
  SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { ICoverageGapReadService } from './coverage-gap-read.service.interface';
import { IPublishedVariantsService } from './published-variants.service.interface';

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
    private readonly integrationsService: IIntegrationsService,
    @Inject(PUBLISHED_VARIANTS_SERVICE_TOKEN)
    private readonly publishedVariantsService: IPublishedVariantsService
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
    // Merge the two independently-paged top-N-by-recency pools and re-sort by
    // `latestMappedAt` before capping — each source query is already sorted,
    // but concatenating them is not, so slicing by insertion order (offers
    // always winning ties over shop rows) would silently drop more-recent
    // shop mappings whenever the combined pool exceeds the cap.
    const productIdByVariantId = new Map<string, string>();
    const latestMappedAtByVariantId = new Map<string, Date>();
    for (const row of [...offerCandidates, ...shopCandidates]) {
      productIdByVariantId.set(row.variantId, row.productId);
      const existing = latestMappedAtByVariantId.get(row.variantId);
      if (!existing || row.latestMappedAt > existing) {
        latestMappedAtByVariantId.set(row.variantId, row.latestMappedAt);
      }
    }
    const candidateVariantIds = [...latestMappedAtByVariantId.entries()]
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .slice(0, MAX_COVERAGE_GAP_CANDIDATES)
      .map(([variantId]) => variantId);
    if (candidateVariantIds.length === 0) {
      return { items: [], totalCount: 0 };
    }

    // One call per capable connection (not per variant) — bounds the fan-out
    // to O(connections), never O(variants × connections). Delegates to
    // `PublishedVariantsService` (#1837) rather than re-implementing its
    // offer/shop-mapping union here, so "already listed on this destination"
    // has one definition.
    const listedByConnection = new Map<string, Set<string>>();
    await Promise.all(
      capableConnectionIds.map(async (connectionId) => {
        const publishedVariantIds = await this.publishedVariantsService.getPublishedVariantIds(
          connectionId,
          candidateVariantIds
        );
        listedByConnection.set(connectionId, new Set(publishedVariantIds));
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
