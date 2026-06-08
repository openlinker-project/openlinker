# Pre-implement analysis — #772 InPost shipment-status polling

**Verdict: READY** (no Critical contract breaks; no reuse collision; purely additive)

Gated against `docs/plans/implementation-plan-772-inpost-shipment-status-poll.md` on a fresh worktree at `origin/main` (dbc791b1).

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `inpost-scheduler-tasks.ts` / `buildInpostSchedulerTasks()` | **NEW** | `find libs/integrations/inpost -iname '*scheduler*'` → none |
| `marketplace.shipment.statusSync` job type | **EXISTS → reuse (no change)** | `libs/core/src/sync/domain/types/sync-job.types.ts:26` |
| `ShipmentStatusSyncService` + `MarketplaceShipmentStatusSyncHandler` | **EXISTS → reuse (no change)** | `libs/core/src/shipping/application/services/shipment-status-sync.service.ts`; `apps/worker/src/sync/handlers/marketplace-shipment-status-sync.handler.ts` (reads `payload.cursorKey`) |
| `SchedulerTaskConfig` (`platformType` scoping) | **EXISTS → reuse** | `libs/core/src/sync/domain/types/scheduler-task.types.ts` (exactly-one-of `platformType`/`connectionFilter`) |
| `host.schedulerTaskRegistry` register seam | **EXISTS → reuse** | `createNestAdapterModule` injects `SCHEDULER_TASK_REGISTRY_TOKEN`; Allegro's `register(host)` already uses it |
| `OL_INPOST_SHIPMENT_STATUS_SYNC_*` env vars | **NEW** | grep across `libs`/`apps` → no prior use |
| `InpostIntegrationModule` in `apps/worker/src/plugins.ts` | **NEW edit** | worker plugins list has Prestashop/Allegro/AI only |
| InPost worker `jest-integration.cjs` mapper pair | **NEW edit** | `grep -c integrations-inpost apps/worker/test/jest-integration.cjs` → **0** |
| InPost api `jest-integration.cjs` mapper pair | **ALREADY PRESENT (no edit)** | api file → 2 hits (InPost is already an api plugin) |

## Backward-compatibility findings

| Surface | Result |
|---|---|
| Top-level barrels | No symbol removed/renamed — additive only. |
| Port signatures | None changed (`ShippingProviderManagerPort`, handler, service all untouched). |
| DTO shapes | None. |
| Symbol tokens | None added/removed (task uses the existing job type + cursor mechanism). |
| ORM schema | **No change → no migration.** |
| `check:invariants` | `check-jest-integration-mappers` **requires** the worker mapper pair when InPost is added to `apps/worker/src/plugins.ts` — the plan includes it (step 4), so the guard stays green. No cross-context-import or service-interface rule is touched (plugin imports `SchedulerTaskConfig` as a type from the `@openlinker/core/sync` top-level barrel). |

## Open questions (carry into implementation — non-blocking for the gate)

1. **Load-bearing (from tech-review):** verify InPost `Shipment` rows are persisted with `connectionId = <the InPost ShippingProviderManager connection>` the scheduler enqueues for. `ShipmentStatusSyncService.sync` does `shipments.findMany({ connectionId, statuses })`; if InPost shipments are stored under a different connection, the poll silently scans zero rows. Trace the `#765/#812` InPost label/dispatch persistence path before trusting `platformType:'inpost'` scoping.
2. **Cadence:** plan defaults to 30 min (SC-4 "conservative") vs Allegro's 15 — operator's call, already surfaced.

## Summary

Purely additive, integration-layer only; reuses the #838 engine + job + handler verbatim and mirrors the Allegro sibling task. No contract surface changes, no migration. The one worker-mapper edit is mandatory (guard-enforced) and already in the plan. The only real risk is behavioral, not structural — the `Shipment.connectionId` assumption (Open Question 1) — which is a verification step, not a plan defect. **READY to implement.**
