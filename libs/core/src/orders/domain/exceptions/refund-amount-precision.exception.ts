/**
 * Refund Amount Precision Exception (#3289, R-18)
 *
 * The amount carries more fraction digits than the refund currency's minor unit
 * allows (JPY 0, KWD 3, otherwise 2). Rounding it silently would record a
 * different figure than the operator typed. Maps to 400.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class RefundAmountPrecisionException extends Error {
  readonly code = 'refund_amount_precision';

  constructor(
    readonly amount: string,
    readonly currency: string,
    readonly allowedFractionDigits: number
  ) {
    super(
      `Refund amount ${amount} has too many decimal places for ${currency}: ` +
        `at most ${allowedFractionDigits} allowed`
    );
    this.name = 'RefundAmountPrecisionException';
    Error.captureStackTrace(this, this.constructor);
  }
}
