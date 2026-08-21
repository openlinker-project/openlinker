/**
 * Top Products Service
 *
 * Composes the core `orders`-context top-products ranking (#1988) with two
 * cross-context enrichments — product display metadata (`products`) and a
 * per-product listing-coverage flag (`listings`) — into one HTTP response.
 * Lives at the apps/api layer, not in a core context, for the same reason
 * `NeedsAttentionService` does (see that service's header): composing three
 * sibling CORE contexts for one HTTP response here avoids adding a new
 * core-to-core dependency edge (`orders → listings`) that no core context
 * otherwise needs — see the #1988 implementation plan § Architecture Mapping.
 *
 * The coverage-gap enrichment is a best-effort addition: any failure there is
 * caught and degrades to an empty flag on every row rather than 500ing the
 * whole endpoint, mirroring `NeedsAttentionService`'s `settleSection` pattern.
 * That degradation is reported via `TopProductsResponseDto.coverageGapAvailable`
 * (#2172 review, SUGGESTION 5) rather than silently: an empty
 * `missingFromConnectionIds` on every row is otherwise indistinguishable from
 * "listed on every channel", the opposite of the truth when the enrichment
 * itself failed.
 *
 * @module apps/api/src/analytics/application/services
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderRecordService,
  type TopProductFilters,
} from '@openlinker/core/orders';
import { PRODUCTS_SERVICE_TOKEN, type IProductsService } from '@openlinker/core/products';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  type IIntegrationsService,
} from '@openlinker/core/integrations';
import {
  PUBLISHED_VARIANTS_SERVICE_TOKEN,
  type IPublishedVariantsService,
} from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';
import { TopProductsResponseDto, TopProductRowDto } from '../../http/dto/top-products-response.dto';
import type { ITopProductsService } from './top-products.service.interface';

@Injectable()
export class TopProductsService implements ITopProductsService {
  private readonly logger = new Logger(TopProductsService.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecordService: IOrderRecordService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(PUBLISHED_VARIANTS_SERVICE_TOKEN)
    private readonly publishedVariantsService: IPublishedVariantsService
  ) {}

  async getTopProducts(filters: TopProductFilters): Promise<TopProductsResponseDto> {
    const core = await this.orderRecordService.getTopProducts(filters);
    const productIds = core.items.map((item) => item.productId);

    const [catalogByProductId, coverageGaps] = await Promise.all([
      this.resolveCatalog(productIds),
      this.resolveCoverageGaps(productIds),
    ]);

    const dto = new TopProductsResponseDto();
    dto.items = core.items.map((item) =>
      TopProductRowDto.fromDomain(
        item,
        catalogByProductId.entries.get(item.productId) ?? { name: null, sku: null },
        coverageGaps.byProductId.get(item.productId) ?? []
      )
    );
    dto.total = core.total;
    dto.unresolvedProductCount = catalogByProductId.unresolvedCount;
    dto.coverageGapAvailable = coverageGaps.available;
    return dto;
  }

  /**
   * Resolves product display metadata for the page. `getProductsByIds`
   * silently drops any id it can't find (its own documented contract) — a
   * naive `.map()`/join over that result would silently shrink the row
   * count, which is exactly what #1988's own AC forbids ("line items that
   * cannot be resolved to a catalogue product are handled explicitly rather
   * than dropped silently"). This explicitly diffs the requested id set
   * against what came back and counts the gap instead.
   */
  private async resolveCatalog(
    productIds: string[]
  ): Promise<{ entries: Map<string, { name: string | null; sku: string | null }>; unresolvedCount: number }> {
    const products = await this.productsService.getProductsByIds(productIds);
    const productById = new Map(products.map((product) => [product.id, product]));

    const entries = new Map<string, { name: string | null; sku: string | null }>();
    let unresolvedCount = 0;
    for (const productId of productIds) {
      const product = productById.get(productId);
      if (product) {
        entries.set(productId, { name: product.name, sku: product.sku });
      } else {
        entries.set(productId, { name: null, sku: null });
        unresolvedCount += 1;
      }
    }
    return { entries, unresolvedCount };
  }

  /**
   * For each of the page's products, which listing-capable connections carry
   * no listing for any of its variants. Bounded by page size × capable-
   * connection count, never catalogue size: variant ids are resolved once for
   * the whole page via a single batch call (#2172 review, SUGGESTION 4 —
   * `getVariantsByProductIds`, not a `Promise.all` fan-out of one call per
   * product), and `getPublishedVariantIds` is called once PER CONNECTION over
   * the union of every page product's variant ids — never once per product —
   * mirroring `CoverageGapReadService`'s O(connections) fan-out.
   *
   * `available: false` on a failure (#2172 review, SUGGESTION 5) — every row
   * still gets an empty `missingFromConnectionIds`, but the response also
   * says the flag couldn't be computed, so the FE can suppress the column
   * rather than assert a false "listed everywhere".
   */
  private async resolveCoverageGaps(
    productIds: string[]
  ): Promise<{ byProductId: Map<string, string[]>; available: boolean }> {
    const byProductId = new Map<string, string[]>();
    if (productIds.length === 0) {
      return { byProductId, available: true };
    }

    try {
      const capableConnectionIds = await this.resolveListingCapableConnectionIds();
      if (capableConnectionIds.length === 0) {
        return { byProductId, available: true };
      }

      const variants = await this.productsService.getVariantsByProductIds(productIds);
      const variantIdsByProductId = new Map<string, string[]>();
      for (const variant of variants) {
        const existing = variantIdsByProductId.get(variant.productId);
        if (existing) {
          existing.push(variant.id);
        } else {
          variantIdsByProductId.set(variant.productId, [variant.id]);
        }
      }

      const allVariantIds = [...new Set([...variantIdsByProductId.values()].flat())];
      if (allVariantIds.length === 0) {
        return { byProductId, available: true };
      }

      const publishedByConnection = new Map<string, Set<string>>();
      await Promise.all(
        capableConnectionIds.map(async (connectionId) => {
          const published = await this.publishedVariantsService.getPublishedVariantIds(
            connectionId,
            allVariantIds
          );
          publishedByConnection.set(connectionId, new Set(published));
        })
      );

      for (const productId of productIds) {
        const variantIds = variantIdsByProductId.get(productId) ?? [];
        const missingFromConnectionIds = capableConnectionIds.filter((connectionId) => {
          const published = publishedByConnection.get(connectionId);
          return !variantIds.some((variantId) => published?.has(variantId));
        });
        byProductId.set(productId, missingFromConnectionIds);
      }

      return { byProductId, available: true };
    } catch (error) {
      this.logger.warn(
        `Coverage-gap enrichment failed for top-products, degrading to empty flags: ${(error as Error).message}`
      );
      return { byProductId, available: false };
    }
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
