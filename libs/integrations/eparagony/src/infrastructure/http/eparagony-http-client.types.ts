/**
 * eparagony.pl HTTP Client Types
 *
 * Transport-layer types for `EparagonyHttpClient`: retry tuning, per-request
 * options and the response envelope.
 *
 * @module libs/integrations/eparagony/src/infrastructure/http
 */

export type EparagonyHttpMethod = 'GET' | 'POST';

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

/**
 * Deliberately modest, because the wall-clock budget is shared with the status
 * poll and the whole call must land inside core's supported provider round-trip
 * ceiling (see `EPARAGONY_REGISTER_DEADLINE_MS`).
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 2,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 4000,
};

export interface EparagonyRequestOptions {
  /** Extra request headers, merged UNDER the client's fixed auth/version headers. */
  headers?: Record<string, string>;
  /** Per-request timeout override in ms. */
  timeoutMs?: number;
  /**
   * Marks a write safe to re-issue on a `5xx`/network failure.
   *
   * For this vendor a document create IS safe to re-issue, because OL sends its
   * own registration key as the vendor's `Idempotency-Key` and the vendor
   * guarantees that repeating a key with the same body cannot mint a second
   * document (and so cannot mint a second fiscal registration). That guarantee
   * is the ONLY reason this flag is ever set on a `POST`; a write without an
   * idempotency key must leave it unset and fail fast.
   */
  idempotent?: boolean;
}

export interface EparagonyHttpResponse<T> {
  status: number;
  data: T;
}
