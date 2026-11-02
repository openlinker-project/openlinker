/**
 * Inventory Movement Service Interface (#3565)
 *
 * Read contract of the stock movement history. Writing is not part of it: the
 * ledger is written inside `IInventoryService.setInventory` (every change to
 * `inventory_items` passes through it) so no caller can forget to record one.
 *
 * @module libs/core/src/inventory/application/services
 */
import type {
  InventoryHistoryRow,
  InventoryMovementFilters,
  InventoryMovementPagination,
} from '../../domain/types/inventory-movement.types';

export interface IInventoryMovementService {
  /**
   * Merged history, newest first: stored movements plus reservations as
   * "Promised" rows (which carry no stock change).
   */
  listMovements(
    filters: InventoryMovementFilters,
    pagination: InventoryMovementPagination
  ): Promise<InventoryHistoryRow[]>;

  /** Total rows matching the same filters, independent of pagination. */
  countMovements(filters: InventoryMovementFilters): Promise<number>;

  /**
   * Delete up to `batchSize` ledger rows older than `cutoff` (retention sweep).
   * Touches `inventory_movements` only - never reservations. Returns the count.
   */
  pruneOlderThan(cutoff: Date, batchSize: number): Promise<number>;
}
