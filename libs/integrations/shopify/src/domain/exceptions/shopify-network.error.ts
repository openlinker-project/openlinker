/**
 * Shopify Network Error
 *
 * The request never produced a readable answer: a transport failure, a
 * timeout, or a 2xx whose body was not JSON. Always retryable.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyNetworkError extends Error {
  constructor(
    message: string,
    readonly timedOut = false,
    readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'ShopifyNetworkError';
    Error.captureStackTrace(this, this.constructor);
  }
}
