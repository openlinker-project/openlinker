/**
 * Location In Use Error
 *
 * Raised when deleting an inventory location would strand the positions that
 * still reference it. `inventory_items` carries no foreign key to
 * `inventory_locations` (ADR-058 decision 3 defers that to step iii), so
 * nothing in the database refuses the delete — the refusal is a decision the
 * caller makes, and this error is the domain vocabulary it makes it in.
 *
 * Thrown today by the interface layer (#2316), which is where
 * `LocationRepositoryPort.delete`'s docblock assigns the referential check. It
 * moves into the application service if and when step (iii) adds the FK and the
 * driver starts reporting the violation itself.
 *
 * The interface layer maps it to 409 Conflict — a referenced location is a
 * state conflict about the operator's own data, never a 500.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class LocationInUseError extends Error {
  constructor(
    public readonly locationId: string,
    public readonly positionCount: number
  ) {
    super(
      `Inventory location ${locationId} is referenced by ${positionCount} inventory position(s)`
    );
    this.name = 'LocationInUseError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LocationInUseError);
    }
  }
}
