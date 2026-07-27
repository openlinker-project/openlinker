/**
 * Invoice Numbering Series Not Found Exception
 *
 * Domain error raised when a numbering-series lookup / update / allocation
 * references an id that does not exist (#1575).
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class InvoiceNumberingSeriesNotFoundException extends Error {
  constructor(seriesId: string) {
    super(`Invoice numbering series not found: ${seriesId}`);
    this.name = 'InvoiceNumberingSeriesNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
