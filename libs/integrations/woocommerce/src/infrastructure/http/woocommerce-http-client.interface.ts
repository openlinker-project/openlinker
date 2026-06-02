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
export interface IWooCommerceHttpClient {
  /**
   * Perform a GET request against the WooCommerce REST API.
   *
   * @param path - URL path including the `/wp-json/wc/v3/...` prefix.
   *   May already contain a query string (`?per_page=1`); `params` are
   *   appended with `&` in that case.
   * @param params - Optional query parameters serialized via URLSearchParams.
   * @throws {WooCommerceUnauthorizedException} on HTTP 401/403
   * @throws {WooCommerceHttpResponseException} on HTTP 404 and other non-2xx (infrastructure/http — not exported)
   * @throws {WooCommerceNetworkException} on timeout or network error
   */
  get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T>;

  /**
   * Perform a POST request against the WooCommerce REST API.
   *
   * @param path - URL path including the `/wp-json/wc/v3/...` prefix.
   * @param body - Request body serialized as JSON.
   * @throws {WooCommerceUnauthorizedException} on HTTP 401/403
   * @throws {WooCommerceHttpResponseException} on HTTP 404 and other non-2xx
   * @throws {WooCommerceNetworkException} on timeout or network error
   */
  post<T>(path: string, body: unknown): Promise<T>;

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
