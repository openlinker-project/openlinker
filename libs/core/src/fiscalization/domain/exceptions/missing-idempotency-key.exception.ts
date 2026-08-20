/**
 * Missing Idempotency Key Exception
 *
 * Raised when a registration command arrives without a usable exactly-once key.
 *
 * The key is MANDATORY (ADR-042 decision 6) and this refusal is the contract, not
 * input validation: without a key there is no exactly-once guarantee at all, and
 * registering one sale twice is a legal event for the seller rather than a
 * data-quality issue. Core therefore refuses the operation instead of degrading
 * to at-least-once.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class MissingIdempotencyKeyException extends Error {
  constructor(orderId: string) {
    super(
      `Fiscal registration for order ${orderId} requires a non-empty idempotencyKey; ` +
        `there is no keyless mode`,
    );
    this.name = 'MissingIdempotencyKeyException';
    Error.captureStackTrace(this, this.constructor);
  }
}
