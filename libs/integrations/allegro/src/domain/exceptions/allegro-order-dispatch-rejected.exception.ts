/**
 * Allegro Order Dispatch Rejected Exception
 *
 * Thrown when the Allegro order-side dispatch (mark-sent via
 * `PUT …/fulfillment`, or waybill-attach via `POST …/shipments`) is rejected.
 * Carries a readable reason derived from the Allegro error response.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroOrderDispatchRejectedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllegroOrderDispatchRejectedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroOrderDispatchRejectedException);
    }
  }
}
