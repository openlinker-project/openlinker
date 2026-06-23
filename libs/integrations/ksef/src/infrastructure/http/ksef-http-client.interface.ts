/**
 * KSeF HTTP Client Port
 *
 * Transport contract the KSeF capability adapters + auth/crypto services code
 * against. Keeping it an interface — not a concrete client — lets adapter and
 * service unit specs mock KSeF HTTP without a real `fetch`, per
 * engineering-standards § "Interface and Implementation Separation".
 *
 * Mirrors the Allegro client surface (#499 precedent): every method returns a
 * `KsefHttpResponse<T>` carrying status + headers so callers can inspect them
 * (e.g. the auth poll reads status to distinguish processing/completed), plus a
 * `postExpectingBinary` for document endpoints (UPO PDFs). The client owns auth
 * header injection, retry/backoff, rate-limit handling, token refresh, and
 * structured logging (never credential material).
 *
 * Package-private: consumed only by the in-package factory, auth handshake, and
 * session-crypto services via relative import; intentionally NOT re-exported
 * from the package barrel (siblings keep their clients private too).
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import type {
  KsefBinaryResponse,
  KsefHttpRequestOptions,
  KsefHttpResponse,
} from './ksef-http-client.types';

export interface IKsefHttpClient {
  /**
   * GET — idempotent; transient `5xx`/network failures and `429` (with
   * `Retry-After` backoff) are retried. `4xx` (other than auth) fails fast.
   */
  get<T = unknown>(path: string, options?: KsefHttpRequestOptions): Promise<KsefHttpResponse<T>>;

  /**
   * POST — non-idempotent by default: a `5xx`/network failure fails fast unless
   * the caller sets `options.idempotent` (KSeF session sub-resource reads are
   * POSTs but safe to repeat). `429` always backs off and retries.
   */
  post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefHttpResponse<T>>;

  /**
   * POST a JSON body but read the SUCCESS response as raw bytes (e.g. a UPO
   * document). Error responses are still parsed as the JSON KSeF error envelope
   * through the same error path as every other call.
   */
  postExpectingBinary(
    path: string,
    body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefBinaryResponse>;
}
