/**
 * WooCommerce HTTP Client Interface
 *
 * Contract for the WooCommerce REST API v3 transport layer. Adapters depend on
 * this interface rather than the concrete WooCommerceHttpClient so that they
 * remain testable with a mock transport.
 *
 * Mirrors the pattern used by IPrestashopWebserviceClient and IInPostHttpClient
 * in their respective integration packages.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */
/** Per-call retry option (#3469 — never retry a non-idempotent write blindly). */
export interface WooCommerceRequestOptions {
  /**
   * Whether the call is safe to auto-retry on an **ambiguous** failure — a
   * network/timeout or an ambiguous `5xx` that might have committed
   * server-side. `false` by default for `post` — every current call site is
   * a genuine create, and a blind retry after a committed-but-lost response
   * duplicates it. `429` is retried regardless of this flag — WooCommerce
   * did not process the request, so a retry can't double-create.
   */
  idempotent?: boolean;
}

export interface IWooCommerceHttpClient {
  /**
   * Perform a GET request against the WooCommerce REST API.
   *
   * @param path - URL path including the `/wp-json/wc/v3/...` prefix.
   * @param params - Optional query parameters serialized via URLSearchParams.
   * @throws {WooCommerceUnauthorizedException} on HTTP 401/403
   * @throws {WooCommerceHttpResponseException} on HTTP 404 and other non-2xx
   * @throws {WooCommerceNetworkException} on timeout or network error
   */
  get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T>;

  /**
   * Perform a POST request against the WooCommerce REST API.
   *
   * Non-idempotent by default (#3469): an ambiguous 5xx or network error is
   * NOT retried unless `options.idempotent` is `true`, since every current
   * call site is a create and a blind retry risks a duplicate write. `429`
   * is always retried — WooCommerce rejected the request without processing
   * it.
   *
   * @param path - URL path including the `/wp-json/wc/v3/...` prefix.
   * @param body - Request body serialized as JSON.
   * @param options - Retry behaviour for this call.
   * @throws {WooCommerceUnauthorizedException} on HTTP 401/403
   * @throws {WooCommerceHttpResponseException} on HTTP 404 and other non-2xx
   * @throws {WooCommerceNetworkException} on timeout or network error
   */
  post<T>(path: string, body: unknown, options?: WooCommerceRequestOptions): Promise<T>;

  /**
   * Perform a PUT request against the WooCommerce REST API.
   *
   * @param path - URL path including the `/wp-json/wc/v3/...` prefix.
   * @param body - Request body serialized as JSON.
   * @throws {WooCommerceUnauthorizedException} on HTTP 401/403
   * @throws {WooCommerceHttpResponseException} on HTTP 404 and other non-2xx
   * @throws {WooCommerceNetworkException} on timeout or network error
   */
  put<T>(path: string, body: unknown): Promise<T>;

  /**
   * Perform a DELETE request against the WooCommerce REST API.
   *
   * @param path - URL path including the `/wp-json/wc/v3/...` prefix.
   * @param params - Optional query parameters (e.g. `{ force: true }`).
   * @throws {WooCommerceUnauthorizedException} on HTTP 401/403
   * @throws {WooCommerceHttpResponseException} on HTTP 404 and other non-2xx
   * @throws {WooCommerceNetworkException} on timeout or network error
   */
  delete<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T>;
}
