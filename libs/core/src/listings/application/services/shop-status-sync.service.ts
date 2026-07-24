/**
 * Shop Status Sync Service (#1845)
 *
 * Steady-state reconcile of shop-side product publication status. For one page
 * of a connection's published/draft products it reads the live status via the
 * `ShopProductStatusReader` sub-capability and persists it into
 * `shop_product_status_snapshots`, logging when a product's status changes
 * versus the prior snapshot (so an unpublished / trashed product is detected).
 *
 * The shop-side sibling of `OfferStatusSyncService` (#816). Enumeration uses the
 * connection's own `ListingCreationRecord` rows (published/draft with an
 * external product id) rather than a marketplace mapping table - the shop path's
 * source of truth for "what OL published here".
 *
 * @module libs/core/src/listings/application/services
 * @implements {IShopStatusSyncService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';
import { isShopProductStatusReader } from '../../domain/ports/capabilities/shop-product-status-reader.capability';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import { ShopProductStatusSnapshotRepositoryPort } from '../../domain/ports/shop-product-status-snapshot-repository.port';
import { SHOP_PUBLICATION_STATUS } from '../../domain/types/shop-product-status.types';
import type { ShopStatusSyncResult } from '../../domain/types/shop-product-status.types';
import {
  LISTING_CREATION_RECORD_REPOSITORY_TOKEN,
  SHOP_PRODUCT_STATUS_SNAPSHOT_REPOSITORY_TOKEN,
} from '../../listings.tokens';
import type {
  IShopStatusSyncService,
  ShopStatusSyncOptions,
} from './shop-status-sync.service.interface';

@Injectable()
export class ShopStatusSyncService implements IShopStatusSyncService {
  private readonly logger = new Logger(ShopStatusSyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(LISTING_CREATION_RECORD_REPOSITORY_TOKEN)
    private readonly listingRecords: ListingCreationRecordRepositoryPort,
    @Inject(SHOP_PRODUCT_STATUS_SNAPSHOT_REPOSITORY_TOKEN)
    private readonly snapshots: ShopProductStatusSnapshotRepositoryPort,
  ) {}

  async sync(
    connectionId: string,
    options: ShopStatusSyncOptions,
  ): Promise<ShopStatusSyncResult> {
    const offset = options.offset ?? 0;
    const limit = options.limit;

    const adapter = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      connectionId,
      'ProductPublisher',
    );
    if (!isShopProductStatusReader(adapter)) {
      this.logger.warn(
        `Connection ${connectionId} adapter does not support ShopProductStatusReader; skipping shop-status sync`,
      );
      return { scanned: 0, updated: 0, transitioned: 0, removed: 0, total: 0, nextOffset: 0 };
    }

    const page = await this.listingRecords.findPublishedByConnection(connectionId, {
      limit,
      offset,
    });
    const items = page.items;

    let updated = 0;
    let transitioned = 0;
    let removed = 0;

    for (const record of items) {
      // Published/draft records always carry an external product id; guard
      // defensively so a malformed row is skipped rather than throwing.
      if (record.externalProductId === null) {
        continue;
      }
      const externalProductId = record.externalProductId;

      const status = await adapter.getShopProductStatus(externalProductId);

      const { previousStatus } = await this.snapshots.upsert({
        connectionId,
        externalProductId,
        internalVariantId: record.internalVariantId,
        publicationStatus: status.publicationStatus,
        statusDetails: null,
        lastStatusSyncedAt: new Date(),
      });
      updated += 1;

      if (status.publicationStatus === SHOP_PUBLICATION_STATUS.Removed) {
        removed += 1;
      }

      if (previousStatus !== null && previousStatus !== status.publicationStatus) {
        transitioned += 1;
        this.logger.log(
          `Shop product status transition (connection=${connectionId}, productId=${externalProductId}): ${previousStatus} → ${status.publicationStatus}`,
        );
      }
    }

    const proposedNext = offset + limit;
    const nextOffset = proposedNext >= page.total ? 0 : proposedNext;

    this.logger.log(
      `Shop-status sync (connection=${connectionId}): scanned=${items.length}, updated=${updated}, transitioned=${transitioned}, removed=${removed}, offset=${offset}→${nextOffset}/${page.total}`,
    );

    return {
      scanned: items.length,
      updated,
      transitioned,
      removed,
      total: page.total,
      nextOffset,
    };
  }
}
