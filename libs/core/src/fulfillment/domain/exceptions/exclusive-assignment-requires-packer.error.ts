/**
 * Exclusive Assignment Requires Packer Error
 *
 * Raised when a caller asks for `selfServeEligible: false` on a work object
 * that has nobody assigned — "lock this parcel to its packer" where there is
 * no packer to lock it to.
 *
 * It exists because the alternative is a SILENT decline. `setSelfServeEligible`
 * refuses that write in its own `WHERE` (ADR-074's unrepresentable state), and
 * a guarded UPDATE answers `false`, which this surface has always read as the
 * ordinary no-op the assignment axis tolerates. So without this the supervisor
 * gets a 200, the board re-renders with the toggle back where it started, and
 * nothing anywhere says why.
 *
 * @module domain/exceptions
 */
export class ExclusiveAssignmentRequiresPackerError extends Error {
  constructor(public readonly workId: string) {
    super(
      `Cannot make fulfillment work ${workId} exclusive: it has no assigned packer. ` +
        `Assign it to a packer first, or send the assignment and the exclusivity together.`
    );
    this.name = 'ExclusiveAssignmentRequiresPackerError';
    Error.captureStackTrace(this, this.constructor);
  }
}
