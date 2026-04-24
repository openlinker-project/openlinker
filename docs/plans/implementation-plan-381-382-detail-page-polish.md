# Implementation Plan — #381 + #382 Detail-Page Polish

**Branch:** `381-382-detail-page-polish`
**Scope:** FE-only. Rebuild inventory detail page (#381) + enrich order detail page §1–§3 (#382).
**Deferred:** #382 §4 (BE item display info) — requires domain extension; filed as a follow-up BE issue after this PR lands.

---

## 1 · Goal & classification

**Layer:** Frontend (`apps/web/src/`). No API, core, worker, or migration changes.

**Goal:** Two detail pages currently useless-for-operators get rebuilt with the data already available in the API, using existing shared primitives. Voice stays refined-minimal per `docs/frontend-ui-style-guide.md` (Shopify admin clarity + Linear polish).

**Explicit non-goals** (out of scope — filed as follow-ups):

- Inventory "Adjust stock" action (needs BE endpoint — follow-up)
- Inventory movement / adjustment history (needs BE — follow-up)
- Per-inventory-item sync activity feed (needs BE — follow-up)
- Per-variant low-stock threshold configuration (BE + FE — follow-up)
- **#382 §4a/§4b — item `name`/`imageUrl` propagation through Allegro adapter + `OrderRecordService`** — requires extending unified `OrderItem` domain type; filed as a follow-up BE issue. FE schema already treats these fields as optional so nothing regresses.
- Product-image enrichment for marketplace items (separate issue)
- Customer merge/split, order status-transition UI, item-level sync diagnostics

**Dependency on #380 (BackLink primitive):** non-blocking. Keep current ad-hoc back-link in place; migrate in #380's own PR.

---

## 2 · Design decisions (with rationale)

### 2.1 Single branch, two commits, one PR closing both issues

Both issues are FE-only, touch non-conflicting file sets, and share the same design voice. Reviewing them together is cheaper than two separate PRs. Commit structure:

- Commit 1: `feat(web): rebuild inventory detail page — hero, KPIs, cross-links, listings (#381)`
- Commit 2: `feat(web): enrich order detail page — customer card, resilient snapshot, totals block (#382)`

PR body uses `Closes #381` and `Closes #382`.

### 2.2 `ProductThumbnail` gets an `lg` size variant

`ProductThumbnail` currently has `sm` / `md`. The inventory hero needs a bigger image. The right move is extending the shared primitive, not inventing a one-off image renderer in `pages/inventory/`. Cost: one entry in the size union, one CSS rule. No consumer breakage — default stays `md`.

### 2.3 Inventory status derivation is a pure helper, not a hook

`deriveStockStatus(available, lowThreshold?)` lives as a pure function at `pages/inventory/inventory-stock-status.ts`. Pure → easy to unit-test without mocking React. Co-located because it's page-local logic, not shared across features. `lowThreshold` defaults to `5` (constant); per-variant thresholds are deferred.

### 2.4 Soft-parse `parseOrderSnapshot` via independent sub-tree `safeParse`

Today `parseOrderSnapshot` returns `null` on any failure, which binary-gates every enriched section. The fix is to `safeParse` each sub-tree (items, totals, shippingAddress, billingAddress) independently and surface failures through a new `parseIssues` array on the result. Callers stop gating on a single parsed value.

Key design note: the top-level `orderSnapshotSchema.id` is required today, which is the most common failure point. Loosen it to optional on the top-level read — the UI tolerates missing `id` because it keys off `order.internalOrderId` (the outer record's ID), not the snapshot's. The schema's `id` was never load-bearing.

### 2.5 Customer card always renders (with a null-state branch)

When `order.customerId` is null, render a muted inline message — same card chrome, different content — rather than suppressing the column. This keeps the three-column grid stable across orders and makes the null case discoverable ("why is this empty?" gets an inline answer).

### 2.6 Totals panel extracted from line-items panel

The totals rollup currently lives inside `OrderLineItemsPanel`. Extracting it means totals remain visible when items fail to parse, and the financial summary gets its own visual anchor (grand-total emphasised via weight + size, not colour). `OrderLineItemsPanel` loses its `totals` prop.

### 2.7 Inventory hero layout: `grid-template-columns: auto 1fr` on wide, stacks on narrow

No new tokens. Uses existing `var(--space-*)`, `var(--bg-surface)`, `var(--border-subtle)` from the monochrome palette shipped in #371.

---

## 3 · Files changed

### 3.1 #381 — Inventory detail (commit 1)

**Modify**
- `apps/web/src/pages/inventory/inventory-detail-page.tsx` — full rewrite against new layout
- `apps/web/src/shared/ui/product-thumbnail.tsx` — add `'lg'` to size union
- `apps/web/src/index.css` — add `.inventory-detail__hero`, `.inventory-detail__kpi-row`, `.inventory-detail__section`, `.product-thumbnail--lg`

**New**
- `apps/web/src/pages/inventory/inventory-stock-status.ts` — `deriveStockStatus`, `StockStatus` union
- `apps/web/src/pages/inventory/inventory-stock-status.test.ts` — three-branch coverage + threshold edge cases
- `apps/web/src/pages/inventory/inventory-detail-page.test.tsx` — hero renders, KPI row values, status badge reflects thresholds, cross-links render, listings section renders + empty, loading/error states

### 3.2 #382 — Order detail enrichment §1–§3 (commit 2)

**Modify**
- `apps/web/src/features/orders/api/order-snapshot.schema.ts` — soft-parse, `parseIssues`, top-level `id` loosened
- `apps/web/src/pages/orders/order-detail-page.tsx` — ungate sections, add customer column, totals block, parse-issues alert, three-column primary grid
- `apps/web/src/features/orders/components/order-line-items-panel.tsx` — drop totals prop + rollup
- `apps/web/src/features/orders/components/order-line-items-panel.test.tsx` — drop totals assertions
- `apps/web/src/index.css` — `.order-customer-card`, `.order-totals-panel`, extend `.order-detail__primary-grid` to three columns on wide viewports

**New**
- `apps/web/src/features/orders/components/order-customer-card.tsx`
- `apps/web/src/features/orders/components/order-customer-card.test.tsx`
- `apps/web/src/features/orders/components/order-totals-panel.tsx`
- `apps/web/src/features/orders/components/order-totals-panel.test.tsx`
- `apps/web/src/features/orders/api/order-snapshot.schema.test.ts` — if not already present; covers full-parse, missing `id`, items with missing `productId`, invalid `totals` + valid `items`, empty object

---

## 4 · Step-by-step implementation

### Phase A · Shared primitive extension (foundation for #381)

**A.1** · Extend `ProductThumbnail` with `'lg'` size.
- File: `apps/web/src/shared/ui/product-thumbnail.tsx`
- Change: `type ProductThumbnailSize = 'md' | 'sm'` → `'md' | 'sm' | 'lg'`
- Change: `const size = props.size ?? 'md'` → unchanged
- CSS: new rule `.product-thumbnail--lg` with 96px square, `font-size: 2rem` for initial fallback

**A.2** · Test: `product-thumbnail.test.tsx` — add an `lg` size test if the file exists; otherwise skip (not a regression risk).

### Phase B · #381 Inventory detail rebuild

**B.1** · Create `inventory-stock-status.ts` with pure helper:
```ts
export type StockStatus = 'out-of-stock' | 'low-stock' | 'in-stock';
export function deriveStockStatus(available: number, lowThreshold = 5): StockStatus {
  if (available <= 0) return 'out-of-stock';
  if (available <= lowThreshold) return 'low-stock';
  return 'in-stock';
}
```
Map each status to `{ label, tone: StatusBadgeTone }` in the same file.

**B.2** · Create `inventory-stock-status.test.ts` — unit-test three branches + threshold boundary (0, 1, `lowThreshold`, `lowThreshold + 1`, custom threshold).

**B.3** · Rewrite `inventory-detail-page.tsx`:
- Keep loading/error states (unchanged from current).
- Drop the single `KeyValueList` layout.
- Render hero: `ProductThumbnail size="lg" src={item.productImageUrl} name={item.productName ?? 'Inventory item'}` + headline (product name) + SKU line + `StatusBadge` (tone from `deriveStockStatus`) + copyable inventory UUID chip.
- `PageLayout.title` = `item.productName ?? 'Inventory item'` (not the UUID).
- `PageLayout.actions` = `<Link className="button button--primary" to={`/products/${item.productId}`}>View product</Link>` + keep existing back link (migrate to `BackLink` when #380 lands).
- Three-column KPI row (`KpiCard` ×3): Available (tone from status), Reserved (neutral), On hand (neutral).
- "Item details" section: `KeyValueList` with variant (with `"Simple product — no variants"` fallback when `productVariantId` is null), SKU, location (`"Default location"` when null), updated (`TimeDisplay` — existing component), product ID as `EntityLabel` linking to `/products/${item.productId}`.
- "Listings using this stock" section: `useListingsQuery({ internalId: item.productVariantId ?? item.productId })` → `DataTable`. Inline-empty message when no rows.

**B.4** · CSS in `index.css`:
```css
.inventory-detail__hero {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 1.25rem;
  align-items: start;
  padding: 1.25rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 0.75rem;
}
.inventory-detail__hero-body { display: grid; gap: 0.5rem; }
.inventory-detail__hero-title { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
.inventory-detail__hero-meta { display: flex; gap: 1rem; color: var(--text-muted); font-size: 0.875rem; }
.inventory-detail__kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.inventory-detail__section { display: grid; gap: 0.75rem; }
@media (max-width: 768px) {
  .inventory-detail__hero { grid-template-columns: 1fr; }
  .inventory-detail__kpi-row { grid-template-columns: 1fr; }
}
```

**B.5** · Test: `inventory-detail-page.test.tsx`.
- Mock `InventoryApi.getById` via `createMockApiClient`.
- Assertions:
  - Renders hero with product name, image (via `src` attribute), SKU chip.
  - Stock-status badge label corresponds to quantity: 0 → "Out of stock", 3 → "Low stock", 100 → "In stock".
  - KPI row shows three values: Available, Reserved, On hand (= sum).
  - "View product" link points to `/products/${productId}`.
  - Variant shows "Simple product — no variants" when `productVariantId` is null.
  - Location shows "Default location" when `locationId` is null.
  - "Listings using this stock" section renders listings or the inline empty message.
  - Loading state renders `LoadingState`, error state renders `ErrorState` with Retry button.

### Phase C · #382 Order detail enrichment

**C.1** · Rewrite `order-snapshot.schema.ts`:
- Add sub-schema exports: `orderItemsSchema`, `orderTotalsSchema`, `addressSchema` (already defined internally — promote to exports).
- Change top-level `orderSnapshotSchema.id` from `z.string()` to `z.string().optional()`.
- Add new `ParsedOrderSnapshot` shape with `parseIssues: Array<{ field: string; message: string }>`.
- Rewrite `parseOrderSnapshot(snapshot: Record<string, unknown>): ParsedOrderSnapshot` to never return null; parse each sub-tree independently via `safeParse` and collect issues.
- Export `ParsedOrderItem`, `ParsedOrderTotals`, `ParsedAddress` as before.

**C.2** · Create `order-snapshot.schema.test.ts`:
- Full-valid snapshot → all fields populated, `parseIssues` empty.
- Missing top-level `id` → returns result without `id`, no `parseIssues` entries for it (since we loosened).
- Items with missing `productId` → item omitted from `items` array, `parseIssues` contains an entry pointing at the offending index.
- Invalid `totals` but valid `items` → `totals` is `undefined`, `items` populated, `parseIssues` contains `{ field: 'totals', ... }`.
- Completely empty object `{}` → `items: []`, no other fields, `parseIssues` empty (everything is optional).

**C.3** · Extract `OrderTotalsPanel`:
- New file `apps/web/src/features/orders/components/order-totals-panel.tsx`.
- Props: `{ totals: ParsedOrderTotals }` (caller guards on presence).
- Reuses the existing `.order-totals` / `.order-totals__row` / `.order-totals__row--total` CSS classes — don't duplicate; update `index.css` only if the extraction requires class renames (it shouldn't).
- Currency formatting via `Intl.NumberFormat(undefined, { style: 'currency', currency: totals.currency })` with a fallback to bare numeric formatting when `currency` is missing.

**C.4** · Create `order-totals-panel.test.tsx`:
- All fields present → renders subtotal, shipping, tax, total.
- `shipping === 0` / `tax === 0` → rows omitted (preserves current behaviour).
- Missing currency → numeric-only formatting without throwing.

**C.5** · Drop totals from `OrderLineItemsPanel`:
- Remove `totals` prop + rollup JSX.
- Update its test file to drop totals assertions — assertions for the table itself remain.

**C.6** · Create `OrderCustomerCard`:
- New file `apps/web/src/features/orders/components/order-customer-card.tsx`.
- Props: `{ customerId: string | null }` — component handles all the plumbing (query, loading/error/empty/data).
- When `customerId === null`: render muted inline message "No customer linked — order may be a guest checkout or customer resolution failed." (no card outline).
- When loading: render card shell with skeleton-light placeholders (one line for name, one for email).
- When error: muted inline "Couldn't load customer details" + Retry button.
- When data present:
  - Display name: `firstName + lastName` joined, fallback "Unknown name".
  - Email: `normalizedEmail` if present; else `emailHash` rendered as a short `mono-text` chip (use `substring(0, 12) + '…'`).
  - Last seen: `TimeDisplay iso={customer.lastSeenAt}`.
  - Previous orders count: `useOrdersQuery({ customerId }).data?.total` — render "N previous orders" as a link to `/customers/${customerId}` when > 0.
  - "View customer →" link at bottom.

**C.7** · Create `order-customer-card.test.tsx`:
- Raw PII mode (normalizedEmail + firstName + lastName present) → full name + email rendered.
- Hash-only mode (normalizedEmail null, firstName/lastName null) → "Unknown name" + emailHash chip.
- `customerId === null` → muted message, no customer query triggered (assert `apiClient.customers.getById` not called).
- Loading → skeleton shell visible.
- Error → "Couldn't load customer details" + Retry.
- Orders query result → "N previous orders" link renders with correct count.

**C.8** · Wire up `order-detail-page.tsx`:
- Replace `const snapshot = parseOrderSnapshot(order.orderSnapshot)` — new return shape is never null.
- Extend `.order-detail__primary-grid` to three columns on wide viewports via CSS media query; add `<OrderCustomerCard customerId={order.customerId} />` as third column.
- Ungate line items: render when `snapshot.items.length > 0` (not on `snapshot` truthiness).
- Ungate addresses: render each when its own sub-tree is present.
- Add `<OrderTotalsPanel totals={snapshot.totals} />` next to line items (or below on narrow viewports) — render when `snapshot.totals` present.
- Parse-issues alert: when `snapshot.parseIssues.length > 0`, render `<Alert tone="warning">Some order fields couldn't be parsed — see raw snapshot below.</Alert>` above line items with an anchor link to the raw snapshot section's id.

**C.9** · CSS updates in `index.css`:
- Extend `.order-detail__primary-grid` to `grid-template-columns: 1.2fr 1fr 1fr` on `min-width: 1024px`, `1fr 1fr` on tablet, `1fr` on narrow.
- Add `.order-customer-card` block matching the existing `.detail-section` card chrome — same border, background, padding, radius.
- Reuse existing `.order-totals*` classes for `OrderTotalsPanel` (class names unchanged from extraction).

---

## 5 · Test strategy

Unit + component tests only; no integration tests needed for FE-only changes.

**Coverage deltas:**
- Pure helpers (`deriveStockStatus`, `parseOrderSnapshot`): 100% branch coverage.
- Components: happy path, loading, error, empty, per the FE rules.

**Command:** `pnpm test` in worktree root runs all vitest suites across the monorepo (unit tests only; no Docker needed).

---

## 6 · Validation checklist (pre-commit)

For each commit:

- [ ] Architecture compliance: `shared` doesn't import from `features` or `pages`; `pages` doesn't cross-feature-import; no core boundary violations.
- [ ] Naming: `kebab-case.tsx` components, `use-*.ts` hooks, `*.test.tsx` tests, `*.schema.ts` zod schemas, `*.types.ts` types.
- [ ] No `any`, no `console.log`, no hardcoded secrets.
- [ ] All four states handled on every page/component that fetches.
- [ ] Pure vanilla CSS using existing tokens only — no new custom properties introduced.
- [ ] `tone` (not `variant` / `color`) for variant props; class construction with `.filter(Boolean).join(' ')`.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` pass with zero errors.

---

## 7 · Risks & open questions

| Risk | Mitigation |
|---|---|
| Extending `ProductThumbnail` with `lg` breaks existing snapshot tests | Tests assert tone + src; size is a modifier class, not part of assertions. Audit at implementation time. |
| `useOrdersQuery({ customerId })` may return full page (expensive) just for count | Use `pagination: { limit: 1 }` — backend returns `total` in payload regardless. Low cost. |
| Three-column grid breaks the order detail at ~1024px tablet | Explicit media-query breakpoints: 3-col ≥1024px, 2-col 768–1023px, 1-col <768px. Matches existing tablet anchor from memory. |
| #382 §4 deferral leaves line items with SKU-only rendering | Accepted — existing fallback chain `name ?? sku ?? productId` already handles it; no regression from current behaviour. Follow-up BE issue tracks the enrichment. |
| `parseOrderSnapshot` behavioural change could silently regress callers | Only one caller (the page). Schema tests plus page tests cover the new contract. |

**No open questions requiring user input** — the issue specs are prescriptive enough.

---

## 8 · Follow-ups to file after merge

1. **BE — Propagate item `name`/`imageUrl` end-to-end.** Extend `OrderItem` on the unified domain (`libs/core/src/orders/domain/types/order.types.ts`) with optional `name`/`imageUrl`; propagate through `OrderRecordService.persistOrder`; map `lineItem.offer.name` in `AllegroOrderSourceAdapter`. Updates specs in both locations. This is exactly §4 of #382, deferred per the issue's own guidance.
2. **BE — `InventoryAdjustment` HTTP endpoint.** Domain type already exists; add controller + use case; then FE dialog + mutation hook.
3. **BE — Inventory movement / adjustment history read model.** Needs persistence of adjustment events.
4. **FE — Per-inventory sync activity feed.** Needs sync-jobs endpoint filter by affected inventory ID.
5. **FE — Product-image enrichment for marketplace items** (resolve internal Product via `productId` to show images on Allegro orders where `imageUrl` is blank).
