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

export interface DpdRequestOptions {
  method: DpdHttpMethod;
  /** Absolute path on the DPDServices host, e.g. `/public/shipment/v1/generatePackagesNumbers`. */
  path: string;
  /** JSON request body (serialised by the client). */
  body?: unknown;
  /**
   * Whether a **network/timeout** failure may be auto-retried. `true` only for
   * idempotent reads (label render). For the non-idempotent create
   * (`generatePackagesNumbers`) leave it `false`/unset: DPD has no idempotency
   * key, so a retry after the request already committed would double-create a
   * waybill and double-charge COD — the network error surfaces as
   * `DpdNetworkException` (reconcile, don't re-POST). HTTP `429`/`5xx` (which
   * mean DPD did NOT commit) are always retryable regardless of this flag.
   */
  retryOnNetworkError?: boolean;
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
