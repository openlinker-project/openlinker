/**
 * Reservation Not Held Error (#2343, REVIEW § 3 H9)
 *
 * A release/consume/expire was asked for a `(order, line, position)` that has no
 * live `held` row — already terminal, or never created.
 *
 * The guard that raises this sits on the **reservation row**, not on the
 * `inventory_items` counter (§ 6I places it on the counter). The ledger is
 * authoritative — #2349's reconciler corrects the counter *to* it — so "was this
 * reservation held?" is a question only the ledger row can answer; a counter
 * that a reconciler has already corrected would make the counter-side predicate
 * report "not held" about a row that plainly is.
 *
 * Raising rather than silently no-op'ing is the point: a double release that
 * quietly succeeded would be indistinguishable from a real one, and the second
 * decrement is exactly how a counter drifts below what the ledger says.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class ReservationNotHeldError extends Error {
  constructor(
    public readonly orderRecordId: string,
    public readonly orderLineId: string,
    public readonly inventoryItemId: string,
  ) {
    super(
      `No held reservation for order ${orderRecordId}, line ${orderLineId}, ` +
        `inventory item ${inventoryItemId}`,
    );
    this.name = 'ReservationNotHeldError';
    Error.captureStackTrace(this, this.constructor);
  }
}
