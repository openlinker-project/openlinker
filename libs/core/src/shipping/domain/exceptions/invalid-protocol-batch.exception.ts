/**
 * Invalid Protocol Batch Exception
 *
 * Thrown by `BulkShipmentDispatchService.generateProtocol` when the requested
 * shipment set cannot yield a valid handover protocol: no shipment carries a
 * provider shipment id (no labels generated yet), or the shipments span more
 * than one carrier connection (the protocol is per-carrier-account, so a mixed
 * set would produce a wrong manifest). A client-input problem → the API maps it
 * to 400.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class InvalidProtocolBatchException extends Error {
  constructor(public readonly reason: string) {
    super(`Cannot generate a handover protocol: ${reason}`);
    this.name = 'InvalidProtocolBatchException';
    Error.captureStackTrace(this, this.constructor);
  }
}
