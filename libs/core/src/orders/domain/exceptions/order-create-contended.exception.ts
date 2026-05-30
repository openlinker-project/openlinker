/**
 * Order Create Contended Exception
 *
 * Thrown by OrderSyncService when a per-(order, destination) create lock is held
 * by a concurrent worker AND no destination mapping exists yet — i.e. another
 * worker is mid-create for the same order. It is a **retryable** signal: callers
 * let it propagate so the sync job is retried (by which point the other worker
 * has finished and the create is skipped). Distinct from a genuine destination
 * failure, which is surfaced as a per-destination `OrderSyncResult` (status
 * 'failed') without aborting sibling destinations.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderCreateContendedException extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly destinationConnectionId: string,
  ) {
    super(
      `Order create is contended for order ${internalOrderId} (destinationConnectionId=${destinationConnectionId}); a concurrent create holds the lock — retry`,
    );
    this.name = 'OrderCreateContendedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderCreateContendedException);
    }
  }
}
