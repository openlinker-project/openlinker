/**
 * Order Snapshot Unavailable Error
 *
 * Thrown by `orderFromReadySnapshot` when a persisted `OrderRecord` cannot be
 * rehydrated into a typed `Order` suitable for invoicing — either the record is
 * not `ready` (still `awaiting_mapping`), or its buyer identity/address has been
 * redacted under the PII-storage configuration so no buyer profile can be
 * derived. PII-clean: cites only the order id, never snapshot contents.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderSnapshotUnavailableError extends Error {
  constructor(
    public readonly internalOrderId: string,
    reason: string,
  ) {
    super(`Order snapshot unavailable for ${internalOrderId}: ${reason}`);
    this.name = 'OrderSnapshotUnavailableError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderSnapshotUnavailableError);
    }
  }
}
