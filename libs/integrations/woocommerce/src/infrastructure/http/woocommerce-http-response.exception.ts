/**
 * WooCommerce HTTP Response Exception
 *
 * Transport-level exception thrown by WooCommerceHttpClient for non-2xx
 * responses that are not mapped to a more specific typed exception
 * (WooCommerceUnauthorizedException for 401/403). Carries the HTTP status
 * code so the adapter layer can inspect it and rethrow as a domain exception
 * (e.g. 404 → WooCommerceResourceNotFoundException) with full entity context.
 *
 * Intentionally placed in infrastructure/http/ (not domain/exceptions/) because
 * HTTP status codes are a transport concern — domain/exceptions/ is reserved for
 * domain-level concepts. Never exported from the package barrel.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */
export class WooCommerceHttpResponseException extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    // Machine-readable WC error code from the response body (e.g.
    // `product_invalid_sku`), when present. Lets the adapter map known codes
    // to domain exceptions without parsing the human-readable message.
    readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'WooCommerceHttpResponseException';
    Error.captureStackTrace(this, this.constructor);
  }
}
