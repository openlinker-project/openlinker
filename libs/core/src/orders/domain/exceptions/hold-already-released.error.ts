/**
 * Hold Already Released Error (#2338, REVIEW §3 H9)
 *
 * Raised by `OrderHoldRepositoryPort.releaseHeld` when the conditional
 * `UPDATE … WHERE "releasedAt" IS NULL` matched zero rows **and** the hold still
 * exists — i.e. someone released it first.
 *
 * That distinction is load-bearing. Zero affected rows has two causes: already
 * released, or no such hold. Reporting "already released" for a hold that never
 * existed is a false statement about the operator's data, so the repository
 * re-reads before choosing between this and `OrderHoldNotFoundError`.
 *
 * **Deliberately NOT `Order`-prefixed**, for the same reason `HoldReason` is not
 * (REVIEW H14): the fulfilment-work grain (`fulfillment_holds`, Wave 3) releases
 * holds too, and an `Order`-prefixed name would be actively misleading there.
 *
 * NOT retryable: it reports persisted state. `releaseHeld` is therefore
 * double-call-safe — a second call stamps nothing and says so.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class HoldAlreadyReleasedError extends Error {
  constructor(
    public readonly holdId: string,
    /** When it was released, so a caller can say who was beaten to it. */
    public readonly releasedAt: Date
  ) {
    super(
      `Hold ${holdId} was already released at ${releasedAt.toISOString()}`
    );
    this.name = 'HoldAlreadyReleasedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, HoldAlreadyReleasedError);
    }
  }
}
