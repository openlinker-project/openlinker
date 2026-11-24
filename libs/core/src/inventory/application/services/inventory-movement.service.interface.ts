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
import type {
  ChannelQuantityPush,
  LastChannelQuantityPush,
} from '../../domain/types/channel-quantity-push.types';

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
  /**
   * Deletes up to `batchSize` movements AND up to `batchSize` channel pushes
   * older than `cutoff`, and returns the two counts added together. A pass that
   * removed a full batch of either is reported as possibly unfinished, so the
   * retention loop keeps going; at worst it runs one extra short round.
   */
  pruneOlderThan(cutoff: Date, batchSize: number): Promise<number>;

  /**
   * What OpenLinker sent each channel for one stock movement (#4062): the
   * pushes that expressed the movement's own observation of its variant.
   * `null` when the movement does not exist; an empty list when nothing was
   * sent (a refused change, a variant listed nowhere, or a channel that does
   * not propagate).
   */
  listChannelPushes(movementId: string): Promise<ChannelQuantityPush[] | null>;

  /** The newest push per (variant, connection) for the given variants (#4062). */
  getLastChannelPushes(productVariantIds: readonly string[]): Promise<LastChannelQuantityPush[]>;
}
