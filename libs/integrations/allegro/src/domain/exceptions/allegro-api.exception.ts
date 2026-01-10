/**
 * Allegro API Exception
 *
 * Domain exception for Allegro API errors. Thrown when API requests fail
 * with non-2xx status codes.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroApiException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'AllegroApiException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroApiException);
    }
  }
}


