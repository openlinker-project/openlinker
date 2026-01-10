/**
 * Inventory Service
 *
 * Application service for inventory operations. Provides inventory upsert
 * and read capabilities. Works with internal IDs only; IdentifierMapping is
 * handled by handlers, not by this service.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IInventoryService}
 * @see {@link IInventoryService} for the service interface
 * @see {@link InventoryRepositoryPort} for persistence port
 */
import { Injectable, Inject } from '@nestjs/common';
import { IInventoryService } from './inventory.service.interface';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import { InventoryItem } from '../../domain/entities/inventory-item.entity';
import { Logger } from '@openlinker/shared/logging';
import { INVENTORY_REPOSITORY_TOKEN } from '../../inventory.tokens';

@Injectable()
export class InventoryService implements IInventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
  ) {}

  async setInventory(item: InventoryItem): Promise<InventoryItem> {
    this.logger.debug(
      `Setting inventory for product: ${item.productId}, variant: ${item.productVariantId ?? 'base'}, location: ${item.locationId ?? 'default'}`,
    );
    const upserted = await this.inventoryRepository.upsert(item);
    this.logger.debug(`Inventory set: ${upserted.id}`);
    return upserted;
  }

  async getInventory(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null,
  ): Promise<InventoryItem | null> {
    this.logger.debug(
      `Getting inventory for product: ${productId}, variant: ${productVariantId ?? 'base'}, location: ${locationId ?? 'default'}`,
    );
    return this.inventoryRepository.findByProductAndVariant(
      productId,
      productVariantId,
      locationId,
    );
  }
}

