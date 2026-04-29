/**
 * Order Destination Not Found Exception
 *
 * Domain exception thrown when attempting to act on a destination sync-status
 * row that doesn't exist on the OrderRecord. Distinct from
 * `OrderRecordNotFoundException` (the order itself is missing) — here the
 * order exists but has no row for the requested destination connection.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderDestinationNotFoundException extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly destinationConnectionId: string,
  ) {
    super(
      `Order ${internalOrderId} has no sync status for destination ${destinationConnectionId}`,
    );
    this.name = 'OrderDestinationNotFoundException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderDestinationNotFoundException);
    }
  }
}
