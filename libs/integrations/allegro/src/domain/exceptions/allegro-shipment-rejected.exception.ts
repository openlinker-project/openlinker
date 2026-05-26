/**
 * Allegro Shipment Rejected Exception
 *
 * Thrown when an Allegro Delivery shipment cannot be created or cancelled —
 * either a pre-flight validation failure (missing delivery-method id, missing
 * parcel dimensions) or a provider-side rejection (the create/cancel command
 * resolved `ERROR`, e.g. `DELIVERY_METHOD_NOT_AVAILABLE` or an Allegro One
 * sender-zip outside the service area). `errors` carries the structured
 * Allegro command errors when present, for surfacing a readable reason.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
import type { AllegroShipmentCommandError } from '../types/allegro-shipment.types';

export class AllegroShipmentRejectedException extends Error {
  constructor(
    message: string,
    public readonly errors?: readonly AllegroShipmentCommandError[],
  ) {
    super(message);
    this.name = 'AllegroShipmentRejectedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroShipmentRejectedException);
    }
  }
}
