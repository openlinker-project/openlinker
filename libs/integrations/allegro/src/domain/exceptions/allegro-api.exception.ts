/**
 * Allegro API Exception
 *
 * Domain exception for Allegro API errors. Thrown when API requests fail
 * with non-2xx status codes.
 *
 * `allegroErrors` is populated by `AllegroHttpClient.handleError` (#486) when
 * the response body is JSON-shaped with an `errors[]` array — the standard
 * Allegro 4xx contract. Downstream consumers (offer-create, content-publish,
 * offer-update) read it directly without re-parsing the raw body.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
import type { AllegroValidationError } from '../types/allegro-api.types';

export class AllegroApiException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
    public readonly url?: string,
    public readonly allegroErrors?: AllegroValidationError[],
  ) {
    super(message);
    this.name = 'AllegroApiException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroApiException);
    }
  }
}
