/**
 * Hold Projection Write Unreadable Error (#2340 review)
 *
 * Raised by `OrderHoldProjectionRepository.setActiveHoldReason` when the driver
 * returned something other than node-postgres' `[rows, affected]` tuple, so the
 * write's outcome is genuinely UNKNOWN.
 *
 * It exists because the previous code degraded that case to `affected = 0`,
 * which the reconcile pass reports as `superseded` — "a peer beat us to it".
 * That is a false statement: nobody knows whether anything happened. The
 * counter is the pass's only observability and the two conditions have
 * different remedies, so they get different arms.
 *
 * Both callers already treat a throw as a non-fatal outcome: the authority path
 * warn-logs (the projection is best-effort by design) and the reconcile pass
 * counts it `failed`.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class HoldProjectionWriteUnreadableError extends Error {
  constructor(public readonly internalOrderId: string) {
    super(
      `Hold projection write for order ${internalOrderId} returned an unreadable driver ` +
        `result; whether the row changed is unknown`
    );
    this.name = 'HoldProjectionWriteUnreadableError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HoldProjectionWriteUnreadableError);
    }
  }
}
