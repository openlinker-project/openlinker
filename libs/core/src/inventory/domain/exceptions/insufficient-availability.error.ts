/**
 * Insufficient Availability Error (#2343, ANALYSIS-1032 § 6I)
 *
 * The guarded reservation claim matched no row because the position exists and
 * is live, but its PUBLISHED available-to-promise — `availableQuantity` less
 * the `held` holds stamped `published` (#2628 review; never the raw
 * `olReservedQuantity` counter, which sums `diagnostic` holds too) — is below
 * what was asked for. This is the ordinary, expected refusal of an oversell —
 * not a defect.
 *
 * Deliberately distinct from {@link ReservationPositionUnavailableError}: a
 * position that cannot be reserved against AT ALL is a different operator
 * situation from one that simply has fewer units left, and collapsing the two
 * would tell an operator to find stock that is not the problem.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class InsufficientAvailabilityError extends Error {
  constructor(
    public readonly inventoryItemId: string,
    public readonly requestedQuantity: number,
    public readonly availableQuantity: number,
  ) {
    super(
      `Insufficient available-to-promise on inventory item ${inventoryItemId}: ` +
        `requested ${requestedQuantity}, available ${availableQuantity}`,
    );
    this.name = 'InsufficientAvailabilityError';
    Error.captureStackTrace(this, this.constructor);
  }
}
