/**
 * Routing Decision Already Live (#2394, ADR-054 R1)
 *
 * Raised by `claimIntent` when the live partial-unique index refuses a second
 * claim for one order.
 *
 * ## Why it THROWS rather than returning the winner
 *
 * The `exchange_rates` `insertIfAbsent` shape recovers by re-selecting the
 * incumbent, because there the caller wants *a* rate and any winner will do.
 * Here the caller must NOT proceed — a live decision existing IS the refusal —
 * so handing back the winner would invite a caller to route against another
 * router's intent, which is the double-ship this table exists to prevent.
 *
 * It carries the order id ONLY. Enriching it with the incumbent's
 * `routerConnectionId` would cost a second query on the refusal path;
 * `findLiveByOrderId` is on the port for a caller that wants to name the holder.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class RoutingDecisionAlreadyLiveError extends Error {
  constructor(public readonly orderId: string) {
    super(`A live routing decision already exists for order ${orderId}`);
    this.name = 'RoutingDecisionAlreadyLiveError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}
