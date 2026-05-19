# Implementation Plan — #794 Allegro `matchCategoryByBarcode` endpoint fix

## Phase 1 — Understand the task

**Goal.** Fix `AllegroOfferManagerAdapter.matchCategoryByBarcode` to use the correct Allegro endpoint for EAN → category resolution. The current implementation calls `/sale/matching-categories?ean=<barcode>`, which Allegro rejects with HTTP 400 — `name` is the required query parameter on that endpoint, not `ean`. The adapter's `try/catch` swallows the 400 and returns `null`, so the failure is silent at the application layer but the bulk-create wizard's Resolve step shows every EAN-bearing row as "manual category required".

**Layer.** Integration (Allegro plugin). No domain or port changes.

**Non-goals.**
- Wiring the wizard's Resolve step through the batch capability (`EanCategoryMatcher.resolveCategoriesForBatchByEan`) — that's #795, which lands separately.
- Re-architecting `CategoryResolutionService` — its contract is unchanged, only the underlying HTTP call.
- Removing or renaming the `CategoryBarcodeMatcher` capability — still meaningful as the single-EAN entry point.
- Surfacing 400s as exceptions to operators — current swallow-to-null behaviour is correct post-fix because the endpoint won't 400.
- Adding `EanCategoryMatcher` to non-Allegro adapters.

## Phase 2 — Research

**Existing patterns.** The correct endpoint and matching logic already live in `libs/integrations/allegro/src/infrastructure/util/resolve-categories-for-batch-by-ean.ts` (#735). The batch util:
- Calls `GET /sale/products?phrase={ean}&mode=GTIN&limit={N}` per item.
- Filters results to those carrying an exact GTIN-marked parameter matching the input EAN.
- Collapses to one of three `EanMatchResult` discriminants: `matched`, `no-match`, `multi-match` (plus `no-ean` for invalid input).
- Caches successful matches and authoritative empty results for 24 h under `allegro:ean-match:{connectionId}:{ean}`.
- HTTP failures collapse to `no-match` and are NOT cached.

**Reuse strategy.** The single-EAN `matchCategoryByBarcode` method should delegate to the same util. The contract of `CategoryBarcodeMatcher.matchCategoryByBarcode(barcode): Promise<string | null>` is narrower than `EanMatchResult`:

| `EanMatchResult.kind` | Single-call return |
|---|---|
| `matched` | `result.allegroCategoryId` |
| `no-match` / `no-ean` / `multi-match` | `null` |

Multi-match collapse to `null` preserves the previous single-call semantics (the broken implementation returned `null` for `matches.length > 1`).

**Dead type to delete.** `AllegroMatchingCategoriesResponse` in `libs/integrations/allegro/src/domain/types/allegro-api.types.ts` is only referenced by the broken adapter call site. After the fix it's dead.

**FE comment drift.** Two FE files reference `/sale/matching-categories` in comments:
- `apps/web/src/features/listings/lib/bulk-throttle.ts:6`
- `apps/web/src/features/listings/hooks/use-resolve-category-query.ts:9,23`

These were written when the broken endpoint was thought to be canonical. The accompanying behaviours (concurrency cap, stale time) still apply — only the endpoint name in the comment is wrong.

## Phase 3 — Design

**Approach.** Delegate the single-call path to `resolveCategoriesForBatchByEan` with a one-item batch. Two-line implementation, single source of truth for the Allegro call + cache + matching logic.

Rejected alternative: extracting `resolveOne` from the batch util into a sibling `resolve-category-by-ean.ts` helper. Pros: cleaner separation, no batch-Map overhead. Cons: ~80 lines moved, two files to maintain in lockstep, two test files updated. The "overhead" is microseconds — constructing a single-entry Map. Not worth the refactor surface area for a tightly-scoped bug fix.

**Data flow (single-call path after fix):**

```
CategoryResolutionService.resolveCategory(connectionId, { barcode })
  → marketplace.matchCategoryByBarcode(barcode)
     → resolveCategoriesForBatchByEan(httpClient, cache, connectionId, { items: [{ variantId: 'single', ean: barcode }] })
        → cache.get('allegro:ean-match:{conn}:{ean}')  (hit-return-on-cache)
        → httpClient.get('/sale/products?phrase={ean}&mode=GTIN&limit=10')
        → filter by hasExactGtin(card, ean)
        → return EanMatchResult
     → collapse to string | null
```

Cache key prefix and TTL are inherited from the batch util's defaults — same `allegro:ean-match:{connectionId}:{ean}` namespace, so a single-call match populates the cache for the next batch call and vice versa.

**Backwards compatibility.** `CategoryBarcodeMatcher` interface is unchanged. Callers (`CategoryResolutionService.resolveCategory`) keep their existing contract. Existing tests of the service-level behaviour need no changes.

## Phase 4 — Step-by-step plan

### Step 1 — Rewrite `matchCategoryByBarcode`

**File:** `libs/integrations/allegro/src/infrastructure/adapters/allegro-offer-manager.adapter.ts`

- Remove the import of `AllegroMatchingCategoriesResponse` from `../../domain/types/allegro-api.types`.
- Replace the body of `matchCategoryByBarcode(barcode: string): Promise<string | null>` with a delegation:

```ts
async matchCategoryByBarcode(barcode: string): Promise<string | null> {
  const results = await resolveCategoriesForBatchByEan(
    this.httpClient, this.cache, this.connectionId,
    { items: [{ variantId: SINGLE_ITEM_KEY, ean: barcode }] },
  );
  const outcome = results.get(SINGLE_ITEM_KEY);
  return outcome?.kind === 'matched' ? outcome.allegroCategoryId : null;
}
```

`SINGLE_ITEM_KEY` is a private module constant — any stable string works because the result map is consumed by exactly one read in the same call.

**Acceptance:** the method calls the batch util once and returns the matched categoryId or `null` for every other outcome kind. No HTTP call to `/sale/matching-categories` anywhere in the codebase.

### Step 2 — Delete the dead response type

**File:** `libs/integrations/allegro/src/domain/types/allegro-api.types.ts`

- Delete `AllegroMatchingCategoriesResponse` interface and its surrounding doc comment at lines ~486-495.
- `pnpm type-check` must remain green — the only consumer was the adapter import removed in Step 1.

**Acceptance:** `grep -r "AllegroMatchingCategoriesResponse"` in the repo returns zero results.

### Step 3 — Update adapter unit specs

**File:** `libs/integrations/allegro/src/infrastructure/adapters/__tests__/allegro-offer-manager.adapter.spec.ts`

Update the four cases under `describe('matchCategoryByBarcode')` (lines 714-765):

1. **Single match** — mock `httpClient.get` with a `/sale/products` response whose `products[0].parameters` carries `options.isGTIN: true` and the matching `values: ['<ean>']`, plus `category.id: 'cat-100'`. Assert the returned value is `'cat-100'` and the call shape is:
   ```ts
   expect(httpClient.get).toHaveBeenCalledWith('/sale/products', {
     queryParams: { phrase: '5901234123457', mode: 'GTIN', limit: 10 },
   });
   ```
2. **No match** — empty products array → null.
3. **Multi-match** — two products each with `isGTIN` parameters matching the EAN → null (preserves the previous single-call collapse).
4. **HTTP failure** — `httpClient.get.mockRejectedValue(...)` → null.

**Acceptance:** `pnpm test --filter @openlinker/integrations-allegro -- allegro-offer-manager` passes; the existing four cases keep their behavioural shape with the new endpoint contract.

### Step 4 — FE comment cleanup

**Files:**
- `apps/web/src/features/listings/lib/bulk-throttle.ts:6`
- `apps/web/src/features/listings/hooks/use-resolve-category-query.ts:9,23`

Replace mentions of `/sale/matching-categories` with `/sale/products` in three doc-comment locations. No behaviour change — only the endpoint name in prose. The accompanying concurrency-cap and stale-time rationale remains correct.

**Acceptance:** No misleading endpoint references remain in FE comments.

### Step 5 — Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
```

All three must pass with zero errors. No integration tests touched (no schema or persistence changes).

## Phase 5 — Validate

**Architecture compliance.**
- Adapter remains in `libs/integrations/allegro/src/infrastructure/adapters/`.
- Delegates to a sibling util in the same package — no cross-context import added.
- Capability contract (`CategoryBarcodeMatcher.matchCategoryByBarcode`) unchanged.

**Naming.** No new files; no new symbols at the public surface.

**Testing strategy.**
- Unit tests cover the four observable branches at the adapter boundary.
- The batch util's existing specs cover cache + multi-match + HTTP-failure semantics — no duplication.

**Security.** No new external inputs, no new HTTP shape. Same auth headers as the existing batch path. EAN is a numeric string at the persistence layer; the batch util normalises with `.trim()`. No injection vector.

**Performance.** Single-call path now incurs the batch util's per-call overhead — one `Map<string, EanMatchResult>` construction, one iteration of a single-element array. Negligible. Cache hit rate improves because the single-call and batch-call paths share the same key namespace.

**Risks.**
- Allegro's `/sale/products` response shape under `mode=GTIN` is already exercised by the batch util in production. No new contract to validate against `developer.allegro.pl`.
- The single-call path is currently only invoked from `CategoryResolutionService.resolveCategory`, which the bulk wizard hits per row. After fix, those calls will return real matches — the FE may need to handle the matched case differently than before (it already does, per `bulk-resolve-step.tsx:118-122`).
- `multi-match` collapses to `null` in the single-call path. This is the same behaviour as before the fix (the broken implementation also collapsed multi-match → null). Preserves contract.

**Open questions.** None.
