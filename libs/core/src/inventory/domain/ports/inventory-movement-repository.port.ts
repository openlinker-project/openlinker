/**
 * Inventory Movement Repository Port (#3565)
 *
 * Persistence contract of the append-only stock movement ledger. There is no
 * `save(movement)`: a row is inserted once, and the only later writes are the
 * guarded `settle` and `attachQuantities`, each a conditional UPDATE on a row
 * that is still `pending`.
 *
 * @module libs/core/src/inventory/domain/ports
 */
import type { InventoryMovement } from '../entities/inventory-movement.entity';
import type {
  AppendInventoryMovementInput,
  InsertPendingInventoryMovementInput,
  InventoryHistoryRow,
  InventoryMovementFilters,
  InventoryMovementPagination,
  SettleInventoryMovementInput,
} from '../types/inventory-movement.types';

export interface InventoryMovementRepositoryPort {
  /** Insert one finished (`applied`) movement. */
  append(input: AppendInventoryMovementInput): Promise<InventoryMovement>;

  /**
   * Claim a `pending` row. `null` when the idempotency key already exists (a replay);
   * the caller then reads the winner with {@link findByIdempotencyKey}.
   */
  insertPending(input: InsertPendingInventoryMovementInput): Promise<InventoryMovement | null>;

  findByIdempotencyKey(idempotencyKey: string): Promise<InventoryMovement | null>;

  findById(id: string): Promise<InventoryMovement | null>;

  /** Settle a `pending` row. `false` when it was no longer `pending`. */
  settle(id: string, settlement: SettleInventoryMovementInput): Promise<boolean>;

  /**
   * Fill `quantityAfter` and the derived `quantityBefore` (`after - requested delta`), and mark `applied`, on a row a caller
   * already claimed. `false` when the row is unknown or already settled otherwise.
   */
  attachQuantities(id: string, quantityAfter: number): Promise<boolean>;

  /** Merged history: stored movements plus reservations as "Promised" rows. */
  listHistory(
    filters: InventoryMovementFilters,
    pagination: InventoryMovementPagination
  ): Promise<InventoryHistoryRow[]>;

  countHistory(filters: InventoryMovementFilters): Promise<number>;

  /** Delete up to `batchSize` rows older than `cutoff`; returns how many were deleted. */
  pruneOlderThan(cutoff: Date, batchSize: number): Promise<number>;
}
