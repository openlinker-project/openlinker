/**
 * No Order Destinations Available Exception
 *
 * Domain exception thrown by OrderSyncService when no eligible
 * OrderProcessorManager destination can be resolved for a given order.
 * Signals an operational/configuration error — distinct from transient adapter
 * failures, which are surfaced per-destination in the OrderSyncResult array.
 *
 * It covers TWO of the three conditions behind an empty destination list
 * (#2397), and `unresolvedDestinationConnectionIds` is what tells them apart:
 *
 * - **absent** — nothing is configured, or every OrderProcessorManager
 *   connection is inactive. No router was involved.
 * - **present and non-empty** — a routing decision named these connection ids
 *   and not one of them is an eligible destination (unknown, inactive, or not
 *   `OrderProcessorManager`-capable). Ids echoing the SOURCE connection are
 *   never listed here: they were excluded by design, not unreachable.
 * - **present and EMPTY** — a routing decision was supplied and every id in it
 *   named the source connection itself. A distinct router misconfiguration
 *   (the order was routed back where it came from), not an unreachable
 *   destination, so the message says so rather than blaming a connection.
 *
 * The third condition — a routing decision that deliberately named NOBODY — is
 * not an error at all and never reaches this exception: it returns no results
 * and warns. See `OrderSyncService.syncOrder`.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
function buildMessage(
  internalOrderId: string,
  sourceConnectionId: string,
  unresolved?: readonly string[]
): string {
  const subject = `No OrderProcessorManager destinations available for order ${internalOrderId} (sourceConnectionId=${sourceConnectionId})`;

  if (unresolved === undefined) {
    return subject;
  }

  if (unresolved.length === 0) {
    return (
      `${subject}: the routing decision named only the source connection itself, ` +
      `which is never a destination for its own orders`
    );
  }

  return (
    `${subject}: the routing decision named [${unresolved.join(', ')}], none of which is an ` +
    `active, eligible destination`
  );
}

export class NoOrderDestinationsAvailableException extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly sourceConnectionId: string,
    /**
     * The router-named connection ids that resolved to no eligible destination.
     * Undefined when no routing filter was supplied — see the class docblock.
     */
    public readonly unresolvedDestinationConnectionIds?: readonly string[]
  ) {
    super(
      buildMessage(internalOrderId, sourceConnectionId, unresolvedDestinationConnectionIds)
    );
    this.name = 'NoOrderDestinationsAvailableException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NoOrderDestinationsAvailableException);
    }
  }
}
