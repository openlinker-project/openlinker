/**
 * DPD HTTP Client Port
 *
 * Narrow transport contract the adapter codes against. Keeping it an interface
 * (not the concrete client) lets adapter unit specs mock DPDServices HTTP
 * without a real `fetch`, per engineering-standards §"Interface and
 * Implementation Separation".
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/http
 */

export type DpdHttpMethod = 'GET' | 'POST';

/** Auth identifiers for the DPDServices client (HTTP Basic + optional X-DPD-FID). */
export interface DpdHttpAuth {
  login: string;
  password: string;
  /** Provisional `X-DPD-FID` header value (master FID), pending OQ-2. */
  masterFid?: string;
}

export interface DpdRequestOptions {
  method: DpdHttpMethod;
  /** Absolute path on the DPDServices host, e.g. `/public/shipment/v1/generatePackagesNumbers`. */
  path: string;
  /** JSON request body (serialised by the client). */
  body?: unknown;
  /**
   * Whether the call is safe to auto-retry on an **ambiguous** failure — a
   * network/timeout or an ambiguous `5xx` (`500`/`502`/`504`) that might have
   * committed server-side. `true` only for idempotent reads (label render).
   *
   * For the non-idempotent create (`generatePackagesNumbers`) leave it
   * `false`/unset: DPD has no idempotency key, so retrying a request that
   * already committed would double-create a waybill and double-charge COD — the
   * failure surfaces as `DpdNetworkException` (reconcile, don't re-POST).
   *
   * `429` and `503` are retryable regardless of this flag: both mean DPD did
   * NOT process the request, so a retry can't double-create.
   */
  idempotent?: boolean;
}

export interface IDpdHttpClient {
  /**
   * Issue a DPDServices request. Resolves with the parsed JSON body. Throws a
   * mapped domain exception on HTTP failure (`DpdUnauthorizedException` /
   * `ShippingProviderRejectionException` / `DpdNetworkException`). Business
   * validation failures arrive as HTTP `200` with a non-OK body status and are
   * the adapter's concern, not the client's.
   */
  request<T>(options: DpdRequestOptions): Promise<T>;
}
