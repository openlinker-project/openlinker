/**
 * Label Not Available Exception
 *
 * Thrown by `ShipmentLabelService` when a shipment has no provider shipment id
 * yet (`providerShipmentId === null`) — i.e. no label has been generated, so
 * there is nothing to fetch. Distinct from `LabelDocumentNotSupportedException`
 * (the provider can't return labels at all): the operator fix here is "generate
 * the label first", not "use a different carrier". Both map to 422.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class LabelNotAvailableException extends Error {
  constructor(public readonly shipmentId: string) {
    super(
      `No label has been generated for shipment ${shipmentId} yet — ` +
        `generate the label first`,
    );
    this.name = 'LabelNotAvailableException';
    Error.captureStackTrace(this, this.constructor);
  }
}
