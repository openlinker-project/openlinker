# Pre-implement analysis — Unify offer creation (#1754)

**Verdict: NEEDS-REVISION** (one boundary correction; all deletions/contract moves confirmed safe). Frontend-only; no CORE/Integration/backend surface touched.

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| Multi-select product picker modal | **NEW (confirmed absent)** — build it | No reusable picker exists; only inline single-select `create-offer-variant-picker` markup in the 3 wizards. Lift its structure + CSS class family. |
| Product search + pagination | **EXISTS → reuse** | `useProductsQuery(filters, {limit,offset})` → `PaginatedProducts`; `useProductQuery(id)` for lazy per-product variants (`features/products`). |
| Variant→product for retry | **EXISTS → reuse** | `ProductVariantSummary.productId` via `useVariantQuery(id)` (`GET /products/variants/:id`). |
| Tri-state checkbox | **EXISTS → reuse** | `CheckboxCell` in `shared/ui` (`state: 'all'|'some'|'none'`). |
| Connection picker for 2+ conns | **EXISTS but NOT reusable as-is** | `MarketplacePickerModal` + `BULK_SELECTION_CAP` live in `pages/products` → importing into `features/listings` breaks the `app→pages→features→shared` direction. |

## Backward-compat findings

- **Route param `variantIds` (new, optional)** — Warning-clear. Zero existing readers; `/products` `goToWizard` only ever sends `productIds`+`connectionId`, so the whole-product path is byte-identical. No collision.
- **FE plugin contract `offerCreationWizard`** — removing the field (`shared/plugins/plugin.types.ts`) + both registrations (`plugins/allegro`, `plugins/erli`) is self-contained: the only read path is `resolve-offer-creation-wizard` → `use-offer-creation-wizard` → `OfferCreationLauncher`, all three deleted together.
- **No CORE barrel / port / DTO / Symbol / ORM change.** No migration.

## Required revisions (folded into implementation)

1. **R1 — do not import from `pages/products`.** The plan's "reuse `MarketplacePickerModal`" crosses `features → pages`. Instead: render connection resolution **inside** the new listings picker (shared `Dialog` + `usePlatforms` + a `Select`/radio-group), and define a local selection cap constant in `features/listings` rather than importing `BULK_SELECTION_CAP`. (Promoting the modal to `shared/ui` is a larger refactor — out of scope; keep it local.)
2. **R2 — keep, do not delete:** `create-offer-request-to-form-values.ts` + `create-offer-fields.schema.ts` (consumed by the **surviving** `OfferCreationTracker`, mounted on `/listings` and `/sync-jobs/:id`). Only the `createOfferRequestToFormValues` export goes dead — that's fine.
3. **Keep all bulk-shared Erli files:** `erli-offer-fields.schema.ts`, `erli-delivery-price-list-field.tsx`, `erli-delivery-price-list-override-field.tsx`, `erli-dispatch-time-field.tsx`, `erli-producer-field.tsx`, `erli-bulk-*`, `erli-offer-validation.ts`. **Delete only:** `erli-create-offer-wizard.tsx`, `create-erli-offer-request-to-form-values.ts`, `erli-create-offer.schema.ts`.

## Confirmed safe-to-delete set

`AllegroCreateOfferWizard.tsx`, `erli/erli-create-offer-wizard.tsx`, `OfferCreationLauncher.tsx`, `app/plugin-bindings/use-offer-creation-wizard.ts`, `plugins/resolve-offer-creation-wizard.ts`, `catalog-product-match-panel.tsx`, `erli/create-erli-offer-request-to-form-values.ts`, `erli/erli-create-offer.schema.ts` + their tests. Prune barrel lines 9–10 and the `offerCreationWizard` field + 2 registrations.

## Open questions
None blocking. Retry re-point uses `record.internalVariantId` + `record.connectionId` + `useVariantQuery(...).productId` → confirmed available.
