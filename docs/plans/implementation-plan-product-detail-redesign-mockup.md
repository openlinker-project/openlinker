# Implementation Plan: Product Detail Page Redesign (Mockup)

**Date**: 2026-07-09
**Status**: Draft
**Estimated Effort**: 3-4 hours

**Issue**: [#1304](https://github.com/openlinker-project/openlinker/issues/1304) — `[TASK] Frontend — Redesign Product detail page (mockups/design)`

**Note on process**: per the same convention used for the sibling issue's plan, this run does **not** create a worktree, commit, push, or open a PR. The plan and mockup are written directly to the working tree. The user commits/pushes when ready.

---

## 1. Task Summary

**Objective**: Produce a single self-contained HTML mockup at `docs/plans/mockups/product-detail-redesign.html` that redesigns the Product detail page's Overview tab (`apps/web/src/pages/products/product-detail-page.tsx`) to match the canonical cockpit composition — hero → KPI strip → 65/35 split grid — already established by Order detail and just applied to Inventory detail (#1305), while fixing three concrete, named defects: unformatted price, buried negative-stock signal, and plain-text External IDs.

**Context**: Product detail is explicitly called out (per the issue) as the *weakest* of the three entity-detail surfaces — a single full-width `KeyValueList` plus three stacked tables, versus Order detail's and (now) Inventory detail's hero/KPI/split-grid composition. #1304 is the sibling of #1305, both told to converge on the same visual language. #1305's mockup and plan already exist in this repo (`docs/plans/mockups/inventory-detail-redesign.html`, `docs/plans/implementation-plan-inventory-detail-redesign-mockup.md`) and are the concrete precedent this plan follows class-for-class, not just in spirit.

**Classification**: Frontend (Interface layer, `apps/web`) — **design artifact only**. No `.tsx`/`.ts` production files change in this issue. Scope is the **Overview tab only** — the page's separate `Content` tab (`ContentEditor`) is untouched.

---

## 2. Scope & Non-Goals

### In Scope
- One new file: `docs/plans/mockups/product-detail-redesign.html`.
- Redesigning the *visual composition* of the Overview tab: hero (image/initial thumbnail + name + SKU + copyable id + status badges), a KPI strip (Price / Available / Variants, +optional Linked-listings), and a 65/35 split grid — left: Description (own block) + Variants table; right: Stock summary + External IDs (as chips) + Created/Updated.
- Three named fixes, shown explicitly in the mockup: price formatted via `Intl.NumberFormat(currency)` (not bare `toFixed(2)`); negative/out-of-stock tone treatment on both the Available KPI and the Stock table cell; External IDs rendered as static chips instead of a plain `platform — id` list.
- Rendering that composition at three labelled, framed widths: 360, 768, 1440 (same `.viewport-frame` scaffold as #1305).
- A content/state stress-test section (many variants, long description, loading/error/empty stock states, price edge cases, chip wrapping) — added proactively this time, matching the follow-up extension the sibling #1305 mockup received after initial review.

### Out of Scope
- Any change to `apps/web/src/pages/products/product-detail-page.tsx`, `apps/web/src/features/products/components/ExternalIdsList.tsx`, or any `shared/ui/*` component. Design artifact only.
- The `Content` tab (`ContentEditor`) — untouched, not part of this redesign.
- Any API/backend change. All data (`images`, `currency`, per-variant `attributes`/`ean`/`gtin`/`externalIds`, `InventoryItem[]` stock) already exists in current responses.
- New `shared/ui` primitives. Per §4 research, a `Chip` **button** primitive already exists (`shared/ui/chip.tsx`) but is semantically interactive (`aria-pressed`, filter-toggle); using it as a static display tag would misuse it. The mockup visually borrows `.chip`/`.chip--neutral` CSS but renders plain `<span>`s, explicitly flagged as not drop-in-reusable as-is — a static `Chip` variant (or an ad-hoc span) is a decision for the implementation issue, not invented here.
- Dark-mode design decisions beyond copying the existing dark-token overrides (same convention as #1305).

### Constraints
- Same house convention as #1305: self-contained `<!doctype html>`, `data-theme="light"` default, no build step, opens standalone in a browser.
- Tokens copied **verbatim** from `apps/web/src/index.css`.
- `<title>` must include `#1304 — Product detail · UI Mockups`.
- Three standard capture widths: 360×812, 768×1024, 1440×900, as labelled framed screens on one sheet (same `.viewport-frame` + CSS-container-query technique as #1305 — `@media` can't distinguish three fixed-width frames sitting side by side in one real window).
- Must only depict primitives that exist today (`ProductThumbnail`, `KpiCard`, `StatusBadge`, `KeyValueList`, `DataTable`) plus the two *new*, cross-sibling proposals already introduced by #1305's mockup (`.kpi-strip`, the `*__primary-grid--split` / `*__stack` container-query port) — reused here under a `.product-detail__*` prefix, not reinvented.

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/web`) — design artifact (`docs/plans/mockups/*.html`), not the application itself. No hexagonal layers, ports, or CORE/Integration boundaries touched.

**Capabilities Involved**: None.

**Existing Components Represented (not modified)**:
- `apps/web/src/shared/ui/product-thumbnail.tsx` → `ProductThumbnail`.
- `apps/web/src/shared/ui/kpi-card.tsx` → `KpiCard`.
- `apps/web/src/shared/ui/status-badge.tsx` → `StatusBadge`.
- `apps/web/src/shared/ui/key-value-list.tsx` → `KeyValueList`.
- `apps/web/src/shared/ui/data-table.tsx` → `DataTable` (Variants table, Stock summary table).
- `apps/web/src/shared/ui/chip.tsx` → `Chip` — CSS shape only (`.chip`/`.chip--neutral`), rendered as static `<span>` in the mockup per the scope note above, not as the interactive `<button>` component itself.

**New Components Required**: None — static HTML mockup.

**Reference**: [Architecture Overview — Hexagonal Architecture Structure](../architecture-overview.md#hexagonal-architecture-structure).

---

## 4. External / Domain Research

Full findings from a codebase research pass (condensed; see the actual `product-detail-page.tsx`, `products.types.ts`, `products-list-page.tsx`, `chip.tsx`, `inventory-stock-status.ts` for the primary sources):

**Current Overview tab** (`product-detail-page.tsx`, Overview = default of a 2-tab page, the other being `Content`):
1. **Product metadata** `KeyValueList`: Product ID, SKU, **Price = `product.price.toFixed(2)`** (confirmed: no currency symbol, no `Intl.NumberFormat` — exactly the issue's complaint), Created, Updated, and — only if truthy — **Description**, crammed into the same list at a `minmax(160px, max-content)` label column (the issue's own "120px" claim doesn't match the shipped `160px` value; noted so the plan doesn't propagate a wrong number).
2. **External IDs** — not a table, an ad-hoc `<ul style={{...}}>` (`ExternalIdsList.tsx`) rendering `{platformType} — {externalId}` as plain mono text per row.
3. **Variants** — `DataTable` (SKU / EAN / GTIN / Attributes / External IDs-as-joined-string), empty state `"No variants found for this product."` (plain muted text).
4. **Stock** — a *separate* `InventoryItem[]` query (`useInventoryQuery`), fully-handled loading (`"Fetching inventory data…"`) / error (`"Unable to load stock"` + Retry button) / empty (`"No inventory records found for this product."`) / data (`DataTable`: productVariantId / availableQuantity **plain number, no tone at all** / reservedQuantity / locationId).

**Confirmed gaps the issue names, verified against source**:
- Price: bare `toFixed(2)`, confirmed no currency anywhere on this page (contrast: `products-list-page.tsx` already has the fix — `formatPrice()` using `Intl.NumberFormat(undefined, { style: 'currency', currency })` with an explicit muted+`title="Currency unknown"` fallback when `currency` is null — **this exact function is the pattern the KPI strip's Price card should visually match**, not `toFixed(2)`).
- Negative/zero stock: `STOCK_COLUMNS.availableQuantity` cell is `item.availableQuantity` with **zero** special-casing — no badge, no tone, nothing. Confirmed there is no per-variant stock aggregation anywhere in the products feature today (stock is separate `InventoryItem[]` rows, not folded into `ProductVariant`) — an "Available across variants" KPI is therefore a **new derived sum** this mockup introduces (`sum(items.availableQuantity)`), same category of addition as #1305's "On-hand"/"Listings count" KPIs were for Inventory detail.
- `deriveStockStatus`/`STOCK_STATUS_*` (thresholds `<=0` error / `<=5` warning / else success) lives at `pages/inventory/inventory-stock-status.ts`, page-local, **not imported anywhere in `products/`** — the mockup reuses the identical 3-state visual model (it's static HTML, no import needed), but a real implementation would need its own colocated copy under `pages/products/`, not a cross-page import (flagged, not solved here).
- External IDs: confirmed `Chip` (`shared/ui/chip.tsx`) is a real, shipped primitive — but it's a `<button aria-pressed>` filter-toggle, not a static tag. Its only production consumer today is `orders-list-page.tsx`'s filter bar. The mockup borrows the CSS shape (`.chip`, `.chip--neutral`) rendered as non-interactive `<span>`s, with an explicit comment flagging that this is *not* proof the component is drop-in reusable for a read-only context.
- `.order-detail__primary-grid--split` / `.order-detail__stack` confirmed unmoved at `index.css:9241-9256` — same ratio (`1.5fr` / `minmax(320px,1fr)` at `≥1024px`) already ported once by #1305 as `.inventory-detail__primary-grid--split`; this mockup ports the identical values again as `.product-detail__primary-grid--split` / `.product-detail__stack`, same rename convention, same container-query technique (not `@media`) for the same three-frames-in-one-window reason #1305 already solved.
- No `.prose`/rich-text block class exists anywhere in `index.css` for "promote Description to its own block" — the mockup uses the existing `.detail-section` wrapper + a plain (non-muted) `<p>`, the same pattern already used elsewhere on this exact page for muted fallback copy, just without the muted class. Flagged as the closest existing convention, not a new primitive.

---

## 5. Questions & Assumptions

### Assumptions
- **KPI strip is 4 cards** (Price / Available / Variants / Linked-listings), matching #1305's `.kpi-strip` collapse behavior (2×2 → 1×4 at narrow widths, 4-across at ≥560px container width) for visual family resemblance, even though the issue marks the 4th card ("Linked listings") as optional/out-of-must-scope since it needs a query not yet on this page. Shown here as the complete, desired end-state; safe to drop before implementation if the query isn't ready.
- **"Available" KPI = `sum(InventoryItem.availableQuantity)` across all of the product's variants** — a new derived value (see §4), tone from the same 3-state model Inventory detail already uses (`<=0` error / `<=5` warning / else success), applied at the product level.
- **Stock summary (right column) resolves `productVariantId` → the variant's own SKU** for legibility, rather than showing the raw internal id the current `STOCK_COLUMNS.productVariantId` cell does today. This is a proposed readability improvement beyond the issue's literal ask ("tone treatment on the Stock table cell") — flagged explicitly as a nice-to-have, not required; the implementation issue can keep the raw id if the join is judged out of scope.
- **External-ID chips are static `<span>`s styled with the existing `.chip`/`.chip--neutral` CSS**, not the real interactive `Chip` component — see §2/§4 Chip caveat.
- **Variants table keeps its current columns** (SKU / EAN / GTIN / Attributes / External IDs) unchanged in shape — the issue doesn't ask to redesign this table, only to move it into the left column and promote Description above/beside it.

### Documentation Gaps
- Same one #1305 already flagged: no prior mockup demonstrated the "3 widths on one sheet" pattern before #1305 invented `.viewport-frame`; this plan reuses that scaffold rather than reinventing it, per the issue's own explicit dependency note ("designed alongside #1305... cross-linked, not blocking").

---

## 6. Proposed Implementation Plan

### Phase 1: Content & data inventory
1. Confirm KPI source fields: `product.price` + `product.currency` (Price card); `sum(InventoryItem.availableQuantity)` across the product's variants (Available card, new derived sum); `product.variants.length` (Variants card); listings count (optional 4th card, needs a query not yet on this page — flagged, not blocking).
2. Confirm hero + metadata fields: name, SKU, internal id, stock-state badge (same 3-state model as #1305), variant-count badge, linked-listings-count badge.
3. Confirm Description promotion: `product.description`, conditionally rendered, moved out of the `KeyValueList` into its own `.detail-section` block.

### Phase 2: Mockup scaffold + token block
Same as #1305 Phase 2 — `<!doctype html>`, `<title>#1304 — Product detail · UI Mockups</title>`, verbatim `:root` token block + `html[data-theme='dark']` overrides, `.sheet`/`.controls`/`.toggle-btn` scaffold.

### Phase 3: Primitive CSS
1. Port `.kpi-card` family verbatim (same source lines as #1305) + the `.kpi-strip` layout wrapper — reused **identically** from #1305 (same class name, same collapse breakpoints) since both mockups are proposing the same new pattern; no drift between siblings.
2. Port `.product-detail__primary-grid--split` / `.product-detail__stack` — values from `index.css:9241-9256`, container-query version (not `@media`), same technique #1305 used inside `.viewport-frame`.
3. New `.product-hero` (renamed port of `.inventory-hero`, same grid/spacing values) + `.key-value-list`/`.data-table`/`.status-badge`/`.product-thumbnail` ported verbatim (unchanged from #1305 — same design system).
4. New, explicitly-flagged additions local to this mockup: (a) a static chip `<span>` styled off `.chip`/`.chip--neutral` (index.css:1612-1676) for the External IDs section; (b) a small `.stock-cell--error`/`.stock-cell--warning` utility (mirrors the `--status-*-fg` tokens already used by `.kpi-card--error/--warning`) so the Stock summary table's Available column can carry tone on the cell itself, not just on the KPI card — directly answers the issue's "tone treatment on... the Stock table cell" line item.
5. Reuse `.viewport-frame` verbatim from #1305 (mockup-only chrome, not a product component) — no changes needed.

### Phase 4: Compose the redesigned page, instantiate 3× framed
1. **Hero**: `ProductThumbnail` (image if `images[0]` present, else initial avatar) + name + `StatusBadge`s (stock state, "N variants", "N listings") + meta line (SKU · updated) + copyable `ol_product_…` id.
2. **KPI strip**: Price (formatted), Available (toned, new derived sum), Variants (count), Linked listings (optional, dimmed/annotated as not-yet-wired if shown).
3. **65/35 grid**: left = Description block (own `.detail-section`, plain paragraph) + Variants table; right = Stock summary (SKU-resolved, tone-celled) + External-ID chips + Created/Updated (`KeyValueList`).
4. Instantiate at 1440 / 768 / 360 inside `.viewport-frame`s, same sample product reused across all three for comparability.

### Phase 5: Content & state stress-test (proactive, mirroring #1305's follow-up)
1. **Many variants (15)** — Variants table grows, page scrolls, no pagination/virtualization (same `DataTable` defaults as #1305 confirmed); mobile (360px) frame showing the real `@container` swap to `.data-table__cards`.
2. **Stock query states** — loading (`"Fetching inventory data…"`), error (`"Unable to load stock"` + Retry), empty (`"No inventory records found for this product."`) — verbatim copy from source, flagged as plain text today (no skeleton), same inconsistency #1305 flagged for its own Listings block.
3. **Long content** — long description (wraps, no truncation, matching `.key-value-list`/prose convention), long SKU/EAN (wraps in `KeyValueList`, truncates-with-ellipsis in table cells per the same `.data-table td .mono-text` 20ch rule #1305 already surfaced — reused finding, not rediscovered).
4. **Price edge cases** — null currency (muted + `title="Currency unknown"`, matching `products-list-page.tsx`'s real fallback), large amount with thousands-separator grouping, zero price.
5. **Chip wrapping** — 10+ External-ID chips wrapping across multiple lines in the narrow right column.
6. **Tone appendix** — Available KPI + Stock-cell tone across all 3 stock states (error/warning/success), mirroring #1305's appendix exactly, satisfying the issue's explicit "Available uses error tone when negative" criterion.

### Phase 6: Self-review + follow-up implementation issue
Same as #1305 Phases 5–6: verify against the issue's own acceptance checklist by inspection; open a follow-up implementation issue once the mockup is reviewed and accepted (not executed as part of this plan).

---

## 7. Alternatives Considered

### Alternative 1: Invent a new page-specific KPI-strip/split-grid pattern instead of reusing #1305's
- **Why Rejected**: The issue explicitly requires sharing one visual language with #1305; inventing a second pattern for the same problem would defeat that requirement and create visible drift between two sibling pages shipped days apart.

### Alternative 2: Use the real interactive `Chip` component as-is for External IDs
- **Why Rejected**: `Chip` is a `<button aria-pressed>` filter-toggle; using it for static display data would render a clickable, focusable button that does nothing — a real accessibility/interaction smell. Borrowing the CSS shape as a `<span>` and flagging the gap is the honest choice; inventing a whole new static-chip primitive is out of scope ("no new primitive").

### Alternative 3: Fold Stock into the Variants table instead of keeping two tables
- **Why Rejected**: Production's data model doesn't support it today — stock is a separate `InventoryItem[]` query keyed by `productVariantId`, not a field on `ProductVariant`. The issue's own target composition explicitly keeps them as two things ("Variants table" on the left, "Stock summary" on the right); collapsing them would require a data-model change the issue doesn't ask for.

---

## 8. Validation & Risks

### Architecture Compliance
✅ No hexagonal layers touched; artifact lives entirely under `docs/plans/mockups/`.

### Risks
- **New derived "Available" sum has no existing production aggregation** — flagged explicitly in §4/§5, not silently presented as already-computed data.
- **Static chip vs. interactive `Chip` divergence** — flagged; implementation issue must decide whether to add a static variant or use ad-hoc markup, not silently reuse the button component.
- **Visual drift risk from #1305 is minimized**, not eliminated — both mockups now exist, so this plan can (and does) copy #1305's actual shipped class names/values rather than guessing at convergence, unlike #1305 itself which had to guess since #1304 didn't exist yet at that time.

### Backward Compatibility
✅ No production code changes.

---

## 9. Testing Strategy & Acceptance Criteria

Not applicable (static HTML mockup, no application code) — same as #1305 §9.

### Acceptance Criteria (mirrors the issue's own checklist verbatim)
- [ ] `docs/plans/mockups/product-detail-redesign.html` added, self-contained, tokens from `index.css`, `<title>` names `#1304`
- [ ] Shows Product detail Overview at 360 / 768 / 1440 as labelled framed screens
- [ ] Hero header rendered (thumbnail + name + SKU + copyable id + status badge[s])
- [ ] KPI strip rendered with explicit tones — Available uses error tone when stock is negative
- [ ] 65/35 grid rendered, matching `order-detail__primary-grid--split`
- [ ] Price shown formatted via currency + thousands separator
- [ ] Negative/out-of-stock treatment shown on both the Stock table cell and the Available card
- [ ] Description promoted to its own block; External IDs shown as chips
- [ ] Only existing `shared/ui` primitives represented — no new primitive
- [ ] Reviewed against `docs/frontend-ui-style-guide.md`
- [ ] Visual language matches the #1305 Inventory detail mockup
- [ ] Follow-up implementation issue created and linked (post-approval, not part of this plan)

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — N/A, design artifact only
- [x] Uses existing patterns — tokens, grid ratio, card/badge CSS sourced from shipped code or #1305's own already-accepted mockup
- [x] Naming conventions followed — file path matches the issue's required deliverable path exactly
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file — `docs/plans/implementation-plan-product-detail-redesign-mockup.md`

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Frontend Architecture](../frontend-architecture.md)
- [Frontend UI Style Guide](../frontend-ui-style-guide.md)
- Sibling mockup + plan: `docs/plans/mockups/inventory-detail-redesign.html`, `docs/plans/implementation-plan-inventory-detail-redesign-mockup.md`
- Reference production pages: `apps/web/src/pages/orders/order-detail-page.tsx`, `apps/web/src/pages/products/product-detail-page.tsx`, `apps/web/src/pages/products/products-list-page.tsx`
