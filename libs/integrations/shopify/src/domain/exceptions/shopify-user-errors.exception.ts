/**
 * Shopify User Errors Exception
 *
 * A mutation answered with `userErrors`: Shopify refused the input and wrote
 * nothing. Deterministic, so it is not retried - EXCEPT the dev-store order
 * cap, which arrives as a plain user error ("Too many attempts", L-X1) rather
 * than a 429 and clears by itself; `isRateLimited` lets the retry classifier
 * defer that one.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export interface ShopifyUserErrorEntry {
  readonly field?: readonly string[] | null;
  readonly message: string;
  readonly code?: string | null;
}

export class ShopifyUserErrorsException extends Error {
  constructor(
    readonly mutation: string,
    readonly userErrors: readonly ShopifyUserErrorEntry[],
  ) {
    super(
      `Shopify ${mutation} refused: ` +
        userErrors
          .map((e) => `${e.message}${e.field ? ` (${e.field.join('.')})` : ''}`)
          .join('; ')
          .slice(0, 500),
    );
    this.name = 'ShopifyUserErrorsException';
    Error.captureStackTrace(this, this.constructor);
  }

  isRateLimited(): boolean {
    return this.userErrors.some((e) => /too many attempts/i.test(e.message));
  }

  /** `changeFromQuantity` no longer matched: somebody moved the stock between our read and write. */
  isStaleCompareAndSet(): boolean {
    return this.userErrors.some(
      (e) => e.code === 'CHANGE_FROM_QUANTITY_STALE' || /changeFromQuantity/i.test(e.message),
    );
  }
}
