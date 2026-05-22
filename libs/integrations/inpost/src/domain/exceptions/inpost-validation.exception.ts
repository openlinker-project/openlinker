/**
 * InPost Validation Exception
 *
 * Thrown for ShipX `400 validation_failed` / `invalid_action` responses and
 * for adapter-side pre-submit checks (unsupported `shippingMethod`, missing
 * `paczkomatId` for a locker shipment, missing courier address). `details`
 * mirrors the ShipX per-field error map (`{ field: code[] }`) when present.
 *
 * @module libs/integrations/inpost/src/domain/exceptions
 */
export class InpostValidationException extends Error {
  constructor(
    message: string,
    public readonly details?: Record<string, readonly string[]>,
  ) {
    super(message);
    this.name = 'InpostValidationException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InpostValidationException);
    }
  }
}
