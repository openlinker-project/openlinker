/**
 * Inventory Returning Unsupported Error
 *
 * Raised when the column-scoped upsert (#2071) updates a row but the driver
 * returns no `RETURNING` payload.
 *
 * The upsert deliberately omits `updatedAt` from its SET clause so the database
 * stamps it, then reads the stamped value back via `.returning(['updatedAt'])`.
 * TypeORM makes `.returning()` a silent no-op on drivers that do not support it,
 * so on such a driver every successful update would yield an empty result set.
 *
 * Falling back to the caller-supplied `updatedAt` there would reintroduce the
 * master-supplied timestamp this exclusion exists to remove — and
 * `InventorySyncService` derives the marketplace propagation job's dedupe key
 * from that value, so a master reporting a stable timestamp while quantity moved
 * would collide the key and drop the propagation silently. Failing is the safe
 * direction.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class InventoryReturningUnsupportedError extends Error {
  constructor(public readonly inventoryItemId: string) {
    super(
      `Inventory update returned no RETURNING payload (id=${inventoryItemId}); the driver did not honour it, so the database-stamped updatedAt cannot be read back`
    );
    this.name = 'InventoryReturningUnsupportedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InventoryReturningUnsupportedError);
    }
  }
}
