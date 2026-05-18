# Implementation Plan — Bulk listing FE (#739 + #740 + #741)

**Status:** ready for implementation
**Issues:** [#739](https://github.com/openlinker-project/openlinker/issues/739), [#740](https://github.com/openlinker-project/openlinker/issues/740), [#741](https://github.com/openlinker-project/openlinker/issues/741)
**Parent product design:** [#726](https://github.com/openlinker-project/openlinker/issues/726) — see [`docs/specs/product-spec-726-allegro-bulk-listing.md`](../specs/product-spec-726-allegro-bulk-listing.md)
**Branch:** `739-740-741-bulk-listing-wizard-fe`
**Layer:** Frontend (`apps/web`) — no backend changes
**Effort:** ~10 days nominal (2 + 5 + 3) — shared scaffolding cuts the total

---

## 1. Goal

Ship the operator-facing FE for Allegro bulk offer creation as a single vertical slice. Backend is fully merged (#734 / #735 / #736 / #737 / #738 / #742). The user flow this PR enables, end to end:

```
Products page
  → checkbox multi-select (≤100)            [#739]
  → bulk action bar: "Create Allegro offers (N)"
  → /listings/bulk-create/wizard            [#740]
      Step 1 — config (connection, shared shipping rate, AI default, default stock + publish)
      Step 2 — auto-match (per-variant EAN→category, partial-blocking up to 15 s)
      Step 3 — review table (per-row status, edit modal)
      Step 4 — edit modal (per-row title/category/price/stock/parameters/description+AI)
      Step 5 — submit confirmation → POST /listings/bulk-create
  → /listings/bulk-batches/:batchId          [#741]
      polling progress (5 s), per-product status, retry-failed (single + batch)
      final summary card on terminal status
```

Acceptance criteria below are tied 1:1 to the user-visible AC in the parent spec §5.2.

---

## 2. Non-goals (explicit deferrals)

Two pieces of the parent spec's AC and one piece of issue #741's AC are **deferred from this bundle**. Honest scope statement: this PR closes **#739 and #740 fully**, and closes **#741 substantially** with one issue-AC unmet (per-record retry — gated on a BE endpoint that doesn't exist yet).

| Deferred | Reason | Follow-up |
|---|---|---|
| **Parent AC-7 — Smart classification badge per row** | `BulkBatchRecordSummaryDto` (`apps/api/src/listings/http/dto/bulk-offer-create-response.dto.ts:27-48`) does **not** carry `smartClassification` or `failedDeliveryMethods`. #737 persists Smart readback server-side via `OfferCreationRecord` but the progress endpoint doesn't surface it. Adding it is a small BE change (extend DTO + repo read-through + mapper) — out of scope for a FE-only bundle. | File **"feat(listings): surface smart classification on bulk batch record summary"** (BE-S) + a FE chaser to render the badge. |
| **Parent AC-8 — Pre-submit account-level Smart warning banner** | No FE hook for `GET /sale/smart` (or its OL wrapper) exists today; need to verify whether the BE endpoint is even exposed. Adding it inflates this PR's scope without a clear seam. | File **"feat(allegro): expose account-level Smart eligibility hook + wizard banner"** (BE+FE-S). |
| **Issue #741 AC-4 — Per-record retry button on the progress row** | Issue #741 AC-4 requires a per-record retry. The implied endpoint (the parent spec's "to be added in #726.9") shipped as **batch-level only** (`POST /listings/bulk-create/:batchId/retry-failed` retries every failed child). There is no per-record retry endpoint today. **Batch-level retry IS shipped in this PR** (full "Retry all failed" wired); per-record retry is the unmet AC. | File **"feat(listings): per-record retry endpoint for bulk batch records"** (BE-S) + a FE chaser to add the inline retry button. |

PR description must state: `Closes #739, Closes #740. Addresses #741 (batch-level retry shipped; per-record retry to follow).` Don't auto-close #741.

**Re-evaluated and pulled INTO scope** during review (originally proposed as deferred):

- **Parent AC-9 — per-row AI description toggle in edit modal**: tech review surfaced that `AllegroCreateOfferWizard` already mounts `SuggestionDialog` inside its parent Dialog (`features/listings/components/AllegroCreateOfferWizard.tsx:49`), so the "two-level Dialog focus management" concern was overstated. The bulk-edit modal reuses the same pattern — `<SuggestionDialog>` opens on top of the edit modal, accepts the AI output back into the modal's `description` field. **In scope**. The Step-1 config "Generate AI descriptions" checkbox also remains as a batch-wide default (`sharedConfig.generateDescription`); per-row toggle in the modal overrides it.

Other things this PR does **not** do (out of scope by parent spec §6):

Other things this PR does **not** do (out of scope by parent spec §6):

- CSV import as input source
- Auto-list rule engine
- Bulk-edit existing offers (different flow)
- Per-PS-variant separate Allegro offers (variant-matrix collapse only)
- Shipment generation

---

## 3. Architecture

### 3.1 Layer & dependency direction

All three issues live in `apps/web/src/`. Files split across layers per `docs/frontend-architecture.md`:

- **Pages** (`pages/products/`, `pages/listings/`) — route entry points
- **Feature** (`features/listings/`) — already exists; we extend it with bulk hooks/components. **No new feature module is created** — bulk is part of the same domain.
- **Shared** (`shared/ui/`) — no new shared primitives (`DataTable`, `Dialog`, `Alert`, `Button`, `StatusBadge`, `PageLayout`, `SetupStepper`, `Input`, `Select`, `Textarea`, `Checkbox`, `FormField`, `LoadingState`, `ErrorState`, `EmptyState`, `useToast()` all exist)

### 3.2 State ownership

Per `docs/frontend-architecture.md` § State Management:

| State | Owner | Notes |
|---|---|---|
| Server (batch, products, variants, categories, parameters, policies) | TanStack Query | `staleTime` per existing pattern; 5 s polling on bulk batch while non-terminal |
| Selected product IDs on Products page | component-local `useState<Set<string>>` | Local during selection; serialised into URL search params **only at navigation time** to the wizard. Selection itself is local UI state — putting it in URL would explode the URL on every checkbox toggle. |
| Wizard step | `useSearchParams` (`?step=config\|resolve\|review\|confirm`) | Linkable + survives reload during a session |
| Wizard shared config (connection, shipping, AI default) | `useState` in wizard page | Single-screen lifetime |
| Wizard per-row overrides | `useState<Record<productId, PerProductOverride>>` | Edit-modal submits update this map |
| Edit modal form | React Hook Form + Zod | Same shape used by single-offer wizard |
| Auto-match results | `useQueries` cache | `useResolveCategoryQuery` per variant — TanStack handles caching/parallelism |
| Batch progress polling | TanStack Query with `refetchInterval` fn | Stops when `status` ∈ `{completed, partially-failed}` |

**No new global store** — none required.

### 3.3 File layout (additions only)

```
apps/web/src/
├── features/listings/
│   ├── api/
│   │   ├── bulk-listings.api.ts                       NEW  POST /listings/bulk-create, GET :batchId, POST :batchId/retry-failed
│   │   ├── bulk-listings.types.ts                     NEW  request/response types (mirror api/src/listings/http/dto/)
│   │   └── listings.query-keys.ts                     EDIT add bulkBatch(batchId) key factory
│   ├── hooks/
│   │   ├── use-bulk-submit-mutation.ts                NEW  POST /listings/bulk-create
│   │   ├── use-bulk-batch-query.ts                    NEW  GET :batchId with polling
│   │   └── use-bulk-retry-failed-mutation.ts          NEW  POST :batchId/retry-failed
│   ├── components/bulk/
│   │   ├── bulk-wizard.tsx                            NEW  the wizard shell + step state
│   │   ├── bulk-config-step.tsx                       NEW  Step 1
│   │   ├── bulk-resolve-step.tsx                      NEW  Step 2 (auto-match progress)
│   │   ├── bulk-review-step.tsx                       NEW  Step 3 (review table)
│   │   ├── bulk-review-row.tsx                        NEW  one review row (status icon + edit btn)
│   │   ├── bulk-edit-modal.tsx                        NEW  Step 4 per-row edit
│   │   ├── bulk-confirm-modal.tsx                     NEW  Step 5 submit confirmation
│   │   ├── bulk-batch-progress-table.tsx              NEW  used by #741 progress page
│   │   ├── bulk-edit-modal.schema.ts                  NEW  Zod schema for the edit modal
│   │   ├── bulk-wizard.test.tsx                       NEW  step-progression + AC-1..AC-4 tests
│   │   ├── bulk-edit-modal.test.tsx                   NEW
│   │   └── bulk-batch-progress-table.test.tsx         NEW
│   ├── lib/
│   │   └── bulk-throttle.ts                           NEW  bounded-concurrency helper (~20 lines, no deps) — caps Step-2 EAN resolves at 8 parallel
│   └── index.ts                                       EDIT  re-export BulkWizard if any cross-feature use
│
├── shared/ui/
│   ├── bulk-action-bar.tsx                            NEW  sticky band primitive — fulfils the style-guide promise + reused on /products
│   ├── bulk-action-bar.css                            NEW  scoped CSS for the band
│   └── index.ts                                       EDIT  re-export BulkActionBar
│
├── pages/
│   ├── products/
│   │   ├── products-list-page.tsx                     EDIT  add checkbox column + selection + bulk action bar
│   │   └── products-list-page.test.tsx                EDIT  add selection tests
│   └── listings/
│       ├── bulk-create-wizard-page.tsx                NEW  /listings/bulk-create/wizard
│       ├── bulk-create-wizard-page.test.tsx           NEW
│       ├── bulk-batch-progress-page.tsx               NEW  /listings/bulk-batches/:batchId
│       └── bulk-batch-progress-page.test.tsx          NEW
│
├── app/routes/
│   └── listings.route.tsx                             EDIT  register two new child routes
│
└── index.css                                          EDIT  ~3 small bounded sections (#739/#740/#741) — selection, wizard layout, progress table chrome
```

### 3.4 API surface consumed (already shipped on `main`)

| Method | Path | Purpose | DTO source |
|---|---|---|---|
| `POST` | `/listings/bulk-create` | Submit batch | `BulkOfferCreateRequestDto` → `BulkOfferCreateResponseDto` |
| `GET` | `/listings/bulk-create/:batchId` | Read batch + records (polled) | `BulkBatchSummaryDto` |
| `POST` | `/listings/bulk-create/:batchId/retry-failed` | Retry failed children | `BulkOfferCreationRetryResponseDto` |
| `POST` | `/listings/connections/:connectionId/categories/resolve` | EAN→Allegro category (per variant; existing) | `ResolveCategoryResponse` via `useResolveCategoryQuery` |
| `GET` | `/listings/connections/:connectionId/seller-policies` | Shipping/return/warranty policies | via `useSellerPoliciesQuery` |
| `GET` | `/listings/connections/:connectionId/categories/:id/parameters` | Dynamic Allegro params for picked category | via `useCategoryParametersQuery` |
| `GET` | `/listings/connections/:connectionId/products/:productId` | Allegro catalog product (smart-link prefill) | via `useCatalogProductQuery` |
| `GET` | `/products?...` | Products list (existing) | via `useProductsQuery` |
| `GET` | `/products/:id` | Single product + variants for the wizard rows | via `useProductQuery` |

No new backend endpoints are required.

### 3.5 Data flow (Step 2 auto-match)

The spec calls for "throttled-parallel EAN lookups + partial-blocking up to ~15 s". Implementation:

1. Wizard receives `productIds` from URL search params.
2. Wizard calls `useProductQuery(id)` for each (`useQueries` in one hook) to hydrate **product + variants**.
3. For each product, pick the primary variant (`variants[0]`) and its `barcode` (EAN).
   - No variants → row → status `no-variant` (❌)
   - No barcode → row → status `no-ean` (❌, manual category required)
4. For products with a barcode: call `useResolveCategoryQuery(connectionId, barcode)` via `useQueries`. **Concurrency capped at 8 parallel** via the new `bulk-throttle.ts` helper — a ~20-line `Promise.allSettled`-with-window utility, no new dependency. Rationale: `useResolveCategoryQuery` has `retry: false`, so a 429-burst would silently flip rows to ❌; 8-parallel is a safe ceiling against Allegro's documented rate limits and still resolves a 50-product batch within the 15 s budget. The helper interface: `pAllLimit<T,R>(items: T[], limit: number, mapper: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]>`.
5. Status derivation per row (`bulk-edit-modal.schema.ts`):
   - `auto_detect` + categoryId set → `matched` (✅)
   - `category_mapping` + categoryId set → `matched` (✅)
   - `manual` or null categoryId → `no-match` (❌)
6. Step 2 renders a progress strip ("Resolving 23 of 50…") and auto-advances to Step 3 once all queries are settled OR 15 s elapses (whichever first). Un-resolved rows stay flagged ❌.

### 3.6 Submit shape

**Variant ambiguity resolved (R4)**: confirmed by reading `libs/core/src/listings/application/services/bulk-offer-creation-submit.service.ts:182` — the service maps each entry from `input.productIds[]` into `OfferCreationRecord.internalVariantId` 1:1. So:

- The DTO description is correct: the array carries **variant IDs**, not product IDs (the misleading field name is locked in via #736).
- Each submitted variant produces exactly one offer-creation record → one Allegro offer.
- The parent spec's SC-2 ("auto-collapse PS product → 1 Allegro offer with Allegro variant matrix") means: **FE picks a canonical primary variant per selected product** and sends only that variant ID. Sibling variants of the same product are not submitted; v1 documents this. If the operator wants per-variant offers, that's a future "split variants" mode.

The bulk-create payload:
- `connectionId`
- `productIds: string[]` — actually **variant IDs**. FE maps each selected product → its primary variant (`variants[0]`) and sends those IDs. Products with no variants are flagged ❌ pre-submit.
- `sharedConfig`: `{ stock, publishImmediately, price?, generateDescription?, descriptionTone? }`
- `perProductOverrides?: Record<variantId, { stock?, publishImmediately?, price?, overrides? }>` — keyed by **variantId** (same key as the array entries).

Per-row edit modal writes into `perProductOverrides[variantId]`. The `overrides` block carries the per-row title/description/category/parameters/images. Unedited rows produce no entry in `perProductOverrides`.

---

## 4. Per-issue implementation steps

### Issue #739 — Products page multi-select + bulk action bar (~2 days)

**Files touched:**
- `apps/web/src/pages/products/products-list-page.tsx`
- `apps/web/src/pages/products/products-list-page.test.tsx`
- `apps/web/src/index.css` — new `/* ── Products selection (#739) ── */` section

**Steps:**

1. **Add a "select" column at column index 0.** It renders a `<input type="checkbox">` per row plus a header checkbox for "select all on this page". Selection is **component-local** — no URL params during selection. (Re-reading the issue: "preserves selection in URL/state when navigating to wizard" — that means at navigation time, not during selection. Selection lives in `useState<Set<string>>`; on "Create Allegro offers (N)" click, IDs are serialised into the wizard URL.)
   - **Decision**: Use a dedicated `DataTable` column with `cell: (product) => <CheckboxCell ... />`. The existing `DataTable` already supports custom cells; selection is just a column whose cell calls back into the page.
   - When the page changes (offset, search), preserve the existing selection set across pagination — selections persist for ≤100 total across pages until either submitted or page exit.
2. **Header checkbox semantics**: "select all visible" toggles all rows on the current page. Indeterminate state when some-but-not-all visible are selected. No "select across all pages" affordance in v1 — operator must page through (matches AC-1 cap of 100).
3. **Selection cap**: when `selected.size === 100`, additional unchecked checkboxes become `disabled` with a tooltip `"Max 100 per batch"`. Already-selected rows can still uncheck.
4. **Bulk action bar**: use the new `BulkActionBar` shared primitive (see § 3.3 — added to `shared/ui/` as part of this PR; the style guide promised it but it didn't exist yet). Shape: `<BulkActionBar count={N} actions={<Button tone="primary">Create Allegro offers ({N})</Button>} />`. Rendered above the table when `selected.size > 0`. Visually hidden at `N=0` (no DOM cost when not in use). `aria-live="polite"` so the count change is announced. **Mobile**: bar pins to bottom of viewport at `<640px` per the cockpit pattern.
5. **Navigation**: clicking the button calls `navigate('/listings/bulk-create/wizard?productIds=' + Array.from(selected).join(','))`. Selection is *not* cleared on navigation — if the user returns via back button the selection is still there.
6. **Tests** (Vitest + Testing Library, `renderWithProviders` pattern from `products-list-page.test.tsx`):
   - Initial render: no checkbox checked, no action bar.
   - Click one row checkbox: action bar appears with "(1)"; row is checked.
   - Click header checkbox: all visible rows check; action bar shows correct count.
   - Click checked header checkbox: all uncheck.
   - Select 100, attempt 101: 101st checkbox is `disabled`; tooltip visible (via `aria-describedby`).
   - Click "Create Allegro offers": navigation called with correct `?productIds=` (assert via mock `navigate`).

**Acceptance (maps to issue AC):**
- ✅ AC-1.1: Operator selects 1–100 products
- ✅ AC-1.2: Select-all selects visible page
- ✅ AC-1.3: >100 disables further selection with tooltip
- ✅ AC-1.4: Action button preserves selection in URL on navigate
- ✅ AC-1.5: Component test
- ✅ AC-1.6: PL+EN locales — current i18n seam is no-op; strings inlined with `t(key, fallback)` per established pattern
- ✅ AC-1.7: Mobile responsive (cardView fallback inherited; action bar collapses)

---

### Issue #740 — Bulk listing wizard (~5 days)

**Route**: `/listings/bulk-create/wizard?productIds=…&step=…`
**Files touched:**
- New `pages/listings/bulk-create-wizard-page.tsx` + test
- New `features/listings/components/bulk/*` (see § 3.3)
- New `features/listings/api/bulk-listings.{api,types,query-keys}.ts`
- New `features/listings/hooks/use-bulk-submit-mutation.ts`
- New `features/listings/lib/bulk-throttle.ts` (stub for v1)
- `app/routes/listings.route.tsx` — register `bulk-create/wizard` child route
- `index.css` — new `/* ── Bulk wizard (#740) ── */` section
- `app/api/api-client-provider.tsx` (or wherever `apiClient.listings` is composed) — add bulk methods to `ListingsApi`

**Steps:**

1. **Route registration.** Add `{ path: 'bulk-create/wizard', handle: { crumb: { group: 'Operations', title: 'Bulk listing' } } satisfies RouteCrumbHandle, lazy: ... }` as a child of `/listings`. Pattern follows `docs/frontend-architecture.md` § Breadcrumb metadata on routes (#610). The route-handle contract test (`route-handle.test.ts`) will fail if `handle.crumb` is missing.

2. **Page shell** (`bulk-create-wizard-page.tsx`):
   - Reads `productIds` from `useSearchParams()`; redirects to `/products` if empty or >100.
   - Uses `useProductsQuery({ ids: [...] })` *or* `useQueries(productIds.map(id => useProductQuery(id)))` to hydrate selected products + variants. **Decision**: use `useQueries` with `useProductQuery` for now — caches are reused if user already viewed the products; one fewer endpoint to extend. (`useProductsQuery` doesn't take an `ids` filter today; adding one is BE work.)
   - Wraps `<BulkWizard products={...} />`.

3. **`bulk-wizard.tsx` — step controller.**
   - State: `step: 'config' | 'resolve' | 'review' | 'confirm'` driven by `?step=` search-param; default `config`.
   - Header: `<SetupStepper>` (reuse from single-offer wizard) showing the 4 visible steps.
   - Body: renders the active step component.
   - Owns `sharedConfig` state, `perProductOverrides` map, and a `rows` array (one entry per product with status + resolved fields).

4. **`bulk-config-step.tsx` — Step 1.**
   - Connection picker: `useConnectionsQuery({ platformType: 'allegro' })` filtered to active connections supporting `OfferCreator`. If exactly 1 → auto-selected, picker hidden. If 0 → `<Alert tone="error">` with link to /connections.
   - Shipping policy picker: `useSellerPoliciesQuery(connectionId)`. Shows `<Select>` of delivery policies.
   - Default stock numeric input + "publish immediately" checkbox (defaults: stock=1, publish=true).
   - Optional default `price` (currency + amount) — used as fallback if a variant has no price.
   - "Generate AI descriptions" checkbox (sets `sharedConfig.generateDescription` — covers the AC-9 fallback per § 2).
   - "Proceed" button → `setStep('resolve')`.
   - Validation: connection + shipping policy + stock ≥ 0 are required.

5. **`bulk-resolve-step.tsx` — Step 2.**
   - Mounts a parallel set of `useResolveCategoryQuery` calls (one per row with a barcode) via a `useResolveCategoryBatch(rows, connectionId)` helper that internally uses `useQueries`. Concurrency capped at 8 via `bulk-throttle.ts` (see § 3.5).
   - Renders `<LoadingState>` with a progress line `"Resolving N of M…"` derived from the queries' `isSuccess` count.
   - 15 s overall timeout via `useEffect` + `setTimeout`: on fire, transitions to Step 3 regardless of pending queries. **Three states per row** (not two): `matched` (✅), `pending-after-timeout` (⏳ amber, "Still resolving — will update"), `no-match` (❌ red, "Manual category required").
   - **Late-arrival behaviour**: queries that settle after the user advances continue to fire (TanStack doesn't cancel them). The Step-3 review table subscribes to the same queries — a row that's `pending-after-timeout` flips to `matched` automatically when its query resolves. Pending rows do not block "Approve all", but the user gets visual confirmation that late-arrivers are still updating.
   - Auto-advance to Step 3 when all queries settle.
   - On render: write resolved `allegroCategoryId` + `method` into the parent's `rows[i].resolvedCategory`.

6. **`bulk-review-step.tsx` — Step 3 (review table).**
   - Renders one row per product using `<DataTable>` with columns: thumbnail+name, status icon, category (text), price (computed from override or shared), stock, edit button.
   - Status icons render via `<StatusBadge tone="success|warning|error" withDot ...>` from `shared/ui/`:
     - `matched` → green "Auto-matched"
     - `multi-match` → amber "Pick a card" (deferred — see note)
     - `no-ean` / `no-variant` / `no-match` → red "Manual category required"
   - **Multi-match handling** is **deferred to a follow-up** because `useResolveCategoryQuery` returns only a single resolved category, not a list of candidates. Surfacing multi-match would require either calling `findProductsByBarcode` separately or a BE change to `/categories/resolve`. v1 treats every non-`manual` result as `matched`; for `manual`, the user picks via the edit modal's category picker — that's already in the edit modal, so the UX still works. Documented in the issue follow-up list at § 7.
   - "Approve all" CTA at top-right; disabled while any row's `status !== 'matched'` or while any row has a Zod-invalid override.
   - "Back to Products" button → `navigate('/products')`.
   - Filter input on top: client-side filter on row name.

7. **`bulk-edit-modal.tsx` — Step 4 (per-row edit).**
   - Triggered by row's "Edit" button. `<Dialog>` (Radix-backed, from `shared/ui/`) with a tall form. Modal owns its own `FormProvider`.
   - Form schema (`bulk-edit-modal.schema.ts`):
     ```ts
     z.object({
       title: z.string().trim().min(1).max(75),  // Allegro title limit
       categoryId: z.string().min(1),
       description: z.string().min(1).max(50_000),
       stock: z.number().int().min(0),
       priceAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
       priceCurrency: z.enum(['PLN', 'EUR', ...]),
       publishImmediately: z.boolean(),
       parameters: parametersSchema,  // dynamic — reuse buildParametersZodSchema()
     })
     ```
   - **Form-context note**: `CategoryParametersStep` and `CategoryPicker` both consume `useFormContext()` (verified at `apps/web/src/features/listings/components/category-parameters-step.tsx:30,82,199`). They access keys `categoryId` and `parameters` — the modal schema uses the exact same key names, so dropping them into the modal's `FormProvider` works without changes.
   - Reused subcomponents (already exist in `features/listings/components/`):
     - `CategoryPicker` — Allegro category tree
     - `CategoryParametersStep` — dynamic parameter editors
     - `OfferDescriptionEditor` — if it exists; fall back to `<Textarea>` for v1 if the editor proves heavy to embed
   - **Per-row AI description toggle (parent AC-9)**: in scope. Render a `<Button tone="ghost">Generate with AI</Button>` near the description field that opens `<SuggestionDialog>` (already used inside the single-offer wizard — `AllegroCreateOfferWizard.tsx:49`). On accept, the AI output replaces the modal's `description` field; the operator can edit before saving the modal. Per-row toggle overrides the Step-1 batch-wide `sharedConfig.generateDescription` for that row.
   - On save: merge into `perProductOverrides[variantId].overrides`. Closing without save discards.

8. **`bulk-confirm-modal.tsx` — Step 5.**
   - Triggered by Step 3's "Approve all".
   - Shows aggregate counts + "Publish immediately" toggle (mirrors `sharedConfig.publishImmediately`; flipping here overwrites).
   - On confirm: `useBulkSubmitMutation.mutate({ connectionId, productIds: variantIds, sharedConfig, perProductOverrides })`. Idempotency key: stable per wizard mount.
   - On 202: `navigate('/listings/bulk-batches/' + batchId)` and `showToast({ tone: 'success', title: 'Batch submitted', description: '…' })`.
   - On 4xx: `<Alert tone="error">` in modal with message.

9. **API client + hook**:
   - `features/listings/api/bulk-listings.api.ts` adds three methods (`bulkCreate`, `getBulkBatch`, `retryFailed`) to `apiClient.listings.bulk` (or top-level — match the existing nesting style).
   - `features/listings/hooks/use-bulk-submit-mutation.ts`:
     ```ts
     useMutation({ mutationFn: (input) => apiClient.listings.bulkCreate(input, { idempotencyKey }), onSuccess: () => queryClient.invalidateQueries(...) })
     ```
   - Idempotency key generated once per wizard mount via `crypto.randomUUID()` — same pattern as the single-offer wizard.

10. **Tests** (component-level Vitest):
    - `bulk-wizard.test.tsx`: step transitions, config validation, resolve progress, submit flow with mocked `useBulkSubmitMutation` returning batchId.
    - `bulk-edit-modal.test.tsx`: opens with row prefill, saves into overrides map, validation errors visible.
    - Page test: 0 products → redirect; >100 → redirect; 1 product → renders.

**Acceptance (maps to issue AC):**
- ✅ AC-2: Wizard completes a 10-product batch in <5 minutes (qualitative — measured during dogfooding)
- ✅ AC-3: EAN auto-match results render correctly per row
- ✅ AC-4: Edit modal validates before save
- ✅ AC-5: "Approve all" disabled state honored
- ⚠️ AC-6 (account-level Smart banner): **deferred** per § 2
- ✅ AC-7: PL+EN inline strings
- ✅ AC-8: Mobile responsive
- ✅ AC-9: Component tests
- ✅ AC-10: lint + type-check + tests pass
- ✅ Parent AC-9 (per-row AI toggle): **in scope** (reverted from initial deferral — see § 2)

---

### Issue #741 — Batch progress page (~3 days)

**Route**: `/listings/bulk-batches/:batchId`
**Files touched:**
- New `pages/listings/bulk-batch-progress-page.tsx` + test
- `features/listings/hooks/use-bulk-batch-query.ts` (the polling query)
- `features/listings/hooks/use-bulk-retry-failed-mutation.ts`
- `features/listings/components/bulk/bulk-batch-progress-table.tsx` + test
- `app/routes/listings.route.tsx` — register `bulk-batches/:batchId`
- `index.css` — new `/* ── Bulk batch progress (#741) ── */` section

**Steps:**

0. **Route registration.** Add `{ path: 'bulk-batches/:batchId', handle: { crumb: { group: 'Operations', title: 'Bulk batch' } } satisfies RouteCrumbHandle, lazy: ... }` as a child of `/listings`. The `:batchId` is dynamic but the crumb title stays static ("Bulk batch") per the established pattern — the page itself shows the batch ID in the eyebrow / KPI strip.

1. **Polling hook.**
   ```ts
   export function useBulkBatchQuery(batchId: string | undefined) {
     return useQuery({
       queryKey: listingsQueryKeys.bulkBatch(batchId ?? ''),
       queryFn: () => apiClient.listings.getBulkBatch(batchId!),
       enabled: Boolean(batchId),
       refetchInterval: (q) => {
         const status = q.state.data?.status;
         return status === 'completed' || status === 'partially-failed' ? false : 5_000;
       },
       staleTime: 0,
     });
   }
   ```
   Mirrors `use-offer-creation-status-query.ts` exactly.

2. **Page shell:**
   - Header: batch ID (mono), connection name (from `useConnectionsQuery`), aggregate counts as a KPI strip (`MetricCard × 3`: Total / Succeeded / Failed) — matches the cockpit pattern.
   - Status badge: pulses while `running`/`pending`, solid on terminal.
   - Loading / error / empty states per `.claude/rules/fe-pages.md`.

3. **Per-record table** (`bulk-batch-progress-table.tsx`):
   - One row per record. Columns: variant id (mono), product name (resolved via `useProductQuery` per row, batched), status badge, externalOfferId (when present, linked to Allegro), createdAt, actions.
   - Product name column is best-effort — if variant→product hydration fails, fall back to variant id only.
   - Status mapping (`OfferCreationStatusValues`):
     - `pending` / `running` → neutral with pulse
     - `succeeded` → success
     - `failed` → error
   - Action column (per row): if `status === 'failed'`, a "Retry" link — **but only the batch-level "Retry all failed" is implemented in this PR**. Per-record retry would need a separate BE endpoint or a hack that re-submits a 1-element batch; deferred to a follow-up. AC-6 of the parent spec covers both single + all; I'll wire the batch-level retry and document the per-record retry as a follow-up.

4. **"Retry all failed" button** (top-right when batch terminal with `failed_count > 0`): mutation calls `POST /listings/bulk-create/:batchId/retry-failed`; on 202, invalidates the bulk-batch query (polling resumes — the BE flips batch back to `running`).

5. **Final summary card**: when `status ∈ {completed, partially-failed}`, render a card summarising counts + links to the connection's `/listings` page (filtered by `?bulkBatchId=` if such a filter exists — verify; if not, just to `/listings`).

6. **Tests:**
   - Renders with mocked `useBulkBatchQuery` returning `running` state — sees polling indicator, no retry button.
   - Renders with `partially-failed` — retry button visible.
   - Click retry — mutation called, toast shown.
   - Loading / error / not-found states.

**Acceptance (maps to issue AC):**
- ✅ AC-1: Polls every 5 s and updates real-time
- ✅ AC-2: Per-product status reflects job state
- ⚠️ AC-3 (Smart badge): **deferred** per § 2
- ⚠️ AC-4 (per-record retry): **deferred** — batch-level retry shipped
- ✅ AC-5: Polling stops in terminal state
- ✅ AC-6: PL+EN inline
- ✅ AC-7: Mobile responsive
- ✅ AC-8: Component tests
- ✅ AC-9: lint + type-check + tests pass

---

## 5. Cross-cutting concerns

### 5.1 Accessibility

- All checkboxes are native `<input type="checkbox">` with `<label>` wrappers; selection count is in an `aria-live="polite"` region; tooltips on disabled checkboxes use `aria-describedby`.
- Modals use the existing `Dialog` Radix-backed component → focus trap + Esc + `aria-modal` handled.
- Polling page wraps the count strip in `aria-live="polite"` so screen readers hear count updates.
- Status icons paired with text per the `StatusBadge` contract (color is never the only signal).

### 5.2 Idempotency

- Wizard mints `crypto.randomUUID()` once per mount → reused across retries → forwarded as `x-idempotency-key` if/when the bulk-create endpoint honors it (verify in `BulkOfferCreationController` — if not used, drop the header).

### 5.3 i18n

- Inline strings with `t('bulk.wizard.config.title', 'Configure batch')` pattern per existing seam; PL fallbacks not yet wired anywhere (the seam is no-op). No additional infra in this PR.

### 5.4 Styling

- Three small bounded `index.css` sections (one per issue) per `.claude/rules/frontend.md`. All colors / spacing via `var(--token)`. No new tokens added (the existing palette covers it).

### 5.5 Plugin barrel

- `features/listings/index.ts` re-exports nothing new — bulk components are internal. Only the route entry points (page modules in `pages/listings/`) consume them, via same-feature relative imports.

---

## 6. Quality gate

Per `CLAUDE.md`:

```bash
pnpm lint
pnpm type-check
pnpm test
```

All three must pass with zero errors before commit. No BE changes → no migration check needed.

Optional dogfood pass: `pnpm start:dev:web` + `pnpm start:dev:api` + `pnpm start:dev:worker` + dev stack up → walk the wizard with 3 real products against a real Allegro connection. Strongly recommended before push for AC-2 ("under 5 minutes for a 10-product batch") qualitative validation.

---

## 7. Risks & open questions

| Risk | Mitigation |
|---|---|
| **R1** — Auto-match endpoint rate-limit gets hit on 50-row batches | Mitigated upfront: `bulk-throttle.ts` caps Step-2 EAN resolves at 8 parallel. Existing `AllegroHttpClient` BE-side rate-limit handling remains the second layer of defence. |
| **R2** — `useProductQuery × 100` page-load weight | `useProductQuery` hits `GET /products/:id` once per product. With 100 selected products this is 100 parallel requests at page mount. TanStack dedupes if the user already viewed a product, but worst case all 100 are cold. **Mitigation**: if observation shows this is slow, request a BE batch endpoint (`GET /products?ids=...`) as a follow-up. Likely acceptable for v1 because the wizard is admin-only and not on a critical hot path. |
| **R3** — Edit modal scope creep | The single-offer wizard is 600+ lines and has 5 steps. Trying to embed its full feature surface in a single-screen modal will balloon. **Mitigation**: edit modal exposes only the *5 commonly edited fields* (title, category, description, stock+price, parameters) + the per-row AI toggle; operator has the option to deselect and use the single-offer wizard for unusual cases. Explicit non-feature: no variant-matrix editing, no policy override, no image picker (uses product's first image as offer image — matches single-offer default). |
| **R4** — Variant ambiguity (DTO field name vs description) | **Resolved**: `bulk-offer-creation-submit.service.ts:182` maps each `input.productIds[]` entry to `internalVariantId` 1:1 — the array carries variant IDs. FE picks the primary variant per selected product (SC-2 collapse). Documented in § 3.6. |

---

## 8. Test strategy

Per `.claude/rules/fe-pages.md` § Testing Priorities:

| Suite | Coverage |
|---|---|
| `products-list-page.test.tsx` (extended) | Selection state, action bar, navigation, cap enforcement, header checkbox semantics |
| `bulk-create-wizard-page.test.tsx` | 0-products redirect, >100 redirect, happy path step transitions |
| `bulk-wizard.test.tsx` | Step state from URL, validation per step, AC-2 through AC-5 |
| `bulk-edit-modal.test.tsx` | Form validation, save merges into overrides, cancel discards |
| `bulk-batch-progress-page.test.tsx` | Loading / error / empty / data states; polling start/stop; retry button visibility per terminal state |
| `bulk-batch-progress-table.test.tsx` | Per-row status badge mapping; offer-link rendering for succeeded rows |

All tests use `renderWithProviders` + `createMockApiClient`. No new test infrastructure.

---

## 9. Out of plan — fixed follow-up issues

If/when this bundle merges, file these as follow-ups (each is small, no dependency between them):

1. **feat(listings): surface smart classification on bulk batch record summary** — BE-S. Extend `BulkBatchRecordSummaryDto` with `smartClassification: { fulfilled: boolean; failedDeliveryMethods?: string[] } | null` + repo read-through from `OfferCreationRecord`. Closes parent AC-7. FE badge addition is a separate FE-S chaser.
2. **feat(allegro): expose account-level Smart eligibility hook + wizard banner** — BE+FE-S. New `GET /listings/connections/:connectionId/smart` endpoint backed by Allegro's `GET /sale/smart`, plus FE `useSmartEligibilityQuery` + banner in the bulk wizard's Step 1. Closes parent AC-8.
3. **feat(listings): per-record retry endpoint for bulk batch records** — BE-S. `POST /listings/bulk-create/:batchId/records/:recordId/retry` — single-row reset + enqueue, mirroring `bulkRetry.retryFailed`'s per-record path. FE inline retry button is a separate FE-S chaser. Closes #741 AC-4.
4. **feat(listings): multi-match handling for EAN→category bulk auto-match** — BE returns top-N candidates from `/sale/products?phrase={ean}`, FE shows a card-picker modal when the row's `method` is multi-match. Closes parent spec OQ-C1.
5. **feat(api,products): batch product detail endpoint `GET /products?ids=`** — only file if observation in R2 (100-product wizard mount) shows real weight. Replaces N parallel `GET /products/:id` with one bounded request.

---

*Plan generated 2026-05-18 following [`docs/implementation-plan-generator-guide.md`](../implementation-plan-generator-guide.md).*
