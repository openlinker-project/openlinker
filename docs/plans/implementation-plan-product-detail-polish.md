# Implementation Plan — Product detail polish (#1752)

## 1. Goal & layer

Frontend-only polish of `/products/:id` (Overview tab). Match the approved design mockup
(https://claude.ai/code/artifact/e27cee32-0cf6-4c53-b0b6-8ee9a27a4780). Dark + light preserved,
existing OKLCH tokens only, existing shared components reused.

**Layer:** Frontend / Interface — `apps/web/src/pages/products/**`, `apps/web/src/features/products/**`,
`apps/web/src/index.css`.

**Non-goals:** no backend changes; no new design tokens (unless forced, then `index.css` → `tokens.ts`);
no change to the Content tab; no new per-variant "listing gap" API (derive from existing data).

## 2. Reuse (verified in repo)

- `VariantStockTable` is used **only** by `product-detail-page.tsx`; `product-detail-hero`,
  `product-detail__kpi-row`, `description-block`, `id-chip*` CSS are page-local — safe to restyle.
- Cockpit row language already exists as global CSS: `.coverage-pill(--full/--partial/--none)`,
  `.channel-pill`, `.products-row-cta`, `.products-variant-row*`, `.products-detail-*`,
  `.products-cell-stack`, `.status-badge*`. Reuse verbatim; add only the table-specific chrome.
- Per-listing rich detail: `useListingMarketplaceOfferQuery(mappingId, { enabled })` (retry:false,
  30s stale) returns `{ status, title, price{amount,currency}, availableQuantity, category, marketplaceUrl, endsAt }`.
- Active OfferCreator connections + create-offer launch: mirror `products-list-page.tsx`
  (`useConnectionsQuery` → filter `status==='active' && supportedCapabilities.includes('OfferCreator')`,
  `MarketplacePickerModal`, navigate `/listings/bulk-create/wizard?productIds=&connectionId=`).
- Stock tones: `deriveStockStatus` / `STOCK_STATUS_BADGE_TONE` / `STOCK_STATUS_LABEL` (page-local helper).
- Marketplace status → tone: replicate the tiny `statusTone` helper (ACTIVE/BIDDING→success,
  ENDED/INACTIVE→warning, else neutral).

## 3. Design

### 3.1 `product-detail-page.tsx`
- **KPI strip:** merge the `--cols-1` Price card + `--cols-3` stat row into one 4-tile strip
  (`--cols-4`): Price / Available / Variants / Listings. Keep Available's tone + Price accent rule.
- **Description → read-only Source clarity:** keep the block, add a `Source · read-only` `StatusBadge`
  tag in the section header + an "Edit in Content →" link; empty state points to the Content tab.
- **"External IDs" → "Source":** new `ProductSourceSection` (feature component) — renders the master
  origin (`externalIds[0]`) as `channel-pill` + connection name + `platformType · externalId` with a
  `Master` badge; remaining mappings render below via existing `ExternalIdChips`. Needs connections
  (name) + `usePlatforms` (label).
- **Create-offer plumbing:** add `useConnectionsQuery`, derive `offerCreatorConnections`, `MarketplacePickerModal`,
  `goToWizard`; pass `connections` / `canCreateOffers` (`useWriteAccess('listings:write', demoMode)`) /
  `onCreateOffers` into `VariantStockTable`.

### 3.2 `variant-stock-table.tsx` (rewrite)
- Full-width `.data-table` (drop `min-width: 640px`; add mobile card transform).
- Columns: expand · **Variant** (SKU/attrs + `EAN … · SKU` meta) · **Stock** (`avail / res n` + IN STOCK
  badge, `products-cell-stack`) · **Listings** (coverage pills full-per-listed-connection + `+ Create offer`
  CTA on gap) · **Price** (master variant price, right) · **Updated** (right).
- **Rich drawer:** inset panel (`products-row-detail` look) — per listing a `ListingDetailCard`
  (own `useListingMarketplaceOfferQuery`, enabled only when row open + `entityType==='Offer'`):
  channel-pill + connection (`ConnectionEntityLabel`) + status badge + price + qty + offer-id link
  (`/listings/:id`) + category + marketplace URL + updated. Falls back to mapping-only fields on
  loading/unavailable (non-offer, 404/422).
- **Mobile (<640px):** table → stacked accordion cards (tappable header: SKU + stock badge + chevron;
  expanded: labelled grid + listing cards).

### 3.3 `index.css`
New bounded section `/* ── Product detail v2 (#1752) ── */`:
- `.product-detail__kpi-row--cols-4` (4 → 2 → 2 responsive).
- `.product-source*` (source item + Master tag + secondary chips).
- `.variant-stock-table` full-width table chrome + listing-detail cards (`.variant-listing-card*`).
- Hero responsive: `.product-detail-hero` single-column + full-width gallery under 768px;
  facts as auto-fit grid with `overflow-wrap:anywhere` (kills char-wrap).
- Mobile card transform for the variant table under 640px.

## 4. Steps

1. `index.css` — add the v2 section (KPI cols-4, source, hero responsive, table chrome, listing cards, mobile cards).
2. `variant-stock-table.tsx` — rewrite (props, columns, coverage pills, rich drawer, mobile cards).
3. `product-source-section.tsx` — new feature component (`features/products/components`).
4. `product-detail-page.tsx` — KPI strip merge, Description tag+link, Source section, create-offer plumbing, table props.
5. Tests — update `variant-stock-table` test (if present) + add coverage-pill / drawer / source-section cases.
6. Quality gate: `pnpm lint`, `pnpm type-check`, scoped `pnpm test`.
7. Visual verify: run web (worktree) against demo API :3000, screenshot desktop 1280 + mobile 375, compare to mockup.

## 5. Validation

- FE dependency direction respected (pages → features → shared; barrel imports; no raw fetch).
- No `any`; explicit return types on components; tokens only (drift check green).
- All four async states handled in the drawer (loading/error/empty/data).
- a11y: expand buttons keep `aria-expanded`/`aria-label`; focus rings via `shadow-focus`; color paired with text/badge.

## Risks

- Create-offer wiring pulls the picker modal + write-access gate onto the detail page — mirrors the list page 1:1 to stay low-risk.
- Per-listing detail fan-out: one query per listing on expand — bounded (a variant has a handful of listings), lazy, retry-off.
