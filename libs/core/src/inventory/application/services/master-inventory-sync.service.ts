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
import {
  IIdentifierMappingService,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
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
    private readonly inventoryService: IInventoryService
  ) {}

  async syncFromMasterByExternalId(
    connectionId: string,
    externalId: string
  ): Promise<MasterInventorySyncResult> {
    const internalProductId = await this.identifierMapping.getOrCreateInternalId(
      'Product',
      externalId,
      connectionId
    );

    const inventoryAdapter =
      await this.integrationsService.getCapabilityAdapter<InventoryMasterPort>(
        connectionId,
        'InventoryMaster'
      );

    const inventoryFromAdapter = await inventoryAdapter.getInventory(internalProductId, undefined);
    const inventoryItem = await this.toDomainInventoryItem(inventoryFromAdapter, internalProductId);
    await this.inventoryService.setInventory(inventoryItem);

    this.logger.debug(
      `Master inventory sync complete (connection: ${connectionId}, externalId: ${externalId}, internalProductId: ${internalProductId}, available=${inventoryItem.availableQuantity}, reserved=${inventoryItem.reservedQuantity})`
    );

    return {
      internalProductId,
      availableQuantity: inventoryItem.availableQuantity,
      reservedQuantity: inventoryItem.reservedQuantity,
    };
  }

  private async toDomainInventoryItem(
    inventory: InventoryPortInterface,
    productId: string
  ): Promise<InventoryItemDomainEntity> {
    const existing = await this.inventoryService.getInventory(
      productId,
      inventory.variantId ?? null,
      inventory.locationId ?? null
    );

    const inventoryItemId = existing?.id ?? randomUUID();

    const availableQuantity =
      inventory.available ?? (inventory.quantity ?? 0) - (inventory.reserved ?? 0);

    return new InventoryItemDomainEntity(
      inventoryItemId,
      productId,
      inventory.variantId ?? null,
      availableQuantity,
      inventory.reserved ?? 0,
      inventory.locationId ?? null,
      inventory.updatedAt ?? new Date()
    );
  }
}
