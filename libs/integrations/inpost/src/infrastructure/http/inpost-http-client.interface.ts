/**
 * InPost HTTP Client Port
 *
 * Narrow transport contract the adapter codes against. Keeping it an interface
 * (not the concrete client) lets adapter unit specs mock ShipX HTTP without a
 * real `fetch`, per engineering-standards §"Interface and Implementation
 * Separation".
 *
 * @module libs/integrations/inpost/src/infrastructure/http
 */

export type InpostHttpMethod = 'GET' | 'POST' | 'DELETE';

export interface InpostRequestOptions {
  method: InpostHttpMethod;
  /** Absolute path on the ShipX host, e.g. `/v1/organizations/{org}/shipments`. */
  path: string;
  /** Query params; `undefined` values are dropped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON request body (serialised by the client). */
  body?: unknown;
}

export interface IInpostHttpClient {
  /**
   * Issue a ShipX request. Resolves with the parsed JSON body (or `undefined`
   * for `204`). Throws a mapped domain exception on failure
   * (`InpostUnauthorizedException` / `InpostValidationException` /
   * `InpostNetworkException`).
   */
  request<T>(options: InpostRequestOptions): Promise<T>;
}
