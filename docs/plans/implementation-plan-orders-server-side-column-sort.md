# Implementation Plan — server-side sortable columns on /orders (#944)

> Supersedes the #939 standalone Sort dropdown and the column-sort non-goal deferred in #929.
> Layers: CORE (domain types + repository SQL), Interface (DTO/controller), migration, Frontend (DataTable prop + page wiring).

## 1. Goal
Clickable column headers with an up/down arrow that sort the `/orders` list **server-side** (global across the paginated set, not just the visible 20 rows).

## 2. Sortable columns
- **Sortable:** Customer, Items, Status, Ship-by, Created, Total.
- **Plain:** Order (opaque id), Channel (categorical, resolved client-side from connectionId), Payment (ghost #928).

## 3. Design decisions (confirmed)
- **Status order** — triage-urgency ordinal: `needs_attention(0) → awaiting_mapping(1) → awaiting_dispatch(2) → synced(3)`; asc = most urgent first. Reuses the existing health `IS_MAPPING`/`HAS_FAILED`/`HAS_SYNCED` SQL expressions in a `CASE`.
- **Total** — sort by raw numeric `(orderSnapshot->'totals'->>'total')::numeric` regardless of currency (no FX normalization available). Documented caveat: mixed-currency sort is approximate.
- **Direction** — new `dir: 'asc' | 'desc'`. Default state = Ship-by `asc` (the triage default; replaces the dropdown). Per-column first-click default: Total `desc`, Customer `asc`, Items `desc`, Status `asc`, Created `desc`, Ship-by `asc`. Re-click flips.
- **Dropdown** — the #939 standalone Sort `Select` is removed (headers own sort now).

## 4. Backend steps
### 4.1 `libs/core/src/orders/domain/types/order-record.types.ts`
- Extend `OrderRecordSortValues` → `['createdAt','dispatchBy','customer','items','status','total']`.
- Add `OrderRecordSortDirectionValues = ['asc','desc'] as const` + `OrderRecordSortDirection`.
- Add `dir?: OrderRecordSortDirection` to `OrderRecordFilters`.

### 4.2 `.../repositories/order-record.repository.ts`
- Replace the `findMany` ORDER BY block with a `applySort(qb, sort, dir)` helper mapping each key → column/expression + direction, with stable `createdAt DESC` tiebreaker. JSONB expressions:
  - `total` → `(rec."orderSnapshot"#>>'{totals,total}')::numeric` (NULLS LAST)
  - `items` → `jsonb_array_length(rec."orderSnapshot"->'items')`
  - `customer` → `lower(rec."orderSnapshot"#>>'{shippingAddress,lastName}')` (NULLS LAST)
  - `status` → `CASE` over `IS_MAPPING`/`HAS_FAILED`/`HAS_SYNCED` (urgency ordinal)
  - `dispatchBy` → `dispatchByAt` ASC/DESC NULLS LAST
  - `createdAt` → `createdAt`
- Default (no sort) unchanged: `dispatchBy` asc semantics.

### 4.3 Migration `apps/api/src/migrations/{ts}-add-order-sort-indexes.ts`
- Expression indexes: total numeric cast, items length, lower(customer lastName). (Status CASE is cheap/bounded — index optional; skip to keep the migration lean, note it.)
- `up` + `down`. 13-digit unique timestamp; class suffix matches.

### 4.4 `apps/api/src/orders/http/dto/list-orders-query.dto.ts` + controller
- `sort` enum already validated against `OrderRecordSortValues` (auto-extends). Add `dir` (`@IsEnum(OrderRecordSortDirectionValues)`, optional). Controller passes `dir` through to `findMany`.

## 5. Frontend steps
### 5.1 `apps/web/src/shared/ui/data-table.tsx`
- Add `manualSorting?: boolean` → `useReactTable({ manualSorting })` and skip the client sorted-row model when true. Additive; default false = unchanged for all consumers. Add a `data-table.test.tsx` case.

### 5.2 `features/orders/api/orders.types.ts` + `orders.api.ts`
- Mirror `OrderSortValues` extension + `OrderSortDirection`; add `dir` to `OrderFilters`; `buildQuery` serializes `dir`.

### 5.3 `pages/orders/orders-list-page.tsx`
- Read `sort` (default `dispatchBy`) + `dir` (default per active column) from URL; build `SortingState` for DataTable; mark the 6 columns `sortable` with `accessor` no-ops (server-sorted); pass `manualSorting`, `sort`, `onSortChange` (→ setSearchParams sort+dir, clear offset). Remove the Sort `Select`. Map column id ↔ sort key.
- Per-column default direction on first click.

### 5.4 `index.css`
- Header sort-arrow styling already exists for DataTable sortable headers (verify); add only if missing, bounded `#944` section.

## 6. Testing
- Repo int-spec: one ordering assertion per new key (asc + desc; NULLS-last where relevant), reusing the `order-dispatch-sla.int-spec.ts` pattern.
- Controller spec: `dir` validated/passed.
- DataTable test: `manualSorting` disables client reordering.
- Orders page test: header click sets `?sort`+`?dir`; arrow on active column; dropdown gone.
- Full `pnpm test` + `pnpm test:integration` (orders repo).

## 7. Risks
- **DataTable shared primitive**: additive `manualSorting` only — assert existing consumers (connections client sort) unaffected via the existing DataTable tests.
- **JSONB sort performance**: expression indexes cover total/items/customer; status CASE is bounded. Note if scan time creeps.
- **#945 overlap fix** lands in `index.css`/toolbar too — trivial merge (different sections); this branch also removes the Sort dropdown from the toolbar.
