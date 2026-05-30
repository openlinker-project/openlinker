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

/** Raw-bytes response — the document bytes plus the reported content type. */
export interface InpostBinaryResponse {
  body: Uint8Array;
  /** Lowercased `content-type` response header; '' when absent. */
  contentType: string;
}

export interface IInpostHttpClient {
  /**
   * Issue a ShipX request. Resolves with the parsed JSON body (or `undefined`
   * for `204`). Throws a mapped domain exception on failure
   * (`InpostUnauthorizedException` / `ShippingProviderRejectionException` /
   * `InpostNetworkException`).
   */
  request<T>(options: InpostRequestOptions): Promise<T>;

  /**
   * Issue a ShipX request and read the **response** as raw bytes (not JSON) —
   * for document endpoints like `GET /v1/shipments/{id}/label?format=pdf`.
   * Shares the same retry + error-mapping machinery as `request`: error
   * responses are still parsed as the JSON ShipX error envelope; only a
   * SUCCESS body is read via `arrayBuffer()`. Returns the bytes + the
   * `content-type` header so the caller can label the document correctly.
   */
  requestBinary(options: InpostRequestOptions): Promise<InpostBinaryResponse>;
}
