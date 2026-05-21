# Implementation Plan — #792 PR 3 + #795: Bulk wizard master-pull policies + batch category resolve

**Issues:** [#792](https://github.com/openlinker-project/openlinker/issues/792) (PR 3 — FE wizard refactor) + [#795](https://github.com/openlinker-project/openlinker/issues/795) (wire `EanCategoryMatcher` batch capability end-to-end)
**Branch:** `792-795-bulk-wizard-master-pull-batch-resolve`
**Base:** `6c1631f` (origin/main — includes #792 PR 1 `ProductVariant.price` + PR 2 batch-availability endpoint)

---

## Phase 1 — Understand the task

### Goal

The bulk Allegro offer-creation wizard's **Resolve step** is being rewritten twice over by two issues that touch the same file (`bulk-resolve-step.tsx`) and the same row-status model. We bundle them into **one** coherent rewrite:

- **#795** — the wizard fires one HTTP `POST /categories/resolve` per row (throttled at concurrency 8). The Allegro adapter already ships a batch capability (`EanCategoryMatcher.resolveCategoriesForBatchByEan`, #735) that does all lookups in one call with shared cache, but **nothing consumes it** — no core service, no HTTP route, no FE caller. Wire it end-to-end: N round-trips → 1.
- **#792 PR 3** — the Config step exposes a single flat *default stock* + *default price* applied to every row, which is wrong for a batch of N different products. Replace with **pricing/stock policies** (`use-master` / `markup`|`cap` / `flat`) that pull each product's master price (`variant.price`, PR 1) and master stock (batch inventory-availability endpoint, PR 2). Widen the single-string row status into a multi-blocker, two-axis state model.

### Layer classification

- **#795:** CORE application service (`CategoryResolutionService` extension) + Interface (HTTP route + DTOs) + Frontend (api client/types/hook).
- **#792 PR 3:** Frontend only (`apps/web/src/features/listings`), consuming PR 1/PR 2 wire shapes already on `main`.

### Non-goals (explicit)

- **No migration** — PR 1 (variant price column) and PR 2 (availability endpoint) already merged with their migrations; this bundle adds no schema change.
- Removing/deprecating the per-row `/categories/resolve` route — single-product offer-create still uses it (#795 out-of-scope).
- Adding `EanCategoryMatcher` to non-Allegro adapters — they degrade to the per-row route until they implement the capability.
- Per-variant pricing for multi-variant products — V1 reads `variants[0]` only.
- Currency conversion — `currency-mismatch` is surfaced as a blocker, no FX.
- `ProductVariantSummaryResponseDto` price — left unchanged.

---

## Phase 2 — Research (key contracts found)

### #795 backend contracts

| Symbol | Location |
|---|---|
| `EanCategoryMatcher` + `isEanCategoryMatcher(adapter)` | `libs/core/src/listings/domain/ports/capabilities/ean-category-matcher.capability.ts` |
| `BatchCategoryByEanInput` = `{ items: Array<{ variantId: string; ean: string \| null }> }` | `libs/core/src/listings/domain/types/ean-category-match.types.ts:70` |
| `EanMatchResult` (union: `matched` / `multi-match` / `no-ean` / `no-match`) | `…/ean-category-match.types.ts:49` |
| `AllegroOfferManagerAdapter.resolveCategoriesForBatchByEan` → `Promise<Map<string, EanMatchResult>>` | `libs/integrations/allegro/.../allegro-offer-manager.adapter.ts:851` |
| `CategoryResolutionService` (single resolve, injects `INTEGRATIONS_SERVICE_TOKEN`) | `libs/core/src/listings/application/services/category-resolution.service.ts` |
| `ICategoryResolutionService` | `libs/core/src/listings/application/interfaces/category-resolution.service.interface.ts` |
| `CATEGORY_RESOLUTION_SERVICE_TOKEN` | `libs/core/src/listings/listings.tokens.ts:21` |
| Single-resolve route `POST connections/:connectionId/categories/resolve` (`@Roles('admin')`) | `apps/api/src/listings/http/listings.controller.ts:448` |
| `AdapterCapabilityNotSupportedException(connectionId, capability)` → mapped to **422** at boundary | `libs/core/src/listings/domain/exceptions/…` ; mapping precedent `bulk-offer-creation.controller.ts:177` |
| Comma/array DTO validation precedent (`@Transform` + `@ArrayMinSize`/`@ArrayMaxSize`) | `apps/api/src/inventory/http/dto/get-inventory-availability-query.dto.ts` |

### #792 PR 3 frontend contracts (PR 1 + PR 2 already on `main`)

| Symbol | Location |
|---|---|
| `ProductVariant.price: number \| null` | `apps/web/src/features/products/api/products.types.ts:28` |
| `Product.currency: string \| null` | `apps/web/src/features/products/api/products.types.ts:40` |
| `useInventoryAvailabilityBatchQuery(ids, opts?)` (dedupes, auto-disables on empty) | `apps/web/src/features/inventory/hooks/use-inventory-availability-batch-query.ts`, exported from `features/inventory/index.ts` |
| `InventoryAvailability = { productVariantId; totalAvailable; locationCount }` | `apps/web/src/features/inventory/api/inventory.types.ts:49` |
| `BulkWizardConfig` (`defaultStock`, `defaultPrice?`) | `bulk-wizard.types.ts:58` |
| `BulkRowStatus` (6-value string union), `BulkWizardRow`, `READY_ROW_STATUSES` | `bulk-wizard.types.ts:35,37,70` |
| `pAllLimit`, `BULK_RESOLVE_CONCURRENCY=8`, 15 s timeout three-ref guard (#796) | `bulk-resolve-step.tsx`, `bulk-throttle.ts` |
| `apiClient.listings.resolveCategory` | `apps/web/src/features/listings/api/listings.api.ts:173` |
| `applyResolveOutcomes` reducer (#796 guard) | `bulk-wizard.tsx:296` |
| Existing tests: `bulk-resolve-step.test.tsx`, `bulk-wizard.test.tsx` | assert old status model — **must be rewritten** |

---

## Phase 3 — Design

### 3.1 Unified Resolve-step data flow (replaces the per-row loop)

```
Resolve step mount
  ├─ 1 call:  apiClient.listings.resolveCategoriesBatch(connectionId, { items: [{variantId, ean}] })   ← #795
  │             → { results: Record<variantId, EanMatchResult> }
  ├─ 1 call:  useInventoryAvailabilityBatchQuery(variantIds)                                            ← #792 PR2
  │             → { items: [{ productVariantId, totalAvailable, locationCount }] }
  ├─ read off already-loaded rows: masterPrice = primaryVariant.price, masterCurrency = product.currency ← #792 PR1
  └─ per row: compute BulkRowState.blockers from (categoryResult × pricingPolicy × stockPolicy × master values)
```

**Advancement (D5):** the step waits for both batch queries to settle, then auto-advances to Review. No 15 s timer, no #796 three-ref guard, no `resolveTimedOut` axis — the single batch call makes that per-row-budget machinery obsolete. On batch error it shows an error + **Retry** (query refetch). `isResolving` is **Resolve-step-local UI state** (derived from the two queries' loading flags), not a per-row field.

**Resolve → wizard handoff:** on settle the step calls `onComplete(outcomes: BulkResolveOutcome[])` where each outcome carries everything the orchestrator folds into its row by `productId`:

```ts
interface BulkResolveOutcome {
  productId: string;
  blockers: readonly BulkRowBlocker[];
  resolvedCategoryId: string | null;
  resolutionMethod: ResolutionMethod | null;     // matched→'auto_detect', else null
  masterPrice: number | null;
  masterStock: number | null;
  masterCurrency: string | null;
  categoryCandidates: readonly EanMatchCandidate[]; // [] unless multi-match
}
```

`bulk-wizard.tsx`'s `handleResolveComplete(outcomes)` merges by `productId` and advances to Review. This replaces the old `applyResolveOutcomes` reducer + its #796 guard wholesale.

### 3.2 #795 — CORE service extension

`ICategoryResolutionService` gains:

```ts
resolveCategoriesBatch(
  connectionId: string,
  input: BatchCategoryByEanInput,
): Promise<Map<string, EanMatchResult>>;
```

Implementation (`CategoryResolutionService`): resolve `getCapabilityAdapter<OfferManagerPort>(connectionId, 'OfferManager')`, narrow with `isEanCategoryMatcher(adapter)`, throw `AdapterCapabilityNotSupportedException(connectionId, 'EanCategoryMatcher')` if unsupported, else delegate to `adapter.resolveCategoriesForBatchByEan(input)`. No mapping-config dependency needed for the batch path.

### 3.3 #795 — HTTP route

`POST /listings/connections/:connectionId/categories/resolve-batch` on `listings.controller.ts` — inherits the **class-level** `@Roles('admin')` (line 84), no per-route decorator needed.

- **DTO file**: all three classes in `apps/api/src/listings/http/dto/resolve-category-batch.dto.ts`, mirroring the single-resolve `resolve-category.dto.ts` (request + response co-located; the `resolve` verb doesn't fit the `create-*`/`update-*` filename convention — the sibling file already established this local exception).
- **Request** `ResolveCategoryBatchRequestDto`: `items: ResolveCategoryBatchItemDto[]` — `@ValidateNested({ each: true })` + `@Type(() => ResolveCategoryBatchItemDto)`, `@ArrayMinSize(1)`, `@ArrayMaxSize(200)` (matches the inventory-availability cap). Item: `variantId` `@IsString @IsNotEmpty`, `ean` `@IsOptional @IsString`.
- **Response** `ResolveCategoryBatchResponseDto`: `{ results: Record<string, EanMatchResult> }` (controller converts the service `Map` → plain object). Swagger: `@ApiProperty({ type: 'object', additionalProperties: true })` on `results` (a record-of-discriminated-union can't be expressed precisely; the wire JSON is the contract — keep the field strongly typed as `Record<string, EanMatchResult>` in TS, loosely documented in OpenAPI). No typed-`any`.
- Resolve adapter first (validates connection exists/active — same as single route), call service, map `Map`→`Record`.
- Catch `AdapterCapabilityNotSupportedException` → `UnprocessableEntityException` (422) at the boundary (mirrors `bulk-offer-creation.controller.ts:177`).

### 3.4 #795 — FE wire

- `listings.types.ts`: mirror `EanMatchResult` union (incl. `EanMatchCandidate` for the multi-match arm — needed by the edit-modal chips, D2/D3) + `ResolveCategoriesBatchRequest`/`Response`.
- `listings.api.ts`: `resolveCategoriesBatch(connectionId, body)` → `POST .../categories/resolve-batch`.
- `listings.query-keys.ts`: `resolveCategoryBatch(connectionId, variantIds)` key.

### 3.5 #792 PR 3 — types (`bulk-wizard.types.ts`)

`as const` arrays + derived unions (per engineering-standards § Union Types):

```ts
PricingPolicyModeValues = ['use-master','markup','flat'];
PricingPolicy = {mode:'use-master'} | {mode:'markup'; percent} | {mode:'flat'; amount};   // D7: flat has NO own currency
StockPolicyModeValues = ['use-master','cap','flat'];
StockPolicy   = {mode:'use-master'} | {mode:'cap'; value} | {mode:'flat'; value};
BulkRowBlockerValues = ['no-variant','no-ean','no-match','multi-match','no-master-price','no-master-stock','currency-mismatch'];  // D2: +multi-match
```

- `BulkWizardConfig`: drop `defaultStock` + `defaultPrice`; add `pricingPolicy`, `stockPolicy`, `currency: string` (single batch-wide currency — D7).
- `BulkWizardRow`: replace `status: BulkRowStatus` with `blockers: readonly BulkRowBlocker[]` **directly on the row** (no `BulkRowState` wrapper — D5 dropped `resolveTimedOut`, and `isResolving` is Resolve-step-local UI state per frontend-architecture state-ownership rules, so a row-level state object would be a single-field wrapper). Add `masterPrice: number | null`, `masterStock: number | null`, `masterCurrency: string | null` (captured at resolve) and `categoryCandidates: readonly EanMatchCandidate[]` (populated only for `multi-match` rows — D2/D3). Keep `resolvedCategoryId`, `resolutionMethod`, `override`, `editFormValues`.
- A row is **ready** ⟺ `row.blockers.length === 0`. The Resolve step owns its own `isResolving` (derived from the two queries' loading flags); the operator only lands on Review after the batch settles (D5), so resolving-ness never reaches the Review gate.

### 3.6 #792 PR 3 — pure policy helper (`bulk-policy.ts`, new)

Isolated, unit-tested pure functions:

- `computeResolvedPrice(policy, masterPrice, override) → { value: number | null; source: 'master'|'policy'|'override'; blocker?: 'no-master-price' }`
  - `markup`: `roundHalfUp(masterPrice × (1 + clamp(percent, -100, 500)/100), 2)`; null master → `no-master-price`.
  - `flat`: verbatim, never blocks.
  - `use-master`: null master → `no-master-price`.
- `computeResolvedStock(policy, masterStock, override) → { value, source, blocker?: 'no-master-stock' }`
  - `cap`: `min(masterStock, N)`; null master → `no-master-stock`.
  - `flat`: verbatim, never blocks.
  - `use-master`: `0` or null → `no-master-stock` (Allegro rejects 0-stock publishes).
- `computeBlockers({ categoryResult, pricingPolicy, stockPolicy, masterPrice, masterStock, masterCurrency, batchCurrency, hasVariant, hasEan, override })` → `BulkRowBlocker[]` (co-occurring). `currency-mismatch` fires when `masterCurrency != null && masterCurrency !== batchCurrency` (`batchCurrency` = `config.currency` — D7); independent of price/stock; null currency does **not** fire it.
- Category-result → blocker mapping (D2): `matched` → none (sets `resolvedCategoryId`); `no-ean` → `no-ean`; `no-match` → `no-match`; `multi-match` → **`multi-match`** blocker + stash `categoryCandidates` on the row (operator picks via candidate chips in the edit modal — D3). Selecting any category (candidate chip or manual pick) clears `no-match`/`multi-match` and promotes the row toward ready.

### 3.7 #792 PR 3 — component changes

- **`bulk-config-step.tsx`** — remove flat stock/price inputs; render two policy radio groups with conditional inputs (markup percent, cap value, flat amount). Currency select stays batch-wide. AI-description toggle + publish-immediately unchanged.
- **`bulk-resolve-step.tsx`** — rewrite per 3.1: one batch category call + one availability call; build `BulkResolveOutcome[]` (per row: `blockers` + `masterPrice`/`masterStock`/`masterCurrency`/`categoryCandidates` + `resolvedCategoryId`/`resolutionMethod`) and hand back via `onComplete`. Inventory hook imported via `features/inventory` barrel. **Wait-for-settle advancement (D5)**: auto-advance to Review when both batch queries settle; local `isResolving` spinner while in flight; on batch error show error + **Retry**. **No 15 s timer, no #796 three-ref guard** — both were per-row-budget machinery the single batch call makes obsolete.
- **`bulk-review-step.tsx`** — render computed price/stock via `bulk-policy`; status cell renders **one chip per active blocker** (none when ready), incl. a distinct `multi-match` chip (copy e.g. "choose category"); provenance badge only when source ≠ `master` (`POLICY` → `warning` tone, `OVERRIDE` → `review` tone per UI style guide); `currency-mismatch` row → `—` in price column. "Approve all" gate: any row with `blockers.length > 0` is not-ready.
- **`bulk-edit-modal.tsx`** — capture `initialValues` from a `useRef` snapshot taken on `open === true`; don't re-bind on later row updates (prevents a background availability refetch clobbering in-progress edits). **Candidate chips (D3)**: when `row.categoryCandidates.length > 0`, render a "Suggested categories" chip row above the existing `CategoryPicker` (one chip per candidate, label `name ?? allegroCategoryId`); clicking a chip `setValue('categoryId', candidate.allegroCategoryId)`. Picker stays as manual fallback; chips don't render when there are no candidates.
- **`bulk-wizard.tsx`** — new config shape; drive the multi-blocker state model; submit filters `blockers.length === 0` rows; promote a row to ready when an operator override clears its blockers.

### 3.8 Tests

- **BE (D6 — no int-spec):** `category-resolution.service.spec.ts` — extend with batch cases (delegates when `isEanCategoryMatcher`; throws `AdapterCapabilityNotSupportedException` otherwise). Controller unit test for the new route (mocked service; 200 happy path + 422 unsupported). **No int-spec** — the listings int-harness deliberately avoids adapter-backed routes (live creds) and there's no fake-`OfferManager` registration path; deviation justified in the PR body (matches how `POST /offers` is tested).
- **FE:** `bulk-policy.test.ts` (new, pure — markup clamp/round, cap min, all blocker permutations incl. `multi-match`). Rewrite `bulk-resolve-step.test.tsx` (single batch call assertion; hydration paths: price+stock, null price, null stock, currency-mismatch, multi-blocker, multi-match; wait-for-settle advancement + error→Retry — **no fake-timer tests**), `bulk-wizard.test.tsx` (policy combinations + worked example, gate logic; old `applyResolveOutcomes`/#796 timer tests removed). Add/extend `bulk-review-step.test.tsx` (multi-chip incl. `multi-match`, provenance, currency-mismatch column), `bulk-edit-modal.test.tsx` (snapshot pre-fill + no re-bind; candidate-chip click fills `categoryId`).

---

## Phase 4 — Step-by-step implementation order

1. **BE #795 service** — interface method + `CategoryResolutionService.resolveCategoriesBatch` + unit spec.
2. **BE #795 route** — request/response DTOs + controller handler + 422 mapping + controller test.
3. **BE #795 barrel** — export any new public types from `@openlinker/core/listings` if needed.
4. **FE #795 wire** — `listings.types.ts` + `listings.api.ts` + `listings.query-keys.ts`.
5. **FE types #792** — `bulk-wizard.types.ts` (policies, blockers, row state, config).
6. **FE helper #792** — `bulk-policy.ts` + `bulk-policy.test.ts`.
7. **FE config step** — policy radios.
8. **FE resolve step** — unified batch + availability + blocker compute.
9. **FE review step** — computed values, multi-chip, provenance, gate.
10. **FE edit modal** — snapshot pre-fill.
11. **FE wizard orchestrator** — wire config + state model + submit filter.
12. **Tests** — rewrite/extend all affected specs.
13. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test` (+ `pnpm test:integration` if the route int-spec lands).

Each step keeps `pnpm type-check` green before moving on where practical (BE first so the FE wire types compile against committed shapes).

---

## Phase 5 — Validation

- **Architecture:** #795 stays inside the existing `CategoryResolutionService` (no new core service); adapter resolved via `IntegrationsService`, narrowed via the existing capability guard — CORE↔Integration boundary intact. FE consumes inventory via the feature barrel (no deep cross-feature import).
- **Naming/standards:** `as const` + union arrays for all new enumerations; DTO validation via class-validator at the boundary; domain exception mapped to HTTP at the controller; Symbol token reuse.
- **Security:** new route `@Roles('admin')` + `@ApiBearerAuth()` like its siblings; input capped at 200 items; no secrets in responses.
- **Testing:** pure policy logic isolated for high-value unit coverage; component tests cover hydration + gate + provenance; service/controller specs cover both capability branches.

### Resolved decisions (grill session)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Batch path is EAN-only** — thin pass-through to `resolveCategoriesForBatchByEan`, no mapping fallback. | Behavior-preserving: the wizard already sends barcode-only (never `sourceCategoryIds`). |
| D2 | **`multi-match` surfaces candidates** — new `multi-match` blocker; candidates stashed on the row. | Operator reviews real candidates instead of blind manual search; never auto-publishes a guessed category. |
| D3 | **Candidate UI = suggestion chips above `CategoryPicker`** — click fills `categoryId`; picker stays as manual fallback. | Additive; degrades to nothing when no candidates. |
| D4 | **One batch call, no chunking** — wizard caps selection at 100 (`bulk-create-wizard-page.tsx`) ≤ route/hook cap of 200. Route DTO cap = 200. | 100 ≤ 200, so chunking is dead code. |
| D5 | **Wait-for-settle advancement** — auto-advance on settle; error → Retry; **drop the 15 s timer + #796 three-ref guard + `resolveTimedOut`**. | The single batch call makes per-row budget machinery obsolete; a 15 s timer would false-fire on ~100-item batches (util runs concurrency 3). |
| D6 | **No int-spec for the new route** — service spec + controller spec (200/422) + FE single-call test. | No fake-`OfferManager` int-harness; mirrors how `POST /offers` is tested; documented in PR. |
| D7 | **Single batch-wide currency** — `PricingPolicy` flat = `{ mode, amount }`; mismatch + published price both keyed to `config.currency`. | Resolves the issue's own redundancy; one source of truth, no contradictory flat currency. |

### Residual risks

1. **Scope size** — ~4 BE files + ~7 FE files + ~6 test files. Bundled deliberately because #795 and #792 PR 3 both rewrite `bulk-resolve-step.tsx` and the status model (splitting would guarantee a merge conflict). The BE-only slice of #795 (steps 1–4) is independently shippable first if the reviewer prefers.
2. **`Closes` magic words** — the combined PR body carries both `Closes #792` **and** `Closes #795`.
