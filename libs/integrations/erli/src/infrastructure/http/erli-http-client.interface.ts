/**
 * Erli HTTP Client Port
 *
 * Narrow transport contract the Erli adapters (#984 offers, #993 orders) code
 * against. Keeping it an interface — not the concrete client — lets adapter
 * unit specs mock Erli HTTP without a real `fetch`, per engineering-standards
 * § "Interface and Implementation Separation".
 *
 * Package-private: consumed only by the in-package `ErliAdapterFactory` (#982)
 * via relative import; intentionally NOT re-exported from the package barrel
 * (siblings keep their clients private too).
 *
 * @module libs/integrations/erli/src/infrastructure/http
 */
import type { ErliHttpResponse, ErliRequestOptions } from './erli-http-client.types';

export interface IErliHttpClient {
  /** GET — idempotent; `5xx`/network failures are retried. */
  get<T>(path: string, options?: ErliRequestOptions): Promise<ErliHttpResponse<T>>;

  /**
   * POST — non-idempotent by default: a `5xx`/network failure fails fast (no
   * retry) unless the caller passes `options.idempotent = true` (D3).
   */
  post<T>(path: string, body?: unknown, options?: ErliRequestOptions): Promise<ErliHttpResponse<T>>;

  /** PATCH — idempotent; `5xx`/network failures are retried. */
  patch<T>(path: string, body?: unknown, options?: ErliRequestOptions): Promise<ErliHttpResponse<T>>;

  /** PUT — idempotent (webhook registration `PUT /hooks/{name}`); `5xx`/network failures are retried. */
  put<T>(path: string, body?: unknown, options?: ErliRequestOptions): Promise<ErliHttpResponse<T>>;
}
