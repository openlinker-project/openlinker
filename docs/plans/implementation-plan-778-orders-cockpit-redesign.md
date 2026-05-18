# Implementation Plan — #778 (`feat(web): redesign /orders page to match the new cockpit pattern`)

**Status**: Draft
**Issue**: [#778](https://github.com/SilkSoftwareHouse/openlinker/issues/778)
**Branch**: `778-orders-cockpit-redesign`
**Layer classification**: Frontend — presentation-only, no API changes.

---

## 1. Goal

Bring `/orders` up to the cockpit composition shown at `/dev/ui → Patterns → "Orders cockpit"`: KPI strip → filter chip row → dense `DataTable` with `EntityLabel` + channel-pill + `StatusBadge`. Wire to real data via existing query hooks; no new endpoints.

**Non-goals**:
- Order *detail* page (`/orders/:id`) — separate issue.
- Sibling list pages (`/connections`, `/listings`, `/inventory`) — each gets its own.
- Any backend / API changes.
- Replacing the existing failed-orders page (`/orders/failed`).

## 2. Verified surface (research findings)

| Element | Path | Status |
|---|---|---|
| Current orders-list-page | `apps/web/src/pages/orders/orders-list-page.tsx` | Uses `PageLayout` + raw `Select` filter + mono-text columns. No KPI strip, no chip filter, no EntityLabel, no channel column. |
| Cockpit reference | `apps/web/src/pages/dev-ui/sections/patterns-section.tsx:128-158` | The visual contract — composition + primitive usage. |
| `MetricCard` | `apps/web/src/shared/ui/metric-card.tsx` | Has `tone` (`neutral` / `success` / `warning` / `error` / `info`), `label`, `value`, `description`. Ready to use. |
| `EntityLabel` | `apps/web/src/shared/ui/entity-label.tsx` | Takes `id` + `name`. Use for the Order column. |
| `.channel-pill` | `apps/web/src/index.css:7332-7352` | Pure CSS class; data-channel switches the dot colour. No JSX wrapper exists — render `<span className="channel-pill" data-channel={…}>`. |
| `StatusBadge` | `apps/web/src/shared/ui/status-badge.tsx` | `tone` + `withDot` + `pulse` + `solid` + `compact`. Pulse on `syncing` per the cockpit demo. |
| `useOrdersQuery` | `apps/web/src/features/orders/hooks/use-orders-query.ts` | Takes `OrderFilters` + `OrderPagination`. Returns `PaginatedOrders` (with `total`). |
| `OrderFilters` shape | `apps/web/src/features/orders/api/orders.types.ts:64-71` | Supports `syncStatus`, `sourceConnectionId`, `customerId`, `createdFrom`, `createdTo`, `recordStatus`. The 4-card KPI strip leverages this — 4 queries with different filters, read `total`. |
| `useConnectionsQuery` | `apps/web/src/features/connections/index.ts:26` | Exposed via barrel; returns `Connection[]` with `platformType`. Use for `sourceConnectionId → channel-pill` lookup. |
| `parseOrderSnapshot` | `apps/web/src/features/orders/api/order-snapshot.schema.ts` | Soft-parses `orderSnapshot.{orderNumber, totals}` — provides typed access for the Order + Total columns. |

## 3. Mapping the cockpit demo to real data

The cockpit demo uses placeholder fields (`Paid · 24h`, `Buyer`); the real semantics are sync-status, not payment-status. Concrete mapping:

| Cockpit demo slot | Real-data wiring |
|---|---|
| Eyebrow "Last 7 days · UTC+02" | Keep eyebrow simple: `"Operations"` (matches the existing nav-group and sibling list pages). No time-window indicator until we actually scope queries by a 7-day window — that would change the KPI semantics. |
| Right-side actions: `Filters · Export CSV · Sync now` | `Failed Orders` link (the existing one — preserve current functionality) on the page-header `actions` slot. `Export CSV` and `Sync now` are deferred — they would need new API endpoints and the issue restricts us to existing query hooks. The current "Failed Orders" link IS the operational action, so it's the right primary affordance to keep. |
| KPI strip: `Open` / `Paid 24h` / `Pending` / `Failed 24h` | `All orders` (neutral, no filter), `Synced` (success, `syncStatus=synced`), `Pending` (warning, `syncStatus=pending`), `Failed` (error, `syncStatus=failed`). Drop the "24h" framing — the existing data model carries no payment timestamps and the 4 cards reading the unfiltered totals is more informative than 4 cards reading the same 24-hour slice. |
| Filter chips: `Status: All` / `Channel: All` / `Date: Last 7d` | A `chip` row with `Status: <value>` and `Source: <value>`. `Date` filtering is deferred — `createdFrom/createdTo` need a date-range picker primitive we don't have yet. Chips toggle via URL search params (mirrors existing `setSearchParams` pattern). |
| Order column: `EntityLabel(id, name)` | `id=internalOrderId`, `name=parsedSnapshot.orderNumber || internalOrderId`. Falls back to ID-only when the snapshot has no orderNumber (recordStatus='awaiting_mapping'). |
| Channel column: `channel-pill` with data-channel | Resolve `sourceConnectionId → connection.platformType` via `useConnectionsQuery` and render `<span className="channel-pill" data-channel={platformType}>`. Unknown channel → `data-channel="unknown"` (no dot, just the label) so the UI degrades cleanly. |
| Buyer | Skip — the current page doesn't render buyer either, and resolving it requires `customers` lookup that doubles request fan-out. Keep the column count tight; defer Buyer to a follow-up. |
| Status column | First `syncStatus[].status` (or aggregated when there are multiple destinations) with `pulse` when `syncing`, `withDot` otherwise. Multi-destination orders show all badges side-by-side (today's behavior — preserve it). |
| Total column | `parsedSnapshot.totals?.total + currency`, mono+tabular. `—` placeholder when totals absent. |

## 4. Files to change

| File | Change |
|---|---|
| `apps/web/src/pages/orders/orders-list-page.tsx` | Full rewrite: add KPI strip (4 `useOrdersQuery` calls, one per status filter), replace Select-based filter with chip-row, rewrite `COLUMNS` to use `EntityLabel`, channel-pill, `StatusBadge` with `pulse`, and parsed totals. |
| `apps/web/src/pages/orders/orders-list-page.test.tsx` | Update existing tests + add coverage for KPI strip rendering, channel-pill display, EntityLabel in Order column. |

## 5. Step-by-step

### Step 1: Add the KPI strip
Four `useOrdersQuery` calls, one per status (no filter for "All"). Each fired with `limit: 1` so we only read `total`. The hook caches per queryKey, so navigating doesn't re-fetch.

```tsx
const allOrders = useOrdersQuery(undefined, { limit: 1 });
const syncedOrders = useOrdersQuery({ syncStatus: 'synced' }, { limit: 1 });
const pendingOrders = useOrdersQuery({ syncStatus: 'pending' }, { limit: 1 });
const failedOrders = useOrdersQuery({ syncStatus: 'failed' }, { limit: 1 });
```

Render in a 4-column grid (`ds-grid ds-grid--4` is the existing utility class used by the patterns demo). Each card uses the existing `MetricCard` primitive:

```tsx
<div className="ds-grid ds-grid--4">
  <MetricCard label="All orders" value={allOrders.data?.total ?? '—'} />
  <MetricCard label="Synced" value={syncedOrders.data?.total ?? '—'} tone="success" />
  <MetricCard label="Pending" value={pendingOrders.data?.total ?? '—'} tone="warning" />
  <MetricCard label="Failed" value={failedOrders.data?.total ?? '—'} tone="error" />
</div>
```

While loading, `total` is `undefined` → `'—'` falls through. Errors on one strip-card don't blank the whole page (the main table query runs independently).

**Acceptance**: KPI strip renders four counts, each tinted, on `/orders`.

### Step 2: Replace the filter row with chips
Drop the `<Select>`. Render a `chip` row for `Status` and `Source`:

```tsx
<div className="chip-row">
  <FilterChip label="Status" value={syncStatus ?? 'All'} onClear={…} />
  {sourceConnectionId && <FilterChip label="Source" value={…connectionName…} onClear={…} />}
  <Button tone="ghost" className="button--sm" onClick={openFilterMenu}>+ Add filter</Button>
</div>
```

Two options for the filter-menu trigger:
- **(A)** Keep the existing `<Select>` semantics by mounting a `DropdownMenu` (Radix-wrapped, already in `shared/ui/`) populated with status options. Cleaner.
- **(B)** Use existing `<Select>` invisibly behind the chip. Hackier but ships sooner.

Going with **(A)** — `DropdownMenu` is already in the catalog and matches the cockpit pattern's intent.

Chip state lives in URL search params (mirrors existing `setSearchParams` pattern — already 80% of the file).

**Acceptance**: chip row replaces the Select; status filter still works through URL params; toggling a chip's clear button removes the filter.

### Step 3: Rewrite the DataTable columns
New column set (5 cols, down from 5):
- **Created** — `<TimeDisplay iso={…} format="date" />`, accessor for sorting (keep existing sortable behaviour).
- **Order** — `<EntityLabel id={internalOrderId} name={orderNumber || internalOrderId} />`. Falls back to ID-only when snapshot has no orderNumber.
- **Channel** — `<span className="channel-pill" data-channel={platformTypeOrUnknown}>{platformLabel}</span>`. Built from a `Map<connectionId, platformType>` derived once via `useMemo` from `useConnectionsQuery`.
- **Sync Status** — preserve existing multi-badge row, but switch the per-destination badges to `pulse` on `syncing`:
  ```tsx
  <StatusBadge tone={SYNC_STATUS_TONES[s.status]} pulse={s.status === 'syncing'} withDot={s.status !== 'syncing'} compact>
    {s.status}
  </StatusBadge>
  ```
- **Total** — `parseOrderSnapshot(orderSnapshot).totals?.total` formatted with currency, mono+tabular. `—` when absent.

Drop the standalone `sourceConnectionId` and `customerId` columns — `sourceConnectionId` is replaced by the Channel column; `customerId` was hidden below 1024px anyway and the new column count is tight enough without it.

**Acceptance**: table renders the new columns at desktop; channel-pill colour matches the platform; pulse animation fires on syncing rows; row-click navigation still works.

### Step 4: Update `cardView`
The mobile cardView is the existing fallback. Update its `title` / `subtitle` / `meta` slots to match the new desktop columns (use `EntityLabel` in `title`, channel-pill in `meta`).

**Acceptance**: at viewport ≤ 767px the page degrades to the card view cleanly with the new identity treatment.

### Step 5: Update tests
- Refresh `orders-list-page.test.tsx` for the new structure.
- Add cases: KPI strip renders four cards with correct labels; channel-pill renders with correct `data-channel`; EntityLabel shows the parsed orderNumber when present, falls back to ID-only otherwise; status badge gets `pulse` class when status is `syncing`.

**Acceptance**: existing tests pass; new tests cover the additions.

### Step 6: Quality gate
```bash
pnpm lint && pnpm type-check && pnpm test
```

All green before commit.

## 6. Risk / open questions

- **4× useOrdersQuery for KPIs**: each is `limit: 1`, queryKey is unique per filter, TanStack caches. Total wire cost is ~4 small requests on first paint. Acceptable for an admin page; if it becomes a hotspot we'd add a dedicated `/api/orders/stats` endpoint (deferred — issue forbids new endpoints).
- **Channel lookup fan-out**: `useConnectionsQuery` is already cached app-wide; the orders page is just another consumer. No new network cost.
- **Filter-chip clear UX**: removing the Status chip should clear the URL param AND collapse the chip. Done via the existing `setSearchParams((prev) => …)` pattern — no new state machinery.
- **Date filter deferred**: the issue's chip strip includes `Date: Last 7d`. Implementing it requires a date-range picker primitive we don't have. Skipped for v1; the URL contract (`createdFrom` / `createdTo`) is already there for a follow-up to wire.

## 7. Validation

- `pnpm lint` — green (design-tokens drift check + cross-context invariants).
- `pnpm type-check` — green.
- `pnpm test` — orders-list-page test suite + sibling tests pass.
- Visual: manual check at `/orders` with admin login (cockpit composition matches `/dev/ui → Patterns` to operator eye).
- Mobile: viewport ≤ 767px renders cardView with the new columns.
- Both themes: render with `data-theme="light"` and `data-theme="dark"` — screenshots in PR body.
