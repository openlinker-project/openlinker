/**
 * Allegro Authentication Exception
 *
 * Domain exception for Allegro authentication errors. Thrown when API
 * requests fail due to invalid or expired access tokens.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroAuthenticationException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'AllegroAuthenticationException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroAuthenticationException);
    }
  }
}



