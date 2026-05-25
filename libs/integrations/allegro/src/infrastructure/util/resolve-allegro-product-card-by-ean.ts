/**
 * Resolve Allegro Product Card By EAN
 *
 * Smart-link resolver (#431). Given a variant's EAN and the target Allegro
 * category, look up Allegro's product catalogue (`GET /sale/products`) and
 * return whether a unique product card exists. The adapter uses this *before*
 * building the offer body: on `unique`, it links via
 * `productSet[0].product.id`, inheriting GPSR + parameters from the card.
 * On `ambiguous` or `no_match`, the adapter falls through to the inline-
 * product path (which requires the connection-level seller defaults from
 * #430).
 *
 * The util **never throws** for resolver-side failures — HTTP errors collapse
 * into `no_match` so the offer-create pipeline is unconditionally able to
 * fall through to inline. Two flavours of failure are caught:
 *
 * - **HTTP non-2xx / network error** (Allegro `AllegroApiException`):
 *   logged + returned as `no_match`. The cache is **not** populated for this
 *   path — we want to retry on the next attempt.
 * - **Allegro returned a result we couldn't make sense of** (no products
 *   array, malformed shape): treated the same way.
 *
 * Cache semantics (`(ean, categoryId) -> ResolveProductCardResult`):
 * - `unique` and `no_match` are cached for `cacheTtlSec` (default 24 h).
 * - `ambiguous` is **not** cached — operators may narrow the catalogue or
 *   a duplicate card may be merged on Allegro's side; re-evaluating cheaply
 *   on the next attempt is correct.
 *
 * Mirrors the no-throw contract used by `upload-images-via-allegro.ts`.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 * @see {@link AllegroOfferManagerAdapter.createOffer} — sole consumer
 */
import type { CachePort } from '@openlinker/shared';
import type {
  AllegroProductCardSummary,
  AllegroProductsSearchResponse,
} from '../../domain/types/allegro-api.types';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import type {
  ResolveAllegroProductCardOptions,
  ResolveProductCardResult,
} from './resolve-allegro-product-card-by-ean.types';

export type {
  ResolveAllegroProductCardOptions,
  ResolveProductCardResult,
} from './resolve-allegro-product-card-by-ean.types';

const DEFAULT_CACHE_TTL_SEC = 24 * 60 * 60;
const DEFAULT_CACHE_KEY_PREFIX = 'allegro:product-card';
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Cache-shape: we serialize the `unique`/`no_match` discriminant as a
 * minimal payload. `ambiguous` is intentionally not cached.
 */
type CachedOutcome =
  | { kind: 'unique'; productId: string }
  | { kind: 'no_match' };

export async function resolveAllegroProductCardByEan(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  input: { ean: string; categoryId: string },
  options?: ResolveAllegroProductCardOptions,
): Promise<ResolveProductCardResult> {
  const ttl = options?.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  const prefix = options?.cacheKeyPrefix ?? DEFAULT_CACHE_KEY_PREFIX;
  const limit = options?.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  const cacheKey = `${prefix}:${input.categoryId}:${input.ean}`;

  if (cache) {
    const cached = await cache.get<CachedOutcome>(cacheKey);
    if (cached) {
      return cached.kind === 'unique'
        ? { kind: 'unique', productId: cached.productId }
        : { kind: 'no_match' };
    }
  }

  let products: AllegroProductCardSummary[];
  try {
    const response = await httpClient.get<AllegroProductsSearchResponse>('/sale/products', {
      queryParams: {
        phrase: input.ean,
        // #808 — `mode=GTIN` tells Allegro to interpret `phrase` as a GTIN,
        // matching the tighter lookup the category matcher uses (#735/#797)
        // rather than the looser phrase-only search this path used before.
        mode: 'GTIN',
        'category.id': input.categoryId,
        limit,
      },
    });
    products = Array.isArray(response.data?.products) ? response.data.products : [];
  } catch {
    // Resolver-side HTTP failure must not block offer creation. Surface as
    // no_match without caching — next attempt re-evaluates. Both
    // `AllegroApiException` (non-2xx) and ad-hoc network errors land here.
    return { kind: 'no_match' };
  }

  // Allegro's matcher is fuzzy on `phrase` — filter to exact-EAN matches.
  const exact = products.filter((p) => typeof p.ean === 'string' && p.ean === input.ean);

  if (exact.length === 1) {
    const productId = exact[0].id;
    if (cache) {
      await cache.set<CachedOutcome>(cacheKey, { kind: 'unique', productId }, ttl);
    }
    return { kind: 'unique', productId };
  }

  if (exact.length === 0) {
    if (cache) {
      await cache.set<CachedOutcome>(cacheKey, { kind: 'no_match' }, ttl);
    }
    return { kind: 'no_match' };
  }

  // exact.length >= 2 → ambiguous. Do not cache — operators may resolve.
  return { kind: 'ambiguous', matches: exact };
}
