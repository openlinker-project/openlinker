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

import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
import { Logger } from '@openlinker/shared/logging';

import type { ShopProductManagerPort } from '../../domain/ports/shop-product-manager.port';
import {
  isShopProductStatusReader,
  type ShopProductStatusReader,
} from '../../domain/ports/capabilities/shop-product-status-reader.capability';
import { ListingCreationRecordRepositoryPort } from '../../domain/ports/listing-creation-record-repository.port';
import { ShopProductStatusSnapshotRepositoryPort } from '../../domain/ports/shop-product-status-snapshot-repository.port';
import { SHOP_PUBLICATION_STATUS } from '../../domain/types/shop-product-status.types';
import type {
  ShopProductStatusReadResult,
  ShopStatusSyncResult,
} from '../../domain/types/shop-product-status.types';
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
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
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

      const status = await this.readStatus(adapter, connectionId, record.internalVariantId, externalProductId);

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

  /**
   * Resolve the correct status-read call for one record (whole-epic review
   * finding #2). A grouped/multi-variant publish (#1836) stores the CHILD
   * variation's id on `record.externalProductId`, which is a different
   * shop-native resource than a standalone simple product (WooCommerce:
   * `products/{parentId}/variations/{id}`, not `products/{id}`) — reading it
   * through `getShopProductStatus` 404s and is misread as `removed`.
   *
   * Detects "grouped" the same way the publish path does (sibling count > 1 on
   * the variant's product), then resolves the parent's `ShopProduct` mapping
   * (keyed on the product id, same lookup shape used to thread
   * `variantGroup.externalParentProductId` in `ProductPublishExecutionService`)
   * and calls the adapter's variation-aware read when both the grouping and
   * the adapter support exist. Falls back to the simple-product read
   * otherwise — including when the adapter doesn't implement the optional
   * `getShopVariationStatus` method — so existing readers are unaffected.
   */
  private async readStatus(
    adapter: ShopProductManagerPort & ShopProductStatusReader,
    connectionId: string,
    internalVariantId: string,
    externalProductId: string,
  ): Promise<ShopProductStatusReadResult> {
    if (typeof adapter.getShopVariationStatus === 'function') {
      const variant = await this.productsService.getVariant(internalVariantId);
      if (variant) {
        const siblings = await this.productsService.getVariantsByProductId(variant.productId);
        if (siblings.length > 1) {
          const parentExternalId = await this.resolveParentExternalId(
            variant.productId,
            connectionId,
          );
          if (parentExternalId) {
            return adapter.getShopVariationStatus(parentExternalId, externalProductId);
          }
        }
      }
    }
    return adapter.getShopProductStatus(externalProductId);
  }

  private async resolveParentExternalId(
    productId: string,
    connectionId: string,
  ): Promise<string | null> {
    const mappings = await this.identifierMapping.getExternalIds(
      CORE_ENTITY_TYPE.ShopProduct,
      productId,
    );
    return mappings.find((m) => m.connectionId === connectionId)?.externalId ?? null;
  }
}
