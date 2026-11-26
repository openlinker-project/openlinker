/**
 * Amazon Network Error
 *
 * No usable answer reached us: a timeout, a connection failure, an oversized
 * or unreadable body. Retryable; the original error is kept for logs.
 *
 * @module libs/integrations/amazon/src/domain/exceptions
 */
export class AmazonNetworkError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean = false,
    readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'AmazonNetworkError';
    Error.captureStackTrace(this, this.constructor);
  }
}
