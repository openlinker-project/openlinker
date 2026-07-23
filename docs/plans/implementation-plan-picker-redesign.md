# Implementation Plan — Create-offers picker redesign (#1779)

**Issue:** #1779 · **Stacks on:** #1754 (PR #1774), branch `1754-unify-offer-creation-wizard`.
**Layer:** Frontend (Interface). Visual/UX only — no route/selection/bulk-wizard/backend change.

## 1. Goal
Rework `OfferProductPickerModal` to the approved mockup: wide two-region desktop modal (list + live rail), product/variant thumbnails, always-visible sticky pager, connection `<select>` in the rail above Continue (required), two-step wizard on tablet + mobile (≤1023), and a discard-changes guard on X / Cancel / outside-click.

**Visual source of truth:** the approved mockup — mirror its markup/CSS class family `offer-product-picker__*`. Non-goals: no change to the URL contract (`productIds`/`variantIds`/`connectionId`), the selection model, the bulk wizard, or any backend.

## 2. Reuse (confirmed present — do not reinvent)
- `ProductThumbnail` (`shared/ui`, props `{ name, src, size }`) — image-or-letter-tile, exactly the product-details treatment. Use for product rows (`size="md"`) and variant sub-rows (`size="sm"`/xs). Demo products have no image URL ⇒ letter tile; wire `src` from `product.images?.[0]`/variant image when present.
- `ConfirmDialog` (`shared/ui`, props `{ open, onOpenChange, onConfirm, title, description, cancelLabel, confirmLabel, tone }`) — the exact discard pattern from `bulk-edit-modal`. Reuse verbatim: title "Discard changes?", description "You have unsaved product selections. Closing now will discard them.", cancel "Keep editing", confirm "Discard changes", `tone="danger"`.
- `Select`, `CheckboxCell` (tri-state), `Dialog`/`DialogContent` — already imported by the current component.

## 3. Design (keep existing state; restructure JSX + CSS)
The current component already owns: `selection: Map<productId, 'ALL'|Set<variantId>>`, `expanded`, `offset`, `pickedConnectionId`, `variantCounts`, `useProductsQuery`/`useProductQuery`, connection filtering, and the Continue navigate. **All of that stays.** Changes:

1. **Layout:** `DialogContent` becomes a two-region flex/grid — left `.offer-product-picker__list-region` (search + list + sticky pager), right `.offer-product-picker__rail` (~340px: "In this batch" counts + grouped selection + pinned footer with connection select + Cancel/Continue). Desktop ≥1024 only.
2. **Thumbnails:** product rows + variant sub-rows render `ProductThumbnail`.
3. **Sticky pager:** move pager into a sticky footer of the list region.
4. **Connection select → rail footer**, above Continue, labelled "Publish to *"; Continue stays gated on `pickedConnectionId !== ''` (already the logic).
5. **Rail selection review:** derive per-product groups from `selection` + `variantCounts`; status chips (ready / N of M / no-EAN) reuse the `bulk-review` chip vocabulary; per-variant + per-product remove; Clear all.
6. **Two-step wizard (≤1023):** add `step: 'products' | 'review'` local state (mobile/tablet only; desktop shows both regions). Step 1 = list + sticky "Review →" bar (running count); step 2 = back-chevron + rail. CSS drives which region shows via a `data-mstep` attribute + the ≤1023 / ≤600 media queries from the mockup. Mobile ≤600 = full-screen sheet; tablet 768–1023 = centered card.
7. **Discard guard:** replace the raw `onClose` on X / Cancel / Dialog `onOpenChange`(outside/esc) with a guarded `requestClose()` — if `selection.size > 0` open `ConfirmDialog`, else close. "Discard changes" → actually close.
8. **CSS:** add the `.offer-product-picker__*` block to `apps/web/src/index.css` (tokens only, no raw hex; new tokens: none). Include the responsive rules (≤1023 two-step, ≤600 full-screen sheet) from the mockup.

## 4. Steps
1. Rewrite `offer-product-picker-modal.tsx` JSX to the two-region + rail + two-step structure, wiring existing state; add `ConfirmDialog` discard guard; render `ProductThumbnail`; move connection `Select` to the rail footer; add the mobile step state + "Review →"/back controls.
2. Replace/extend the `.offer-product-picker__*` CSS in `index.css` with the mockup's styles (desktop grid, rail, sticky pager, chips, two-step media queries, full-screen mobile sheet).
3. Update `offer-product-picker-modal.test.tsx`: keep the existing selection/URL/connection-gate/reset tests; add discard-guard tests (X/Cancel/outside with selection → confirm; empty → closes) and two-step navigation (Review → shows rail; back → list). Assert `ProductThumbnail` present.
4. Quality gate (lint/type-check/test/invariants).
5. Playwright: build the worktree web, screenshot desktop / tablet / mobile-step1 / mobile-step2 / discard, compare to the mockup; redeploy to `:8090`.

## 5. Risks
- Radix `Dialog` `onOpenChange` fires for esc/outside — route it through `requestClose()` so the discard guard covers all paths (don't let Dialog close itself directly).
- Keep a11y: the `ConfirmDialog` is a nested dialog over the picker — use its `contentClassName` elevated variant (as bulk-edit-modal does) so focus/stacking is correct.
- Two-step must not regress desktop: `data-mstep` rules apply only ≤1023.

## 6. Docs impact (hypothesis)
- `docs/frontend-ui-style-guide.md` — note the two-region-modal→responsive-two-step + discard-on-all-close-paths pattern if worth codifying; else none. No central/ADR/migration impact.

## Pre-implement gate
Skipped deliberately: frontend-only, touches no port / DTO / Symbol token / ORM / barrel contract; all reused primitives (`ProductThumbnail`, `ConfirmDialog`, `Select`, `CheckboxCell`, `Dialog`) confirmed to exist. The gate's backend-contract checks have nothing to bite on here.
