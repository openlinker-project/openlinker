/**
 * Invoice Record Not Found Exception
 *
 * Thrown by the repository's update path when no `InvoiceRecord` matches the id.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class InvoiceRecordNotFoundException extends Error {
  constructor(id: string) {
    super(`Invoice record not found: ${id}`);
    this.name = 'InvoiceRecordNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
