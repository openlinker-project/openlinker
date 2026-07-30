/**
 * Master Inventory Sync Service
 *
 * Core-owned orchestration for syncing inventory data from a master connection
 * to canonical storage.
 *
 * @module libs/core/src/inventory/application/services
 */

import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIdentifierMappingService, IDENTIFIER_MAPPING_SERVICE_TOKEN, CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import {
  IProductsService,
  PRODUCTS_SERVICE_TOKEN,
  MASTER_DELETION_EVENT_STREAM,
  MASTER_DELETION_EVENT_SCHEMA_VERSION,
  MASTER_PRODUCT_STALE_EVENT,
  MASTER_VARIANT_STALE_EVENT,
  MasterProductNotFoundError,
  type MasterDeletionEventPayload,
} from '@openlinker/core/products';
import { EventPublisherPort, EVENT_PUBLISHER_TOKEN } from '@openlinker/core/events';
import { INVENTORY_SERVICE_TOKEN } from '../../inventory.tokens';
import { IInventoryService } from './inventory.service.interface';
import type {
  InventoryMasterPort,
  Inventory as InventoryPortInterface,
} from '../../domain/ports/inventory-master.port';
import { InventoryItem as InventoryItemDomainEntity } from '../../domain/entities/inventory-item.entity';
import type {
  IMasterInventorySyncService,
  MasterInventorySyncResult,
} from './master-inventory-sync.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class MasterInventorySyncService implements IMasterInventorySyncService {
  private readonly logger = new Logger(MasterInventorySyncService.name);

  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN)
    private readonly identifierMapping: IIdentifierMappingService,
    @Inject(INVENTORY_SERVICE_TOKEN)
    private readonly inventoryService: IInventoryService,
    @Inject(PRODUCTS_SERVICE_TOKEN)
    private readonly productsService: IProductsService,
    @Inject(EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: EventPublisherPort
  ) {}

  async syncFromMasterByExternalId(
    connectionId: string,
    externalId: string
  ): Promise<MasterInventorySyncResult> {
    const internalProductId = await this.identifierMapping.getOrCreateInternalId(
      CORE_ENTITY_TYPE.Product,
      externalId,
      connectionId
    );

    const inventoryAdapter =
      await this.integrationsService.getCapabilityAdapter<InventoryMasterPort>(
        connectionId,
        'InventoryMaster'
      );

    // One Inventory per variant — per-combination rows for multi-variant
    // products, the synthetic variant for simple products (#823). The sync
    // writes one variant-keyed canonical row per entry. A master-side deletion
    // surfaces as the neutral MasterProductNotFoundError (adapters translate
    // their platform not-found at the listInventory port boundary, #1688) —
    // distinct from a transient failure, which rethrows unchanged so the job
    // stays retryable.
    let inventories: InventoryPortInterface[];
    try {
      inventories = await inventoryAdapter.listInventory(internalProductId);
    } catch (error) {
      if (error instanceof MasterProductNotFoundError) {
        return this.handleMasterDeletion(connectionId, externalId, internalProductId);
      }
      throw error;
    }

    let availableQuantity = 0;
    let reservedQuantity = 0;
    const currentVariantIds: (string | null)[] = [];
    for (const inventory of inventories) {
      const inventoryItem = await this.toDomainInventoryItem(inventory, internalProductId);
      await this.inventoryService.setInventory(inventoryItem);
      currentVariantIds.push(inventoryItem.productVariantId);
      availableQuantity += inventoryItem.availableQuantity;
      reservedQuantity += inventoryItem.reservedQuantity;
    }

    // Soft-mark any previously-known variant absent from this master response as
    // stale. A genuine full deletion is caught above via MasterProductNotFoundError
    // before ever reaching here (#1688); this prune instead catches a PARTIAL
    // removal (some variants gone, the product itself still resolves) or an
    // adapter returning an empty list without throwing (e.g. a variable product
    // with zero variations) — runs unconditionally, so an empty response still
    // marks every currently-known row stale (#1478). Unlike the products-context
    // MasterProductSyncService, which skips its equivalent prune on a
    // successful-but-empty pull to avoid staling everything on a flaky response,
    // this side prunes unconditionally on purpose - the two are intentionally
    // asymmetric here, not drifted. The asymmetry is made observable below: an
    // empty response that stales rows is warn-logged, so a silent full-stale
    // can't happen without an operator-visible signal.
    const pruneResult = await this.inventoryService.pruneStaleVariants(
      internalProductId,
      currentVariantIds
    );

    // A successful-but-empty master response that stales every currently-known
    // row is the one case where this side's unconditional prune diverges from
    // the products context (which skips its prune instead). It is reported as
    // masterDeleted=false / outcome='ok' - correct, since the product itself
    // still resolves at the master - so without this warn the full-stale would
    // leave no trace anywhere. Reachable e.g. for a WooCommerce variable
    // product whose variations list comes back empty without a 404.
    if (inventories.length === 0 && pruneResult.markedCount > 0) {
      this.logger.warn(
        `master_inventory_empty_response_full_stale connection=${connectionId} externalId=${externalId} internalProductId=${internalProductId} markedStale=${pruneResult.markedCount} — master returned no inventory rows while the product still resolves; every known row was marked stale`
      );
    }

    // Emit the master-deletion signal from the inventory prune path too (#1599).
    // Disjoint from the product-sync emission — a full deletion produces one from
    // each sync path; consumers dedupe by (productId, variantIds) as needed.
    // Gated on markedCount, not variantIds.length - a product-level (NULL
    // variant) row contributes to markedCount but not variantIds, and gating on
    // variantIds alone would silently drop the event for such a row (#1688).
    if (pruneResult.markedCount > 0) {
      await this.publishDeletionEvent(MASTER_VARIANT_STALE_EVENT, {
        connectionId,
        internalProductId,
        variantIds: pruneResult.variantIds,
      });
    }

    this.logger.debug(
      `Master inventory sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, itemsWritten=${inventories.length}, markedStale=${pruneResult.markedCount}, available=${availableQuantity}, reserved=${reservedQuantity})`
    );

    return {
      internalProductId,
      itemsWritten: inventories.length,
      availableQuantity,
      reservedQuantity,
      masterDeleted: false,
    };
  }

  /**
   * Product deleted at the master (its inventory no longer resolves there):
   * mark every one of its inventory rows stale (empty keep-set), emit
   * `master.product.stale`, and signal the deletion so the worker handler does
   * NOT retry a permanent condition (#1688, mirrors
   * `MasterProductSyncService.handleMasterDeletion`, #1599).
   */
  private async handleMasterDeletion(
    connectionId: string,
    externalId: string,
    internalProductId: string
  ): Promise<MasterInventorySyncResult> {
    const pruneResult = await this.inventoryService.pruneStaleVariants(internalProductId, []);
    // Gated on markedCount, not variantIds.length - see the identical note on
    // the sibling emission above (#1688).
    if (pruneResult.markedCount > 0) {
      await this.publishDeletionEvent(MASTER_PRODUCT_STALE_EVENT, {
        connectionId,
        internalProductId,
        variantIds: pruneResult.variantIds,
      });
    }
    this.logger.warn(
      `Master inventory deleted at source — marked rows stale (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, markedStale=${pruneResult.markedCount})`
    );
    return {
      internalProductId,
      itemsWritten: 0,
      availableQuantity: 0,
      reservedQuantity: 0,
      masterDeleted: true,
    };
  }

  private async publishDeletionEvent(
    eventType: typeof MASTER_VARIANT_STALE_EVENT | typeof MASTER_PRODUCT_STALE_EVENT,
    payload: MasterDeletionEventPayload
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.eventPublisher.publish(MASTER_DELETION_EVENT_STREAM, {
      eventId: randomUUID(),
      eventType,
      payloadJson: JSON.stringify(payload),
      metadataJson: JSON.stringify({ schemaVersion: MASTER_DELETION_EVENT_SCHEMA_VERSION }),
      occurredAt: now,
      publishedAt: now,
    });
  }

  private async toDomainInventoryItem(
    inventory: InventoryPortInterface,
    productId: string
  ): Promise<InventoryItemDomainEntity> {
    const variantId = await this.resolveVariantId(inventory, productId);

    const existing = await this.inventoryService.getInventory(
      productId,
      variantId,
      inventory.locationId ?? null
    );

    const inventoryItemId = existing?.id ?? randomUUID();

    const availableQuantity =
      inventory.available ?? (inventory.quantity ?? 0) - (inventory.reserved ?? 0);

    return new InventoryItemDomainEntity(
      inventoryItemId,
      productId,
      variantId,
      availableQuantity,
      inventory.reserved ?? 0,
      inventory.locationId ?? null,
      inventory.updatedAt ?? new Date()
    );
  }

  /**
   * Resolve the variant the inventory row is keyed to (#822). The canonical
   * mapping/offer target is the variant, so master inventory is keyed to the
   * product's variant rather than the bare product — this is what lets the
   * variant-keyed availability read (the bulk offer wizard) find stock.
   *
   * - An adapter that already knows the variant wins. Since #823 the PrestaShop
   *   adapter supplies a variantId per combination (and for the synthetic
   *   variant) via `listInventory`, so this is the normal path.
   * - Safety net for an adapter that doesn't set variantId: a product with
   *   exactly one variant ⇒ key to it; multiple/zero variants ⇒ product-level
   *   (`null`).
   */
  private async resolveVariantId(
    inventory: InventoryPortInterface,
    productId: string
  ): Promise<string | null> {
    if (inventory.variantId) {
      return inventory.variantId;
    }

    const variants = await this.productsService.getVariantsByProductId(productId);
    if (variants.length === 1) {
      return variants[0].id;
    }

    this.logger.debug(
      `master_inventory_product_level_fallback product=${productId} variants=${variants.length} (multi/zero-variant — kept product-level pending #823/#824)`
    );
    return null;
  }
}
