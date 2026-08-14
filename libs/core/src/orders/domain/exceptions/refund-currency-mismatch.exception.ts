/**
 * Refund Currency Mismatch Exception
 *
 * Domain error raised when a new refund's currency doesn't match an existing
 * refund already recorded against the same order (#2036). `RefundSummary`
 * sums `amount` across every refund for an order under the assumption that
 * they all share one currency (matching `OrderTotals.currency` being singular
 * per order); this exception enforces that invariant at the cheapest point —
 * write time — instead of letting a mismatch reach the aggregate read.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class RefundCurrencyMismatchException extends Error {
  constructor(internalOrderId: string, existingCurrency: string, attemptedCurrency: string) {
    super(
      `Refund currency mismatch for order ${internalOrderId}: existing refunds use ` +
        `${existingCurrency}, attempted ${attemptedCurrency}`,
    );
    this.name = 'RefundCurrencyMismatchException';
    Error.captureStackTrace(this, this.constructor);
  }
}
