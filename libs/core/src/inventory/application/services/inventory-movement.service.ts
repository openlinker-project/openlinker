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
import { INVENTORY_MOVEMENT_REPOSITORY_TOKEN } from '../../inventory.tokens';
import type { IInventoryMovementService } from './inventory-movement.service.interface';

@Injectable()
export class InventoryMovementService implements IInventoryMovementService {
  constructor(
    @Inject(INVENTORY_MOVEMENT_REPOSITORY_TOKEN)
    private readonly movements: InventoryMovementRepositoryPort
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

  pruneOlderThan(cutoff: Date, batchSize: number): Promise<number> {
    return this.movements.pruneOlderThan(cutoff, batchSize);
  }
}
