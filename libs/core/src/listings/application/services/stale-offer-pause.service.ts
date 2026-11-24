/**
 * Stale Offer Pause Service
 *
 * Takes a listing off sale when its product (or one variant) is deleted at
 * the master. Covers marketplace offers (#1689) and, since #3962, shop
 * products - which until then kept selling with their last quantity.
 *
 * Two entry points share the same core:
 *
 *   - `pauseOffersForVariants` - the event-driven trigger. Re-reads each
 *     variant's `isStale` flag immediately before acting (never trust the
 *     event's variant list as authority - a reappearance racing the event
 *     must never take a live listing off sale).
 *   - `sweepConnection` - the reconcile guarantee. The deletion event is
 *     published at-most-once, so the hourly sweep re-reads the persisted
 *     `isStale` flag for one connection and re-asserts the same pause.
 *
 * What each channel gets:
 *
 *   - Marketplace offer: an absolute quantity-0 write, as before.
 *   - Shop product, whole product deleted: hidden (draft / inactive) through
 *     `ShopProductVisibilityWriter`. Most shop connections have no stock
 *     write, and stock 0 still sells where backorders are allowed, so hiding
 *     is what reliably stops the sale. Nothing is deleted on the shop.
 *   - Shop product, one variant deleted: a shop cannot hide one variation, so
 *     that variation gets quantity 0 where the connection writes stock;
 *     otherwise the hold records why it could not be stopped and the product
 *     page asks the operator to act.
 *
 * Every outcome is recorded as a `ListingSaleHold`. A hold whose write was
 * applied is not re-applied by the sweep (an operator may have reasons to
 * look at the shop product); a failed or impossible one is re-evaluated, so
 * switching stock updates on later is picked up within the hour. Holds end
 * only through an operator's "put back on sale".
 *
 * A single listing's failure never aborts the run: failures are logged and
 * recorded, not thrown, since the sweep is the backstop.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IStaleOfferPauseService}
 */
import { Injectable, Inject } from '@nestjs/common';
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  CORE_ENTITY_TYPE,
} from '@openlinker/core/identifier-mapping';
import {
  BUNDLE_DEFINITION_SERVICE_TOKEN,
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  type BundleDefinition,
  type IBundleDefinitionService,
} from '@openlinker/core/products';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { ProductVariant } from '@openlinker/core/products';
import { SyncJobQueuePort, SYNC_JOB_QUEUE_TOKEN } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import {
  LISTING_SALE_HOLD_REPOSITORY_TOKEN,
  OFFER_MAPPING_REPOSITORY_TOKEN,
  SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import { isShopProductVisibilityWriter } from '../../domain/ports/capabilities/shop-product-visibility-writer.capability';
import { ListingSaleHoldRepositoryPort } from '../../domain/ports/listing-sale-hold-repository.port';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';
import { ShopProductMappingRepositoryPort } from '../../domain/ports/shop-product-mapping-repository.port';
import type { RecordListingSaleHoldInput } from '../../domain/types/listing-sale-hold.types';
import type { StaleOfferPauseResult } from '../../domain/types/stale-offer-pause.types';
import type { IStaleOfferPauseService } from '../interfaces/stale-offer-pause.service.interface';

/** Recency window for the reconcile sweep - see this file's header. */
const DEFAULT_STALE_WINDOW_DAYS = 30;

interface StockZeroTarget {
  connectionId: string;
  externalId: string;
  externalParentId: string | null;
  staleAt: Date;
}

/** What a connection can do to stop a sale, read from its own capabilities. */
interface ConnectionAbility {
  writesStock: boolean;
  couldWriteStock: boolean;
}

const emptyResult = (considered: number): StaleOfferPauseResult => ({
  variantsConsidered: considered,
  variantsStillStale: 0,
  offersPaused: 0,
  offersSkipped: 0,
  shopProductsHidden: 0,
  shopListingsZeroed: 0,
  shopListingsNotStopped: 0,
});

@Injectable()
export class StaleOfferPauseService implements IStaleOfferPauseService {
  private readonly logger = new Logger(StaleOfferPauseService.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly offerMappings: OfferMappingRepositoryPort,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort,
    @Inject(BUNDLE_DEFINITION_SERVICE_TOKEN)
    private readonly bundleDefinitions: IBundleDefinitionService,
    @Inject(SHOP_PRODUCT_MAPPING_REPOSITORY_TOKEN)
    private readonly shopMappings: ShopProductMappingRepositoryPort,
    @Inject(LISTING_SALE_HOLD_REPOSITORY_TOKEN)
    private readonly holds: ListingSaleHoldRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService
  ) {}

  async pauseOffersForVariants(input: {
    variantIds: readonly string[];
    internalProductId?: string;
    correlationId: string;
  }): Promise<StaleOfferPauseResult> {
    const { correlationId } = input;
    // A product-level deletion row can arrive with no variant ids; every
    // variant of the product is then the subject.
    const variantIds =
      input.variantIds.length > 0 || !input.internalProductId
        ? [...input.variantIds]
        : (await this.productsService.getVariantsByProductId(input.internalProductId)).map((v) => v.id);
    const result = emptyResult(variantIds.length);
    const productIds = new Set<string>();

    for (const variantId of variantIds) {
      const variant = await this.productsService.getVariant(variantId);
      if (!variant || variant.isStale !== true || !variant.staleAt) {
        this.logger.debug(
          `Skipping stale pause for ${variantId} - no longer stale (correlationId: ${correlationId})`
        );
        continue;
      }
      result.variantsStillStale += 1;
      productIds.add(variant.productId);

      const offerMappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Offer, variantId);
      for (const mapping of offerMappings) {
        await this.pauseOffer(result, variant, mapping.connectionId, mapping.externalId, variant.staleAt);
      }
    }

    // #3931: a bundle with a stale component cannot be fulfilled, so its offers
    // are paused like the stale variant's own. Re-verified inside, never taken
    // from the event.
    const bundles = await this.bundleDefinitions.findCurrentContainingComponents(variantIds);
    const bundleResult = await this.pauseBundles(bundles, undefined);
    result.offersPaused += bundleResult.paused;
    result.offersSkipped += bundleResult.skipped;

    for (const productId of productIds) {
      await this.pauseShopListings(result, productId, null);
    }

    this.logger.warn(
      `Stale pause (trigger) complete: considered=${result.variantsConsidered}, stillStale=${result.variantsStillStale}, offersPaused=${result.offersPaused}, offersSkipped=${result.offersSkipped}, shopHidden=${result.shopProductsHidden}, shopZeroed=${result.shopListingsZeroed}, shopNotStopped=${result.shopListingsNotStopped} (correlationId: ${correlationId})`
    );
    return result;
  }

  async sweepConnection(
    connectionId: string,
    options: { limit: number }
  ): Promise<StaleOfferPauseResult> {
    const staleSince = new Date(Date.now() - DEFAULT_STALE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [staleMappedVariants, staleShopProductIds] = await Promise.all([
      this.offerMappings.findStaleMappedVariants(connectionId, { limit: options.limit, staleSince }),
      this.shopMappings.findStaleMappedProductIds(connectionId, { limit: options.limit, staleSince }),
    ]);

    const result = emptyResult(staleMappedVariants.length);
    result.variantsStillStale = staleMappedVariants.length;

    for (const row of staleMappedVariants) {
      const variant = await this.productsService.getVariant(row.variantId);
      if (!variant) continue;
      await this.pauseOffer(result, variant, connectionId, row.externalOfferId, row.staleAt);
    }
    for (const productId of staleShopProductIds) {
      await this.pauseShopListings(result, productId, connectionId);
    }

    // The persisted-state half for bundles (#3931): a bundle whose component is
    // stale has no stale variant of its own, so the variant sweep above cannot
    // find it. Bundles are authored by hand and few, so reading them all is one
    // small read per tick.
    const bundleResult = await this.pauseBundles(
      await this.bundleDefinitions.list(),
      connectionId
    );
    result.variantsConsidered += bundleResult.considered;
    result.variantsStillStale += bundleResult.considered;
    result.offersPaused += bundleResult.paused;
    result.offersSkipped += bundleResult.skipped;

    this.logger.debug(
      `Stale pause (sweep) complete for connection ${connectionId}: offers=${result.variantsConsidered}, paused=${result.offersPaused}, skipped=${result.offersSkipped}, shopProducts=${staleShopProductIds.length}, shopHidden=${result.shopProductsHidden}, shopZeroed=${result.shopListingsZeroed}, shopNotStopped=${result.shopListingsNotStopped}`
    );
    return result;
  }

  private async pauseOffer(
    result: StaleOfferPauseResult,
    variant: ProductVariant,
    connectionId: string,
    externalOfferId: string,
    staleAt: Date
  ): Promise<void> {
    const enqueued = await this.enqueueStockZero({
      connectionId,
      externalId: externalOfferId,
      externalParentId: null,
      staleAt,
    });
    if (enqueued) result.offersPaused += 1;
    else result.offersSkipped += 1;
    await this.recordHold({
      connectionId,
      entityType: 'Offer',
      externalId: externalOfferId,
      externalParentId: null,
      internalProductId: variant.productId,
      internalVariantId: variant.id,
      method: 'stock_zero',
      outcome: enqueued ? 'applied' : 'failed',
      outcomeReason: enqueued ? null : 'error',
      staleAt,
      appliedAt: new Date(),
    });
  }

  /**
   * Pause the offers of every bundle that currently has a stale component.
   *
   * Reads the components' `isStale` flag fresh (the #1689 re-verify rule), keys
   * the dedupe on the newest `staleAt` among them so a re-stale after a restock
   * pauses again, and optionally restricts to one connection (the sweep).
   */
  private async pauseBundles(
    bundles: readonly BundleDefinition[],
    onlyConnectionId: string | undefined
  ): Promise<{ considered: number; paused: number; skipped: number }> {
    const counts = { considered: 0, paused: 0, skipped: 0 };
    if (bundles.length === 0) return counts;

    const componentIds = [
      ...new Set(bundles.flatMap((bundle) => bundle.components.map((c) => c.variantId))),
    ];
    const variants = await this.productsService.getVariantsByIds(componentIds);
    const staleAtById = new Map<string, Date>();
    for (const variant of variants) {
      if (variant.isStale === true && variant.staleAt) {
        staleAtById.set(variant.id, variant.staleAt);
      }
    }

    for (const bundle of bundles) {
      const staleTimes = bundle.components
        .map((c) => staleAtById.get(c.variantId))
        .filter((d): d is Date => d !== undefined);
      if (staleTimes.length === 0) continue;
      counts.considered += 1;
      const staleAt = new Date(Math.max(...staleTimes.map((d) => d.getTime())));

      const offerMappings = await this.identifierMapping.getExternalIds(
        CORE_ENTITY_TYPE.Offer,
        bundle.variantId
      );
      for (const mapping of offerMappings) {
        if (onlyConnectionId !== undefined && mapping.connectionId !== onlyConnectionId) continue;
        const paused = await this.enqueueStockZero({
          connectionId: mapping.connectionId,
          externalId: mapping.externalId,
          externalParentId: null,
          staleAt,
        });
        if (paused) {
          counts.paused += 1;
        } else {
          counts.skipped += 1;
        }
      }
    }
    return counts;
  }

  /**
   * Stop every shop listing of one product, optionally limited to one
   * connection (the sweep). Hides the whole product when every variant is
   * deleted, otherwise zeroes the deleted variations where it can.
   */
  private async pauseShopListings(
    result: StaleOfferPauseResult,
    productId: string,
    onlyConnectionId: string | null
  ): Promise<void> {
    const variants = await this.productsService.getVariantsByProductId(productId);
    const stale = variants.filter((v) => v.isStale === true && v.staleAt);
    if (stale.length === 0) return;
    const wholeProduct = stale.length === variants.length;
    const staleAt = stale.reduce((latest, v) => ((v.staleAt as Date) > latest ? (v.staleAt as Date) : latest), stale[0].staleAt as Date);

    const parentMappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.ShopProduct, productId);
    const parentByConnection = new Map(parentMappings.map((m) => [m.connectionId, m.externalId]));
    const variantListings: { connectionId: string; externalId: string; variant: ProductVariant }[] = [];
    for (const variant of stale) {
      const mappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.ShopProduct, variant.id);
      for (const m of mappings) variantListings.push({ connectionId: m.connectionId, externalId: m.externalId, variant });
    }

    const connectionIds = new Set<string>([
      ...variantListings.map((l) => l.connectionId),
      ...(wholeProduct ? parentByConnection.keys() : []),
    ]);
    for (const connectionId of connectionIds) {
      if (onlyConnectionId && connectionId !== onlyConnectionId) continue;
      const listings = variantListings.filter((l) => l.connectionId === connectionId);
      const parentExternalId = parentByConnection.get(connectionId) ?? null;
      try {
        if (wholeProduct) {
          const hidden = await this.hideWholeProduct(result, {
            connectionId,
            productId,
            // A grouped product is hidden through its parent; a simple product
            // is its own (single) variant listing.
            externalId: parentExternalId ?? listings[0]?.externalId,
            internalVariantId: parentExternalId ? null : (listings[0]?.variant.id ?? null),
            staleAt,
          });
          if (hidden) continue;
        }
        await this.zeroVariantListings(result, connectionId, productId, parentExternalId, listings);
      } catch (error) {
        this.logger.error(
          `Stale pause failed for product ${productId} on connection ${connectionId}`,
          (error as Error).stack
        );
      }
    }
  }

  /**
   * Hide the product on one shop. Returns false when the connection has no
   * visibility write, so the caller falls back to per-variant stock 0.
   */
  private async hideWholeProduct(
    result: StaleOfferPauseResult,
    target: {
      connectionId: string;
      productId: string;
      externalId: string | undefined;
      internalVariantId: string | null;
      staleAt: Date;
    }
  ): Promise<boolean> {
    if (!target.externalId) return false;
    const existing = await this.holds.findActiveByListings([
      { connectionId: target.connectionId, entityType: 'ShopProduct', externalId: target.externalId },
    ]);
    if (existing[0]?.outcome === 'applied') return true;

    let adapter: ShopProductManagerPort;
    try {
      adapter = await this.integrations.getCapabilityAdapter<ShopProductManagerPort>(
        target.connectionId,
        'ProductPublisher'
      );
    } catch {
      return false;
    }
    if (!isShopProductVisibilityWriter(adapter)) return false;

    const base = {
      connectionId: target.connectionId,
      entityType: 'ShopProduct' as const,
      externalId: target.externalId,
      externalParentId: null,
      internalProductId: target.productId,
      internalVariantId: target.internalVariantId,
      method: 'unpublished' as const,
      staleAt: target.staleAt,
      appliedAt: new Date(),
    };
    try {
      await adapter.setShopProductVisibility({ externalProductId: target.externalId, visible: false });
      result.shopProductsHidden += 1;
      await this.recordHold({ ...base, outcome: 'applied', outcomeReason: null });
    } catch (error) {
      this.logger.error(
        `Failed to hide shop product ${target.externalId} (connection: ${target.connectionId})`,
        (error as Error).stack
      );
      result.shopListingsNotStopped += 1;
      await this.recordHold({ ...base, outcome: 'failed', outcomeReason: 'error' });
    }
    return true;
  }

  private async zeroVariantListings(
    result: StaleOfferPauseResult,
    connectionId: string,
    productId: string,
    parentExternalId: string | null,
    listings: { connectionId: string; externalId: string; variant: ProductVariant }[]
  ): Promise<void> {
    if (listings.length === 0) return;
    const existing = await this.holds.findActiveByListings(
      listings.map((l) => ({ connectionId, entityType: 'ShopProduct' as const, externalId: l.externalId }))
    );
    const applied = new Set(existing.filter((h) => h.outcome === 'applied').map((h) => h.externalId));
    const ability = await this.connectionAbility(connectionId);

    for (const listing of listings) {
      if (applied.has(listing.externalId)) continue;
      const staleAt = listing.variant.staleAt as Date;
      const base = {
        connectionId,
        entityType: 'ShopProduct' as const,
        externalId: listing.externalId,
        externalParentId: parentExternalId,
        internalProductId: productId,
        internalVariantId: listing.variant.id,
        staleAt,
        appliedAt: new Date(),
      };
      if (!ability.writesStock) {
        result.shopListingsNotStopped += 1;
        await this.recordHold({
          ...base,
          method: 'none',
          outcome: 'not_possible',
          outcomeReason: ability.couldWriteStock ? 'stock_sync_off' : 'no_stock_write',
        });
        continue;
      }
      const enqueued = await this.enqueueStockZero({
        connectionId,
        externalId: listing.externalId,
        externalParentId: parentExternalId,
        staleAt,
      });
      if (enqueued) result.shopListingsZeroed += 1;
      else result.shopListingsNotStopped += 1;
      await this.recordHold({
        ...base,
        method: 'stock_zero',
        outcome: enqueued ? 'applied' : 'failed',
        outcomeReason: enqueued ? null : 'error',
      });
    }
  }

  /**
   * Same rule as the inventory propagation's shop branch: stock is written to
   * a shop connection only when stock updates (`OfferManager`) are enabled on
   * it and it is not itself the inventory master. Whether it COULD write
   * stock tells "switched off" apart from "this shop has no stock write".
   */
  private async connectionAbility(connectionId: string): Promise<ConnectionAbility> {
    try {
      const { connection, metadata } = await this.integrations.getAdapter(connectionId);
      const enabled = connection.enabledCapabilities ?? [];
      const couldWriteStock = (metadata.supportedCapabilities ?? []).includes('OfferManager');
      return {
        couldWriteStock,
        writesStock: enabled.includes('OfferManager') && !enabled.includes('InventoryMaster'),
      };
    } catch {
      return { couldWriteStock: false, writesStock: false };
    }
  }

  private async recordHold(input: RecordListingSaleHoldInput): Promise<void> {
    try {
      await this.holds.recordActive(input);
    } catch (error) {
      this.logger.error(
        `Failed to record sale hold for ${input.entityType} ${input.externalId} (connection: ${input.connectionId})`,
        (error as Error).stack
      );
    }
  }

  /**
   * Enqueue one absolute quantity-0 update. Never throws - an enqueue failure
   * is logged and reported to the caller, since the sweep re-asserts on the
   * next tick.
   */
  private async enqueueStockZero(target: StockZeroTarget): Promise<boolean> {
    const dedupeKey = `stale-pause:${target.connectionId}:${target.externalId}:${target.staleAt.toISOString()}`;
    try {
      await this.jobQueue.enqueue({
        type: 'marketplace.offerQuantity.update',
        connectionId: target.connectionId,
        payload: {
          schemaVersion: 1,
          offerId: target.externalId,
          quantity: 0,
          // #2285 - the stale transition IS the observation this write expresses, so
          // a re-pause after a restock derives a fresh key instead of reusing a dead
          // command id and leaving the listing selling.
          observedAt: target.staleAt.toISOString(),
          ...(target.externalParentId ? { externalParentId: target.externalParentId } : {}),
        },
        options: { dedupeKey },
      });
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to enqueue stale pause for listing ${target.externalId} (connection: ${target.connectionId})`,
        (error as Error).stack
      );
      return false;
    }
  }
}
