/**
 * Resolve Categories For Batch By EAN
 *
 * Batch EAN→Allegro-category resolver (#735). Implements the
 * `EanCategoryMatcher` capability for `AllegroOfferManagerAdapter`. Given
 * N `{ variantId, ean }` pairs, queries Allegro's product catalogue
 * (`GET /sale/products?phrase={ean}&mode=GTIN`) per non-empty EAN with a
 * concurrency cap, and returns a per-variant outcome envelope.
 *
 * No-throw contract: the util never throws for resolver-side failures.
 * HTTP errors collapse into `{ kind: 'no-match' }` (and are NOT cached, so
 * the next attempt can retry). Cache failures (Redis outage) are caught
 * + logged + bypassed — they MUST NOT abort the batch.
 *
 * Cache semantics:
 * - `matched` (unique exact-EAN hit)             → cached 24 h
 * - `no-match` from a successful empty response  → cached 24 h
 * - `no-match` from an HTTP failure              → NOT cached (allows retry)
 * - `multi-match`                                → NOT cached (operators may
 *                                                  resolve duplicates upstream)
 *
 * Mirrors the no-throw + selective-cache contract of `resolveAllegroProductCardByEan`
 * (#431). The two utils are siblings — this one resolves the category from
 * the EAN; #431 resolves a card given an already-known category.
 *
 * @module libs/integrations/allegro/src/infrastructure/util
 * @see {@link EanCategoryMatcher} for the capability port
 */
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';
import type {
  BatchCategoryByEanInput,
  EanMatchCandidate,
  EanMatchResult,
} from '@openlinker/core/listings';
import type {
  AllegroProductCardSummary,
  AllegroProductsSearchResponse,
} from '../../domain/types/allegro-api.types';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import type { ResolveCategoriesForBatchByEanOptions } from './resolve-categories-for-batch-by-ean.types';

export type { ResolveCategoriesForBatchByEanOptions } from './resolve-categories-for-batch-by-ean.types';

const DEFAULT_CACHE_TTL_SEC = 24 * 60 * 60;
const DEFAULT_CACHE_KEY_PREFIX = 'allegro:ean-match';
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Lazy-instantiated logger — only constructed on the cache-failure path.
 * Avoids the module-import side effect of `new Logger(...)` at top scope.
 */
let cachedLogger: Logger | null = null;
function getLogger(): Logger {
  cachedLogger ??= new Logger('resolveCategoriesForBatchByEan');
  return cachedLogger;
}

/**
 * Cache-shape: only the `matched` / `no-match` discriminants are persisted.
 * `multi-match` is never cached (see file header).
 */
type CachedOutcome =
  | { kind: 'matched'; allegroCategoryId: string; productCardId: string }
  | { kind: 'no-match' };

export async function resolveCategoriesForBatchByEan(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  connectionId: string,
  input: BatchCategoryByEanInput,
  options?: ResolveCategoriesForBatchByEanOptions,
): Promise<Map<string, EanMatchResult>> {
  const ttl = options?.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  const prefix = options?.cacheKeyPrefix ?? DEFAULT_CACHE_KEY_PREFIX;
  const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
  const searchLimit = options?.searchLimit ?? DEFAULT_SEARCH_LIMIT;

  const result = new Map<string, EanMatchResult>();
  const itemsToFetch: Array<{ variantId: string; ean: string }> = [];

  for (const item of input.items) {
    if (!isResolvableEan(item.ean)) {
      result.set(item.variantId, { kind: 'no-ean' });
    } else {
      itemsToFetch.push({ variantId: item.variantId, ean: item.ean.trim() });
    }
  }

  if (itemsToFetch.length === 0) return result;

  const settled = await throttleProcess(itemsToFetch, concurrency, (item) =>
    resolveOne(httpClient, cache, connectionId, prefix, ttl, searchLimit, item),
  );
  for (const entry of settled) {
    result.set(entry.variantId, entry.outcome);
  }

  return result;
}

/**
 * Normalised EAN check — `null`, `''`, and whitespace-only strings all
 * collapse to no-ean. Sending an empty phrase to Allegro produces
 * undefined results and burns rate-limit.
 */
function isResolvableEan(ean: string | null): ean is string {
  return typeof ean === 'string' && ean.trim().length > 0;
}

async function resolveOne(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  connectionId: string,
  cachePrefix: string,
  cacheTtlSec: number,
  searchLimit: number,
  item: { variantId: string; ean: string },
): Promise<{ variantId: string; outcome: EanMatchResult }> {
  const cacheKey = `${cachePrefix}:${connectionId}:${item.ean}`;

  const cached = await safeCacheGet(cache, cacheKey);
  if (cached) {
    return { variantId: item.variantId, outcome: cached };
  }

  const products = await fetchSearchResults(httpClient, item.ean, searchLimit);
  if (products === null) {
    // HTTP failure → no-match, do NOT cache (allows retry on next call).
    return { variantId: item.variantId, outcome: { kind: 'no-match' } };
  }

  const exact = products.filter((p) => hasExactGtin(p, item.ean));

  if (exact.length === 1) {
    const matched = exact[0];
    const categoryId = matched.category?.id;
    if (!categoryId) {
      // Defensive: swagger says category is required, but if a malformed
      // response sneaks through we degrade to no-match rather than crash.
      return { variantId: item.variantId, outcome: { kind: 'no-match' } };
    }
    const matchedOutcome = {
      kind: 'matched' as const,
      allegroCategoryId: categoryId,
      productCardId: matched.id,
    };
    await safeCacheSet(cache, cacheKey, matchedOutcome, cacheTtlSec);
    return { variantId: item.variantId, outcome: matchedOutcome };
  }

  if (exact.length === 0) {
    await safeCacheSet(cache, cacheKey, { kind: 'no-match' }, cacheTtlSec);
    return { variantId: item.variantId, outcome: { kind: 'no-match' } };
  }

  // exact.length >= 2 → multi-match. Preserve Allegro's relevance order.
  const candidates: EanMatchCandidate[] = [];
  for (const p of exact) {
    const categoryId = p.category?.id;
    if (!categoryId) continue;
    const candidate: EanMatchCandidate = {
      allegroCategoryId: categoryId,
      productCardId: p.id,
    };
    if (typeof p.name === 'string') {
      candidate.name = p.name;
    }
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    // All exact-EAN matches were malformed (no category). Collapse.
    return { variantId: item.variantId, outcome: { kind: 'no-match' } };
  }
  if (candidates.length === 1) {
    // After filtering out malformed entries we're back to a unique match.
    const winner = candidates[0];
    const matchedOutcome = {
      kind: 'matched' as const,
      allegroCategoryId: winner.allegroCategoryId,
      productCardId: winner.productCardId,
    };
    await safeCacheSet(cache, cacheKey, matchedOutcome, cacheTtlSec);
    return { variantId: item.variantId, outcome: matchedOutcome };
  }

  return { variantId: item.variantId, outcome: { kind: 'multi-match', candidates } };
}

/**
 * Make the Allegro `/sale/products` call. Returns null on HTTP failure or
 * malformed response so the caller can collapse to no-match. Uses
 * `mode=GTIN` for tighter matching than the phrase-only path #431 uses.
 */
async function fetchSearchResults(
  httpClient: IAllegroHttpClient,
  ean: string,
  searchLimit: number,
): Promise<AllegroProductCardSummary[] | null> {
  try {
    const response = await httpClient.get<AllegroProductsSearchResponse>('/sale/products', {
      queryParams: { phrase: ean, mode: 'GTIN', limit: searchLimit },
    });
    return Array.isArray(response.data?.products) ? response.data.products : [];
  } catch {
    // HTTP failure must not abort the batch. Surface as no-match without
    // caching — next attempt re-evaluates. Both `AllegroApiException`
    // (non-2xx) and ad-hoc network errors land here.
    return null;
  }
}

/**
 * True when the card carries an EAN-bearing parameter (`options.isGTIN === true`)
 * whose value matches `input.ean` exactly. Defensive against Allegro's fuzzy
 * matcher — even with `mode=GTIN` we re-filter on the GTIN parameter to be sure.
 *
 * Implementation note: the swagger documents the EAN as living inside the
 * `parameters[]` array under the GTIN-marked entry, NOT as a top-level field.
 * The `AllegroProductCardSummary.ean` field that the legacy #431 primitive
 * filters on is undocumented and may always be absent — we don't trust it here.
 */
function hasExactGtin(card: AllegroProductCardSummary, ean: string): boolean {
  if (!Array.isArray(card.parameters)) return false;
  for (const param of card.parameters) {
    if (param.options?.isGTIN !== true) continue;
    if (Array.isArray(param.values) && param.values.some((v) => v === ean)) {
      return true;
    }
  }
  return false;
}

/**
 * Cache get with defensive try/catch. `RedisCacheAdapter` does NOT swallow
 * connection errors; an outage would otherwise abort the batch.
 */
async function safeCacheGet(
  cache: CachePort | undefined,
  cacheKey: string,
): Promise<EanMatchResult | null> {
  if (!cache) return null;
  try {
    const cached = await cache.get<CachedOutcome>(cacheKey);
    if (!cached) return null;
    return cached;
  } catch (err) {
    getLogger().warn(`Cache get failed for ${cacheKey}: ${errorMessage(err)}`);
    return null;
  }
}

async function safeCacheSet(
  cache: CachePort | undefined,
  cacheKey: string,
  outcome: CachedOutcome,
  ttlSec: number,
): Promise<void> {
  if (!cache) return;
  try {
    await cache.set<CachedOutcome>(cacheKey, outcome, ttlSec);
  } catch (err) {
    getLogger().warn(`Cache set failed for ${cacheKey}: ${errorMessage(err)}`);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Chunked Promise.allSettled with a fixed in-flight concurrency cap. Items
 * within a chunk run in parallel; the next chunk starts after the previous
 * fully settles. Per-item failures cannot be observed here because `fn`
 * never throws — the resolver maps HTTP errors to a fulfilled `no-match`
 * outcome.
 */
async function throttleProcess<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const cap = Math.max(1, concurrency);
  for (let i = 0; i < items.length; i += cap) {
    const chunk = items.slice(i, i + cap);
    const settled = await Promise.allSettled(chunk.map(fn));
    for (const s of settled) {
      if (s.status === 'fulfilled') results.push(s.value);
    }
  }
  return results;
}
