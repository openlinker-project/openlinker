/**
 * Shipment Not Found Exception
 *
 * Domain exception thrown when a Shipment with the specified ID does not
 * exist. Raised by `ShipmentRepositoryPort.update` when no row matches —
 * i.e. infrastructure `Repository.update(id, ...)` returns `affected === 0`.
 *
 * Mirrors `BulkOfferCreationBatchNotFoundException` shape.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class ShipmentNotFoundException extends Error {
  constructor(id: string) {
    super(`Shipment not found: ${id}`);
    this.name = 'ShipmentNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
