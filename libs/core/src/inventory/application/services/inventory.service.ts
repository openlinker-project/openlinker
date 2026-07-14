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
import type { IInventoryService } from './inventory.service.interface';
import { InventoryRepositoryPort } from '../../domain/ports/inventory-repository.port';
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import { Logger } from '@openlinker/shared/logging';
import { INVENTORY_REPOSITORY_TOKEN } from '../../inventory.tokens';
import { SyncJobQueuePort, SYNC_JOB_QUEUE_TOKEN } from '@openlinker/core/sync';

@Injectable()
export class InventoryService implements IInventoryService {
  private readonly logger = new Logger(InventoryService.name);
  // inventory.propagateToMarketplaces is global and not tied to one connection.
  private readonly SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000';

  constructor(
    @Inject(INVENTORY_REPOSITORY_TOKEN)
    private readonly inventoryRepository: InventoryRepositoryPort,
    @Inject(SYNC_JOB_QUEUE_TOKEN)
    private readonly jobQueue: SyncJobQueuePort
  ) {}

  async setInventory(item: InventoryItem): Promise<InventoryItem> {
    this.logger.debug(
      `Setting inventory for product: ${item.productId}, variant: ${item.productVariantId ?? 'base'}, location: ${item.locationId ?? 'default'}`
    );

    const previous = await this.inventoryRepository.findByProductAndVariant(
      item.productId,
      item.productVariantId,
      item.locationId
    );

    const upserted = await this.inventoryRepository.upsert(item);
    this.logger.debug(`Inventory set: ${upserted.id}`);

    // Marketplace propagation currently assumes canonical single-location inventory.
    if (upserted.locationId !== null) {
      this.logger.debug(
        `inventory_write_propagation_skipped_non_default_location product=${upserted.productId} variant=${upserted.productVariantId ?? 'base'} location=${upserted.locationId}`
      );
      return upserted;
    }

    if (previous && previous.availableQuantity === upserted.availableQuantity) {
      this.logger.debug(
        `inventory_write_propagation_skipped_no_change product=${upserted.productId} variant=${upserted.productVariantId ?? 'base'} quantity=${upserted.availableQuantity}`
      );
      return upserted;
    }

    const writeEventToken = upserted.updatedAt.toISOString();
    const dedupeKey = this.buildPropagationDedupeKey(upserted, writeEventToken);
    try {
      await this.jobQueue.enqueue({
        type: 'inventory.propagateToMarketplaces',
        connectionId: this.SYSTEM_CONNECTION_ID,
        payload: {
          productId: upserted.productId,
          variantId: upserted.productVariantId,
          inventoryUpdatedAt: writeEventToken,
        },
        options: {
          dedupeKey,
        },
      });

      this.logger.debug(
        `inventory_write_propagation_enqueued product=${upserted.productId} variant=${upserted.productVariantId ?? 'base'} quantity=${upserted.availableQuantity} event=${writeEventToken}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `inventory_write_propagation_enqueue_failed product=${upserted.productId} variant=${upserted.productVariantId ?? 'base'} event=${writeEventToken} reason=${message}`
      );
      // Fail fast: callers should retry the operation to avoid silent propagation loss.
      throw new Error(`Failed to enqueue inventory propagation job: ${message}`);
    }

    return upserted;
  }

  async getInventory(
    productId: string,
    productVariantId?: string | null,
    locationId?: string | null
  ): Promise<InventoryItem | null> {
    this.logger.debug(
      `Getting inventory for product: ${productId}, variant: ${productVariantId ?? 'base'}, location: ${locationId ?? 'default'}`
    );
    return this.inventoryRepository.findByProductAndVariant(
      productId,
      productVariantId,
      locationId
    );
  }

  async pruneStaleVariants(
    productId: string,
    currentVariantIds: readonly (string | null)[]
  ): Promise<number> {
    const marked = await this.inventoryRepository.markStaleExceptVariants(
      productId,
      currentVariantIds
    );
    if (marked > 0) {
      this.logger.debug(
        `inventory_prune_marked_stale product=${productId} rows=${marked} kept=${currentVariantIds.length}`
      );
    }
    return marked;
  }

  private buildPropagationDedupeKey(item: InventoryItem, writeEventToken: string): string {
    return [
      'inventory:propagate',
      item.productId,
      item.productVariantId ?? 'base',
      writeEventToken,
    ].join(':');
  }
}
