/**
 * Resolve Categories For Batch By EAN — Types
 *
 * Options type for the batch EAN→category resolver (#735). The public
 * `BatchCategoryByEanInput` and `EanMatchResult` shapes live in
 * `@openlinker/core/listings` — this file only carries plugin-local
 * tuning knobs.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */

/**
 * Optional knobs for `resolveCategoriesForBatchByEan`. Defaults match the
 * production wiring on `AllegroOfferManagerAdapter`.
 */
export interface ResolveCategoriesForBatchByEanOptions {
  /** Cache TTL in seconds. Default 86 400 (24h) — matches #431. */
  cacheTtlSec?: number;
  /** Cache-key prefix. Default `'allegro:ean-match'`. Override for tests. */
  cacheKeyPrefix?: string;
  /**
   * In-flight concurrency cap.
   *
   * The default differs by entry point (#2215): the batch collector uses 3,
   * which straddles the spec's 5-10 req/sec target at Allegro's typical
   * 200-500 ms p50 latency, while the streaming generator uses
   * `STREAM_CONCURRENCY` because results land continuously there and the
   * pre-#2208 chunking already sustained that many in flight. Higher values are
   * tolerated by `AllegroHttpClient`'s `Retry-After`-aware 429 backoff, and
   * `HttpTransportFactory` still paces every call against the connection's own
   * `config.rateLimit`, so an operator's configured cap wins over either number.
   */
  concurrency?: number;
  /** Allegro `GET /sale/products?limit=` cap. Default 10 — mirrors #431. */
  searchLimit?: number;
}

/**
 * Options for `streamCategoriesForBatchByEan` (#2208). Same tuning knobs plus
 * the cancellation seam the `EanCategoryMatcherStreaming` capability declares.
 */
export interface StreamCategoriesForBatchByEanOptions
  extends ResolveCategoriesForBatchByEanOptions {
  /**
   * Aborting stops further marketplace calls from being *scheduled*; calls
   * already issued are left to settle and their results are still yielded
   * (epic #2205 decision 5).
   */
  signal?: AbortSignal;
}
