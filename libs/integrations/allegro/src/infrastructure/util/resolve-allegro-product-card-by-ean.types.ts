/**
 * Resolve Allegro Product Card By EAN — Types
 *
 * Public type surface for the smart-link resolver (#431). Kept in a
 * dedicated `.types.ts` file per Engineering Standards "Type Definitions in
 * Separate Files".
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 */
import type { AllegroProductCardSummary } from '../../domain/types/allegro-api.types';

/**
 * Discriminated outcome of `resolveAllegroProductCardByEan`. The util never
 * throws for resolver-side failures — HTTP errors collapse into `no_match`
 * and are logged at the call site. This keeps the offer-create pipeline
 * unconditionally able to fall through to the inline-product path.
 *
 * - `unique`     — exactly one card matched the EAN exactly. Adapter will
 *                  link via `productSet[0].product.id`.
 * - `ambiguous`  — multiple cards matched. Adapter falls back to inline.
 *                  `matches` carries the candidate summaries for ops logs.
 * - `no_match`   — zero exact matches (or HTTP error). Adapter falls back
 *                  to inline.
 */
export type ResolveProductCardResult =
  | { kind: 'unique'; productId: string }
  | { kind: 'ambiguous'; matches: AllegroProductCardSummary[] }
  | { kind: 'no_match' };

/**
 * Optional knobs for `resolveAllegroProductCardByEan`. Defaults match the
 * production wiring in `AllegroAdapterFactory`.
 */
export interface ResolveAllegroProductCardOptions {
  /** Cache TTL in seconds. Default 86 400 (24 h). */
  cacheTtlSec?: number;
  /** Cache key prefix. Default `'allegro:product-card'`. Override for tests. */
  cacheKeyPrefix?: string;
  /** Allegro `GET /sale/products` page size. Default 10. */
  searchLimit?: number;
}
