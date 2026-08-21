/**
 * Resolve Categories For Batch By EAN
 *
 * Batch EAN→Allegro-category resolver (#735). Implements the
 * `EanCategoryMatcher` and `EanCategoryMatcherStreaming` capabilities for
 * `AllegroOfferManagerAdapter`. Given N `{ variantId, ean }` pairs, queries
 * Allegro's product catalogue (`GET /sale/products?phrase={ean}&mode=GTIN`)
 * per non-empty EAN with a concurrency cap, and reports a per-variant
 * outcome envelope.
 *
 * `streamCategoriesForBatchByEan` is the primary shape (#2208, epic #2205):
 * an async generator that yields each variant's outcome the moment it
 * settles, so a batch stops withholding every result for the
 * `ceil(n / STREAM_CONCURRENCY) * latency` it takes the last wave to land. Allegro exposes no
 * bulk GTIN lookup, so the per-item work itself is unchanged - only the
 * delivery point moved.
 *
 * `resolveCategoriesForBatchByEan` is kept as a thin collector over that
 * generator. One resolution path means the batch and streaming call sites
 * cannot drift in cache behaviour, GTIN filtering, or failure handling.
 *
 * No-throw contract: the util never throws for resolver-side failures.
 * HTTP errors collapse into `{ kind: 'no-match' }` (and are NOT cached, so
 * the next attempt can retry). Cache failures (Redis outage) are caught
 * + logged + bypassed - they MUST NOT abort the batch or the stream.
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
 * @see {@link EanCategoryMatcher} for the batch capability port
 * @see {@link EanCategoryMatcherStreaming} for the streaming capability port
 */
import type { CachePort } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';
import type {
  BatchCategoryByEanInput,
  EanCategoryMatchStreamItem,
  EanMatchCandidate,
  EanMatchResult,
} from '@openlinker/core/listings';
import type {
  AllegroProductCardSummary,
  AllegroProductsSearchResponse,
} from '../../domain/types/allegro-api.types';
import type { IAllegroHttpClient } from '../http/allegro-http-client.interface';
import type {
  ResolveCategoriesForBatchByEanOptions,
  StreamCategoriesForBatchByEanOptions,
} from './resolve-categories-for-batch-by-ean.types';

export type {
  ResolveCategoriesForBatchByEanOptions,
  StreamCategoriesForBatchByEanOptions,
} from './resolve-categories-for-batch-by-ean.types';

const DEFAULT_CACHE_TTL_SEC = 24 * 60 * 60;
const DEFAULT_CACHE_KEY_PREFIX = 'allegro:ean-match';
const DEFAULT_CONCURRENCY = 3;
/**
 * In-flight cap for the STREAMING path (#2215), deliberately higher than
 * `DEFAULT_CONCURRENCY`.
 *
 * Before the streamed step existed, the wizard split a batch into 50-variant
 * requests and fired them in parallel; each request built its own adapter, each
 * capped at 3, so the effective in-flight count was `3 * ceil(variants / 50)` -
 * 9 for a 120-variant batch, 18 for 300. Nobody chose those numbers, they fell
 * out of the chunk size, but they ran routinely in production. One stream
 * replaced the chunking, which dropped the cap to a flat 3 and made a
 * 120-variant batch take about 25 s where it took about 10 s.
 *
 * 9 is what a 3-chunk batch already sustained, so it is a ceiling that ran in
 * production rather than a new one. Two things it is NOT, stated because the
 * arithmetic above invites both readings:
 *
 * - It does not "restore" the old number for every batch. The client now splits
 *   at the route's 200-item cap, not at 50, so a batch of 40 ran 3 in flight
 *   before and runs 9 now. The premise only holds from roughly 150 variants up;
 *   below that this is a straight 3x on outbound `/sale/products`, accepted
 *   deliberately because that is where the frozen-counter complaint came from.
 * - It does not sit under a manifest floor. `allegroAdapterManifest` declares no
 *   `defaultRateLimit` and deliberately never will (#1810 §1: a manifest default
 *   is for merchant-hosted platforms; a fabricated RPM for a multi-tenant
 *   marketplace would be surfaced to the operator as "adapter default"). So
 *   "the operator's configured cap wins" is true only once the operator has
 *   configured `connection.config.rateLimit`; with none set, 9 IS the cap.
 *   Reactive protection still applies unconditionally - a 429 parks the client
 *   on `Retry-After` (`AllegroHttpClient`).
 */
export const STREAM_CONCURRENCY = 9;
const DEFAULT_SEARCH_LIMIT = 10;

/**
 * Resolve the effective in-flight ceiling for one streamed run (#2229).
 *
 * The single source of truth for BOTH what the adapter reports through
 * `getStreamConcurrency()` and what it actually passes as `concurrency` below.
 * Two call sites, one function, on purpose: a ceiling shown to the operator
 * that differs from the one enforced would be a worse defect than the
 * invisible ceiling #2229 exists to remove.
 *
 * An operator's `Connection.config.rateLimit.maxConcurrent` clamps the ceiling
 * DOWNWARD only. Raising it is deliberately not supported - that knob is a
 * safety valve on the operator's own quota, and letting it lift the adapter's
 * pacing would turn a cap into a throttle-release. A non-finite or
 * non-positive configured value is ignored rather than treated as zero, since
 * a zero ceiling would stall every resolve run silently.
 */
export function resolveStreamConcurrency(configuredMaxConcurrent?: number): {
  maxInFlight: number;
  source: 'connection-config' | 'adapter-default';
  adapterDefault: number;
} {
  const usable =
    typeof configuredMaxConcurrent === 'number' &&
    Number.isFinite(configuredMaxConcurrent) &&
    configuredMaxConcurrent > 0
      ? Math.floor(configuredMaxConcurrent)
      : undefined;

  if (usable !== undefined && usable < STREAM_CONCURRENCY) {
    return {
      maxInFlight: usable,
      source: 'connection-config',
      adapterDefault: STREAM_CONCURRENCY,
    };
  }

  return {
    maxInFlight: STREAM_CONCURRENCY,
    source: 'adapter-default',
    adapterDefault: STREAM_CONCURRENCY,
  };
}

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

/**
 * Streaming resolver (#2208). Yields one item per input variant, each as soon
 * as its own outcome settles rather than when its wave does.
 *
 * `no-ean` verdicts cost nothing to reach, so they are yielded up front in
 * input order; the remaining items follow in settle order, which is why a
 * consumer keys on `variantId` and never on position.
 *
 * `options.signal` ends the iteration promptly: no further wave is scheduled
 * and the generator stops waiting on the wave already in flight, so an
 * operator who navigated away is never held for the HTTP client's 30 s
 * per-request timeout. Those calls are deliberately NOT cancelled - see
 * `throttleStream` for why - their results are simply discarded.
 */
export async function* streamCategoriesForBatchByEan(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  connectionId: string,
  input: BatchCategoryByEanInput,
  options?: StreamCategoriesForBatchByEanOptions,
): AsyncGenerator<EanCategoryMatchStreamItem, void, undefined> {
  const ttl = options?.cacheTtlSec ?? DEFAULT_CACHE_TTL_SEC;
  const prefix = options?.cacheKeyPrefix ?? DEFAULT_CACHE_KEY_PREFIX;
  // The streaming path is the wide one (#2215). The batch collector below
  // narrows it back to `DEFAULT_CONCURRENCY`, so a caller that wants the old
  // per-call pacing gets it by calling the batch function, not by remembering
  // to pass a number.
  const concurrency = options?.concurrency ?? STREAM_CONCURRENCY;
  const searchLimit = options?.searchLimit ?? DEFAULT_SEARCH_LIMIT;
  const signal = options?.signal;

  const itemsToFetch: Array<{ variantId: string; ean: string }> = [];
  const withoutEan: EanCategoryMatchStreamItem[] = [];

  for (const item of input.items) {
    if (!isResolvableEan(item.ean)) {
      withoutEan.push({ variantId: item.variantId, result: { kind: 'no-ean' } });
    } else {
      itemsToFetch.push({ variantId: item.variantId, ean: item.ean.trim() });
    }
  }

  if (signal?.aborted) return;

  for (const item of withoutEan) {
    yield item;
  }

  if (itemsToFetch.length === 0) return;

  yield* throttleStream(itemsToFetch, concurrency, signal, (item) =>
    resolveOne(httpClient, cache, connectionId, prefix, ttl, searchLimit, item),
  );
}

/**
 * Batch resolver (#735), kept as a thin collector over the generator so the
 * two capability paths share one resolution implementation.
 *
 * The returned map is equal *by value* to the pre-#2208 one, not by iteration
 * order: fetched entries are inserted in settle order rather than in chunk
 * order. Both in-tree call sites read it with `.get(variantId)`.
 */
export async function resolveCategoriesForBatchByEan(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  connectionId: string,
  input: BatchCategoryByEanInput,
  options?: ResolveCategoriesForBatchByEanOptions,
): Promise<Map<string, EanMatchResult>> {
  const result = new Map<string, EanMatchResult>();
  for await (const item of streamCategoriesForBatchByEan(
    httpClient,
    cache,
    connectionId,
    input,
    // A batch caller blocks on the whole map, so widening its in-flight count
    // buys it nothing an operator can see while spending more of the
    // marketplace's rate limit at once. Only the streaming path, whose whole
    // point is that results land continuously, gets the wider cap (#2215).
    { ...options, concurrency: options?.concurrency ?? DEFAULT_CONCURRENCY },
  )) {
    result.set(item.variantId, item.result);
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
 * Chunked resolution with a fixed in-flight concurrency cap, yielding in
 * settle order.
 *
 * Strict waves, NOT a sliding window: items within a chunk run in parallel and
 * the next chunk starts only once the previous one has fully settled. That keeps
 * the scheduling shape identical to the pre-#2208 `Promise.allSettled` wave
 * loop, so #2208 changed only WHEN a result is delivered.
 *
 * How much traffic is generated is a separate axis, and #2215 did move it: the
 * streaming entry point now runs at `STREAM_CONCURRENCY` instead of the batch
 * default. Refilling a freed slot early - a sliding window rather than waves -
 * would shorten the tail further without raising the ceiling, and is still
 * unclaimed work.
 *
 * A rejection cannot take the rest of the batch down (no-throw contract): `fn`
 * is the resolver, which already maps HTTP errors to a fulfilled `no-match`, so
 * a rejection here can only be a defect. It is logged and reported as
 * `no-match` rather than swallowed, because the capability promises every input
 * item is yielded exactly once.
 *
 * Abort ends the iteration promptly: the drain races the in-flight wave against
 * the signal and returns on the abort branch, leaving those promises un-awaited.
 * The underlying HTTP calls are NOT cancelled, and must not be "fixed" into
 * being cancelled: `AllegroHttpClient` builds its own `AbortController` per
 * request and accepts no external signal, and ADR-047 § Consequences accepted
 * that coarseness. Orphaning them costs one settled promise nobody reads;
 * awaiting them costs the consumer up to the client's 30 s request timeout.
 */
async function* throttleStream(
  items: Array<{ variantId: string; ean: string }>,
  concurrency: number,
  signal: AbortSignal | undefined,
  fn: (item: { variantId: string; ean: string }) => Promise<{
    variantId: string;
    outcome: EanMatchResult;
  }>,
): AsyncGenerator<EanCategoryMatchStreamItem, void, undefined> {
  const cap = Math.max(1, concurrency);
  const abortRace = signal ? createAbortRace(signal) : null;
  try {
    for (let i = 0; i < items.length; i += cap) {
      if (signal?.aborted) return;
      const inFlight = new Map<number, Promise<SettledSlot>>();
      items.slice(i, i + cap).forEach((item, slot) => {
        inFlight.set(
          slot,
          fn(item).then(
            (value): SettledSlot => ({ slot, outcome: value }),
            (err): SettledSlot => {
              getLogger().warn(
                `Resolver rejected for variant ${item.variantId}, reporting no-match: ${errorMessage(err)}`,
              );
              return {
                slot,
                outcome: { variantId: item.variantId, outcome: { kind: 'no-match' } },
              };
            },
          ),
        );
      });
      while (inFlight.size > 0) {
        const racers: Array<Promise<SettledSlot | typeof ABORTED>> = [...inFlight.values()];
        if (abortRace) racers.push(abortRace.promise);
        const first = await Promise.race(racers);
        if (first === ABORTED) return;
        inFlight.delete(first.slot);
        yield { variantId: first.outcome.variantId, result: first.outcome.outcome };
      }
    }
  } finally {
    abortRace?.dispose();
  }
}

/** Race marker for the abort branch of the drain. */
const ABORTED = Symbol('aborted');

/**
 * A never-rejecting promise that settles when `signal` aborts, plus the
 * listener teardown. Without `dispose` a long-lived signal (one per operator
 * request in the #2205 NDJSON path) would accumulate a listener per wave.
 */
function createAbortRace(signal: AbortSignal): {
  promise: Promise<typeof ABORTED>;
  dispose: () => void;
} {
  let onAbort: () => void = (): void => undefined;
  const promise = new Promise<typeof ABORTED>((resolve): void => {
    onAbort = (): void => resolve(ABORTED);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const dispose = (): void => signal.removeEventListener('abort', onAbort);
  return { promise, dispose };
}

/** One settled slot of the current wave. */
interface SettledSlot {
  slot: number;
  outcome: { variantId: string; outcome: EanMatchResult };
}
