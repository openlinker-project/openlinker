/**
 * Invalid Fiscal Line Error
 *
 * Raised by the order -> command mapper when an order item cannot become a
 * registrable line (today: a non-positive or non-finite quantity, which a
 * malformed snapshot defaults to 0).
 *
 * PII-clean by construction: the message cites only the order id, never item or
 * buyer contents - the value travels to an operator-facing surface.
 *
 * @module libs/core/src/fiscalization/application/mappers/errors
 */
export class InvalidFiscalLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidFiscalLineError';
    Error.captureStackTrace(this, this.constructor);
  }
}
