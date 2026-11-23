/**
 * Listing Sale Status Service (#3962)
 *
 * Answers "is this product still on sale anywhere?" for the product page,
 * from what OpenLinker already holds: the identifier mappings, the persisted
 * channel status / quantity snapshots and the sale holds. No channel call.
 *
 * It also owns the only way a sale hold ends: `releaseHolds`, an operator
 * action. Nothing puts a held listing back on sale by itself, not even the
 * product coming back at the master, because a seller who sees a deleted
 * product reappear has to decide where it should sell again.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IListingSaleStatusService}
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import { SyncJobQueuePort, SYNC_JOB_QUEUE_TOKEN } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import {
  LISTING_SALE_HOLD_REPOSITORY_TOKEN,
  OFFER_COMMERCIAL_READ_SERVICE_TOKEN,
  OFFER_STATUS_READ_SERVICE_TOKEN,
  SHOP_PRODUCT_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type { ListingSaleHold } from '../../domain/entities/listing-sale-hold.entity';
import { SaleHoldReleaseRefusedException } from '../../domain/exceptions/sale-hold-release-refused.exception';
import { isShopProductVisibilityWriter } from '../../domain/ports/capabilities/shop-product-visibility-writer.capability';
import { ListingSaleHoldRepositoryPort } from '../../domain/ports/listing-sale-hold-repository.port';
import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';
import { ShopProductStatusSnapshotRepositoryPort } from '../../domain/ports/shop-product-status-snapshot-repository.port';
import type { ListingRef } from '../../domain/types/listing-sale-hold.types';
import {
  deriveListingSaleState,
  type ListingSaleRow,
  type ProductSaleStatus,
  type ReleaseSaleHoldsResult,
} from '../../domain/types/listing-sale-status.types';
import type { IListingSaleStatusService } from '../interfaces/listing-sale-status.service.interface';
import { IOfferCommercialReadService } from './offer-commercial-read.service.interface';
import { IOfferStatusReadService } from './offer-status-read.service.interface';

/** Placeholder scope for a job with no owning connection (same value as inventory's). */
const SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

const holdKey = (connectionId: string, entityType: string, externalId: string): string =>
  `${connectionId}|${entityType}|${externalId}`;

@Injectable()
export class ListingSaleStatusService implements IListingSaleStatusService {
  private readonly logger = new Logger(ListingSaleStatusService.name);

  constructor(
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(OFFER_STATUS_READ_SERVICE_TOKEN)
    private readonly offerStatusRead: IOfferStatusReadService,
    @Inject(OFFER_COMMERCIAL_READ_SERVICE_TOKEN)
    private readonly offerCommercialRead: IOfferCommercialReadService,
    @Inject(SHOP_PRODUCT_STATUS_SNAPSHOT_REPOSITORY_TOKEN)
    private readonly shopSnapshots: ShopProductStatusSnapshotRepositoryPort,
    @Inject(LISTING_SALE_HOLD_REPOSITORY_TOKEN)
    private readonly holds: ListingSaleHoldRepositoryPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrations: IIntegrationsService,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort,
  ) {}

  async getProductSaleStatus(productId: string): Promise<ProductSaleStatus> {
    const variants = await this.productsService.getVariantsByProductId(productId);
    const variantIds = variants.map((v) => v.id);
    const stale = variants.filter((v) => v.isStale === true && v.staleAt);
    const deletedAt = stale.reduce<Date | null>(
      (latest, v) => (latest === null || (v.staleAt as Date) > latest ? (v.staleAt as Date) : latest),
      null,
    );

    const [activeHolds, offerStatuses, quantities, shopSnapshots] = await Promise.all([
      this.holds.findActiveByProductId(productId),
      this.offerStatusRead.getPublicationStatusForProduct(productId),
      this.offerCommercialRead.getObservedQuantities(variantIds),
      variantIds.length > 0 ? this.shopSnapshots.findByVariantIds(variantIds) : Promise.resolve([]),
    ]);
    const holdByListing = new Map(
      activeHolds.map((h) => [holdKey(h.connectionId, h.entityType, h.externalId), h]),
    );
    const rows: ListingSaleRow[] = [];

    for (const offer of offerStatuses) {
      const qty = quantities.find(
        (q) => q.connectionId === offer.connectionId && q.externalOfferId === offer.externalOfferId,
      );
      const hold = holdByListing.get(holdKey(offer.connectionId, 'Offer', offer.externalOfferId)) ?? null;
      rows.push(
        this.toRow({
          connectionId: offer.connectionId,
          entityType: 'Offer',
          externalId: offer.externalOfferId,
          externalParentId: null,
          internalVariantId: offer.internalVariantId,
          channelStatus: offer.publicationStatus,
          quantity: qty?.availableQuantity ?? null,
          lastCheckedAt: offer.lastStatusSyncedAt ?? qty?.observedAt ?? null,
          hold,
        }),
      );
    }

    const parentMappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.ShopProduct, productId);
    const parentByConnection = new Map(parentMappings.map((m) => [m.connectionId, m.externalId]));
    const coveredByParent = new Set<string>();
    for (const [connectionId, parentExternalId] of parentByConnection) {
      const hold = holdByListing.get(holdKey(connectionId, 'ShopProduct', parentExternalId));
      if (!hold) continue;
      coveredByParent.add(connectionId);
      const snapshot = shopSnapshots.find((s) => s.connectionId === connectionId);
      rows.push(
        this.toRow({
          connectionId,
          entityType: 'ShopProduct',
          externalId: parentExternalId,
          externalParentId: null,
          internalVariantId: null,
          channelStatus: snapshot?.publicationStatus ?? null,
          quantity: null,
          lastCheckedAt: snapshot?.lastStatusSyncedAt ?? null,
          hold,
        }),
      );
    }

    for (const variant of variants) {
      const mappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.ShopProduct, variant.id);
      for (const mapping of mappings) {
        if (coveredByParent.has(mapping.connectionId)) continue;
        const snapshot = shopSnapshots.find(
          (s) => s.connectionId === mapping.connectionId && s.externalProductId === mapping.externalId,
        );
        rows.push(
          this.toRow({
            connectionId: mapping.connectionId,
            entityType: 'ShopProduct',
            externalId: mapping.externalId,
            externalParentId: parentByConnection.get(mapping.connectionId) ?? null,
            internalVariantId: variant.id,
            channelStatus: snapshot?.publicationStatus ?? null,
            quantity: null,
            lastCheckedAt: snapshot?.lastStatusSyncedAt ?? null,
            hold: holdByListing.get(holdKey(mapping.connectionId, 'ShopProduct', mapping.externalId)) ?? null,
          }),
        );
      }
    }

    const checkedAt = rows.reduce<Date | null>(
      (latest, r) => (r.lastCheckedAt && (latest === null || r.lastCheckedAt > latest) ? r.lastCheckedAt : latest),
      null,
    );
    return {
      productId,
      deletedAt,
      deletedAtSource: stale.length > 0,
      staleVariantIds: stale.map((v) => v.id),
      rows,
      checkedAt,
    };
  }

  async releaseHolds(
    productId: string,
    holdIds: readonly string[],
    actor: string,
  ): Promise<ReleaseSaleHoldsResult> {
    const holds = (await this.holds.findByIdsForProduct(productId, holdIds)).filter((h) => h.isActive);
    if (holds.length === 0) return { released: [], failed: [] };

    const variants = await this.productsService.getVariantsByProductId(productId);
    const staleIds = new Set(variants.filter((v) => v.isStale === true).map((v) => v.id));
    const blocked = holds.filter((h) =>
      h.internalVariantId === null ? staleIds.size > 0 : staleIds.has(h.internalVariantId),
    );
    if (blocked.length > 0) {
      throw new SaleHoldReleaseRefusedException(
        productId,
        blocked.map((h) => h.id),
      );
    }

    const released: string[] = [];
    const failed: { holdId: string; message: string }[] = [];
    const now = new Date();
    for (const hold of holds) {
      try {
        if (hold.method === 'unpublished') {
          await this.showShopProduct(hold);
        }
        await this.holds.release([hold.id], actor, now);
        released.push(hold.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to put listing ${hold.externalId} back on sale (hold ${hold.id}): ${message}`);
        failed.push({ holdId: hold.id, message });
      }
    }

    if (released.length > 0) {
      await this.enqueueStockRefresh(productId, holds.filter((h) => released.includes(h.id)), now);
    }
    return { released, failed };
  }

  findActiveHolds(refs: readonly ListingRef[]): Promise<ListingSaleHold[]> {
    return this.holds.findActiveByListings(refs);
  }

  countProductsStillOnSale(): Promise<number> {
    return this.holds.countProductsNeedingAttention();
  }

  private async showShopProduct(hold: ListingSaleHold): Promise<void> {
    const adapter = await this.integrations.getCapabilityAdapter<ShopProductManagerPort>(
      hold.connectionId,
      'ProductPublisher',
    );
    if (!isShopProductVisibilityWriter(adapter)) {
      throw new Error(`Connection ${hold.connectionId} cannot change product visibility`);
    }
    await adapter.setShopProductVisibility({ externalProductId: hold.externalId, visible: true });
  }

  /**
   * After a release the ordinary propagation writes the master's current
   * stock again. The release time is the observation it carries: the
   * operator's decision is the new fact, and it is newer than the `staleAt`
   * the pause wrote, so the write-order guard (#2617) lets it through.
   */
  private async enqueueStockRefresh(productId: string, released: ListingSaleHold[], at: Date): Promise<void> {
    const variantIds = new Set<string>();
    for (const hold of released) {
      if (hold.internalVariantId) {
        variantIds.add(hold.internalVariantId);
      } else {
        for (const v of await this.productsService.getVariantsByProductId(productId)) variantIds.add(v.id);
      }
    }
    // The job's scope is the master the stock comes from (#2609), never the
    // channel being released: the propagation fans out to every channel.
    const masterMappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Product, productId);
    const masterConnectionId = masterMappings[0]?.connectionId ?? SYSTEM_CONNECTION_ID;
    for (const variantId of variantIds) {
      try {
        await this.jobQueue.enqueue({
          type: 'inventory.propagateToMarketplaces',
          connectionId: masterConnectionId,
          payload: { productId, variantId, inventoryUpdatedAt: at.toISOString() },
          options: { dedupeKey: `sale-hold-release:${variantId}:${at.toISOString()}` },
        });
      } catch (error) {
        this.logger.error(
          `Failed to enqueue stock refresh after release for variant ${variantId}`,
          (error as Error).stack,
        );
      }
    }
  }

  private toRow(input: Omit<ListingSaleRow, 'state' | 'hold'> & { hold: ListingSaleHold | null }): ListingSaleRow {
    const { hold, ...rest } = input;
    return {
      ...rest,
      hold: hold
        ? {
            id: hold.id,
            method: hold.method,
            outcome: hold.outcome,
            outcomeReason: hold.outcomeReason,
            appliedAt: hold.appliedAt,
          }
        : null,
      state: deriveListingSaleState({
        channelStatus: input.channelStatus,
        quantity: input.quantity,
        hold: hold ? { outcome: hold.outcome, active: hold.isActive } : null,
      }),
    };
  }
}
