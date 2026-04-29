/**
 * Order Destination Not Retryable Exception
 *
 * Domain exception thrown when an operator attempts to retry a destination
 * sync that is not in a retryable state. Only destinations whose status is
 * `failed` can be retried — `pending` / `syncing` / `synced` rows reject.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
import type { OrderSyncStatus } from '../entities/order-record.entity';

export class OrderDestinationNotRetryableException extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly destinationConnectionId: string,
    public readonly currentStatus: OrderSyncStatus['status'],
  ) {
    super(
      `Cannot retry destination ${destinationConnectionId} for order ${internalOrderId}: current status is '${currentStatus}', expected 'failed'`,
    );
    this.name = 'OrderDestinationNotRetryableException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderDestinationNotRetryableException);
    }
  }
}
