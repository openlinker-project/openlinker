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
   * In-flight concurrency cap. Default 3 — straddles the spec's 5-10 req/sec
   * target at Allegro's typical 200-500ms p50 latency. Higher values are
   * tolerated by `AllegroHttpClient`'s `Retry-After`-aware 429 backoff,
   * but deliberately staying under the rate-limit ceiling is cheaper than
   * relying on the backpressure net.
   */
  concurrency?: number;
  /** Allegro `GET /sale/products?limit=` cap. Default 10 — mirrors #431. */
  searchLimit?: number;
}
