/**
 * Dispatch Protocol Not Supported Exception
 *
 * Thrown by `BulkShipmentDispatchService.generateProtocol` when the resolved
 * shipping-provider adapter for the batch's carrier connection does not
 * implement the `DispatchProtocolReader` sub-capability — i.e. the carrier has
 * no handover-manifest concept (e.g. InPost). The API maps it to 422 with an
 * operator-actionable message. Distinct from a provider rejection (502): the
 * carrier integration simply offers no protocol, it didn't reject a request.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class DispatchProtocolNotSupportedException extends Error {
  constructor(public readonly connectionId: string) {
    super(
      `Cannot generate a handover protocol: connection ${connectionId} does not ` +
        `support dispatch protocols`,
    );
    this.name = 'DispatchProtocolNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
