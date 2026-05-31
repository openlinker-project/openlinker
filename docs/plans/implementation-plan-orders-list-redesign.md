# Implementation Plan — Orders list (`/orders`) UX redesign (#929)

> Spec mockup: `docs/plans/orders-list-redesign-mockup.html` (standalone, verified light + dark).
> Sibling FE redesign: #924 (order detail). Data-capture epic: #925 → #926/#927/#928.

## 1. Goal & layer classification

Reshape the existing `OrdersListPage` from a **sync log** into an operator **triage queue**, and fix the headline correctness bug where the KPI cards don't partition the order set (`32 ≠ 0+0+9`) and every row's status renders `—`.

- **Primary layer: Frontend** (`apps/web/pages/orders`, `features/orders`).
- **Secondary layer: CORE + Interface (backend)** — a small, contained addition to make the status buckets *partition correctly* (the bug): a derived **order-health** classification used for both a list filter and an aggregate count summary. This is the only backend touch.

The current page already provides (reuse, don't rebuild): `DataTable` (client sort, mobile `cardView`, `rowHref`), `DataTableSkeleton` (loading), `ErrorState`/`EmptyState`, `MetricCard` KPI strip, `parseOrderSnapshot`, URL-state filters via `useSearchParams`, i18n currency/relative-time seam, the `R` refresh shortcut.

## 2. The bug (root cause, confirmed in code)

- `orders-list-page.tsx:134-137` issues 4 count queries; `pending`/`synced`/`failed` use the repository's JSONB-containment filter (`order-record.repository.ts:82-88`). An order with an **empty `syncStatus[]`** (ingested, not yet dispatched) matches none of them, and an `awaiting_mapping` order isn't represented at all → the cards don't sum to total.
- `orders-list-page.tsx:192-193` renders `—` whenever `syncStatus.length === 0` — i.e. for every not-yet-dispatched order (the majority in the screenshot).

The fix is a single **derived order-health** with mutually-exclusive precedence, computed identically on the row (FE) and in aggregate (SQL):

| Health | Precedence | Definition |
|---|---|---|
| `awaiting_mapping` | 1 | `recordStatus = 'awaiting_mapping'` |
| `needs_attention` | 2 | `recordStatus = 'ready'` AND any destination `syncStatus = 'failed'` |
| `synced` | 3 | ready, no failed, AND any destination `synced` |
| `awaiting_dispatch` | 4 | everything else (ready, no failed, no synced — empty / pending / syncing) |

These four + `all` partition the set; counts sum to total.

## 3. Scope decision (⏸️ confirm with user)

### Review adjustments applied (tech-review, before Phase 4)
- **Sort scope tightened.** Only `Placed`/`createdAt` is sortable in v1 (the column the server already orders by). Customer/Items/Total/Status are **not** marked sortable — they're `orderSnapshot` (JSONB) derivations the server can't sort without expression indexes; a client-only sort of the 20-row page would be a misleading affordance. Server `orderBy` for Total/Status is a follow-up.
- **Inline Retry vs `rowHref`.** The row is a navigable link; a `<button>` nested in it is invalid/inaccessible. Retry renders in a dedicated action cell the row-link excludes (verify `DataTable`'s action-cell mechanism first; if absent, drop `rowHref` and make the identity cell the explicit link).
- **`countByHealth` input narrowed.** Takes a `OrderHealthSummaryFilters` subset (source/customer/date) — never the `health` field — so the aggregate can't be self-filtered.
- **"Placed" label kept honest.** The date column stays **Created / Ingested** (`createdAt`) until #926 lands; "Placed" is not asserted from data we don't have (consistent with the ghost-column rule).
- **No migration.** `countByHealth` + `health` filter read existing columns (`recordStatus`, `syncStatus` JSONB) — no ORM schema change, so the `migration:show` gate is consciously skipped.
- **Single-source health precedence.** The four-way precedence is written once as a doc comment referenced verbatim by both `deriveOrderHealth` (TS) and the SQL `CASE`; the int-spec asserts failed+synced → `needs_attention`.

**Recommended — Option A (full vertical slice, one PR):** implement the derived-health classification end-to-end:
- Backend: add `health` to `OrderRecordFilters` (translate → SQL `CASE`/jsonb predicate) and a `countByHealth()` repository method (single grouped query) surfaced via `GET /orders/status-summary`.
- FE: per-row health badge (kills `—`), clickable segment cards that filter by `health`, counts that partition.
- Satisfies the issue's acceptance ("buckets partition the full set; counts sum to total"). Contained; does **not** touch the orders detail files #924 is editing.

**Fallback — Option B (FE-only this PR, defer counts):** ship the per-row health badge + all column/state work; leave the KPI cards on today's (imperfect) raw-status counts and file a follow-up backend issue for the partition. Faster, but leaves the headline bug partly unfixed and misses an AC.

→ **Plan below assumes Option A.** If the user prefers B, drop steps 4.1–4.4 and keep the cards as-is.

## 4. Backend steps (Option A)

### 4.1 Domain types — `libs/core/src/orders/domain/types/order-record.types.ts`
- Add `OrderHealthValues = ['awaiting_mapping','needs_attention','synced','awaiting_dispatch'] as const;` + `OrderHealth` union.
- Add `OrderHealthSummary` type: `{ total; awaitingMapping; needsAttention; synced; awaitingDispatch }`.
- Extend `OrderRecordFilters` with `health?: OrderHealth`.
- **Acceptance:** `as const` + union per standards; no inline types.

### 4.2 Repository port — `domain/ports/order-record-repository.port.ts`
- Add `countByHealth(filters: OrderRecordFilters): Promise<OrderHealthSummary>`.

### 4.3 Repository impl — `infrastructure/persistence/repositories/order-record.repository.ts`
- Add a private `applyHealthFilter(qb, health)` that appends the precedence predicate (reuse in `findMany` when `filters.health` is set).
- Implement `countByHealth` as one grouped query: a `CASE` expression mapping each row to a bucket, `GROUP BY` it, plus the source/customer/date filters. Map rows → `OrderHealthSummary` (zero-fill missing buckets).
- **Acceptance:** single round-trip; respects existing `sourceConnectionId`/date filters; integration test (`*.int-spec.ts`) covering each bucket + precedence (e.g. failed+synced → needs_attention).

### 4.4 Interface — `apps/api/src/orders/http/orders.controller.ts` (+ response DTO + query DTO)
- `GET /orders/status-summary` → `OrderHealthSummaryResponseDto`; accepts the same source/date query params as the list.
- Add `health` to the list query DTO (`ListOrdersQueryDto`) validated against `OrderHealthValues`.
- **Acceptance:** `@UseGuards(JwtAuthGuard)`; controller spec; degrades to all-zero when empty.

## 5. Frontend steps

### 5.1 Health view-model — `features/orders/lib/order-health.ts` (+ `.test.ts`)
- Pure `deriveOrderHealth(order: OrderRecord): { key: OrderHealth; tone: StatusBadgeTone; label: string; reason?: string }`. `reason` = first failed destination's `error` (plain-language) for `needs_attention`.
- Mirrors the SQL precedence exactly (single source of truth for the rule, documented in both).
- **Acceptance:** unit tests for all four buckets + precedence + empty-array case.

### 5.2 Types/api/hook for the summary — `features/orders/api/orders.types.ts`, `orders.api.ts`, `orders.query-keys.ts`, `hooks/use-order-status-summary-query.ts`
- Add `OrderHealth*` types (FE mirror), `statusSummary(filters?)` client method, query key, `useOrderStatusSummaryQuery(filters)` hook. Add `health` to `OrderFilters`.

### 5.3 Reshape the table — `pages/orders/orders-list-page.tsx`
Columns (left→right): **Order** (EntityLabel: human # + uuid — keep), **Customer** (NEW — `parsed.shippingAddress` name + city), **Items** (NEW — `parsed.items.length` + first item name), **Channel** (source pill + `→ OMP · PrestaShop` dest subline from `syncStatus[].destinationConnectionId`), **Status** (NEW — single `deriveOrderHealth` badge + `reason`, replaces the per-destination list and the `—`), **Ship-by** (ghost — disabled column, `#927`), **Placed** (relative `TimeDisplay` + abs subline; honest "ingested" tooltip until #926), **Payment** (ghost — `#928`), **Total** (keep). Sortable: Order, Customer, Items, Status, Placed, Total (client-side page sort, matching existing `useTableSort` behavior — server multi-sort is a noted non-goal).
- Update `cardView` (mobile) to the new fields.
- **Per-row inline Retry** for `needs_attention` via the existing `useRetryOrderDestinationMutation` — render inside the row with `e.stopPropagation()` so it doesn't trigger `rowHref` navigation.

### 5.4 Segment cards as filters — same file
- Replace the 4 static `MetricCard`s with 5 segment cards (`all`, `needs_attention`, `awaiting_mapping`, `awaiting_dispatch`, `synced`) backed by `useOrderStatusSummaryQuery`. Clicking sets the `health` URL param (reuse the `setSearchParams` pattern). Active card = current filter. `MetricCard` is presentational; wrap in a button/Link for the filter affordance (keep a11y — real `<button>`).

### 5.5 Empty / all-clear — same file
- When `health=needs_attention` (or any filter) yields zero rows, show the "all clear" `EmptyState` copy ("Nothing needs your attention…") instead of the generic empty message.

### 5.6 Styles — `apps/web/src/index.css` (+ `shared/theme/tokens.ts` if new vars)
- Ghost-column + channel-dest-subline styles in a bounded `/* ── Orders list redesign (#929) ── */` section. Reuse existing tokens; add to `tokens.ts` if any new var (drift checker).

## 6. Testing
- Unit: `order-health.test.ts` (precedence/buckets); extend `orders-list-page.test.tsx` (new columns render customer/items/channel; single health badge; segment-card click sets `health` param; all-clear empty; inline retry calls mutation without navigating).
- Backend: `order-record.repository.int-spec.ts` for `countByHealth` + `health` filter; controller spec for `/orders/status-summary`.
- Run full `pnpm test` (FE) + `pnpm test:integration` (orders repo) — manifest/contract-adjacent per project memory.

## 7. Non-goals (explicit)
- Bulk row selection/actions (`DataTable` has no selection model — would change a shared primitive). Inline per-row Retry only. **Follow-up.**
- True server-side multi-column sort (keep current client page-sort). **Follow-up.**
- Ship-by / Payment data (capture-gap epic #925) — ghost columns only.
- Saved views / column picker. **Follow-up.**

## 8. Risks
- **Overlap with #924 (parallel):** both edit `apps/web` orders. I touch only `pages/orders/orders-list-page.tsx`, `features/orders/{api,hooks,lib}`, `index.css`. I will **not** touch order-detail files. Shared edits (`orders.types.ts` additive, `index.css` bounded section) are merge-friendly. `parseOrderSnapshot` is read-only.
- **Partition correctness:** the FE `deriveOrderHealth` and the SQL `CASE` must stay in lockstep — documented as a single rule in both; integration test asserts the SQL side, unit test the FE side.
- **Health filter has no index** (JSONB scan) — acceptable at v1 scale per the existing note in the repository; file a follow-up if scan time creeps.
