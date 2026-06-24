# Pre-implement Analysis: #1146 — Order-cancellation-observe hook → stock-restore

**Date**: 2026-06-22
**Plan**: `docs/plans/implementation-plan-1146-order-cancel-stock-restore.md`
**Base branch**: `997-erli-writeback` (so `ErliOfferManagerAdapter.restoreStockOnCancellation` is present)

## Verdict: ✅ READY

No reuse collisions, no contract-surface breaks. One doc-hygiene Warning (update the dependency map). The plan may proceed to implementation.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `OfferStockRestorer` capability + `isOfferStockRestorer` guard | **NEW** | No `StockRestor`/`isOfferStockRestorer` hit anywhere in `libs/core/src` or other plugins; only match is the Erli adapter method (the extension target). |
| `OfferStockRestoreTarget` type | **NEW** | No existing type of this name/shape. |
| `OfferStockRestoreService` + `IOfferStockRestoreService` | **NEW** | No `*RestoreService` in `libs/**/application/services/**`. |
| `marketplace.offer.stockRestore` job type | **NEW (additive)** | `JobTypeValues` (`libs/core/src/sync/domain/types/sync-job.types.ts:16`) has no stock-restore entry — append only. Payload interface added to `marketplace-job-payloads.types.ts`. |
| `OrderIngestionService` observe hook | **PARTIAL (extend)** | `syncOrderFromSource` exists (`libs/core/src/orders/application/services/order-ingestion.service.ts`); already fetches the pre-persist `existing` record (~line 206) and has the destination-echo early-return (~line 217). Hook is an additive branch. |
| `ErliOfferManagerAdapter.restoreStockOnCancellation` | **PARTIAL (refactor)** | Present on `997-erli-writeback` (`erli-offer-manager.adapter.ts:362`) with the old `(variantOfferIds, inventoryQuery)` signature — refactor to `(targets)`. Unreleased ⇒ no compat break. |
| Worker handler | **NEW (additive)** | Registers in `apps/worker/src/sync/handlers/handler-registration.service.ts` + `sync-job-handler.registry.ts` (established seam). |

**Reachable reused services (confirmed on allowed surfaces):**
- `IInventoryQueryService.getAvailabilityByVariantIds` — `inventory-query.service.interface.ts:48`; already consumed by listings (`bulk-listing-submit.service.ts`). `listings → inventory` edge pre-exists.
- `IOrderRecordService` — exported from the orders barrel (`orders/index.ts:100`).
- `OfferMappingRepositoryPort.findMany` — `listings/domain/ports/offer-mapping-repository.port.ts` (intra-context to the listings restore service).

## Backward-compatibility findings

| Surface | Finding | Severity |
|---|---|---|
| `JobTypeValues` union | Append-only (`'marketplace.offer.stockRestore'`). No removal/rename. | OK |
| Capability port signatures | `OfferStockRestorer` is new; refactoring the **unreleased** #997 `restoreStockOnCancellation` signature breaks no published contract. | OK |
| `check-service-interfaces.mjs` | New `OfferStockRestoreService` in `listings/application/services/` must `implements IOfferStockRestoreService` with a sibling `*.service.interface.ts` — plan includes it. | OK (plan-covered) |
| `check-cross-context-imports.mjs` | New `listings → orders` edge via **`IOrderRecordService`** — an allowed `I*Service` shape, not a deny-pattern (`*RepositoryPort`/`*OrmEntity`/`*Adapter`/`*Dto`). **No `ALLOW_LIST` entry needed**; the guard passes. (The deny-list `ALLOW_LIST` is repository-port-only.) | OK |
| Dependency map (`architecture-overview.md § Current dependency map`) | The new `listings → orders` edge is **not** in the mermaid map. The `offer-manager.port.ts` "no import from orders" is a comment, not a real edge — so this edge is genuinely new. Add `listings --> orders` to the map. | **Warning (doc)** |
| ORM schema / migrations | None — transition-gate + dedupeKey, no new table. | OK |

## Open questions
- **None blocking.** The #997 coupling (PR targets `997-erli-writeback`, rebased onto `main` after #997 merges) is a process item tracked in plan §8, not a code-readiness gap.

## One-paragraph summary
The plan is **READY** to implement. Every proposed artifact (`OfferStockRestorer` capability + guard, `OfferStockRestoreTarget`, `OfferStockRestoreService`/interface, the `marketplace.offer.stockRestore` job type, and the `OrderIngestionService` observe hook) is confirmed absent in the live tree — the only `restoreStockOnCancellation` is the #997 Erli method this plan extends, and the job-type/payload additions are append-only. The one new cross-context edge (`listings → orders` via `IOrderRecordService`) rides an allowed `I*Service` shape, so `check-cross-context-imports.mjs` passes with no allow-list entry; the only action item is a documentation update to the dependency map. No Critical contract breaks, no migration, no reuse collision.
