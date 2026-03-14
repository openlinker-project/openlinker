/**
 * PrestaShop API Exception
 *
 * Thrown when PrestaShop WebService API returns an error (5xx, or other API errors).
 * Used for server errors, rate limiting, or other API-level failures.
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






