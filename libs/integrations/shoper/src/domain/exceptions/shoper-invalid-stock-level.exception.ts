/**
 * ShoperInvalidStockLevelException
 *
 * Thrown when Shoper answered with a `product-stocks` row whose `stock` is
 * missing or not a number. Distinct from `ShoperNetworkError`: the request did
 * produce a usable HTTP response, the shop simply stated no readable level.
 *
 * Never read as 0. A master sync treating it as zero would zero a live offer
 * (the #1689 primitive). Left out of the retry classifier on purpose, so it
 * stays retryable: a half-written row is the likely cause, and a re-read is
 * the only thing that can clear it.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperInvalidStockLevelException extends Error {
  constructor(
    readonly stockId: string,
    readonly externalProductId: string,
    readonly connectionId: string,
  ) {
    super(
      `Shoper returned no readable stock level for stock ${stockId} of product ` +
        `${externalProductId} (connection: ${connectionId})`,
    );
    this.name = 'ShoperInvalidStockLevelException';
    Error.captureStackTrace(this, this.constructor);
  }
}
