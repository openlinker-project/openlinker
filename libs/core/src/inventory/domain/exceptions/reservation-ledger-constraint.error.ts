/**
 * Reservation Ledger Constraint Error (#2343)
 *
 * The translation target for any database constraint violation that escapes a
 * reservation write — so no `QueryFailedError` crosses the port boundary
 * (`docs/engineering-standards.md § Error Handling`).
 *
 * **Reaching this is a defect signal, not a normal path.** Every constraint on
 * the ledger is already enforced by a guard that runs first: the `>= 0` CHECK on
 * `olReservedQuantity` is § 6I's *hard floor* beneath a `WHERE` that makes
 * underflow unreachable, and the partial unique index is consumed by
 * `ON CONFLICT DO NOTHING` rather than allowed to throw. A named error here
 * gives that defect a discriminable shape instead of a driver stack trace a job
 * runner would retry forever.
 *
 * @module libs/core/src/inventory/domain/exceptions
 */
export class ReservationLedgerConstraintError extends Error {
  constructor(
    public readonly constraint: string,
    public readonly cause?: unknown,
  ) {
    super(`Reservation ledger constraint violated: ${constraint}`);
    this.name = 'ReservationLedgerConstraintError';
    Error.captureStackTrace(this, this.constructor);
  }
}
