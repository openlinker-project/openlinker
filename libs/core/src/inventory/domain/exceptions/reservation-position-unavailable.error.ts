/**
 * Reservation Position Unavailable Error (#2343)
 *
 * The guarded claim matched no row for a reason that is not about quantity: the
 * `inventory_items` row does not exist, or it is `isStale` — soft-marked because
 * its variant no longer appears in the master's `listInventory` response
 * (#1478). A stale position must not accept new promises, so § 6I's claim
 * predicate carries `isStale = false`.
 *
 * The discriminating read that produces this error runs ONLY on the failure
 * path, and is deliberately unlocked: it can mislabel an already-failing claim
 * under a race, but can never turn a failure into a success — the guard already
 * decided that.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
import type { ReservationPositionUnavailableReason } from '../types/reservation.types';

export class ReservationPositionUnavailableError extends Error {
  constructor(
    public readonly inventoryItemId: string,
    public readonly reason: ReservationPositionUnavailableReason,
  ) {
    super(
      `Inventory position ${inventoryItemId} cannot accept a reservation: ${reason}`,
    );
    this.name = 'ReservationPositionUnavailableError';
    Error.captureStackTrace(this, this.constructor);
  }
}
