# Pre-implement gate — ANALYSIS: Prune stale inventory_items (#1478)

**Verdict: READY** (one must-apply correction recorded below — trivial, no plan restructure needed).

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `InventoryItem.isStale` field | **NEW** | No `isStale`/`is_stale` anywhere in `libs`/`apps`. |
| `inventory_items.isStale` column | **NEW** | Grep clean; ORM entity has no such column. |
| Migration `1818000000007-add-inventory-item-is-stale` | **NEW** | Tail on `main` = `1818000000006`; `1818000000007` is free + strictly greater. |
| `InventoryRepositoryPort.markStaleExceptVariants` | **NEW** | No `markStale`/`prune` method exists on the port. |
| `IInventoryService.pruneStaleVariants` | **NEW** | No such method exists. |
| Read-side exclusion on `findAvailabilityByVariantIds` | **PARTIAL (extend existing)** | Method exists (`inventory.repository.ts:103`); plan adds one `andWhere`. |
| Sync wiring in `MasterInventorySyncService` | **PARTIAL (extend existing)** | Adds a post-loop prune call to the existing method. |

No reuse collisions. Every "new" artifact is genuinely absent.

## Backward-compatibility findings

| Surface | Result | Severity |
|---|---|---|
| `InventoryRepositoryPort` (add method) | Only **one** implementer — `InventoryRepository` (`inventory.repository.ts:31`). No in-memory/second impl to break. | OK |
| `IInventoryService` (add method) | Only **one** implementer — `InventoryService` (`inventory.service.ts:22`). | OK |
| `InventoryItem` ctor (add field) | New param is **last + defaulted `= false`** → all 7 existing `new InventoryItem(...)` call sites compile unchanged. | OK |
| Top-level barrel `@openlinker/core/inventory` | Only **additions** (no exported symbol removed/renamed). | OK |
| Response/view surface (`InventoryItemView`) | `InventoryQueryService.compose` maps fields **explicitly** — a new domain field does **not** auto-leak into API responses. `isStale` stays internal (correct for this issue; FE surfacing deferred). | OK |
| ORM schema change ⇒ migration | Required and planned; additive `NOT NULL DEFAULT false`, self-healing. | Warning (expected) |
| `check:invariants` | No cross-context import change; the new service method is backed by an existing `implements` clause (`check-service-interfaces` satisfied); migration prefix/class-suffix invariant honoured. | OK |

## Must-apply correction (recorded — gate does not edit the plan)

- **Migration column name is `isStale`, NOT `is_stale`.** `apps/api/src/database/data-source.ts` sets **no** `namingStrategy`, so TypeORM uses property names verbatim as column names — existing columns are camelCase (`availableQuantity`, `reservedQuantity`, `productVariantId`, `locationId`), and the recent `AddInvoicePaymentStatus` migration added `"paymentStatus"`, not `payment_status`. The plan (following the issue text) proposed `is_stale`; that would create a column the ORM entity never reads (`@Column isStale` → column `"isStale"`), yielding a runtime `column "isStale" does not exist`. Implementation must use `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "isStale" boolean NOT NULL DEFAULT false`. (The plan already flags "verify actual column name" in step 3 — this resolves it.)

## Open questions

- None blocking. The one design fork (read-side exclusion scope) was resolved with the user: **Option A** — exclude stale only from `findAvailabilityByVariantIds`; leave `findMany` inclusive.

## Summary

Every artifact the plan introduces is confirmed absent from the tree, and each port/service the plan extends has exactly one implementer, so the additive changes break no contract surface. The single correction is the migration column name (`isStale`, camelCase — the repo uses TypeORM default naming), which must be applied at implementation time. Cleared to implement.
