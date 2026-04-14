/**
 * No Order Destinations Available Exception
 *
 * Domain exception thrown by OrderSyncService when no active
 * OrderProcessorManager destinations can be resolved for a given order.
 * Signals an operational/configuration error (no processor connections, all
 * disabled, or the allowlist override points at a missing connection) —
 * distinct from transient adapter failures, which are surfaced per-destination
 * in the OrderSyncResult array.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class NoOrderDestinationsAvailableError extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly sourceConnectionId: string,
  ) {
    super(
      `No OrderProcessorManager destinations available for order ${internalOrderId} (sourceConnectionId=${sourceConnectionId})`,
    );
    this.name = 'NoOrderDestinationsAvailableError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NoOrderDestinationsAvailableError);
    }
  }
}
