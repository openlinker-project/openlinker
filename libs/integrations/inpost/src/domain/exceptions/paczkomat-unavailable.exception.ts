/**
 * Paczkomat Unavailable Exception
 *
 * Thrown when a selected paczkomat/locker is unknown or not currently
 * available for a shipment (ShipX rejects `target_point`, or a points lookup
 * yields no usable locker). Lets callers surface a "pick another locker"
 * affordance distinct from a generic validation error.
 *
 * @module libs/integrations/inpost/src/domain/exceptions
 */
export class PaczkomatUnavailableException extends Error {
  constructor(
    message: string,
    public readonly paczkomatId?: string,
  ) {
    super(message);
    this.name = 'PaczkomatUnavailableException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PaczkomatUnavailableException);
    }
  }
}
