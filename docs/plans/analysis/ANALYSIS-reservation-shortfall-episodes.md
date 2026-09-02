# Pre-implement gate: reservation shortfall episodes (#2349)

**Date**: 2026-08-27
**Plan**: `docs/plans/implementation-plan-reservation-shortfall-episodes.md`
**Verdict**: **READY** — with two mandatory revisions applied before coding (both naming/wiring, no design change).

---

## Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `reservation_shortfall_episodes` table | **NEW** | no `*shortfall*` table anywhere; `apps/api/src/migrations/1850000000009-create-reservations.ts:19-23` documents the deliberately-absent `olReserved <= available` CHECK and names `W2-12` as the follow-through |
| `ReservationShortfallEpisode` entity | **NEW** | no such class |
| `ReservationShortfallRepositoryPort` / repository | **NEW** | — |
| `IReservationShortfallService` | **NEW** | — |
| `RESERVATION_SHORTFALL_{SERVICE,REPOSITORY}_TOKEN` | **NEW** | `libs/core/src/inventory/inventory.tokens.ts` holds 14 tokens, none colliding |
| Job type `inventory.reservations.shortfall` | **NEW** | siblings at `libs/core/src/sync/domain/types/sync-job.types.ts:102,106` |
| Scan-offset cursor idiom | **REUSE** | `apps/worker/src/sync/handlers/returns-orphan-reconcile.handler.ts` — `CONNECTION_CURSOR_REPOSITORY_TOKEN` from `@openlinker/core/sync`, `get`/`set`, set **only after success** inside the try. `reservation-consume.handler.ts` is NOT the model (it deliberately has no cursor) |
| Budget + lock primitives | **REUSE** | `resolveSweepBudget` / `resolveSweepLockTtlMs` from `apps/worker/src/sync/bounded-sweep`, `SYNC_LOCK_TOKEN` |
| System scope id | **REUSE-BY-DUPLICATION** | there is no shared export; the nil-UUID is a documented local literal in 5 places (`scheduler.service.ts:88` explains why, ADR-051 role boundary). Follow the convention, do not invent an export |
| Partial-unique index idiom | **REUSE** | `reservation.orm-entity.ts:52-73` + `1850000000009-create-reservations.ts:96-100`; every constraint declared class-level under the SAME name the migration uses |
| **`stockAtRisk` field name** | **COLLISION → renamed** | see Critical-1 |

## Backward-compatibility findings

**Critical-1 — vocabulary collision on `stockAtRisk` / `shortfall` (naming, resolved).**
`libs/core/src/listings/domain/types/stock-at-risk.types.ts:19-58` already ships
`StockAtRiskItem.shortfall`, defined as `max(0, (masterStock − buffer) − availableToPromise)`
and read through `StockAtRiskReadService` in the **listings** context. That answers a different
question — *which listing is about to stop selling* — and is keyed by variant, not by order.
Shipping an order-detail field also called `stockAtRisk` would make two unrelated numbers share
one name across two contexts, and #2350 would have no way to tell an operator which it is
rendering.

*Resolution (applied at implementation)*: the order-detail field is
**`reservationShortfalls: OrderReservationShortfallDto[]`**, and the DTO file is
`order-reservation-shortfall.dto.ts`. The episode's own quantity column stays `shortQuantity`
(not `shortfall`) for the same reason. #2350 keeps "stock at risk" as **operator copy** — that
is the product vocabulary and is correct in the UI; only the contract names change.

**Critical-2 — `OrdersModule` does not import `InventoryModule` (wiring, resolved).**
`apps/api/src/orders/orders.module.ts` imports only `CoreOrdersModule` / `CoreInvoicingModule` /
`CoreMappingsModule`. The projection needs `InventoryModule` added there, and the new service
token added to BOTH `providers` and the `exports` array of
`libs/core/src/inventory/inventory.module.ts:174-191`. This creates **no new core cross-context
edge** — the composition is in the host app's interface layer, the same place `IInvoiceService`
is already composed.

**Warning-1 — integration-harness truncation.** `apps/api/test/integration/setup.ts:73+`
lists tables child-first. The new table carries no ORM FK (the `reservations`
`orderRecordId` precedent), so it is invisible to the CASCADE closure walk and **must** be
listed explicitly — immediately after `'reservations'`, before `'inventory_items'`.

**Warning-2 — migration ordering.** Slot `1861000000000` is above the branch tail
(`1854000000000`), so `check-migration-timestamps.mjs` rule 3 is satisfied. Class suffix must
repeat the prefix exactly.

**Warning-3 — invariant scripts that will fire.** `check-service-interfaces.mjs` (the new
service must `implements I*Service` with a sibling `*.service.interface.ts`),
`check-migration-timestamps.mjs`, `check-cross-context-imports.mjs` (the repository port must
stay OFF the `@openlinker/core/inventory` barrel — a `*RepositoryPort` is a denied shape),
`check-architecture-gates.mjs`, `check-ui-vocabulary.mjs` (frontend only, #2350's problem).

## Open questions

None blocking. Two recorded for #2350:
1. The API field is `reservationShortfalls`, not `stockAtRisk`; the UI copy is free to say
   "stock at risk".
2. RS-S (the `W2-15` authority-status reason value) is **not** emitted by this slice — the
   reason union does not exist on this branch, and emitting into a sink that does not exist
   would make an unhandled condition read as handled (#2346's `escalated` precedent).
