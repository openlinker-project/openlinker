# Implementation Plan — #772 InPost shipment-status polling (re-scoped)

## 1. Understand the task

**Goal:** Make InPost shipment tracking update end-to-end **without** a provisioned webhook, by scheduling the *existing* #838 `marketplace.shipment.statusSync` poll for InPost connections.

**Layer:** Integration (InPost plugin) + host wiring (worker plugin list). **No CORE change** — the poll engine, job, handler, and propagation path all shipped in #838 and are carrier-generic.

**Re-scope context:** #772's original body ("build a poller + extract a shared propagation service") is obsolete — #838 did it. Investigation (Phase 1.5) found the poll is scheduled **only for Allegro** (`allegro-scheduler-tasks.ts`, `platformType:'allegro'`); InPost registers no scheduler tasks and is absent from `apps/worker/src/plugins.ts`. The issue body was updated on claim.

**Non-goals:**
- Any change to `ShipmentStatusSyncService` / `MarketplaceShipmentStatusSyncHandler` / the OMP propagation path (all #838).
- Per-connection "polling fallback enabled" DB toggle — env-gate + always-on poll suffices for v1 (deferred).
- Customer-visible tracking pages; time-since-dispatch cadence optimization (v2).

## 2. Research findings (live repo)

- **`MarketplaceShipmentStatusSyncHandler`** (`apps/worker`) is carrier-generic: reads `payload.cursorKey ?? DEFAULT_CURSOR_KEY` and resolves the carrier via `getCapabilityAdapter(connectionId, 'ShippingProviderManager')`. **No handler change needed.**
- **`ShipmentStatusSyncService`** (#838, core) polls non-terminal shipments, advances to terminal, backfills tracking, propagates to OMP. Carrier-agnostic.
- **Allegro task** (`allegro-scheduler-tasks.ts`): `taskId:'allegro-shipment-status-sync'`, `platformType:'allegro'`, `jobType:'marketplace.shipment.statusSync'`, `cursorKey:'allegro.shipmentStatus.scanOffset'`, env-gated. **This is the exact template.**
- **`SchedulerTaskConfig`** requires exactly one of `platformType` | `connectionFilter`; `platformType:'inpost'` is correct.
- **`createNestAdapterModule`** (InPost's module) injects `host.schedulerTaskRegistry` and calls `plugin.register(host)` → the InPost `register()` can register tasks. The plugin is constructed eagerly (no DI), so the task helper reads **`process.env`** (precedent: #849 pickup-refresh reads `process.env` directly).
- **`apps/worker/src/plugins.ts`** lacks `InpostIntegrationModule`. The worker has **no SchedulerService**, so: (a) the worker needs InPost added so the poll handler can resolve the InPost adapter; (b) registering the task in the worker is a harmless no-op (only the api drains tasks — same as Allegro today).
- **`check-jest-integration-mappers`** (#917) requires every `plugins.ts` integration to have two `moduleNameMapper` entries in that app's `test/jest-integration.cjs`. Adding InPost to `apps/worker/plugins.ts` ⇒ must add its two worker mapper lines.

## 3. Design / steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 0 | *(verification — no code)* | **Confirm the load-bearing assumption** (tech-review IMPORTANT-1): trace the InPost label/dispatch persistence path (`#765/#812`) and confirm InPost `Shipment` rows are written with `connectionId = <the InPost ShippingProviderManager connection>` that this task enqueues for. `ShipmentStatusSyncService.sync` does `shipments.findMany({ connectionId, statuses })` + resolves the carrier via `getCapabilityAdapter(connectionId, 'ShippingProviderManager')`, so a mismatch makes the poll a silent zero-row no-op. **If the assumption does not hold, STOP and resurface** — the scheduler task is pointless until shipment persistence keys to the carrier connection. | Documented confirmation (file + line where `Shipment.connectionId` is set for InPost) before any task code is written. |
| 1 | `libs/integrations/inpost/src/infrastructure/scheduler/inpost-scheduler-tasks.ts` *(new)* | `buildInpostSchedulerTasks(): SchedulerTaskConfig[]` reading `process.env` (the plugin is constructed eagerly by `createNestAdapterModule` — no DI — and `register(host)` runs at `onModuleInit`, after dotenv has populated `process.env`; #849 precedent. **The file header must state this** so a future reader doesn't "fix" it toward `ConfigService` and reopen the eager-construction problem). Returns the `inpost-shipment-status-sync` task; omits it when `OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED === 'false'`. Mirrors the Allegro task: `platformType:'inpost'`, `jobType:'marketplace.shipment.statusSync'`, `cursorKey:'inpost.shipmentStatus.scanOffset'`, `enabledEnvVar:'OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED'`, cron default `'0 */30 * * * *'` (**6-field, seconds-leading — parity with Allegro's `'0 */15 * * * *'`; keep 6-field**), page-limit default 50, idempotency `marketplace:${connection.id}:shipment:status:sync:${timestamp}`. | Returns 1 task when enabled, 0 when disabled; payload carries `schemaVersion:1`, `limit`, `cursorKey:'inpost.shipmentStatus.scanOffset'`. |
| 2 | `libs/integrations/inpost/src/inpost-plugin.ts` | In `register(host)`: `for (const task of buildInpostSchedulerTasks()) host.schedulerTaskRegistry.register(task);` | Registration loop present; existing config-validator registration untouched. |
| 3 | `apps/worker/src/plugins.ts` | Import + append `InpostIntegrationModule` to `workerPlugins`. | Worker can resolve the InPost `ShippingProviderManager` adapter when running `marketplace.shipment.statusSync`. |
| 4 | `apps/worker/test/jest-integration.cjs` | Add `^@openlinker/integrations-inpost$` + `^@openlinker/integrations-inpost/(.*)$` mapper entries. | `pnpm lint` (`check-jest-integration-mappers`) green; fresh-worktree worker int-tests resolve InPost via `src/`. |
| 5 | `apps/api/.env.example` | Document `OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED` / `_INTERVAL_CRON` / `_PAGE_LIMIT`. | Knobs documented next to the Allegro shipment-sync block. |
| 6 | `libs/integrations/inpost/src/infrastructure/scheduler/inpost-scheduler-tasks.spec.ts` *(new)* | Unit specs: enabled→1 task w/ correct fields+payload; `=false`→0 tasks; cron default + override; page-limit default + override. | All assertions pass. |

## 4. Validation

- **Architecture:** integration-layer only; no CORE edit; matches the Allegro sibling exactly. Additive — no signature/DTO/token/ORM change → no contract break, no migration.
- **Naming:** `inpost-scheduler-tasks.ts` mirrors `allegro-scheduler-tasks.ts`; env vars mirror `OL_ALLEGRO_SHIPMENT_STATUS_SYNC_*`.
- **Testing:** unit spec on the task builder (the only new logic). End-to-end poll is already covered by #838's specs; the worker→adapter resolution is exercised by existing worker integration boot.
- **jest-integration mappers (#917):** `apps/api/test/jest-integration.cjs` already maps `@openlinker/integrations-inpost` (InPost is already an api plugin — verified, 2 hits), so **only the worker file needs the pair added** (verified absent — 0 hits). `check-jest-integration-mappers` enforces this once InPost lands in `apps/worker/src/plugins.ts`.
- **Cadence decision:** default `'0 */30 * * * *'` (every 30 min) per SC-4's "conservative" guidance — deliberately slower than Allegro's 15 min because the InPost poll is a webhook *fallback*, not the primary path. Operator-overridable via `OL_INPOST_SHIPMENT_STATUS_SYNC_INTERVAL_CRON`. (Surfaced to the maintainer; 30 min chosen.)
- **Risk:** structural risk very low. Double-scheduling is impossible (worker runs no SchedulerService). Cursor key + idempotency key are disjoint from Allegro's. The only real risk is behavioral — the step-0 `Shipment.connectionId` assumption — which is verified before any code.

## 5. Pre-implement gate

Ran `/pre-implement` → **READY**. Verdict at `docs/plans/analysis/ANALYSIS-implementation-plan-772-inpost-shipment-status-poll.md`. Confirmed against a fresh worktree at `origin/main` (dbc791b1): no reuse collision (`inpost-scheduler-tasks*` absent; job type / service / handler / register-seam reused verbatim; env names unused); no contract-surface break; no migration. The mandatory worker `jest-integration.cjs` mapper edit is included (guard-enforced; worker file confirmed at 0 hits, api file already at 2). One open question carried forward as step 0 above — the `Shipment.connectionId` assumption — behavioral, not structural.

A deep `/tech-review` of this plan also ran → 🔄 Approve with changes: the step-0 verification is the folded IMPORTANT item; SUGGESTIONs (process.env rationale, 6-field cron, api-mapper-already-present) are reflected in steps 1 + §4.
