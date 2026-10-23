/**
 * Fulfillment Work Dispatch Conflict Exception (#3340 follow-up)
 *
 * Thrown by `ShipmentDispatchService` when a caller identifies the specific
 * `FulfillmentWork` a dispatch is meant to satisfy (`ShipmentDispatchInput.
 * fulfillmentWorkId`), an ACTIVE shipment already exists for the order, the
 * order has MORE THAN ONE live work (`FulfillmentWorkLinkResolution.kind ===
 * 'ambiguous'`), and that active shipment is not definitely linked to this
 * caller's work.
 *
 * ## Why this exists
 *
 * `findActiveByOrderId` resolves by ORDER, not by work — a split order can
 * carry several `FulfillmentWork` rows, but `UQ_shipments_branch_one_per_order_
 * conn` allows at most one non-terminal shipment per `(order, connection,
 * direction)`. Before this exception, a second work's auto-dispatch attempt
 * silently received the FIRST work's shipment back as `{ kind: 'dispatched' }`
 * — a false success that named another parcel's label as this one's own. The
 * ambiguity is unavoidable at the `Shipment` grain today (#2727 is the
 * line-grain fix); this exception is what stops that ambiguity from being
 * reported as a success.
 *
 * **Terminal, never retryable** (ADR-007): the shipment's ownership is a
 * persisted-state fact and blindly retrying the same job cannot change it.
 * The remedy is operator-driven — dispatch this order's remaining works by
 * hand once the first parcel's label is confirmed, or #2727's line-grain
 * model closes the gap for good.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class FulfillmentWorkDispatchConflictException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly fulfillmentWorkId: string,
    public readonly existingShipmentId: string
  ) {
    super(
      `Order ${orderId} already has an active shipment (${existingShipmentId}) that cannot be ` +
        `attributed to fulfillment work ${fulfillmentWorkId}: the order has more than one live ` +
        'work and the existing shipment is not linked to this one'
    );
    this.name = 'FulfillmentWorkDispatchConflictException';
    Error.captureStackTrace(this, this.constructor);
  }
}
