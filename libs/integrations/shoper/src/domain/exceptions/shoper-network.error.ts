/**
 * ShoperNetworkError
 *
 * Thrown when the request never produced a usable HTTP response: DNS failure,
 * connection refused, TLS failure, a timeout, or a response body over the size
 * cap. Distinct from `ShoperApiError`, which means the shop answered.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperNetworkError extends Error {
  constructor(
    message: string,
    readonly timedOut: boolean = false,
    readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'ShoperNetworkError';
    Error.captureStackTrace(this, this.constructor);
  }
}
