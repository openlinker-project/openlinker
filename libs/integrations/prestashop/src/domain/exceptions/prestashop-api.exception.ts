/**
 * PrestaShop API Exception
 *
 * Thrown when PrestaShop WebService API returns an error (5xx, or other API errors).
 * Used for server errors, rate limiting, or other API-level failures.
 *
 * `responseBody` carries the **full** upstream body — it is intentionally
 * unbounded so callers can inspect or parse the payload without re-fetching
 * (matches Allegro `AllegroApiException` since #409). Log surfaces are
 * separately capped via `formatBodyForLog` (#416). If you re-log this field,
 * route it through that helper.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopApiException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'PrestashopApiException';
    Error.captureStackTrace(this, this.constructor);
  }
}






