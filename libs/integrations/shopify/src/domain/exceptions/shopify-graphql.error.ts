/**
 * Shopify GraphQL Error
 *
 * Top-level `errors` on a 200 answer. Shopify reports cost throttling
 * (`extensions.code: THROTTLED`), a missing scope (`ACCESS_DENIED`) and an
 * invalid token this way rather than with an HTTP status, so the code is kept
 * for the classifiers.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyGraphqlError extends Error {
  constructor(
    readonly codes: readonly string[],
    readonly messages: readonly string[],
  ) {
    super(`Shopify GraphQL error: ${messages.join('; ').slice(0, 500)}`);
    this.name = 'ShopifyGraphqlError';
    Error.captureStackTrace(this, this.constructor);
  }

  isThrottled(): boolean {
    return this.codes.includes('THROTTLED');
  }

  /**
   * The document asks for more than one query may cost (1000 points, Admin
   * API 2026-10). Deterministic for the document: only a smaller one passes.
   */
  isMaxCostExceeded(): boolean {
    return this.codes.includes('MAX_COST_EXCEEDED');
  }

  isAccessDenied(): boolean {
    return this.codes.includes('ACCESS_DENIED');
  }

  /** Shopify answers a bad token with a 200 + this message on some paths, 401 on others. */
  isInvalidToken(): boolean {
    return this.messages.some((m) => /invalid api key or access token/i.test(m));
  }
}
