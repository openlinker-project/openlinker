# Implementation Plan — #1108 fold shipment state + ship-by SLA into derived order-health

**Issue:** [#1108](https://github.com/openlinker-project/openlinker/issues/1108) · **Branch:** `1108-order-health-shipment-sla`
**Source:** non-deferred read-only slice carved out of #1032 (spec `docs/specs/product-spec-1032-order-status-state-machine.md`). Extends #929 (derived order-health) + #927 (`dispatchByAt`).

## 1. Understand

**Goal:** make an order's *real* state legible at a glance and filterable — fold in (a) the **ship-by SLA** (overdue / at-risk) and (b) **shipment/fulfillment state** — on top of the existing sync-only order-health.

**Layer:** Core (derivation + SQL) + API (DTO/filters) + Frontend (list/detail rendering + filter). Read-only / derive-only.

**Non-goals (hard):** no OL-owned status transitions / cancel-propagation / outbound writes (that's the DEFERRED #1032 end-state); no SLA *enforcement* (surface only); no multi-destination reconciled rollup.

## 2. Research findings (verified)

- **Order-health** = `OrderHealthValues = [awaiting_mapping, needs_attention, synced, awaiting_dispatch]`, derived in two places from `recordStatus` + `syncStatus[]`:
  - BE: `order-record.repository.ts` — `COUNT(*) FILTER` summary + `applyHealthFilter` (TypeORM QB; SQL fragments `IS_MAPPING` / `HAS_FAILED` / `HAS_SYNCED`).
  - FE: `apps/web/src/features/orders/lib/order-health.ts` — pure `deriveOrderHealth(order)`.
- **`dispatchByAt`** is already a denormalized, indexed `timestamptz` column on `order_records` (#927), already in `OrderRecordResponseDto`, already rendered as a tone-coded **Ship-by countdown** on the list (`orders-list-page.tsx`) and detail. It is **not** fulfillment-aware and **not** a health/filter dimension.
- **Shipment state** lives only in `shipments` (shipping context); `Shipment.orderId` → order. Orders context does **not** read shipments. **`orders → shipping` would create a dependency cycle** (shipping already depends on `IOrderRecordService`).
- FE already has `deriveFulfillment(shipmentStatuses, hasShippingCapability) → not-shipped|dispatched|delivered|failed|unavailable` and fetches shipments per-order on **detail** (`useOrderShipmentsQuery`), composed app-side — not on the list.

## 3. Design

### Decision 1 — SLA is an ORTHOGONAL axis, not a 5th health bucket
Sync-health answers "did it sync to destinations?"; SLA answers "is dispatch late?". Merging SLA into the 4-value enum breaks its documented precedence and conflates two questions. So model SLA as a **separate, derived signal**:

```
SlaStateValues = ['none', 'on_track', 'at_risk', 'overdue'] as const
```
derived from `dispatchByAt` vs `now` (+ a configurable at-risk window). `none` when `dispatchByAt` is null **or** the order is already shipped (see source-of-truth rule below).

- **Backend is the single source of truth for `slaState`** (tech-review fix). The BE derives the bucket from the order's own indexed `dispatchByAt` **and applies the "cleared once shipped" rule using the row's `fulfillmentState`** (Decision 2) — so `slaState` is `none` once `fulfillmentState ∈ {dispatched, delivered}`. The BE exposes `slaState` on the list response and uses the **same** derivation for the health/SLA summary counts and the list **filter + sort**. This guarantees the list filter and the row badge agree.
- **The at-risk window is one constant, owned by the BE** (a single exported const in the core types; default 24h). The FE does **not** re-derive the bucket — it consumes `slaState` from the response and computes only the **live ticking countdown** label from `dispatchByAt` (legitimately time-relative/client-side; the existing `formatShipBy` already does this). No duplicated business logic (`frontend-architecture.md` App Boundary).

### Decision 2 — Shipment/fulfillment state denormalized onto `order_records` (CHOSEN: scope B)
To make fulfillment **server-side filterable/sortable** on the list (full AC coverage), denormalize a rollup column onto `order_records`, kept fresh by the shipping write-path. This respects the dependency direction (`shipping → orders` already exists; orders never imports shipping).

- **New column** `order_records.fulfillmentState` (nullable varchar, indexed) holding a per-order rollup. **NULL ≡ `not-shipped`** in all derivations (no backfill needed for correctness; see backfill note).
- **Type name (tech-review fix): `FulfillmentRollupState`** — deliberately distinct from the existing exported `FulfillmentStatus` (the OMP read-back view, `delivered|dispatched|cancelled`). **One shared value spelling with the FE**: `['not-shipped', 'dispatched', 'delivered', 'failed'] as const` (hyphenated, matching the FE's existing `deriveFulfillment` output so no translation layer). `unavailable` stays **FE-render-only** (computed from shipping-capability; never stored).
- **Rollup derivation lives in SHIPPING** (it owns shipment status). A single shipping helper `recomputeOrderFulfillment(orderId)` loads the order's shipments, derives the rollup (`delivered` > `dispatched` (generated/dispatched/in-transit) > `failed` (all terminal failed/cancelled) > `not-shipped`), and calls **`IOrderRecordService.updateFulfillmentState(orderId, state)`** (new additive method on the existing orders service interface; mirrors the existing `updateSyncStatus`).
- **Write-path call-sites:** invoke `recomputeOrderFulfillment` after any shipment status mutation — `ShipmentDispatchService`, `ShipmentStatusSyncService`, `ShipmentCancellationService`, `FulfillmentStatusSyncService` (+ bulk variants). Best-effort, logged; a failed projection never fails the shipment op.
- **Reconciliation backstop (tech-review fix):** `FulfillmentStatusSyncService` already polls/derives shipment state per order — it calls `recomputeOrderFulfillment` too, so a dropped best-effort projection self-heals on the next poll tick.
- **Backfill / NULL semantics (tech-review fix):** treat `NULL` as `not-shipped` everywhere (derivation, filter, summary), so existing orders are correct-by-default on day one; orders with prior shipments converge to their true rollup on the next shipment mutation **or** the reconciliation poll. No data migration required — the column ships nullable with a documented NULL≡not-shipped rule. (If a same-day accurate fulfillment filter on historical orders is later wanted, a one-shot backfill from `shipments` is a follow-up, not part of this slice.)
- **Migration** required: add column + index. **Synthetic sequential prefix** strictly greater than the current tail `1808000000000` → **`1809000000000-add-order-fulfillment-state.ts`**, class suffix `…1809000000000`, `up()` + `down()`, NOT a `Date.now()` prefix (`docs/migrations.md` rule 3; guarded by `check-migration-timestamps.mjs`). Verify `migration:show`.

### Recommendation (resolved at gate → scope B)
**Decision 1 (server-side SLA, BE-owned bucket incl. cleared-once-shipped) + Decision 2 (denormalized `FulfillmentRollupState` projection).** Both signals server-side filterable/sortable; full AC coverage. ~M (migration + write-path). The FE reads `fulfillmentState` + `slaState` off the order row — no per-list app-layer shipments fetch — and computes only the live ship-by countdown client-side.

## 4. Steps

**Core — types & SLA derivation**
1. New `orders/domain/types/order-sla.types.ts` and `order-fulfillment.types.ts` (dedicated files, mirroring `fulfillment-status-snapshot.types.ts`): `SlaStateValues`/`SlaState` (`none|on_track|at_risk|overdue`) + `SLA_AT_RISK_WINDOW_MS` const; `FulfillmentRollupStateValues`/`FulfillmentRollupState` (`not-shipped|dispatched|delivered|failed`). Pure helpers `deriveSlaState(dispatchByAt, fulfillmentState, now)` (applies cleared-once-shipped) and `deriveFulfillmentRollup(shipmentStatuses)`. Extend summary types with SLA + fulfillment counts (sibling interfaces). Export all from the `orders` barrel. + unit specs (precedence + NULL≡not-shipped + cleared-once-shipped).

**Core — persistence + projection**
2. Migration (`apps/api/src/migrations/`) — add `order_records.fulfillmentState` (nullable varchar) + index. Per `docs/migrations.md`; verify with `migration:show`.
3. `order-record.orm-entity.ts` — add the `fulfillmentState` column. `order-record.repository.ts` — persist it; add SQL fragments + `applySlaFilter` (over `dispatchByAt`) + `applyFulfillmentFilter` (over the new column) + sort; extend the `COUNT(*) FILTER` summary.
4. `orders` service interface + impl — add `updateFulfillmentState(orderId, state)` to `IOrderRecordService` / `OrderRecordService` (+ repo method). Domain entity stays anemic (persistence-only mutation).

**Shipping — rollup write-path**
5. New shipping helper `recomputeOrderFulfillment(orderId)` (loads order's shipments via `ShipmentRepositoryPort.findByOrderId`, derives the rollup, calls `IOrderRecordService.updateFulfillmentState`). Best-effort + logged.
6. Call it from the shipment-status mutation sites: `ShipmentDispatchService`, `ShipmentStatusSyncService`, `ShipmentCancellationService`, `FulfillmentStatusSyncService` (+ bulk). + unit specs for the rollup precedence.

**API**
7. Order list/summary DTO + query params — expose `slaState` + `fulfillmentState`; add both as filter + sort; add summary counts. (`dispatchByAt` already exposed.)

**Frontend** (use `/frontend-design:frontend-design` for new visuals; responsive mobile+tablet+desktop)
8. FE order types + `order-health.ts` — add `slaState` + `fulfillmentState` to the `OrderRecord` FE type; **consume `slaState` from the response** (do NOT re-derive the bucket); reconcile the existing FE `FulfillmentState`/`deriveFulfillment` to the shared `not-shipped|dispatched|delivered|failed` spelling (keep `unavailable` as the FE-only capability-absent render state). SLA badge tone map; the live ship-by countdown stays client-side via the existing `formatShipBy`.
9. Order list — fulfillment-state cell/badge + SLA badge; SLA + fulfillment **filter controls backed by URL search params** (mirroring the existing `health` filter — `frontend-architecture.md` URL-state rule); KPI strip counts.
10. Order detail / health-summary strip — fold SLA + the row-level fulfillment state into the existing summary (Fulfillment cell already exists).

**Tests**: unit (`deriveSlaState` + rollup precedence, core & FE), int-spec (list filter/sort/summary for both axes; the shipping→order projection write-path), component (badges/filters).

## 5. Validate
- Architecture: **no `orders → shipping` import** (projection is pushed *from* shipping via `IOrderRecordService`); rollup derivation stays in shipping; SLA stays intra-order. `as const` unions in `*.types.ts`. No `any`. Anemic entity (mutation via repo/service).
- Migration validated (`migration:show`, up/down). Naming/headers/`pnpm check:invariants` clean. Responsive FE. Projection failures never fail the shipment op.

## Gate resolution
**Scope B chosen (2026-06-18):** Decision 1 + Decision 2 (denormalized `fulfillmentState` projection) for full server-side fulfillment filtering. ~M, includes a migration + the shipping write-path.
