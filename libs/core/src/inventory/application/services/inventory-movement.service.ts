/**
 * Inventory Movement Service (#3565)
 *
 * Thin read service over the movement ledger repository. Kept separate from
 * `InventoryService` so the history read has its own `I*Service` seam for the
 * API layer without widening the hot write service.
 *
 * @module libs/core/src/inventory/application/services
 * @implements {IInventoryMovementService}
 */
import { Inject, Injectable } from '@nestjs/common';

import { InventoryMovementRepositoryPort } from '../../domain/ports/inventory-movement-repository.port';
import type {
  InventoryHistoryRow,
  InventoryMovementFilters,
  InventoryMovementPagination,
} from '../../domain/types/inventory-movement.types';
import {
  CHANNEL_QUANTITY_PUSH_REPOSITORY_TOKEN,
  INVENTORY_MOVEMENT_REPOSITORY_TOKEN,
} from '../../inventory.tokens';
import { ChannelQuantityPushRepositoryPort } from '../../domain/ports/channel-quantity-push-repository.port';
import type {
  ChannelQuantityPush,
  LastChannelQuantityPush,
} from '../../domain/types/channel-quantity-push.types';
import type { IInventoryMovementService } from './inventory-movement.service.interface';

@Injectable()
export class InventoryMovementService implements IInventoryMovementService {
  constructor(
    @Inject(INVENTORY_MOVEMENT_REPOSITORY_TOKEN)
    private readonly movements: InventoryMovementRepositoryPort,
    @Inject(CHANNEL_QUANTITY_PUSH_REPOSITORY_TOKEN)
    private readonly pushes: ChannelQuantityPushRepositoryPort
  ) {}

  listMovements(
    filters: InventoryMovementFilters,
    pagination: InventoryMovementPagination
  ): Promise<InventoryHistoryRow[]> {
    return this.movements.listHistory(filters, pagination);
  }

  countMovements(filters: InventoryMovementFilters): Promise<number> {
    return this.movements.countHistory(filters);
  }

  async pruneOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    const movements = await this.movements.pruneOlderThan(cutoff, batchSize);
    const pushes = await this.pushes.pruneOlderThan(cutoff, batchSize);
    return movements + pushes;
  }

  async listChannelPushes(movementId: string): Promise<ChannelQuantityPush[] | null> {
    const movement = await this.movements.findById(movementId);
    if (movement === null) return null;
    // A push names the stock observation it expressed: the inventory row's
    // `updatedAt`, which is exactly the movement's `occurredAt`. Without a
    // variant there is nothing to match on.
    if (movement.productVariantId === null) return [];
    return this.pushes.findForObservation(movement.productVariantId, movement.occurredAt);
  }

  getLastChannelPushes(productVariantIds: readonly string[]): Promise<LastChannelQuantityPush[]> {
    return this.pushes.findLatestByVariantIds(productVariantIds);
  }
}
