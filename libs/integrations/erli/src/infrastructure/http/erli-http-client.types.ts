/**
 * Erli HTTP Client Types
 *
 * Transport-layer type definitions for `ErliHttpClient` — retry configuration,
 * per-request options, and the response envelope. Extracted to a separate file
 * per engineering-standards.md § "Type Definitions in Separate Files" (the
 * newer WooCommerce precedent; InPost/Allegro/DPD inline these — this is a
 * deliberate standards alignment, not a divergence).
 *
 * @module libs/integrations/erli/src/infrastructure/http
 */

/** The only HTTP methods Erli's REST Shop API uses. */
export type ErliHttpMethod = 'GET' | 'POST' | 'PATCH';

/** Bounded-retry tuning. Overridable per-connection via the client constructor. */
export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

/**
 * InPost-derived defaults: 3 retries, 500 ms → 8 s jittered exponential
 * backoff. Deliberately modest — the sync-job runner is the second retry tier
 * (D4), so the in-request budget stays small.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 8000,
};

export interface ErliRequestOptions {
  /** Query params; `undefined` values are dropped. */
  queryParams?: Record<string, string | number | boolean | undefined>;
  /** Extra request headers, merged over the client's defaults. */
  headers?: Record<string, string>;
  /** Per-request timeout override (ms); defaults to the client's 30 s. */
  timeoutMs?: number;
  /**
   * Marks a request safe to retry on `5xx`/network failure (D3). GET/PATCH are
   * idempotent by HTTP semantics regardless of this flag; POST is
   * non-idempotent unless this is `true`. A non-idempotent POST fails fast on
   * a transport error rather than risk a double-create.
   */
  idempotent?: boolean;
}

/**
 * Response envelope. Exposes `status` (not just the body) so adapters can tell
 * a synchronous `200` from Erli's asynchronous `202` accepted-write (ADR-022:
 * ~20-min cache lag) — the #989 reconciliation flow keys off this.
 */
export interface ErliHttpResponse<T> {
  status: number;
  data: T;
}
