/**
 * Fetch Allegro Product — Types
 *
 * Public type surface for the catalog product-detail fetcher (#633). Kept
 * in a dedicated `.types.ts` file per Engineering Standards.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */

/**
 * Optional knobs for `fetchAllegroProduct`. Defaults match the production
 * wiring in `AllegroAdapterFactory`.
 */
export interface FetchAllegroProductOptions {
  /** Cache TTL in seconds. Default 86 400 (24 h). */
  cacheTtlSec?: number;
  /** Cache key prefix. Default `'allegro:product-detail'`. Override for tests. */
  cacheKeyPrefix?: string;
}
