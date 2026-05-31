# Implementation Plan — Dispatch SLA / ship-by deadline + countdown (#927)

Part of the #925 capture-gap epic. **P0.** Lights up the ghost **Ship-by** column shipped on the #929 orders list and adds a countdown to the order detail.

## 1. Goal & layer

Give operators the single highest-value number in a marketplace ops console: **when an order must ship**. Capture the marketplace dispatch deadline, persist it, expose it on the order contract, and surface it as a countdown (detail) + an SLA sort and a "breaching / overdue" filter (list).

- **Layers:** Integration (Allegro adapter) → CORE (IncomingOrder, snapshot, order-record column + migration, repository sort/filter) → Interface (controller query params + DTO) → Frontend (countdown chip, list column + server sort + filter chip).

## 2. Key research finding (drives the design)

The issue assumed `ship-by = buyer-placed-at + handling-time` (hence "depends on #926"). **Verified against developer.allegro.pl: Allegro's order checkout-form exposes the dispatch window directly** as `delivery.time.dispatch.{from,to}` — absolute ISO-8601 timestamps, populated for **all** delivery methods. (Refs: developer.allegro.pl news "wprowadzimy czas dostawy i wysyłki" and "gwarantowany czas dostawy w sekcji delivery".)

**Decisions that follow:**
- The ship-by deadline = **`delivery.time.dispatch.to`** — a source-authoritative absolute timestamp. We capture it directly; we do **not** derive it from placedAt + handlingTime.
- **#927 is therefore independent of #926** — no cross-dependency on the buyer-placed timestamp. (#926 still improves the "Placed" column separately.)
- No ISO-8601 duration parser needed.
- Graceful: if `delivery.time.dispatch` is absent (older records, non-Allegro sources) → no deadline → no countdown, no false SLA. (Satisfies the AC.)

## 3. Persist vs compute (decision: **persist** an indexed column)

The deadline is an absolute timestamp independent of "now", and the issue's payoff is **list-level sort + filter**. Persisting a top-level `dispatch_by_at timestamptz null` column (indexed) enables server-side `ORDER BY` and "due before / overdue" `WHERE` without per-row JSONB parsing. Compute-on-read can't be indexed for a global sort. → **Persist** + keep the full dispatch window in the snapshot for fidelity.

## 4. Steps

### Integration — Allegro
- `allegro-api.types.ts`: extend `AllegroCheckoutForm.delivery` with `time?: { from?; to?; dispatch?: { from?; to? }; guaranteed?: {...} }` (only what we read).
- `allegro-order-source.adapter.ts` `getOrder()`: map `checkoutForm.delivery.time.dispatch` → `IncomingOrder.dispatchTime` (window). Unit-test the mapping with a fixture carrying the dispatch window.

### CORE — contract + persistence
- `incoming-order.types.ts`: add `dispatchTime?: { from?: string; to?: string }` (ISO timestamps; the SLA deadline is `.to`).
- `order.types.ts`: carry `dispatchTime?` through the resolved `Order` if needed for snapshot rebuild.
- `order-record.service.ts`: include `dispatchTime` in the snapshot; compute the scalar `dispatchByAt = dispatchTime?.to` for the column.
- `order-record.orm-entity.ts`: add `@Column({ type: 'timestamptz', nullable: true }) @Index() dispatchByAt!: Date | null`. **Migration** (`apps/api/src/migrations/`, follow docs/migrations.md; run `migration:show`).
- `order-record.types.ts` (`OrderRecordFilters`): add `dueBefore?: Date` and `overdue?: boolean`; add a sort option. `order-record-repository.port.ts` + repository: support `ORDER BY dispatchByAt` (nulls last) and the due/overdue predicate; populate `dispatchByAt` in `upsert`/`persist` mapping + `toDomain`.

### Interface
- `list-orders-query.dto.ts`: add `sort` (allow `dispatchBy`) + `dueBefore` / `overdue` (validated). Controller maps to filters.
- `OrderRecordResponseDto`: expose `dispatchByAt: string | null` (top-level, alongside createdAt) so the FE doesn't parse the snapshot for the hot path.

### Frontend
- `orders.types.ts`: add `dispatchByAt: string | null` to `OrderRecord`.
- New `shared/format/format-countdown.ts` (+ test): `formatShipBy(dueAtIso, now)` → `{ label: "Ship by 02 Jun · 1d left" | "Overdue 4h", tone: 'success'|'warning'|'error' }`. Thresholds via status tokens (e.g. ≤24h → warning, past due → error).
- Order **detail**: a ship-by summary chip (countdown), tone-shifting.
- Orders **list** (#929 page): populate the **Ship-by** column (replace the ghost) with the countdown; wire **server-side default sort by `dispatchBy`** and a "Breaching soon / Overdue" filter chip (URL-state). This is the first server-sorted column on the list — the prior columns are client-page-sorted; `dispatchBy` sorts via the new query param so it orders the whole set.

## 4a. Review adjustments applied (tech-review, before Phase 4)
- **Boundary held:** Allegro `delivery.time` typing stays in the allegro package; CORE gains only the neutral `dispatchTime` / `dispatchByAt`. No `platformType` branching anywhere; neutral names only.
- **Coherent sort model:** `dispatchBy` is the **server-backed default sort** (asc = soonest first, nulls last). To avoid a silent client-page-sort vs server-global-sort split, **`dispatchBy` is the only sortable column** in this PR — `Created` loses its client sort caret. The sortable header maps to a `sort` URL param that drives the query (the column carries no client accessor, so the server order governs).
- **Recompute-on-re-pull:** `dispatchByAt` is written in the same snapshot mapping on **both** insert and update, so the #904/#906/#909 re-pull path keeps it fresh. Integration test asserts a changed dispatch window updates the column.
- **`dispatch` not `guaranteed`:** read `delivery.time.dispatch.to` (all methods); ignore the deprecated Kurier-X-press-only `delivery.time.guaranteed`. Fixture-backed mapping test.
- **Window captured, scalar derived once:** `IncomingOrder.dispatchTime = { from, to }`; `dispatchByAt = .to` derived a single time in the core service; FE/DTO hot path uses the top-level scalar (no snapshot parse).
- **Strict typing:** type the extended `AllegroCheckoutForm.delivery.time` (no `any`); expose `dispatchByAt` top-level on `OrderRecordResponseDto`.

## 5. Tests
- Unit: Allegro `getOrder` dispatch-window mapping; `format-countdown` thresholds (future / <24h / overdue / unknown→none); FE list (Ship-by renders, SLA sort sets the query param, overdue filter).
- Integration (`*.int-spec.ts`): repository `dispatchByAt` sort (nulls last) + due/overdue filter against real Postgres; full `pnpm test:integration` (order-ingestion + carrier-mapping + fulfillment) green.

## 6. Non-goals
- Buyer-placed timestamp (#926, parallel) — not redefined here.
- Non-Allegro dispatch sources (PrestaShop has no marketplace SLA) — graceful-absent.
- Notifications/alerts on breach — future.

## 7. Risks
- **Overlap with #926 (parallel):** both touch the Allegro `getOrder` mapping, `IncomingOrder`, the snapshot build in `order-record.service`, `OrderRecordResponseDto`, FE `OrderRecord`/snapshot schema, and the orders list/detail pages. Additive fields + a bounded merge (like #929/#930). Keep changes localized; coordinate the snapshot key names.
- **Migration** adds a column — first schema change in this area; verify `migration:show` and that integration harness picks it up.
- **Server-side list sort** is new on the redesigned list; scope it to the `dispatchBy` column only (others stay client-page-sort) to limit blast radius.
