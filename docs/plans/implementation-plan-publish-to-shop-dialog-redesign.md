# Implementation Plan: Publish-to-shop dialog redesign (#1414)

## 1. Task

Frontend-only. Fix three UI defects in the "Publish to shop" flow and add real batch
multi-select from the top-level entry point, per the approved mock
(https://claude.ai/code/artifact/d14dfe42-6554-4457-a6ce-6800829daf03):

1. Dialog too narrow (520px) → widen.
2. Product/variant names + SKU overflow instead of truncating.
3. Picker is single-select (`type="radio"`) with no way to batch-publish from the
   top-level "Publish to shop" CTA → checkboxes + selection tray.
4. Configure step: Stock/Price become per-product rows (not one shared field),
   each with an independent "use master for all" reset, plus a per-row remove.

Non-goals (explicitly out of scope, tracked separately): per-product destination
category (needs a new BE capability, separate epic).

## 2. Research

- `ShopPublishLauncher.tsx` owns the `<Dialog>` chrome; `WoocommercePublishWizard.tsx`
  owns the picker + form body. Only the wizard needs picker/form changes;
  the launcher only needs the wide-dialog class.
- `.dialog__content--wide` (920px) already exists in `index.css`, used by the KSeF
  UPO dialog. Publish-to-shop needs something narrower (~680px is enough for a
  3-column config row) — add a new `.dialog__content--publish` modifier rather
  than reusing `--wide` verbatim (different target width, same pattern).
- Existing multi-select precedent: `apps/web/src/pages/products/products-list-page.tsx`
  uses `CheckboxCell` + `BulkActionBar` (`shared/ui/`). Reuse `BulkActionBar` isn't a
  fit here (it's a page-level sticky bar); the mock's in-dialog "selection tray"
  (chips + count + Clear all) is a new small local pattern, not a shared primitive
  (single consumer today).
- `woocommerce-publish-wizard.schema.ts` currently has one shared `stock`/`priceAmount`
  for both modes. Needs a per-item shape for bulk.
- `resolveVariantIds` currently returns a fixed `ids` array from props; the "remove
  from batch" action needs a **stateful** selected-id list, not just props passthrough.

## 3. Design

### 3.1 CSS (`apps/web/src/index.css`)
New section `/* ── Publish-to-shop dialog (#1414) ── */`:
- `.dialog__content--publish { width: min(680px, 94vw); max-height: min(90vh, 800px); }`
- `.shop-publish-picker__product-name`, `.shop-publish-picker__variant-name`:
  `min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap` (+ `title` attr in JSX).
- `.shop-publish-picker__code` — fixed-width mono column for SKU/EAN (`flex:none`).
- `.shop-publish-tray`, `.shop-publish-tray__chips`, `.shop-publish-chip` — selection tray
  (reuses the existing `.shop-publish-chip` class already defined for the read-only bulk
  chips row — extend it with a remove `<button>` variant, don't duplicate).
- `.shop-publish-config-row`, `.shop-publish-config-row__fields` — per-product config row
  (2-line: name+remove, then Stock/Price mini-grid).

### 3.2 Picker → checkbox multi-select (`WoocommercePublishWizard.tsx`)
- Replace `pickedVariantId: string | null` with `selectedVariants: Map<string, { label, productId }>`
  (ordered by insertion — `Map` preserves insertion order, matches the tray's expected order).
- Checkbox `onChange` toggles membership in the map instead of single-picking.
- Tray renders `Array.from(selectedVariants.entries())` as chips with a remove `×`.
- `effectiveIds` becomes `ids.length > 0 ? ids : Array.from(selectedVariants.keys())`.
- Continuing with 1 selected → `mode: 'single'` (unchanged path); 2+ → `mode: 'bulk'`
  (`resolveVariantIds`'s existing `bulkIds.length > 1` branch already does this once fed
  the right array — no change needed there, only the *source* of the array changes from
  "always props" to "props OR local selection").
- This only applies to the `needsVariantPicker` (top-level entry, no `defaultVariantId(s)`)
  branch — row-level single/bulk entry points (`defaultVariantId`/`defaultVariantIds` set)
  are unaffected.

### 3.3 Configure step — per-product Stock/Price (bulk mode)
- Schema: add `items: { variantId: string; stock: string; priceAmount: string }[]` to
  `woocommercePublishWizardSchema`, validated with the same per-field rules as today's
  top-level `stock`/`priceAmount`. Keep the top-level `stock`/`priceAmount` fields for
  **single** mode (unchanged) — bulk mode ignores them and uses `items` instead.
- Seed `items` from `effectiveIds` via `useFieldArray` (`control`, `name: 'items'`) when
  entering bulk mode (on mode transition / mount), one row per variant, `stock: ''`,
  `priceAmount: ''`, `priceCurrency` stays a single shared field (only stock+price are
  per-product per the request — currency isn't).
- Per-row remove button calls `remove(index)` (from `useFieldArray`) — this is the same
  action as un-checking the variant in the picker, so it should also sync back
  `selectedVariants` if the operator navigates back (acceptable to leave picker state
  independent for v1: removing in Configure only removes from the batch being submitted,
  matching the mock's behavior — no back-sync required, documented as a follow-up if
  raised in review).
- Two reset buttons: "Use master stock for all" → `items.forEach((_, i) => setValue(items.${i}.stock, ''))`;
  same for price. Independent, no "copy row 1" semantics.
- Submit: `BulkShopPublishRequest` needs per-item stock/price. Check
  `apps/web/src/features/listings/api/listings.types.ts` — if `BulkShopPublishRequest`
  is currently `{ connectionId, internalVariantIds, status, stock, price? }` (batch-shared),
  it needs to become `{ connectionId, status, items: { internalVariantId, stock, price? }[] }`
  or similar — **this is a BE contract touch-point**, not pure FE. Confirmed in step 4 below.

### 3.4 `ShopPublishLauncher.tsx`
- Apply `dialog__content--publish` className to `<DialogContent>`.

## 4. Contract check (pre-implement gate focus)

`BulkShopPublishRequest` / the bulk-publish endpoint DTO must be checked before writing
FE code that assumes per-item stock/price — if the backend only accepts one shared
stock/price for the whole batch today, per-product overrides need a backend change too
(new scope, likely its own follow-up issue) OR the FE ships per-row UI but sends the
*first* row's values / an average, which would misrepresent the feature. This plan
assumes the check comes back "needs backend change" and scopes accordingly — resolved
in the pre-implement pass before touching the request-building code.

## 5. Steps

1. `apps/web/src/index.css` — new CSS section (dialog width, truncation, tray, config-row).
2. `woocommerce-publish-wizard.schema.ts` — add `items` field + defaults; keep single-mode
   fields unchanged.
3. `WoocommercePublishWizard.tsx` — checkbox multi-select + tray (picker), `useFieldArray`
   for the bulk Configure table, two reset actions, remove-row action.
4. `apps/web/src/features/listings/api/listings.types.ts` + bulk-publish API/mutation —
   extend `BulkShopPublishRequest` for per-item stock/price (BE contract — flag if this
   requires a backend PR; if so, ship FE behind the extended contract in the same PR only
   if the BE change is small and self-contained, otherwise split and note the follow-up).
5. `WoocommercePublishWizard.test.tsx` — update/add cases: multi-select accumulation,
   remove chip, per-row independence, two reset actions, submit payload shape.
6. `ShopPublishLauncher.tsx` — apply the new dialog width class.

## 6. Validation

- `pnpm --filter @openlinker/web exec tsc --noEmit`
- `pnpm eslint` on changed files
- `pnpm --filter @openlinker/web exec vitest run` on the wizard + launcher test files
- Manual check against the mock states (loading/empty/error/results, tray, config table).
