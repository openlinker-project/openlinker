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
 * `retryAfterSeconds` carries the upstream `Retry-After` header when the shop
 * sent one (#2613). Honouring the shop's own number beats any backoff we could
 * compute, so the retry classifier reads it for a 429. It is `undefined`
 * whenever the header was absent or unparseable - PrestaShop core sends no
 * `Retry-After`, so in practice it is populated only by a fronting proxy or
 * WAF that does.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopApiException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
    public readonly connectionId?: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'PrestashopApiException';
    Error.captureStackTrace(this, this.constructor);
  }
}
