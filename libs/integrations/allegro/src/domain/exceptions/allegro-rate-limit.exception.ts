/**
 * Allegro Rate Limit Exception
 *
 * Domain exception for Allegro rate limit errors. Thrown when API
 * requests exceed rate limits (429 status code).
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroRateLimitException extends Error {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'AllegroRateLimitException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroRateLimitException);
    }
  }
}



