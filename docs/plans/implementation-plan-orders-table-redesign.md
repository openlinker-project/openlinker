# Implementation Plan — Responsive /orders table redesign + order deep links (#1713)

## 1. Goal & classification

Surface shipment (carrier + status), payment status, and a sortable created-at date directly in the `/orders` list rows; make the table responsive across three breakpoints (desktop full table, tablet condensed table, mobile cards); rework the accordion; render multi-item orders properly; and add "Open order" deep links (source marketplace + master shop) in the accordion.

- **Layer**: Frontend (bulk) + Integration/Interface (deep links, payment sort key).
- **Non-goals**: no change to the order ingestion pipeline, no new shared UI primitives, no order-detail-page changes, no change to which data the list endpoint returns beyond the additive `externalUrl` / `payment` sort.

A faithful 3-breakpoint mockup is approved (design signed off).

## 2. Frontend design (self-contained; reads data the list already loads)

All in `apps/web`. Styling stays vanilla CSS + OKLCH tokens in `index.css` (bounded `/* ── Orders list redesign (#1713) ── */` section), `StatusBadge` for pills, `.mono`/`.tabular` for ids/numerics. Theme-aware.

### 2.1 Unified column model (`orders-list-page.tsx` columns useMemo)
Desktop columns: `select, order, customer, channel, status, shipment, money`. Tablet: same minus `channel` (folds under order name) via `hideBelow`.
- **status** (id `status`): sync health only (`deriveOrderHealth`) — unchanged content, keeps single-arrow sort.
- **shipment** (new merged id, replaces `fulfillment` + `shipBy`): stacked cell = fulfillment badge (`fulfillmentBadge`) + ship-by SLA badge (`slaBadge` + live countdown from `dispatchByAt`) + carrier sub-line (`parsed.shipping?.methodName ?? parsed.pickupPoint?.name`).
- **money** (new merged id, replaces `total`): right-aligned stack = total (`formatCurrency`), payment pill (`parsed.paymentStatus`), created (`order.createdAt`).
- **order** cell gains an items line: first item name (truncated) + `+N` chip when `parsed.items.length > 1`.

### 2.2 Per-label sorting (composite headers)
The `shipment` and `money` columns are declared **non-sortable** (`sortable` omitted) so `DataTable` renders their `header` ReactNode verbatim (confirmed: `data-table.tsx` renders the node as-is when `!canSort`). Each header is a small vertical stack of `<button class="sortbtn">` controls:
- shipment header → `Shipment` (key `fulfillment`) + `Ship-by` (key `dispatchBy`).
- money header → `Total` (`total`) + `Payment` (`payment`) + `Created` (`createdAt`).

Extract the existing sort-toggle logic from `onSortChange` (lines ~977-996) into a page-level `applySort(key: OrderSortValue)` that toggles dir if `key === sort` else `DEFAULT_DIR[key]`, and writes `sort`/`dir` to the URL (dropping `offset`). Both the react-table `onSortChange` (for `customer`/`status`) and the custom header buttons call `applySort`. Each button shows its active state + ▲/▼/↕ derived from the page's `sort`/`dir`. Update `SORT_KEY_TO_COLUMN` / `COLUMN_TO_SORT_KEY` / `DEFAULT_DIR` for the new/renamed column ids and `payment`.

### 2.3 Accordion rework (`order-row-detail.tsx` + CSS)
- Inset "drawer": `tr.detail-row td` gets side padding; the inner panel background = `color-mix(in oklch, var(--bg-surface), black 7%)` (theme-safe recess), border, radius.
- Field order regrouped: `Order reference · Internal ID · Placed · Destination` first, then a full-width **line-item list** (`qty × name`, SKU beneath, line price right — one row per `parsed.items[]`), then Shipping / Billing addresses.
- New "Open order" links strip at the top (§3.3).

### 2.4 Mobile cardView rewrite (`orders-list-page.tsx` cardView)
Replace the always-expanded full `OrderRowDetail` dump with: header (order name + id chip, amount right, channel sub), badge row (status / ship-by / shipment), one-line items summary, a 2×2 facts grid (Customer, Payment, Shipment carrier, Created), and the full `OrderRowDetail` **collapsed behind a "View full details" disclosure** (local `useState` toggle inside the card detail renderer).

### 2.5 View-model helpers
Add small pure helpers to `features/orders/lib/order-health.ts` (or a new `order-row.ts`) for the items summary (`{firstName, moreCount}`) and payment badge tone/label; unit-test them (`.test.ts`).

## 3. Backend design

### 3.1 Payment sort key (small, self-contained)
- `libs/core/src/orders/domain/types/order-record.types.ts`: add `'payment'` to `OrderRecordSortValues`.
- `order-record.repository.ts`: add `PAYMENT_EXPR = rec."orderSnapshot"->>'paymentStatus'` and `case 'payment'` in `applySort` (`orderBy(PAYMENT_EXPR, d('ASC'), 'NULLS LAST').addOrderBy('rec.createdAt','DESC')`). Alphabetical ordering is acceptable; a semantic CASE ordinal is optional. (Companion expression index migration optional — low row counts; skip unless perf demands it.)
- FE mirror: add `'payment'` to `OrderSortValues` in `features/orders/api/orders.types.ts` + the sort maps.

### 3.2 Source-marketplace deep link (moderate)
The source external id is not reliably on a `ready` `OrderRecord`, so build the URL where the adapter knows both the scheme and the id, and persist it onto the snapshot:
- `libs/core/src/orders/domain/types/incoming-order.types.ts`: add optional `externalUrl?: string`.
- Source adapters populate it in `getOrder`:
  - Allegro: `getAllegroWebBaseUrl(env)` sibling → add a `getAllegroSalesCenterOrderUrl(env, checkoutFormId)` host helper in `allegro-hosts.ts`; adapter reads `connection.config.environment` (currently discards `_connection`).
  - Erli: confirm seller-panel order URL scheme; if none is confirmable, leave `undefined` (link hidden).
  - PrestaShop-as-source: `{connection.config.baseUrl}` + order id (front-office order URL, or admin per §3.3 decision).
- Persist into the snapshot in `order-record.service.ts` (`persistOrder` + `persistIncomingSnapshot`) as `orderSnapshot.sourceExternalUrl`. API `toDto` already returns the snapshot verbatim, so the FE reads `parsed.sourceExternalUrl` — **no API-layer change, no per-row lookup**.
- FE: extend `order-snapshot.schema.ts` `ParsedOrderSnapshot` with `sourceExternalUrl?`, render the source link in the accordion strip when present.

### 3.3 Master-shop (destination) deep link — DEFERRED (decided)
**Decision: option A — deferred to a separate follow-up issue.** The destination `externalOrderId` (PrestaShop `id_order`) is on the sync-status row, but a working PrestaShop admin URL needs the per-employee `token` and the randomized admin-dir, neither stored in connection config — a genuine data gap. This PR ships only the source-marketplace link (§3.2). A follow-up issue will cover the master link (likely by adding an optional `adminDir` to PrestaShop connection config + `OrderSyncStatusResponseDto.externalUrl` + an async per-request destination-config resolve in `orders.controller.ts`). The FE accordion links strip is built so a `destinationExternalUrl` simply lights up a second link when it later exists.

## 4. Step-by-step plan (one PR, sequenced commits)

1. **feat(web): unified column model + shipment/money merged cells + items `+N`** — `orders-list-page.tsx`, `order-health.ts` helpers, `index.css`; unit tests for helpers + column render.
2. **feat(web): per-label sort controls** — `applySort` extraction, composite headers, sort maps.
3. **feat(web): accordion rework + line-item list** — `order-row-detail.tsx`, CSS.
4. **feat(web): mobile card rewrite + disclosure** — cardView config, CSS; card tests.
5. **feat(orders): add `payment` sort key** — core enum + repo expr + FE mirror; repo/int test.
6. **feat(orders): source-marketplace deep link** — `IncomingOrder.externalUrl`, adapters, snapshot persistence, FE schema + render; adapter unit tests.
7. ~~master-shop deep link~~ — **deferred to a follow-up issue** (§3.3).

Each step keeps `pnpm lint` / `type-check` / `test` green.

## 5. Validation

- **Architecture**: URL-scheme knowledge stays in adapters (source link built in `getOrder`); no platform strings in core/FE. Payment sort stays in core + repo. No CORE↔Integration boundary crossing.
- **Naming/conventions**: FE per `.claude/rules/frontend.md` (tokens, StatusBadge, mono/tabular, kebab files). BE per engineering-standards.
- **Testing**: unit tests for new FE view-model helpers + card/column render; repo integration test for the `payment` ORDER BY; adapter unit tests for URL builders.
- **Security**: deep links are `rel="noopener"` external anchors; no secrets in URLs.

## 6. Open questions / risks

1. **§3.3 master-shop link** — defer (A), add config (B), or front-office (C)? (Recommend A.)
2. **Erli source URL** — is there a public seller-panel order URL scheme? If not, Erli source link is hidden (graceful).
3. **Composite sort headers** — two headers with multiple sort buttons is a dense, non-standard affordance; verify discoverability on the live UI (`/verify`) before finalizing. Fallback: split back into separate columns.
4. **Payment sort ordering** — alphabetical vs semantic ordinal; alphabetical is fine for MVP.
