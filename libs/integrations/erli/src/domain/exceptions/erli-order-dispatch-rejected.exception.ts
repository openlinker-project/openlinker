/**
 * Erli Order Dispatch Rejected Exception (#997)
 *
 * Thrown when the Erli order-side dispatch writeback (mark-dispatched via the
 * fulfillment-status PATCH, or waybill-attach via the shipments POST) is
 * rejected. Carries a readable, payload-free reason (no waybill / order id in
 * the message — see the `OrderStatusWriteback.write` log-hygiene rule). Mirrors
 * `AllegroOrderDispatchRejectedException`.
 *
 * @module libs/integrations/erli/src/domain/exceptions
 */
export class ErliOrderDispatchRejectedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErliOrderDispatchRejectedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErliOrderDispatchRejectedException);
    }
  }
}
