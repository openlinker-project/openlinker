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
import { IProductsService, PRODUCTS_SERVICE_TOKEN } from '@openlinker/core/products';
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
    private readonly productsService: IProductsService
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
    // writes one variant-keyed canonical row per entry.
    const inventories = await inventoryAdapter.listInventory(internalProductId);

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
    // stale (#1478). Runs unconditionally — an empty response marks every row for
    // the product stale (product fully removed at the master).
    const markedStale = await this.inventoryService.pruneStaleVariants(
      internalProductId,
      currentVariantIds
    );

    this.logger.debug(
      `Master inventory sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, itemsWritten=${inventories.length}, markedStale=${markedStale}, available=${availableQuantity}, reserved=${reservedQuantity})`
    );

    return {
      internalProductId,
      itemsWritten: inventories.length,
      availableQuantity,
      reservedQuantity,
    };
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
