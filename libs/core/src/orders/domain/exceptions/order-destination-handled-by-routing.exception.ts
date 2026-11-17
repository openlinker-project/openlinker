/**
 * Order Destination Handled By Routing Exception
 *
 * Domain exception thrown when an operator retries a destination mirror of an
 * order that OMS fulfilment routing owns (routed to work, or held by the
 * router). Such an order is not mirrored to destinations, so a retry would
 * re-run ingestion, be routed or held again, and leave the destination row
 * `pending` for ever (#3990).
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderDestinationHandledByRoutingException extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly destinationConnectionId: string,
  ) {
    super(
      `Cannot retry destination ${destinationConnectionId} for order ${internalOrderId}: ` +
        `this order is handled by OMS routing and is not mirrored to destinations`,
    );
    this.name = 'OrderDestinationHandledByRoutingException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderDestinationHandledByRoutingException);
    }
  }
}
