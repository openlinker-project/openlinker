# Implementation Plan — Bulk `needs-product-parameters` review blocker (#810)

## 1. Understand the task

**Goal.** Stop bulk-offer rows from silently 422-ing on Allegro when they will create a product **inline** (no catalogue card to inherit from) under a category that has **required product-section parameters** (Marka, Model, EAN, …) that the operator has not supplied. Surface the condition as a **pre-submit review blocker** instead of a post-submit per-record failure.

**Layer.** Frontend only (`apps/web`, `features/listings`). No CORE / Integration / API change — the `GET /listings/connections/:connectionId/categories/:categoryId/parameters` endpoint already returns each parameter's `required` and `section` (`'offer' | 'product'`).

**Explicit non-goals.**
- No new BE endpoint or resolve-batch contract change.
- No change to the worker / adapter create path (#806 keeps surfacing the post-submit detail as a backstop).
- Not building a *new* product-parameter form — the bulk **edit modal already collects product-section params** (`bulk-edit-modal.tsx`, #740: `CategoryParametersStep` + `serializeAllegroParameters` → `platformParams.productParameters`). The blocker simply routes the operator back into that existing modal.

### Corrected premise (vs the issue text)

The issue assumed "the bulk wizard has no per-row product-parameter form." It does (#740). The real gap is two-fold:
1. The edit modal does **not** hard-block save when required params are missing (it explicitly allows save: *"the worker may reject"* — `bulk-edit-modal.tsx:430`).
2. `computeBlockers` **clears** the category blocker the instant `override.categoryId` is set (`bulk-policy.ts:137`), so a row where the operator picked a category but skipped the required product params shows **"ready"** and enters the submit gate → 422.

So the blocker's remedy is **"edit the row to add the required product parameters"**, not "create individually."

### Why detection must be FE-side (rejecting Option 2)

The BE batch-resolve (`resolveCategoriesForBatchByEan`) only ever yields a category **together with** a card (`matched`, or `multi-match` candidates each carrying `productCardId`). The "category without a card" state is created **exclusively by FE operator overrides** the BE never sees. Therefore a BE `requiresProductParameters` flag (issue Option 2) cannot detect the primary case. Option 3 (accept-and-route on the worker 422) is the explicit non-goal of the issue ("operator only finds out *after* submit"). **Option 1 (FE detection, reusing the existing category-parameters query) is the only option that meets the pre-submit AC.**

## 2. Research findings (anchors)

| Concern | Location |
|---|---|
| Blocker union | `bulk-wizard.types.ts:31` `BulkRowBlockerValues` |
| Blocker computation (pure) | `bulk-policy.ts:131` `computeBlockers` / `:109` `ComputeBlockersInput` |
| Card-link selector (#808) | `bulk-wizard.tsx` `selectBulkProductCardId(row)` (exported) |
| Blockers recomputed | `bulk-resolve-step.tsx:121` `buildOutcomes`; `bulk-wizard.tsx:99` `handleUpdateRow` |
| Submit gate | `bulk-wizard.tsx:128` `submittable`, `:206` `readyCount` |
| Review readiness gate | `bulk-review-step.tsx:88` `canApprove`, `:306` `countByReadiness` |
| Blocker chip labels | `bulk-review-step.tsx:54` `BLOCKER_CHIPS` |
| Category params query | `hooks/use-category-parameters-query.ts:22` (24 h cache) |
| Param type (`required`, `section`) | `api/listings.types.ts:307` `CategoryParameter` |
| Serialized product-param shape | `serialize-allegro-parameters.ts:45` `AllegroParameterInput { id, values?, valuesIds?, rangeValue? }` |

## 3. Design

### 3.1 Blocker value

Add `'needs-product-parameters'` to `BulkRowBlockerValues` (`bulk-wizard.types.ts`). Co-occurring with the existing model.

### 3.2 Detection (pure, in `computeBlockers`)

Extend `ComputeBlockersInput` with two plain-data fields (keeps the function pure + unit-testable):

```ts
/** Card will be linked on submit (selectBulkProductCardId(row) !== undefined). */
willLinkProductCard: boolean;
/**
 * Required product-section param ids for the row's SUBMIT category, with no
 * `dependsOn` gating. undefined = schema not loaded yet (do not block — avoids
 * flicker / false block while the query is in flight).
 */
requiredProductParamIds: string[] | undefined;
```

Rule appended in `computeBlockers`:

```ts
if (!input.willLinkProductCard && input.requiredProductParamIds?.length) {
  const supplied = new Set(
    (input.override.overrides?.platformParams?.productParameters as
      | { id: string }[]
      | undefined ?? []
    ).map((p) => p.id),
  );
  if (input.requiredProductParamIds.some((id) => !supplied.has(id))) {
    blockers.push('needs-product-parameters');
  }
}
```

- **Clearable**: filling the params in the edit modal writes `platformParams.productParameters`, coverage satisfies, blocker lifts.
- **No false positive on card-linked rows**: `willLinkProductCard` short-circuits (AC).
- **No false positive when the category has no required product params**: `requiredProductParamIds` empty → skip (AC).
- **Conservative on `dependsOn`**: conditional params are excluded from the required set so an inapplicable gated param can never permanently block.

### 3.3 Feeding the schema (async → plain map)

New hook `use-bulk-required-product-params.ts` in `features/listings/hooks/`:

```ts
export function useBulkRequiredProductParams(
  connectionId: string,
  submitCategoryIds: readonly string[], // distinct categories of no-card rows
): { requiredByCategory: Map<string, string[]>; isResolving: boolean }
```

- Uses TanStack `useQueries` over the **existing** `getCategoryParameters` query (same 24 h-cached key — repeats across a batch are cache hits).
- For each category returns the ids of params where `required && section === 'product' && !dependsOn`.
- `isResolving` true while any query is pending → used to gate "Approve all" so the operator can't beat the check.

The wizard derives, per row, `willLinkProductCard = selectBulkProductCardId(row) !== undefined` and the submit category `override.overrides?.categoryId ?? resolvedCategoryId`. Distinct submit-categories of no-card rows feed the hook. The resulting `requiredByCategory.get(submitCategoryId)` is passed into `computeBlockers` at all three recompute sites (resolve `buildOutcomes`, `handleUpdateRow`, and a new recompute when `requiredByCategory` changes).

### 3.4 Review-step surfacing

- `BLOCKER_CHIPS['needs-product-parameters'] = { tone: 'warning', label: 'add product params' }` (`bulk-review-step.tsx:54`).
- The existing per-row "Edit" affordance is the remedy; add a one-line hint in the review summary when `needs-product-parameters` rows exist: *"N row(s) need required product parameters — edit each to add them."* No new routing.
- `countByReadiness` already counts any blocker as `needsAttention`; `canApprove` already gates on it. Add: `canApprove` also requires `!isResolving` (3.3).

### 3.5 Open scope question — multi-match candidate card-threading

Picking a multi-match candidate chip (`bulk-edit-modal.tsx:267`) currently sets **only** `categoryId`, dropping the candidate's `productCardId` — so a resolved multi-match row creates inline and hits this blocker. Two scopes:
- **(A) Blocker-only** — out of scope to thread the card; multi-match rows get blocked → operator fills params. Smallest change.
- **(B) Blocker + thread candidate card** — clicking a candidate also writes `override.overrides.productCardId = candidate.productCardId` (mirrors #808). The row then links the card, inherits params, and never hits the blocker. Small, reuses #808 plumbing, fixes a latent multi-match 422 too.

Recommendation: **(B)** — it's a few lines, removes a whole class of avoidable blocks, and is the same pattern #808 established. Confirm before implementing.

## 4. Step-by-step implementation

1. **`bulk-wizard.types.ts`** — add `'needs-product-parameters'` to `BulkRowBlockerValues` + doc comment. *AC: type compiles; value exported.*
2. **`bulk-policy.ts`** — extend `ComputeBlockersInput` (`willLinkProductCard`, `requiredProductParamIds`); append the rule in §3.2. *AC: pure, no new imports beyond types.*
3. **`hooks/use-bulk-required-product-params.ts`** (new) — `useQueries` fan-out per §3.3. *AC: returns `{ requiredByCategory, isResolving }`; only `required && section==='product' && !dependsOn` ids.*
4. **`bulk-wizard.tsx`** — compute distinct no-card submit-categories; call the hook; thread `willLinkProductCard` + `requiredProductParamIds` into `computeBlockers` at `buildOutcomes`, `handleUpdateRow`, and a new recompute effect on `requiredByCategory` change. *AC: blockers update when schema loads / operator edits.*
5. **`bulk-review-step.tsx`** — `BLOCKER_CHIPS` entry; summary hint; `canApprove &&= !isResolving`. *AC: chip renders; approve disabled while resolving.*
6. **(If scope B)** **`bulk-edit-modal.tsx:267`** — candidate-chip click also sets `productCardId`. *AC: picking a candidate threads its card; row links card, no blocker.*

## 5. Tests

- `bulk-policy.test.ts` — new `computeBlockers` cases: (a) no-card + uncovered required product param → blocker; (b) covered → no blocker; (c) card-linked → no blocker even if params missing; (d) `requiredProductParamIds` undefined → no blocker; (e) category with no required product params → no blocker; (f) `dependsOn` param excluded.
- `use-bulk-required-product-params.test.ts` (new) — filters to `required && product && !dependsOn`; dedupes categories; `isResolving` lifecycle.
- `bulk-review-step.test.tsx` — chip label renders; approve disabled while `isResolving`; summary hint shows.
- `bulk-edit-modal.test.tsx` (scope B) — candidate-chip click writes `productCardId`.
- `bulk-wizard.test.tsx` — integration: a no-card row under a product-param category is blocked pre-submit and excluded from `submittable`; filling params clears it.

## 6. Validate

- **Architecture**: FE-only, dependency direction intact (`features` only); reuses existing query/endpoint; no `shared`→`features` import.
- **State ownership**: server state (schemas) via TanStack Query; blocker is derived, not stored as separate global state.
- **Naming**: `use-*.ts` hook, `*.test.tsx` colocated, kebab files.
- **No false positives**: guarded by `willLinkProductCard` + empty-set + `dependsOn` exclusion (§3.2) — meets the issue's AC.
- **Security**: none touched (read-only schema fetch already authorized).
- **Risk**: brief window where a row reads "ready" before the param query resolves → mitigated by `isResolving` gating "Approve all" and `submittable` recompute.
