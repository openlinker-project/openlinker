/**
 * Inventory Row Vanished Error
 *
 * Raised when the column-scoped upsert (#2071) matches zero rows: the row was
 * read by `findByProductAndVariant` and had disappeared by the time the UPDATE
 * ran.
 *
 * This exists because the scoped UPDATE cannot resurrect a row the way the
 * previous `save()` could — `save()` would have fallen back to an INSERT. Rather
 * than return an `InventoryItem` describing a row that no longer exists, the
 * repository fails loudly: `InventorySyncService` derives a marketplace
 * propagation job from that return value, so a phantom row would enqueue a
 * publish for stock that is not there.
 *
 * No shipped code path can currently delete an `inventory_items` row — the
 * repository port has no delete method, the staleness sweep is a soft
 * `isStale = true` update, and both foreign keys are `ON DELETE NO ACTION`. The
 * guard is therefore expected to be unreachable, and is here so that a future
 * delete path surfaces as an error instead of a silently wrong quantity.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class InventoryRowVanishedError extends Error {
  constructor(
    public readonly inventoryItemId: string,
    public readonly productId: string,
    public readonly productVariantId: string | null
  ) {
    super(
      `Inventory row vanished between read and write (id=${inventoryItemId}, productId=${productId}, productVariantId=${productVariantId ?? 'null'})`
    );
    this.name = 'InventoryRowVanishedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InventoryRowVanishedError);
    }
  }
}
