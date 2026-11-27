/**
 * Label Not Ready Exception
 *
 * Thrown by a `LabelDocumentReader` when the carrier has accepted the shipment
 * but cannot yet render its label document - the label is PENDING, not refused.
 * Carriers that confirm a shipment asynchronously (InPost ShipX answers 400
 * `shipment_status_incorrect` until the shipment leaves its initial status)
 * report this for a short window right after generation.
 *
 * Distinct from `LabelNotAvailableException` (no shipment was ever generated -
 * the operator must generate first) and from `ShippingProviderRejectionException`
 * (the carrier refused): here nothing is wrong and the same request succeeds
 * shortly. The HTTP layer maps it to 409 `SHIPMENT_LABEL_NOT_READY` so a client can wait
 * and retry instead of showing an error.
 *
 * The adapter owns the translation from its own signal; core knows only this
 * neutral fact. An adapter that never reports it is read as "label ready on
 * request", which is the pre-existing behaviour.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class LabelNotReadyException extends Error {
  constructor(
    public readonly providerShipmentId: string,
    /** The adapter's hint for when to ask again; absent means "soon". */
    public readonly retryAfterMs?: number,
  ) {
    super(`The carrier has not finished preparing the label for ${providerShipmentId} yet`);
    this.name = 'LabelNotReadyException';
    Error.captureStackTrace(this, this.constructor);
  }
}
