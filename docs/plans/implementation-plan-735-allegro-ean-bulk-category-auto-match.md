# Implementation Plan — Allegro EAN bulk category auto-match (#735)

**Issue**: [#735 — feat(allegro): EAN-based bulk category auto-match service](https://github.com/SilkSoftwareHouse/openlinker/issues/735)
**Parent epic**: [#726 — Allegro Smart! + bulk listing](https://github.com/SilkSoftwareHouse/openlinker/issues/726)
**Spec**: `docs/specs/product-spec-726-allegro-bulk-listing.md` § 4.5
**Branch**: `735-allegro-ean-bulk-category-auto-match`

---

## 0. Goal

Ship a batch-EAN-to-Allegro-category resolver so the future bulk-submission service (#736) and its review-table FE (#740) can pre-fill Allegro categories for N selected variants in one round.

**Non-goals** (explicitly out of scope per #735):
- AI-based category fallback when EAN match fails — OQ-C4 = manual pick in v1 (#740).
- Cache invalidation on Allegro product-card updates — v2 polish.
- `suggestedParams` (brand, manufacturer-code, …) in the match envelope — see § 9 decision and § 9.5 schema discovery; deferred to #740's edit modal.
- The HTTP API surface that exposes this to FE — owned by #736.

---

## 1. Layer mapping

Adapter capability addition. CORE gets a new sub-capability port; the Allegro plugin grows one method on `AllegroOfferManagerAdapter`. No new schema, no new migrations.

| File | Layer | Role |
|---|---|---|
| `libs/core/src/listings/domain/ports/capabilities/ean-category-matcher.capability.ts` | CORE — Domain | New sub-capability of `OfferManagerPort` + `isEanCategoryMatcher` type guard |
| `libs/core/src/listings/domain/types/ean-category-match.types.ts` | CORE — Domain | `EanMatchResultKindValues` (`as const`) + `EanMatchResultKind` type + `EanMatchResult` discriminated union + `BatchCategoryByEanInput` |
| `libs/core/src/listings/index.ts` | CORE — barrel | Re-export the capability + type guard + types + the `EanMatchResultKindValues` runtime array. Lives on the **existing** `@openlinker/core/listings` top-level barrel — no new sub-barrel. |
| `libs/integrations/allegro/src/infrastructure/util/resolve-categories-for-batch-by-ean.ts` | Plugin — util | Pure function: takes HTTP client + cache + batch input → result map. Adapter delegates. Matches the #431 sibling-util shape. |
| `libs/integrations/allegro/src/infrastructure/util/resolve-categories-for-batch-by-ean.types.ts` | Plugin — util | Options type for the util |
| `libs/integrations/allegro/src/infrastructure/util/__tests__/resolve-categories-for-batch-by-ean.spec.ts` | Plugin — util test | Unit spec — happy / no-EAN / no-match / multi-match / partial-failure / cache hit / concurrency cap |
| `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | Plugin — adapter | Adds `EanCategoryMatcher` to `implements` list + 5-line delegate method |
| `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` | Plugin — adapter test | Adds one suite verifying the adapter delegates with the right args (cache + http client + connectionId-bound cache prefix) |

---

## 2. Capability port shape

### 2.1 `EanMatchResult` discriminated union

```ts
// libs/core/src/listings/domain/types/ean-category-match.types.ts

/**
 * Runtime array of the per-EAN outcome discriminants. Required by
 * `engineering-standards.md § Union Types: as const Pattern` — even for
 * unions that don't cross HTTP/DB today, the runtime array is what makes
 * future validation, `@IsIn` decorators, and Swagger schemas work without
 * a refactor.
 */
export const EanMatchResultKindValues = [
  'matched',
  'multi-match',
  'no-ean',
  'no-match',
] as const;

export type EanMatchResultKind = (typeof EanMatchResultKindValues)[number];

/**
 * Per-EAN outcome of a batch category match call.
 *
 * - `matched`: unique product card found in Allegro's catalogue with this EAN;
 *   `allegroCategoryId` is the category-id reported on that card, ready to
 *   pre-fill the review-table row. `productCardId` is the Allegro
 *   product-card UUID — passed through to `productSet[0].product.id` at
 *   offer-create time so the offer smart-links to the catalogue card.
 * - `multi-match`: more than one product card matched the EAN (rare but
 *   real — duplicate cards exist on Allegro's catalogue). Caller MUST surface
 *   candidate selection UX (#740). Ordering preserves Allegro's relevance
 *   ranking — top candidate first.
 * - `no-ean`: the variant has no EAN — caller must fall back to manual
 *   category pick.
 * - `no-match`: Allegro returned zero exact matches for this EAN.
 */
export type EanMatchResult =
  | { kind: 'matched'; allegroCategoryId: string; productCardId: string }
  | { kind: 'multi-match'; candidates: EanMatchCandidate[] }
  | { kind: 'no-ean' }
  | { kind: 'no-match' };

export interface EanMatchCandidate {
  allegroCategoryId: string;
  productCardId: string;
  /** Display name from Allegro for the review-table candidate picker. */
  name?: string;
}

export interface BatchCategoryByEanInput {
  items: Array<{ variantId: string; ean: string | null }>;
}
```

### 2.2 Capability port

```ts
// libs/core/src/listings/domain/ports/capabilities/ean-category-matcher.capability.ts

import type { OfferManagerPort } from '../offer-manager.port';
import type {
  BatchCategoryByEanInput,
  EanMatchResult,
} from '../../types/ean-category-match.types';

export interface EanCategoryMatcher {
  /**
   * Resolve Allegro categories for N variant EANs in one batch. Variants
   * without an EAN return `{ kind: 'no-ean' }` without making any HTTP
   * call. Per-EAN HTTP failures collapse to `{ kind: 'no-match' }` — the
   * batch never aborts on per-item failure (mirrors the #431 primitive's
   * no-throw contract). The returned map is keyed by `variantId`.
   *
   * Adapters that implement this declare
   * `implements OfferManagerPort, EanCategoryMatcher`. Call sites
   * narrow via `isEanCategoryMatcher(adapter)`.
   */
  resolveCategoriesForBatchByEan(
    input: BatchCategoryByEanInput,
  ): Promise<Map<string, EanMatchResult>>;
}

export function isEanCategoryMatcher(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & EanCategoryMatcher {
  return (
    typeof (adapter as Partial<EanCategoryMatcher>).resolveCategoriesForBatchByEan ===
    'function'
  );
}
```

**Naming-collision note.** A `CategoryBarcodeMatcher` sub-capability already exists (`matchCategoryByBarcode(barcode): Promise<string | null>`) — single barcode, simple return. The new `EanCategoryMatcher` is the batch sibling with a richer per-item envelope. Different shapes, different consumers (single-offer wizard vs bulk review table). Both can coexist on the adapter; #740 picks based on which path it's rendering.

---

## 3. Util implementation

### 3.1 File layout

`libs/integrations/allegro/src/infrastructure/util/resolve-categories-for-batch-by-ean.ts` — pure function, mirrors the `resolveAllegroProductCardByEan` (#431) layout. The adapter method is a 5-line delegate.

### 3.2 Function signature

```ts
export async function resolveCategoriesForBatchByEan(
  httpClient: IAllegroHttpClient,
  cache: CachePort | undefined,
  connectionId: string,
  input: BatchCategoryByEanInput,
  options?: ResolveCategoriesForBatchByEanOptions,
): Promise<Map<string, EanMatchResult>>
```

`connectionId` is a parameter (not closed over) so the util stays a pure function. The adapter passes its `this.connectionId`.

### 3.3 Options (with defaults)

```ts
export interface ResolveCategoriesForBatchByEanOptions {
  /** Default 24h. Matches the #431 precedent + spec § 4.5. */
  cacheTtlSec?: number;
  /** Cache-key prefix. Default `'allegro:ean-match'`. */
  cacheKeyPrefix?: string;
  /**
   * In-flight concurrency cap. Default **3**. At Allegro's typical 200-500ms
   * per-call latency this lands at 6-15 req/sec, straddling the spec's
   * 5-10 req/sec target. Higher values are tolerated by `AllegroHttpClient`'s
   * `Retry-After`-aware 429 backoff — see § 3.5.
   */
  concurrency?: number;
  /** Allegro `/sale/products?limit=` cap. Default 10 (mirrors #431). */
  searchLimit?: number;
}
```

### 3.4 Algorithm

```
input.items.forEach(item):
  if (item.ean === null):
    result.set(item.variantId, { kind: 'no-ean' })   // free path, no HTTP, no cache
  else:
    enqueue for HTTP resolution

throttle-process(enqueued items, concurrency):
  per item:
    1. cache.get(`allegro:ean-match:{connectionId}:{ean}`)
       hit + matched → return cached { kind: 'matched', allegroCategoryId, productCardId }
       hit + no-match → return cached { kind: 'no-match' }
       (multi-match never cached, see § 4.2)
       miss → fall through

    2. httpClient.get('/sale/products', { phrase: ean, mode: 'GTIN', limit: 10 })
       on HTTP failure → return { kind: 'no-match' } (no-throw, no-cache; matches #431)

    3. extract response.data.products[]
       filter: only items where the EAN-bearing parameter equals input.ean
       (defensive — Allegro's GTIN-mode search SHOULD return exact, but
        belt-and-suspenders against fuzzy-match drift)

    4. case length:
         0 → cache + return { kind: 'no-match' }
         1 → cache + return { kind: 'matched',
                              allegroCategoryId: items[0].category.id,
                              productCardId: items[0].id }
         ≥2 → return { kind: 'multi-match', candidates: items.map(toCandidate) }
              (do NOT cache — #431 precedent)

return result Map
```

**EAN extraction from response.** `BaseSaleProductResponseDto.parameters` may include the EAN-bearing parameter (`options.isGTIN === true` per the existing `AllegroProductDtoParameter` shape). The filter logic walks `parameters[]` for the GTIN parameter and matches its value. The current `AllegroProductCardSummary` type at `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` declares only `{ id, name?, ean? }` — that type is incomplete vs the Allegro swagger; we widen it as part of this slice (see § 5.1).

### 3.5 Concurrency: chunked `Promise.allSettled`

```ts
async function throttleProcess<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const settled = await Promise.allSettled(chunk.map(fn));
    for (const s of settled) {
      // fn never throws — per-item failure is already mapped to no-match
      // inside `fn`. But Promise.allSettled keeps the batch boundary safe
      // even against bugs in fn.
      if (s.status === 'fulfilled') results.push(s.value);
    }
  }
  return results;
}
```

**Default concurrency = 3.** Throughput is `concurrency / latency`, not a flat req/sec. At Allegro's p50 of 200-500ms, concurrency=3 produces 6-15 req/sec — straddles the spec's 5-10 target. Concurrency=8 (the original draft) would yield 16-40 req/sec on the fast-path; while `AllegroHttpClient` absorbs the resulting 429s via `Retry-After`-aware backoff, deliberately staying under the rate-limit ceiling is cheaper than relying on the backpressure net. Operators can tune via the `concurrency` option without a code change.

**Why not `p-limit`.** One new transitive dep, plus a streaming model that obscures the batch-boundary `await` for tests. Chunked `allSettled` is 10 lines, no dep, easier to reason about and to mock in specs.

---

## 4. Caching

### 4.1 Key shape

`allegro:ean-match:{connectionId}:{ean}` — connection-scoped (one Allegro seller's product-card universe is independent of another's, even for the same EAN, because cards are seller-agnostic but the GTIN-mode search is account-token-scoped and could in principle return seller-specific eligibility).

### 4.2 Cache discriminant — separates two distinct no-match paths

| Outcome | Cached? | Why |
|---|---|---|
| `matched` (unique) | ✅ Yes (24h) | Stable: once Allegro publishes a card, its category rarely changes |
| `no-match` from a successful 200 with zero exact-EAN hits | ✅ Yes (24h) | Stable in the negative direction; cards take time to land |
| `no-match` collapsed from an HTTP failure (network, 5xx, etc.) | ❌ No | Allows retry on the next call — the EAN may legitimately match once Allegro is reachable again. Matches #431 |
| `multi-match` | ❌ No | Operators may resolve duplicates manually on Allegro's side or a duplicate card may merge — re-evaluating cheaply on the next attempt is correct |
| `no-ean` | N/A | Free path — never makes a cache call |

### 4.3 Cache-failure tolerance — defensive wrap required

**Verified during plan revision**: `RedisCacheAdapter` (`libs/shared/src/cache/redis-cache.adapter.ts`) does NOT swallow Redis connection errors — only JSON parse errors at line 25-31. `client.get()` and `client.set()` failures propagate to the caller. This means the util MUST defensively wrap both `cache.get` and `cache.set` so a Redis outage doesn't take down a batch.

Pattern (in the util):
```ts
let cached: CachedOutcome | null = null;
try {
  cached = await cache.get<CachedOutcome>(cacheKey);
} catch (err) {
  // Log + fall through to HTTP path. Cache outage must not fail the batch.
  this.logger.warn(`Cache get failed for ${cacheKey}: ${msg(err)}`);
}
// ... HTTP path ...
try {
  await cache.set<CachedOutcome>(cacheKey, outcome, ttl);
} catch (err) {
  this.logger.warn(`Cache set failed for ${cacheKey}: ${msg(err)}`);
}
```

**Pre-existing inconsistency** (out of scope for #735, flagged as follow-up): #431's `resolveAllegroProductCardByEan` does NOT wrap `cache.get`/`cache.set` defensively — meaning a Redis outage there would propagate up through the OfferManagerAdapter and fail offer creation. Worth a tracking issue after this PR lands.

---

## 5. Type-system gaps to widen

### 5.1 `AllegroProductCardSummary`

Current declaration at `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:595-603`:

```ts
export interface AllegroProductCardSummary {
  id: string;
  name?: string;
  ean?: string;  // ← undocumented; may not exist on actual responses
}
```

Allegro's swagger `BaseSaleProductResponseDto` actually returns:

```yaml
required: [id, name, category]
properties:
  id: string
  name: string
  description: …
  category: ProductCategoryWithPath  # { id: string, path: ... }
  images: …
  parameters: ProductParameterDto[]  # contains the EAN-bearing parameter
  …
```

This slice widens the type to model `category.id` (the field we now read) and keeps the existing optional fields untouched. Existing #431 callers continue to work — they read `p.ean` which remains optional on the widened type. (Whether `p.ean` is actually populated by Allegro at the top level is a separate question — out of scope for #735; the new util reads `parameters[].options.isGTIN` instead.)

Concretely:

```ts
export interface AllegroProductCardSummary {
  id: string;
  name?: string;
  ean?: string;  // pre-existing; documented-undocumented
  category?: { id: string };  // new; matches swagger (path field omitted — unread)
  parameters?: AllegroProductDtoParameter[];  // new; matches swagger
}
```

`parameters` reuses the existing `AllegroProductDtoParameter` type. `category.path` is **omitted** rather than typed as `unknown` — the swagger fully documents the shape (`ProductCategoryWithPath`), but the util doesn't read it; widening only what's actually consumed keeps the surface narrow. A future reader who needs `path` adds it then.

---

## 6. Adapter wiring

### 6.1 `AllegroOfferManagerAdapter`

Three edits:
1. Add `EanCategoryMatcher` to the `implements` list (alphabetically near `CategoryBarcodeMatcher`).
2. Add the import.
3. Add the 5-line delegate method:

```ts
async resolveCategoriesForBatchByEan(
  input: BatchCategoryByEanInput,
): Promise<Map<string, EanMatchResult>> {
  return resolveCategoriesForBatchByEan(
    this.httpClient,
    this.cache,
    this.connectionId,
    input,
  );
}
```

### 6.2 Core barrel

`libs/core/src/listings/index.ts` adds four exports near the existing capability group (after `CategoryBarcodeMatcher`). The capability + type guard + the runtime `EanMatchResultKindValues` array land on the **existing** top-level `@openlinker/core/listings` barrel — no new sub-barrel:

```ts
export type { EanCategoryMatcher } from './domain/ports/capabilities/ean-category-matcher.capability';
export { isEanCategoryMatcher } from './domain/ports/capabilities/ean-category-matcher.capability';
export { EanMatchResultKindValues } from './domain/types/ean-category-match.types';
export type {
  EanMatchResultKind,
  EanMatchResult,
  EanMatchCandidate,
  BatchCategoryByEanInput,
} from './domain/types/ean-category-match.types';
```

### 6.3 No new tokens, no module changes

Capability is discovered at runtime via the type guard. `AllegroOfferManagerAdapter` is already registered with its `OfferManager` capability key — no plugin-descriptor edit needed.

---

## 7. Tests

### 7.1 Util unit spec — `resolve-categories-for-batch-by-ean.spec.ts`

Mirrors the #431 spec layout. Mocks `IAllegroHttpClient` + `CachePort` inline (no shared fixture per Allegro plugin convention).

Required cases (all AC-tagged in the issue):

| # | Case | Coverage |
|---|---|---|
| 1 | Happy: 3 items, all unique-matched, no cache | All `matched`, HTTP called 3x, cache `set` called 3x |
| 2 | No-EAN — `ean: null` | `no-ean` returned, HTTP NOT called for that item |
| 3 | No-EAN — empty / whitespace string (`ean: ''`, `'   '`) | Treated identically to `null` → `no-ean`; HTTP NOT called |
| 4 | No-match: 200 with empty `response.data.products` | `no-match` returned + cached |
| 5 | Multi-match: 2+ exact-EAN candidates | `multi-match` with candidates in response order; cache `set` NOT called |
| 6 | Cache hit (matched): cache returns `{kind: 'matched', …}` | Returned from cache; HTTP NOT called |
| 7 | Cache hit (no-match): cache returns `{kind: 'no-match'}` | Returned from cache; HTTP NOT called |
| 8 | HTTP failure: per-item throws `AllegroApiException` | That item becomes `no-match`; batch continues; **cache `set` NOT called for the failed item** (separates failure path from genuine no-match per § 4.2) |
| 9 | Malformed response: 200 with `response.data.products` missing/non-array | `no-match` (defensive `Array.isArray` guard); does NOT crash |
| 10 | Cache `get` throws (Redis down) | Falls through to HTTP path; logs warning; result still returned correctly |
| 11 | Cache `set` throws (Redis down) | HTTP path completed normally; logs warning; result still returned correctly |
| 12 | Concurrency cap: 16 items with cap=4 → 4 chunks of 4 (via `Promise.allSettled` ordering observation) | Throttle correctness |
| 13 | `mode=GTIN` query param passed on the search call | Spec-correctness vs Allegro API |
| 14 | Empty input: zero items | Returns empty Map; no HTTP, no cache |

### 7.2 Adapter spec — `allegro-offer-manager.adapter.spec.ts` (additive)

One small suite (`describe('resolveCategoriesForBatchByEan')`):
- One test: adapter forwards `(httpClient, cache, connectionId, input)` to the util. Mock the util by `jest.mock(...)` at module top.

No need to duplicate util coverage on the adapter; the delegate is 5 lines.

### 7.3 No integration tests

Integration tests use Testcontainers (Postgres + Redis). This slice adds zero schema; the HTTP path is entirely mocked. Unit specs suffice per `docs/testing-guide.md § Integration tests` ("Focus on critical paths").

---

## 8. Implementation steps (ordered)

| # | Step | File(s) | AC |
|---|---|---|---|
| 1 | Widen `AllegroProductCardSummary` to include `category?: { id }` + `parameters?: AllegroProductDtoParameter[]` | `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` | Type compiles; existing #431 spec still passes |
| 2 | Add `EanMatchResultKindValues` (`as const`) + `EanMatchResultKind` + `EanMatchResult` + `EanMatchCandidate` + `BatchCategoryByEanInput` | `libs/core/src/listings/domain/types/ean-category-match.types.ts` (new) | Type-only file, no framework deps |
| 3 | Add `EanCategoryMatcher` capability + `isEanCategoryMatcher` guard | `libs/core/src/listings/domain/ports/capabilities/ean-category-matcher.capability.ts` (new) | Mirrors `CategoryBarcodeMatcher` shape |
| 4 | Add 4 barrel re-exports (one is the runtime `EanMatchResultKindValues` array) | `libs/core/src/listings/index.ts` | type + value imports work from `@openlinker/core/listings` |
| 5 | Write `resolveCategoriesForBatchByEan` util + options type | `libs/integrations/allegro/src/infrastructure/util/resolve-categories-for-batch-by-ean.ts` (new) + `.types.ts` (new) | Pure function, ≤150 LOC body (incl. defensive cache wraps + concurrency helper) |
| 6 | Wire `EanCategoryMatcher` into `AllegroOfferManagerAdapter` (implements + import + delegate method) | `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts` | 5-line method body |
| 7 | Write util unit spec (14 cases per § 7.1) | `libs/integrations/allegro/src/infrastructure/util/__tests__/resolve-categories-for-batch-by-ean.spec.ts` (new) | All cases green |
| 8 | Write adapter delegate spec (1 case per § 7.2) | `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts` (additive) | Green |
| 9 | Quality gate: `pnpm lint && pnpm type-check && pnpm test` | — | 0 errors, all green |

---

## 9. Decisions locked

| # | Decision | Source | Why |
|---|---|---|---|
| 1 | **Exposure model: sub-capability port** (`EanCategoryMatcher`) on `OfferManagerPort` | grill-me Q1 | Matches #337 pattern uniformly; no new architectural precedent; #736 reaches via standard `IntegrationsService.getCapabilityAdapter` + capability guard |
| 2 | **Defer `suggestedParams`** to #740 edit modal | grill-me Q2 | Keeps the port surface narrow; #740 is the actual consumer of parameter pre-fill |
| 3 | **Throttling: chunked `Promise.allSettled` with cap=3 default** | tech-review correction | At Allegro's 200-500ms p50, concurrency=3 yields 6-15 req/sec — straddles the spec's 5-10 target. Higher caps (originally 8) would land at 16-40 req/sec on the fast-path, requiring 429-backoff backpressure to avoid rate-limit penalties. Operators tune via the `concurrency` option |
| 4 | **Input: pre-resolved EANs from caller** (`Array<{ variantId, ean: string \| null }>`) | user pick | Keeps Allegro plugin's deps narrow; caller (#736) already has variants in memory |
| 5 | **`mode=GTIN` query param** on the search call | added during plan | Tighter than fuzzy-phrase; the search endpoint explicitly supports it; reduces false positives |
| 6 | **Widen `AllegroProductCardSummary`** instead of writing a parallel summary type — add `category.id` + `parameters[]`, omit `category.path` (unread) | added during plan | The existing type is incomplete vs swagger; widening fixes a latent bug + keeps one source of truth; the omitted `path` field can be added when a reader needs it |
| 7 | **Cache `matched` + response-`no-match`, never `multi-match` or HTTP-failure-`no-match`** | #431 precedent | Matches sibling primitive; HTTP failures must remain retriable on the next call |
| 8 | **Ship `EanMatchResultKindValues` runtime array** alongside the discriminated union | engineering-standards.md § Union Types: as const Pattern (Default) | The standard marks "inline union without runtime array" as ❌ Bad without an in-process carve-out — the runtime array future-proofs validation and Swagger consumers (#736's response DTO) without a refactor |
| 9 | **Util in `infrastructure/util/`, adapter is a 5-line delegate** | #431 precedent | Same pattern; keeps stateful HTTP logic out of the adapter class; makes the util independently testable |
| 10 | **Defensive try/catch around `cache.get` and `cache.set`** | verified `RedisCacheAdapter` source | The Redis adapter only swallows JSON-parse errors at line 25-31, not connection errors. A Redis outage would otherwise abort the batch. Wrap defensively + log; do NOT propagate. Pre-existing in #431 — flagged as follow-up |
| 11 | **Treat empty / whitespace EAN as `no-ean`** | added during plan | A caller may pass `ean: ''` rather than `null` for a missing EAN. Both should collapse to `no-ean` — sending an empty `phrase` to Allegro produces undefined results and burns rate-limit |

### 9.5 Decision revisited after schema discovery

Q2 (defer `suggestedParams`) was decided on the assumption that populating `suggestedParams` would require a second `GET /sale/products/{id}` call per match. **Swagger verification (during plan-writing) found that `parameters` IS already returned on each `/sale/products` search item.** So the API-cost argument doesn't hold.

The other rationales for deferral still hold:
- The port shape stays narrow (`{ allegroCategoryId, productCardId }` is two fields, well-typed).
- The consumer for `suggestedParams` is #740, not #736.
- Adding a heterogeneous parameters record now would burden every downstream caller with a field most ignore.

**Action**: shipping with deferral as decided. If you'd rather override and include `suggestedParams` in v1 now that we know it's free at the API level, flag during plan review — adding the field is a 10-line change to the type + the util's `matched` branch; the AC coverage in § 7.1 expands by 1 case.

---

## 10. Residual risks

- **`AllegroProductCardSummary.ean` filter in #431 may be broken.** The existing primitive does `p.ean === input.ean`, but `ean` isn't a documented top-level field on the swagger schema (it's nested inside `parameters[].values[]` under the GTIN-marked parameter). If Allegro's response doesn't include a top-level `ean`, the existing primitive silently always falls through to `no_match`. **Out of scope for #735** — flag as a follow-up if the integration-test layer surfaces it. The new util reads `parameters[]` directly, sidestepping the question.
- **Concurrency cap of 3 + 50-EAN batch + cold cache = ~17 sequential chunks.** At 500ms median per call (Allegro p50), that's ~8.5s wall-clock — inside the 15s AC. At a degraded p99 of 2s + occasional 429 backoff, the worst-case heads toward 35s and breaches the AC. Mitigation lever is the `concurrency` option (knob, not code change); under load operators can bump to 5-6 trading some 429s for parallelism. No proactive tuning needed in v1 — wait for real-world data.
- **`mode=GTIN` is a behavioural shift from #431.** The existing primitive uses phrase-only search and post-filters by `p.ean`. The new util uses `mode=GTIN` for tighter matching. If Allegro's GTIN-mode search has a quirk (e.g. doesn't return some legitimate cards because of metadata gaps), we'd see false `no-match` results. The defensive `parameters[].options.isGTIN` re-filter in the algorithm guards against the worst case but can't fabricate missing entries. Low-probability risk; flag during integration testing of #740.
- **Type widening affects callers.** Adding `category?` + `parameters?` to `AllegroProductCardSummary` is structurally compatible (both optional), but any existing caller that destructured the type expecting closure may need a fresh look. Spot-check: only `resolveAllegroProductCardByEan` (#431) consumes the type today, and its filter logic doesn't touch the new fields.
- **#431 lacks defensive cache-error wrapping.** The pre-existing `resolveAllegroProductCardByEan` calls `cache.get` / `cache.set` without try/catch, so a Redis outage propagates up through `AllegroOfferManagerAdapter.createOffer` and fails offer creation. The new util in this PR wraps defensively (§ 4.3). Worth filing a follow-up to apply the same wrap to #431.

---

## 11. After this PR

- #736 (bulk submission service + HTTP API) — consumes the new capability via `IntegrationsService.getCapabilityAdapter<OfferManagerPort>(...)` + `isEanCategoryMatcher(adapter)` guard.
- #740 (FE review table + edit modal) — fetches detail-on-modal-open to populate `suggestedParams` in the edit form; lazy pattern keeps the bulk-flow lightweight.
- #735 explicitly does NOT create a follow-up issue for the `AllegroProductCardSummary.ean` filter quirk in #431 — flag it during this PR's review if anyone wants to chase it.
