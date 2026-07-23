# Implementation Plan — Unify offer creation (#1754)

**Issue:** #1754 · **Depends on:** #1741 (PR #1757 — this branch is stacked on it)
**Layer:** Frontend (Interface). **No CORE / Integration / backend change.**

## 1. Goal

Make the redesigned bulk offer wizard the single entry point for offer creation on `/listings`, driven by a **multi-select, paginated, searchable product picker** (whole product, a single variant, or a mix across products — all one batch). Retire the two single-offer wizards (`AllegroCreateOfferWizard`, `erli-create-offer-wizard`) and their modal dispatch chain. A single selected variant renders as the wizard's flat single-offer path.

Prototype (approved): https://claude.ai/code/artifact/2a042aec-352a-429c-9dad-223e26b5e5e3

### Non-goals
- No backend / job / DTO change (bulk flow already delegates to the single-offer core primitives, #726).
- No change to the WooCommerce `ShopPublishLauncher` publish flow (not an `OfferCreator`).
- No change to the bulk-batch retry (#742) or the per-variant editor internals (shipped in #1741).

## 2. Current state (researched)

- `/listings` "Create offer" → `OfferCreationLauncher` (modal) → connection pick → plugin-registered `offerCreationWizard` (`useOfferCreationWizard(platformType)` → `AllegroCreateOfferWizard` / `ErliCreateOfferWizard`).
- `/products` already does whole-product multi-select + pagination + filters + `MarketplacePickerModal` + `goToWizard(productIds, connectionId)` → navigates to `/listings/bulk-create/wizard?productIds=…&connectionId=…`. **This is the pattern to reuse.**
- `bulk-create-wizard-page.tsx` hydrates products from `?productIds=` via `useProductsBatchQuery`, mounts `BulkWizard`. The wizard's `seedRow` seeds **all** variants of each product (`included: true`).
- Product search: `useProductsQuery({ search }, { limit, offset })` → `PaginatedProducts` (already used by the old wizards' product search). Per-product variants load lazily via `useProductQuery(productId).variants`.
- Retry: `OfferCreationTracker.onRetry(record)` feeds a `CreateOfferRequest` snapshot back into `OfferCreationLauncher`. `OfferCreationStatusResponse` carries `internalVariantId` + `connectionId` directly.

## 3. Design

### 3.1 Route contract (extend, backward-compatible)
`/listings/bulk-create/wizard?productIds=<csv>[&variantIds=<csv>][&connectionId=<id>]`
- `productIds` — every product touched by the selection (unchanged).
- `variantIds` (**new**, optional) — explicit variant subset. A product in `productIds` with **no** matching entry in `variantIds` = all its variants (whole-product pick; `/products` path unchanged). A product with ≥1 matching variant = only those variants.
- Absent `variantIds` ⇒ byte-identical to today (protects the `/products` entry point).

### 3.2 Variant filtering happens in the page, not the wizard
`bulk-create-wizard-page.tsx` parses `variantIds` into a Set; for each hydrated product, if any of its variants are in the set, filter `product.variants` to that subset before passing to `BulkWizard`. `BulkWizard` seeds exactly what it is given → a single selected variant yields a 1-variant product → the wizard already renders it flat (simple editor, no rail). **`BulkWizard` needs no change.**

### 3.3 Multi-select picker (new component)
`apps/web/src/features/listings/components/offer-product-picker-modal.tsx` — a Radix `Dialog`:
- Search `<Input>` (debounced) → `useProductsQuery({ search }, { limit: PAGE_SIZE, offset })`.
- Paginated list (Previous / Next + "from–to of total"), matching the `/products` + old-wizard pager.
- Each product row: tri-state product checkbox (all / some=indeterminate / none) + expand caret. Expanding lazily loads variants (`useProductQuery(id)`), rendering per-variant checkboxes.
- Selection state lives in the component and **persists across pages / filters**, keyed by product id → `'ALL' | Set<variantId>`.
- Selection bar: "N items selected across M products" + Clear. Continue disabled until ≥1.
- On Continue: resolve target connection — 1 `OfferCreator` connection ⇒ preselect; 2+ ⇒ reuse `MarketplacePickerModal`; 0 ⇒ inline warning. Then build `productIds` (all touched) + `variantIds` (only products picked at variant granularity) and navigate to the wizard route.

### 3.4 `/listings` rewire
`listings-list-page.tsx`: "Create offer" opens `OfferProductPickerModal` instead of `OfferCreationLauncher`. Preserve `useWriteAccess` visibility + demo `ReadOnlyLock` semantics.

### 3.5 Retry re-point
`OfferCreationTracker.onRetry(record)` → navigate `bulk-create/wizard?productIds=<p>&variantIds=<record.internalVariantId>&connectionId=<record.connectionId>`, resolving `<p>` from the variant (`GET /products/variants/:id` → `productId`). Drops the launcher-based retry state (`retryInitialValues` / `retryDefaultConnectionId`). The batch flow re-runs the same single-offer core path, so the retry is functionally preserved.

### 3.6 Removals (only after the above compiles + tests pass)
- `AllegroCreateOfferWizard.tsx` (+ `.test.tsx`), `erli/erli-create-offer-wizard.tsx` (+ test).
- `OfferCreationLauncher.tsx`, `app/plugin-bindings/use-offer-creation-wizard.ts`, `plugins/resolve-offer-creation-wizard.ts`.
- `offerCreationWizard` contributions in `plugins/allegro/index.ts` + `plugins/erli/index.ts`; the `offerCreationWizard` field on `shared/plugins/plugin.types.ts`.
- `create-offer-request-to-form-values.ts` + the single-offer form-values plumbing **iff** nothing else consumes it after the retry re-point.
- Keep every **shared** Erli/Allegro subcomponent the bulk editor reuses (`CategoryParametersStep`, `erli-*-field`, schemas, `catalog-product-match-panel`, `erli-offer-validation`) — audit each importer before deleting.
- Prune `features/listings/index.ts` re-exports of removed symbols.

## 4. Steps

1. **Picker component** — `offer-product-picker-modal.tsx` + `.test.tsx`. Search + pagination + lazy variants + tri-state + persisted selection + connection resolution + navigate.
2. **Route/page** — `bulk-create-wizard-page.tsx`: parse `variantIds`, filter product variants. Unit-cover the filter.
3. **`/listings` rewire** — swap CTA to the picker; wire retry re-point via the tracker.
4. **Remove single-offer dispatch** — delete wizards + launcher + dispatch hooks + plugin contributions + type field; prune barrels/imports; audit shared subcomponents stay.
5. **Tests** — picker (select whole product / single variant / mix / pagination-persistence / connection routing), page variant-filter, retry navigation. Update/remove obsolete `OfferCreationLauncher` / wizard tests.
6. **Quality gate** — `pnpm lint`, `type-check`, full `test`.
7. **Live demo E2E + screenshots** — full click-through on the local demo stack; compare to the mockup.

## 5. Risks
- **Shared-subcomponent over-deletion** — the Erli/Allegro dirs mix single-offer-only files with bulk-shared files. Mitigate: grep each importer before deleting; delete only files with no remaining non-test importer.
- **Retry snapshot fidelity** — the re-point carries variant + connection but not the old per-field overrides; acceptable (batch re-runs the same core path). Confirm `ProductVariantSummary.productId` exists.
- **Dependency:** stacked on #1757; rebase onto main after it merges.

## 6. Docs impact (Phase 4.5 hypothesis)
- `docs/frontend-architecture.md` — offer-creation entry point is now the bulk wizard via a multi-select picker; single-offer wizard dispatch removed.
- `docs/architecture-overview.md` (Listings §6) — note the unified FE entry (#1754) if the single-offer wizard is referenced.
- `docs/lessons.md` — only if a pitfall surfaces.
