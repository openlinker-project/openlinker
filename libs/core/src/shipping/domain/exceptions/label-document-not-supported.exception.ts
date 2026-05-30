/**
 * Label Document Not Supported Exception
 *
 * Thrown by `ShipmentLabelService` when the resolved shipping-provider adapter
 * for the shipment's connection does not implement the `LabelDocumentReader`
 * sub-capability — i.e. the carrier integration cannot return a label
 * document. Distinct from `LabelNotAvailableException` (label not yet
 * generated) so the API surface maps both to 422 with operator-actionable
 * messages that point at different fixes.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class LabelDocumentNotSupportedException extends Error {
  constructor(
    public readonly shipmentId: string,
    public readonly connectionId: string,
  ) {
    super(
      `Cannot fetch label for shipment ${shipmentId}: connection ${connectionId} ` +
        `does not support returning label documents`,
    );
    this.name = 'LabelDocumentNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
