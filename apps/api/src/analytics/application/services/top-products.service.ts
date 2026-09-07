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
  type SalesAnalyticsFilters,
  type TopProductFilters,
  type VariantChannelBreakdownRow,
  type VariantSalesView,
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
import {
  INVENTORY_QUERY_SERVICE_TOKEN,
  type IInventoryQueryService,
} from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';
import { TopProductsResponseDto, TopProductRowDto } from '../../http/dto/top-products-response.dto';
import { TopProductVariantsResponseDto } from '../../http/dto/top-product-variants-response.dto';
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
    private readonly publishedVariantsService: IPublishedVariantsService,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN)
    private readonly inventoryQueryService: IInventoryQueryService
  ) {}

  async getTopProducts(
    filters: TopProductFilters,
    includeBackfilledTaxRatesInNetSales = false
  ): Promise<TopProductsResponseDto> {
    // Passed through rather than resolved here (#2469): the controller reads the
    // setting once per request so every read in that request agrees, and this
    // composition service is not the place to acquire it.
    const core = await this.orderRecordService.getTopProducts(
      filters,
      includeBackfilledTaxRatesInNetSales
    );
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
   * One product's sales split by variant, per channel (#2765). Composes the
   * core per-variant read with variant catalog metadata (sku/attributes) and
   * live stock — same "catalog/enrichment lives at apps/api, not core"
   * layering as {@link getTopProducts}.
   */
  async getTopProductVariantSales(
    productId: string,
    filters: SalesAnalyticsFilters
  ): Promise<TopProductVariantsResponseDto> {
    const core = await this.orderRecordService.getTopProductVariantSales(productId, filters);
    const catalogVariants = await this.productsService.getVariantsByProductId(productId);
    const realVariantIds = catalogVariants.map((variant) => variant.id);

    const variants = this.mergeUnassignedVariantBucket(core.variants, realVariantIds);

    const catalogByVariantId = new Map(
      catalogVariants.map((variant) => [
        variant.id,
        { sku: variant.sku, attributes: variant.attributes },
      ])
    );
    const stockByVariantId = await this.resolveVariantStock(
      productId,
      variants
        .map((variant) => variant.variantId)
        .filter((variantId): variantId is string => variantId !== null)
    );

    return TopProductVariantsResponseDto.fromDomain(
      { productId, variants },
      catalogByVariantId,
      stockByVariantId
    );
  }

  /**
   * A `variantId: null` row means some order lines never resolved to a
   * variant — `order_line_items.variantId` is nullable "for a simple
   * product's synthetic-variant edge case" (see the entity's own doc).
   * Folding it into a real variant is sound in EXACTLY one case: the
   * product has precisely one catalog variant, so a line that resolved to
   * "no variant" could only ever have meant that one — there is no other
   * candidate to have silently picked instead. With zero or several real
   * variants there is no unique target, and the bucket is reported as its
   * own "Unassigned" row (never dropped, never guessed at).
   */
  private mergeUnassignedVariantBucket(
    variants: VariantSalesView[],
    realVariantIds: string[]
  ): VariantSalesView[] {
    const unassignedIndex = variants.findIndex((variant) => variant.variantId === null);
    if (unassignedIndex === -1 || realVariantIds.length !== 1) {
      return variants;
    }

    const targetId = realVariantIds[0];
    const targetIndex = variants.findIndex((variant) => variant.variantId === targetId);
    if (targetIndex === -1) {
      // The sole real variant sold nothing at all — nothing to merge into.
      return variants;
    }

    const unassigned = variants[unassignedIndex];
    const target = variants[targetIndex];
    const merged: VariantSalesView = {
      variantId: targetId,
      units: target.units + unassigned.units,
      revenue: target.revenue + unassigned.revenue,
      unconvertedRevenue: target.unconvertedRevenue + unassigned.unconvertedRevenue,
      // NOT a sum (#2765 review, finding 5): both operands are
      // `COUNT(DISTINCT orderRecordId)` computed inside their own
      // `variantId` group, so one order carrying both an unassigned and an
      // assigned line for this product — exactly the mixed historical shape
      // this fold exists for — is counted once on each side. Summing
      // reports 2 unstamped orders for 1. The union size cannot be
      // recovered from two group counts, so this reports the larger, which
      // is a true LOWER BOUND and never overstates a data-quality problem.
      unconvertedOrderCount: Math.max(target.unconvertedOrderCount, unassigned.unconvertedOrderCount),
      currency: this.mergeCurrency(target.currency, unassigned.currency),
      unconvertedCurrency: this.mergeCurrency(
        target.unconvertedCurrency,
        unassigned.unconvertedCurrency
      ),
      netRevenue: target.netRevenue + unassigned.netRevenue,
      netExcludedRevenue: target.netExcludedRevenue + unassigned.netExcludedRevenue,
      netExcludedLineCount: target.netExcludedLineCount + unassigned.netExcludedLineCount,
      channels: this.mergeChannelBreakdowns(target.channels, unassigned.channels, targetId),
    };

    const result = variants.filter((_, index) => index !== targetIndex && index !== unassignedIndex);
    result.splice(Math.min(targetIndex, unassignedIndex), 0, merged);
    return result;
  }

  /**
   * `null` when the two sides name DIFFERENT currencies (#2765 review,
   * finding 4) — mirroring the SQL that produced these fields, which
   * already returns `null` for a set that mixes native currencies
   * (`unconverted_currency`'s `COUNT(DISTINCT rec."currency") <= 1` guard).
   * A `??` chain instead labelled the sum of a PLN slice and a EUR slice
   * with whichever currency happened to come first — a number that is not
   * an amount in the currency it claims. An amount with no single currency
   * is unrenderable, which is the correct outcome: the FE reads `null` as
   * "no figure", never as zero.
   */
  private mergeCurrency(a: string | null, b: string | null): string | null {
    if (a !== null && b !== null && a !== b) {
      return null;
    }
    return a ?? b;
  }

  private mergeChannelBreakdowns(
    a: VariantChannelBreakdownRow[],
    b: VariantChannelBreakdownRow[],
    variantId: string
  ): VariantChannelBreakdownRow[] {
    const byConnection = new Map<string, VariantChannelBreakdownRow>();
    for (const row of [...a, ...b]) {
      const existing = byConnection.get(row.sourceConnectionId);
      if (!existing) {
        byConnection.set(row.sourceConnectionId, { ...row, variantId });
        continue;
      }
      byConnection.set(row.sourceConnectionId, {
        variantId,
        sourceConnectionId: row.sourceConnectionId,
        units: existing.units + row.units,
        revenue: existing.revenue + row.revenue,
        unconvertedRevenue: existing.unconvertedRevenue + row.unconvertedRevenue,
        currency: this.mergeCurrency(existing.currency, row.currency),
        unconvertedCurrency: this.mergeCurrency(existing.unconvertedCurrency, row.unconvertedCurrency),
        netRevenue: existing.netRevenue + row.netRevenue,
        netExcludedRevenue: existing.netExcludedRevenue + row.netExcludedRevenue,
        netExcludedLineCount: existing.netExcludedLineCount + row.netExcludedLineCount,
      });
    }
    return [...byConnection.values()];
  }

  /**
   * Live stock per variant, best-effort (#2765) — mirrors {@link
   * resolveCoverageGaps}'s degrade-rather-than-500 policy: a failure here
   * must not take down the whole drill-down over a secondary enrichment.
   * Degrades to an empty map, which `TopProductVariantsResponseDto` reads as
   * `totalAvailable: null` per variant — "not resolved", never a false `0`.
   *
   * Reads `findAvailabilityByVariantIds`, NOT the zero-filled
   * `getAvailabilityByVariantIds` (#2765 review, finding 1): the latter maps
   * every requested id to a number, so a variant no inventory master has
   * ever synced came back as `0` and rendered a red "Out of stock" badge —
   * a positive false claim about the seller's stock, where the intent is no
   * badge at all. A variant absent from this read stays absent from the map
   * and therefore `null` on the wire.
   */
  private async resolveVariantStock(
    productId: string,
    variantIds: string[]
  ): Promise<Map<string, number>> {
    if (variantIds.length === 0) {
      return new Map();
    }
    try {
      const availability = await this.inventoryQueryService.findAvailabilityByVariantIds(variantIds);
      return new Map(availability.map((entry) => [entry.productVariantId, entry.totalAvailable]));
    } catch (error) {
      this.logger.warn(
        `Stock enrichment failed for top-product variant sales (product ${productId}): ${(error as Error).message}`
      );
      return new Map();
    }
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
