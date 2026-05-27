/**
 * Allegro Shipment Pending Exception
 *
 * Thrown when the async create-command poll exhausts its bounded budget while
 * still `IN_PROGRESS` — the shipment may yet be created provider-side. The
 * dispatch service persists the shipment `failed` (retriable) on this; the
 * durable `pending` lifecycle + create-command reconciliation (re-deriving the
 * deterministic `commandId` from the shipment id) is #838's. Carries the
 * `commandId` so a reconciler can resume the exact command.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroShipmentPendingException extends Error {
  constructor(public readonly commandId: string) {
    super(
      `Allegro shipment create-command ${commandId} did not resolve within the poll budget; ` +
        `treating as a retriable pending failure (live status sync is #838)`,
    );
    this.name = 'AllegroShipmentPendingException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroShipmentPendingException);
    }
  }
}
