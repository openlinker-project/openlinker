# Implementation Plan: Batched auto-issue trigger model (#3583)

**Date**: 2026-11-02
**Status**: Draft / Ready for Review
**Estimated Effort**: ~4-5 days (core gate + queue 1 d, run aggregate + migration 1 d, worker jobs + scheduler 1 d, API 0.5 d, tests/docs 1-1.5 d)
**Issue**: #3583, child 2 of 4 of epic #3515 (Pilot G10). Builds on #3582 (kind-scoped `salesDocument.triggerModels[kind]`, implemented on this branch). The UI is #3584, the E2E #3585.
**Delivery**: epic branch `3515-batched-sales-document-issuing`, single epic PR.

---

## 1. Task Summary

**Objective**: Make `triggerModel = 'batched'` work. An order whose routed sales-document connection batches that document kind waits in a **queue** (not as an attention block); a **batch run**, started by a per-connection schedule or by an operator's "Run now", re-evaluates each queued order and enqueues its ordinary per-order issuance job (`invoicing.issue` / `fiscalization.register`) on the `fiscal` lane. Each run is **recorded** with its per-order outcomes. A month-end schedule issues B2B orders only; B2C orders on that connection go out in an implied daily run (D42).

**Context**: `'batched'` is selectable (`InvoiceTriggerModelValues`) but `AutoIssueTriggerService.evaluateGate` throws `BatchedTriggerNotImplementedError`, which becomes a persisted `trigger-model-batched` block counted as invoicing attention. In the #3460 pilot operators issue in batches (daily at 18:00, month end). Mockup M15 (`queue`, `running`, `finished`, `empty`, `unavailable`) defines what the operator sees; its notes 6, 8, 9, 10, 11 constrain the backend.

**Classification**: CORE (gate, queue marker, run aggregate, schedule rules) + Infrastructure (migration, repositories) + App (worker job handlers, scheduler task, API controller) + Documentation.

---

## 2. Scope & Non-Goals

### In Scope
- Gate: `batched` + condition met → order **queued** (persisted, not counted as attention); in a batch run → `proceed`.
- Queue: which connection/kind an order is queued for, persisted on `order_records`, readable per connection.
- Schedule: per connection, per kind (the two kind-scoped schedules #3584 edits), in `Connection.config.salesDocument.batchSchedules[kind]`; pure due-slot rules incl. D42.
- Run: new job types `salesDocument.batch.tick` (scheduler) and `salesDocument.batch.run` (one run); "Run now" enqueues the same run job.
- Run record: `sales_document_batch_runs` + `sales_document_batch_run_items` (migration); healthy empty run vs failed-to-start; `needs_reauth` refusal.
- Read API: queue, run history, run detail with per-order outcome (issued / blocked / in doubt / failed) derived from the existing per-order sales-document projection (ADR-065), plus `POST` run now.
- Remove `BatchedTriggerNotImplementedError`; docs.

### Out of Scope
- The batch screen and the "Configure" link (#3584); E2E (#3585).
- Changing which kind an order gets (routing is untouched).
- Re-issuing / retrying failed documents from the run screen (existing invoice retry paths apply).
- Server-side validation of schedule config beyond the tolerant reader (consistent with `triggerModel`, which has none either).
- Cross-replica schedule exactness beyond what the scheduler lease already gives (ADR-051).

### Constraints
- One document per order (#2047) must keep holding: a run enqueues the SAME jobs with the SAME deterministic idempotency keys (`invoice:{conn}:{order}` / `fiscal:{conn}:{order}`) the auto path uses, and each job still takes `invoice:issue:{orderId}` (ADR-041 § 3a).
- Invoicing must not import `orders` (F3 one-way edge): the run orchestration therefore lives in `orders`, which already depends on invoicing.
- `sales-documents` stays a zero-outbound-edge leaf; only pure types/rules are added there.
- Migration timestamp must sort after every open PR's migration on the stack (#3837 uses `1937440000000`, #3844 `1937460000000`): use `1938780000000` (bumped from `1937500000000`, then from `1938500000000` after `1938770000000` landed on main).

---

## 3. Architecture Mapping

**Target Layers**: CORE (`libs/core/src/invoicing`, `libs/core/src/orders`, `libs/core/src/sales-documents`, `libs/core/src/sync`), App (`apps/worker`, `apps/api`), migration (`apps/api/src/migrations`).

**Capabilities Involved**: none new. `InvoicingPort` / `FiscalizationPort` are reached only through the existing `invoicing.issue` / `fiscalization.register` handlers.

**Existing Services Reused**:
- `AutoIssueTriggerService.onOrderTransition` - routing, kind validation, tax-rate gate, one-document guard (`reportBlock`), payload compose, deterministic enqueue. The run calls it per order; nothing is re-implemented.
- `orderFromReadySnapshot` (`orders/domain/order-from-ready-snapshot.ts`) - rebuilds the `Order` from a record, as the manual-issue path already does.
- `IOrderRecordService.markSalesDocumentBlock` - the level-triggered writer; extended with two columns.
- `ISalesDocumentViewService.getForOrders` (ADR-065, batched) - the per-order document state the run detail reads its final outcome from.
- `SyncLockPort` (per-connection run lock), `SyncJobQueuePort`/`ISyncJobsService.schedule`, `SchedulerService` task registry, `SyncJobHandlerRegistry` lanes.
- `resolveTriggerModelForKind` (#3582).

**New Components Required**:
- `sales-documents`: `batch-schedule.types.ts` (schedule shape, reader, due-slot rules, D42 segment).
- `invoicing`: gate option `mode: 'batch-run'`; enqueue report on the `none` outcome.
- `orders`: `SalesDocumentBatchRun` + `SalesDocumentBatchRunItem` entities, repository port + TypeORM repository, `ISalesDocumentBatchService` (queue read, `startRun`, `executeRun`, history/detail read), two ORM entities, two `order_records` columns.
- `sync`: two `JobTypeValues` members.
- `apps/worker`: `SalesDocumentBatchTickHandler`, `SalesDocumentBatchRunHandler`, scheduler task.
- `apps/api`: `SalesDocumentBatchController` + DTOs.

**Core vs Integration Justification**: issuance timing is OL's own policy (ADR-041 gate); no adapter is involved. The run orchestration needs the order record (orders) and the gate (invoicing); `orders → invoicing` is the existing allowed direction, so the service belongs in `orders`, beside `SalesDocumentViewService`, which already composes both document kinds per order.

---

## 4. External / Domain Research

### External System
None. Providers are reached only through existing issuance jobs.

### Internal Patterns
- **Report, don't persist** (#2100): the gate returns a `SalesDocumentBlockOutcome`; `orders` writes it. The run reuses exactly that seam.
- **Level-triggered block columns** (#2100): every gate evaluation rewrites the reason, so the queue marker clears itself when the order is invoiced by hand, cancelled out of the condition, or re-routed.
- **Attention subset** (`SalesDocumentAttentionReasonValues`): `trigger-model-manual` is already excluded because it is a configured workflow, not a fault; `trigger-model-batched` is the same kind of fact.
- **Global system-scoped sweep** (`fulfillment.work.timeoutSweep`, #2712): nil-UUID system connection, `bulk` lane, scheduler task with `enabledEnvVar`, per-tick idempotency key.
- **Slot-keyed idempotency**: `sync_jobs.idempotencyKey` is unique and TTL-less, so a key derived from the schedule slot makes "at most one run per slot" a database fact, with no extra cursor.
- **Composite run aggregate over ordinary jobs**: bulk offer batches (#726) keep a parent row and children that are normal jobs; same idea, but the final outcome is read from the document projection rather than counted by a progress service, which avoids a second source of truth.

---

## 5. Questions & Assumptions

### Open Questions
1. **When does a batched order qualify?** M15 note 11: "once the auto-issue condition (paid/shipped) is already met". `batched` names no condition of its own. **Assumed: paid** (the `auto-on-paid` condition), the common pilot case and the safe one for fiscal documents. A `batched-on-shipped` variant can be added later as a separate value.
2. **Time zone for "Daily at 18:00".** No issue or doc decides it; only M15 shows a static caption "Server time zone: Europe/Warsaw", and the codebase has no install-wide time-zone setting to back that caption (FX and PL working days hard-code `Europe/Warsaw`; KSeF numbering keeps it per connection). **Decided: the zone is stored WITH the schedule** (`batchSchedules[kind].timeZone`, an IANA name), defaulting to `Europe/Warsaw` when absent or not a zone `Intl` accepts. No env var: the worker that fires the run and the API that shows the next slot then read the same value from config and cannot disagree. No UI field yet (#3584 shows it read-only, as M15 does); adding one later needs no backend change. Flag for product: M15 assumes a "server time zone" the system does not have.
3. **Run granularity.** Schedules are per kind (#3582/#3584), the mockup shows one history per connection. **Assumed: a run belongs to one connection and covers one or more kinds**; a scheduled slot yields one run per (connection, kind, slot), "Run now" one run for all of the connection's batched kinds.
4. **"Run now" and D42.** **Assumed: Run now issues the whole queue** for that connection (B2B and B2C). D42 restricts only the scheduled month-end slot.
5. **Queue "Blocked" rows.** M15's queue shows orders that would be blocked (document on another connection, no rule for DE). Those orders do not carry the batched marker today. **Assumed: the queue lists batch-queued orders only**; such conflicts appear as `blocked` items in the run that meets them. A pre-run dry evaluation for the queue is a possible #3584 follow-up.
6. **Month-end time.** M15: "last calendar day at 23:00". **Assumed fixed at 23:00** in the batch time zone; the B2C fallback daily run (D42) also runs at 23:00.

### Assumptions
- A batched order that is not yet paid is `waiting` (nothing persisted), exactly like `auto-on-paid`.
- The B2B test is the persisted three-state `order_records.buyerTaxId` decoded with `decodeBuyerTaxIdColumn`: a non-empty id is B2B; asserted-none AND unknown are B2C, so an order whose source never states a tax id is never stranded by a month-end-only schedule (D42's intent).
- A run never retries a document. The per-order jobs keep their own retry ladders and in-doubt handling (M15 note 10).
- A connection that stops being `active` between slots: the run starts, finds the connection not active, records `failed-to-start` with a reason code, enqueues nothing.

### Documentation Gaps
- `architecture-overview.md` § 14 (gate) still describes `batched` as deferred.
- `sales-document-reason-copy.ts` (web) describes `trigger-model-batched` as unimplemented - the copy change is #3584's, but the backend meaning changes here, so the PR must change both.

---

## 6. Proposed Implementation Plan

### Phase 1: Pure rules (sales-documents leaf)
**Goal**: schedule shape and slot arithmetic as pure, unit-tested functions.

1. **Batch schedule types and reader**
   - **File**: `libs/core/src/sales-documents/domain/types/batch-schedule.types.ts` (+ spec)
   - **Action**: 
     ```ts
     export const BatchFrequencyValues = ['daily', 'every-n-hours', 'month-end'] as const;
     export interface BatchSchedule { frequency: BatchFrequency; time: string /* HH:MM */; everyHours: number; timeZone: string /* IANA, default Europe/Warsaw */; effectiveFrom: Date }
     export function readBatchSchedule(config: unknown, kind: SalesDocumentKind): BatchSchedule | null
     export const BatchRunSegmentValues = ['all', 'b2b', 'b2c'] as const;
     export interface DueBatchSlot { slotAt: Date; segment: BatchRunSegment }
     export function findDueBatchSlots(schedule: BatchSchedule, now: Date): DueBatchSlot[] // uses schedule.timeZone
     ```
     `findDueBatchSlots` returns the MOST RECENT slot at or before `now` and not before `effectiveFrom` (so enabling a schedule at 19:00 does not fire today's 18:00), for: `daily` → `segment: 'all'`; `every-n-hours` (1..24, from 00:00) → `all`; `month-end` → the last calendar day 23:00 with `b2b` **plus** the daily 23:00 slot with `b2c` (D42). Invalid/partial config → `null` (never a guessed schedule). Exported from the leaf barrel. Pure, takes `now` - no clock, no env; the zone comes from the schedule.
   - **Acceptance**: spec covers each frequency, DST change days in Europe/Warsaw, month lengths (28/29/30/31), `effectiveFrom` suppression, malformed config.

2. **Queue marker and attention**
   - **File**: `libs/core/src/sales-documents/domain/types/sales-document-reason.types.ts` (+ spec)
   - **Action**: `SalesDocumentBlock` gains optional `connectionId?: string` and `documentKind?: SalesDocumentKind` (the routed target, set when known). `SalesDocumentAttentionReasonValues` also excludes `'trigger-model-batched'`, with the docblock stating why (a configured workflow, like manual). `SalesDocumentBlockOutcome`'s `none` arm gains optional `enqueued?: { connectionId; documentKind; idempotencyKey }` and `alreadyDocumented?: true` (set when `reportBlock` suppressed the block because the order already carries a document), so a caller can tell "enqueued", "already has a document" and "nothing to do here" apart without a second read.
   - **Acceptance**: union/attention spec updated; no existing consumer breaks (all fields optional).

### Phase 2: Gate (invoicing)
**Goal**: `batched` queues instead of throwing, and proceeds inside a run.

1. **Evaluate `batched`**
   - **File**: `libs/core/src/invoicing/application/services/auto-issue-trigger.service.ts` (+ spec), `.../auto-issue-trigger.service.interface.ts`, `invoice-trigger.types.ts`
   - **Action**: `onOrderTransition(..., options?: { batchRun?: { connectionId: string; documentKinds: readonly SalesDocumentKind[] } })`. `evaluateGate` for `batched`: not paid → `waiting`; paid and the call is a batch run for THIS connection and kind → `proceed`; otherwise → `blocked` `trigger-model-batched` with `connectionId` + `documentKind` on the block. `TriggerGateOutcome`'s `blocked` arm carries the target. The `enqueued` report is filled on the success path of both `dispatchInvoice` and `dispatchFiscalReceipt`. Delete `BatchedTriggerNotImplementedError` (+ its PII allow-list entry and the file).
   - **Acceptance**: specs: unpaid → waiting; paid → queued block with target; batch run for the connection → enqueues the same job type and key as `auto-on-paid`; batch run for a DIFFERENT connection or kind → still queued; manual still blocks; `reportBlock`'s invoice-aware suppression still applies (an order already invoiced elsewhere is `none`, so the run never double-issues).

### Phase 3: Persistence (orders)
**Goal**: queue is queryable; runs are recorded.

1. **Order record columns**
   - **Files**: `libs/core/src/orders/infrastructure/persistence/entities/order-record.orm-entity.ts`, repository, `OrderRecordService.markSalesDocumentBlock`, domain entity
   - **Action**: `salesDocumentBlockConnectionId text NULL`, `salesDocumentBlockDocumentKind text NULL`, written by the SAME single writer as the reason (excluded from `toOrm`, #2100 discipline), cleared with it. Partial index `IDX_order_records_sales_document_batch_queue` on `("salesDocumentBlockConnectionId", "placedAt")` `WHERE "salesDocumentBlockReason" = 'trigger-model-batched'` (declared on the entity under the same name, for `synchronize` parity).
   - **Acceptance**: repository int-spec: write/clear round-trip; the count/filter paths that use `SalesDocumentAttentionReasonValues` no longer count batched orders.

2. **Run aggregate**
   - **Files**: `libs/core/src/orders/domain/entities/sales-document-batch-run.entity.ts`, `sales-document-batch-run-item.entity.ts`, `domain/types/sales-document-batch-run.types.ts`, `domain/ports/sales-document-batch-run-repository.port.ts`, `infrastructure/persistence/entities/*.orm-entity.ts`, `infrastructure/persistence/repositories/sales-document-batch-run.repository.ts`, token in `orders.tokens.ts`
   - **Action**: run `{ id, connectionId, trigger: 'schedule'|'manual', documentKinds, segment, slotAt|null, status: 'running'|'completed'|'empty'|'failed-to-start', failureReason|null, eligibleCount, enqueuedCount, blockedCount, startedAt, finishedAt, startedByUserId|null }`; item `{ runId, orderId, documentKind|null, result: 'enqueued'|'blocked'|'already-documented'|'not-routed-here'|'indeterminate', blockReason|null, idempotencyKey|null }`. Repository: `create`, `appendItems`, `finish` (narrow conditional UPDATE `WHERE status = 'running'`), `findRunning(connectionId)`, `listForConnection(connectionId, page)`, `findById`, `listItems(runId)`.
   - **Acceptance**: no `save(entity)` full-row write; item FK `ON DELETE CASCADE` (migration-only, the `return_lines` precedent).

3. **Migration**
   - **File**: `apps/api/src/migrations/1938780000000-add-sales-document-batch-runs.ts`
   - **Action**: the two `order_records` columns + partial index; `sales_document_batch_runs` (+ index `(connectionId, startedAt DESC)`, partial unique `(connectionId) WHERE status = 'running'` so two runs on one connection cannot overlap - enforced by the index, not a read); `sales_document_batch_run_items` (+ index `(runId)`). `down()` drops all. Add both tables to the integration harness truncate lists.
   - **Acceptance**: `migration:show` clean; timestamp check passes.

### Phase 4: Run service (orders)
**Goal**: one service owns queue reads and run execution.

1. **`ISalesDocumentBatchService`**
   - **Files**: `libs/core/src/orders/application/interfaces/sales-document-batch.service.interface.ts`, `application/services/sales-document-batch.service.ts` (+ spec), module wiring in `orders.module.ts`, token
   - **Action**:
     - `listQueue(connectionId, { documentKind?, limit, cursor })` → queued orders (id, number, source, placedAt, total, currency, documentKind, isB2b).
     - `executeRun({ connectionId, trigger, documentKinds, segment, slotAt?, startedByUserId? })`:
       1. Claim: insert the `running` row; a unique violation on the running index → return `{ status: 'already-running' }` (no second run).
       2. Connection must be `active` (`ConnectionPort.get`); otherwise finish `failed-to-start` with reason `connection-not-active` / `needs-reauth` and touch no order.
       3. Page through the queue (bounded page, e.g. 200) filtered by kinds and segment (`b2b` / `b2c` via `buyerTaxId`).
       4. Sequentially per order: `orderFromReadySnapshot` (unavailable snapshot → item `indeterminate`), call `autoIssueTrigger.onOrderTransition(order, record.sourceConnectionId, undefined, record.taxRateEra, record.buyerTaxId, { batchRun })`, persist the returned outcome through `markSalesDocumentBlock` (same rule as ingestion: `indeterminate` writes nothing), record the item from the outcome (`none`+`enqueued` → `enqueued`; `none`+`alreadyDocumented` → `already-documented`; other `none` → `not-routed-here`; `blocked` → `blocked` + reason; `indeterminate`).
       5. Finish `completed` (or `empty` when eligible = 0).
       An error in one order never aborts the run (item `indeterminate`); an infrastructure error before step 3 finishes `failed-to-start`.
     - `listRuns(connectionId, page)`, `getRun(runId)` → run + items with `finalOutcome` per item derived from `ISalesDocumentViewService.getForOrders` (`issued` | `in-doubt` | `failed` | `pending` | `blocked`), never stored.
   - **Why sequential**: M15 note 8; the per-order issue lock serialises anyway, and a sequential loop keeps the run's progress observable.
   - **Acceptance**: specs for happy path (N enqueued), partial failure (one order throws, run completes, item indeterminate), zero eligible (`empty`, distinct from `failed-to-start`), `needs_reauth` (no gate call, queue untouched), already-running, B2B/B2C segment filtering.

### Phase 5: Jobs and scheduler (worker)
**Goal**: scheduled and on-demand runs go through one job.

1. **Job types**: `libs/core/src/sync/domain/types/sync-job.types.ts` - `salesDocument.batch.tick`, `salesDocument.batch.run`; web mirror in `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts` (+ label).
2. **Run handler**: `apps/worker/src/sync/handlers/sales-document-batch-run.handler.ts` (+ spec) - payload `{ schemaVersion: 1, connectionId, trigger, documentKinds, segment, slotAt?, startedByUserId? }`; calls `executeRun`; `outcome: 'ok'` for completed/empty/already-running, `business_failure` for `failed-to-start` (ADR-007: a refusal is terminal, retrying cannot change connection status). Registered on **`bulk`**: it is cron-paced orchestration of local reads and enqueues; the documents themselves still run on `fiscal`, so a run cannot take a slot from a buyer-facing document job.
3. **Tick handler**: `apps/worker/src/sync/handlers/sales-document-batch-tick.handler.ts` (+ spec) - lists active connections with `Invoicing` or `Fiscalization`, for each kind with `resolveTriggerModelForKind === 'batched'` and a readable schedule computes `findDueBatchSlots`, and enqueues `salesDocument.batch.run` per due slot with key `salesDocument:batch:{connectionId}:{kind}:{segment}:{slotAt ISO}` (the slot key IS the at-most-once guarantee). `bulk` lane, system scope.
4. **Scheduler task**: `apps/worker/src/scheduler/scheduler.service.ts` - `sales-document-batch-tick`, `*/5 * * * *`, `OL_SALES_DOCUMENT_BATCH_ENABLED` default ON (inert unless a connection is batched), nil-UUID system connection, key `salesDocument:batch:tick:{timestamp}`. 5-minute resolution is the precision contract ("18:00" runs between 18:00 and 18:05), stated in the API response.
5. **Registration**: `handler-registration.service.ts` - both on `bulk`; lane tally comment updated; `assertFullLaneCoverage` passes.

### Phase 6: API (apps/api)
1. **Controller** `apps/api/src/sales-documents/http/sales-document-batch.controller.ts` (+ spec), DTOs:
   - `GET /sales-documents/batches/:connectionId` → schedule per kind as resolved, time zone, next slot per kind, running run (if any), queue counts per kind. `@Roles('admin','operator','viewer')`.
   - `GET /sales-documents/batches/:connectionId/queue?documentKind=&cursor=&limit=` - same roles. Buyer name included only as the orders list already exposes it.
   - `GET /sales-documents/batches/:connectionId/runs?page=` and `GET .../runs/:runId` - same roles.
   - `POST /sales-documents/batches/:connectionId/runs` → enqueues `salesDocument.batch.run` (`trigger: 'manual'`, all batched kinds, `segment: 'all'`, key `salesDocument:batch:{conn}:manual:{uuid}`); 409 `BATCH_RUN_IN_PROGRESS` when a run is running, 409 `CONNECTION_NOT_BATCHED` when no kind is batched, 409 `CONNECTION_NEEDS_REAUTH`. `@Roles('admin','operator')`.
   - Failures answer with stable codes, never caught messages (#2341 rule).
2. Route-authorization coverage spec picks the controller up by discovery; no change needed beyond the decorators.

### Phase 7: Docs
- `docs/architecture-overview.md` § 14: batched gate, queue marker, run aggregate, lanes, slot-key idempotency, D42; § 7 lane tally.
- `apps/worker/.env.example`: `OL_SALES_DOCUMENT_BATCH_ENABLED`.
- `docs/lessons.md` only if implementation surfaces a regression.

### Implementation Details

**New Components**:
- **Domain**: `BatchSchedule` rules (sales-documents); `SalesDocumentBatchRun`, `SalesDocumentBatchRunItem`, repository port (orders).
- **Application**: `SalesDocumentBatchService` (orders); gate option (invoicing).
- **Infrastructure**: two ORM entities + repository; migration.
- **Interface**: two worker handlers, one scheduler task, one API controller.

**Configuration Changes**: `Connection.config.salesDocument.batchSchedules[kind] = { frequency, time, everyHours, timeZone, effectiveFrom }` (JSONB; `timeZone` defaults to `Europe/Warsaw`); env `OL_SALES_DOCUMENT_BATCH_ENABLED` (default `true`).

**Database Migrations**: `1938780000000-add-sales-document-batch-runs.ts` (two tables, two columns, two indexes, one partial unique index).

**Events**: none emitted or consumed.

**Error Handling**: no new domain exception for the gate (the throw is removed). `BatchRunAlreadyRunningError` / `ConnectionNotBatchedError` (orders `domain/exceptions/`) map to 409 in the controller. Per-order failures are recorded as items, never thrown out of the run.

---

## 7. Alternatives Considered

### Alternative 1: A separate queue table filled by the gate
- **Description**: the gate inserts into `sales_document_batch_queue` instead of persisting a block.
- **Why Rejected**: the gate is level-triggered and already writes one per-order state; a second table needs its own clean-up whenever the order is invoiced by hand, re-routed or cancelled, which the level-triggered columns get for free.

### Alternative 2: A run that issues documents itself
- **Description**: the run calls `IInvoiceService.issueInvoice` directly.
- **Why Rejected**: bypasses the job ladder, in-doubt handling and idempotency the per-order jobs already provide, and contradicts the issue ("a run is a view over ordinary jobs").

### Alternative 3: Per-connection cron tasks
- **Description**: register a scheduler task per connection with its own cron expression.
- **Why Rejected**: `CronJob` expressions are fixed at scheduler start (ADR-069 records the same limit for cadences), so a schedule edit would need a scheduler restart. One 5-minute tick reading config per tick applies edits immediately.

### Alternative 4: Store the final per-order outcome on the run item
- **Description**: update items as issuance jobs finish.
- **Why Rejected**: needs a writer in the invoicing/fiscal job paths and creates a second record of the document's state that can disagree with the real one. Reading the ADR-065 projection keeps one source of truth.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ `orders → invoicing` only (existing edge); invoicing gains no `orders` import (F3).
- ✅ `sales-documents` remains a zero-outbound-edge leaf (pure types only).
- ✅ Ports for persistence; services behind interfaces; tokens in `orders.tokens.ts`.

### Naming Conventions
- ✅ `*.entity.ts`, `*.orm-entity.ts`, `*.port.ts`, `*.service.interface.ts`, `*.handler.ts`, `as const` unions.

### Existing Patterns
- ✅ Report-don't-persist, level-triggered columns, system-scoped sweep, slot-keyed idempotency, ADR-065 projection.

### Risks
- **Double issue**: mitigated by unchanged deterministic job keys, the per-order lock, and `reportBlock`'s already-invoiced check inside the gate.
- **A run starving the fiscal lane**: the run itself is `bulk`; it enqueues N fiscal jobs, which the fiscal lane drains at its own cap (same load as N orders paid at once).
- **Large queues**: paged reads; sequential loop; a 10 000-order month-end run takes minutes, acceptable, and the `running` row reports progress via `eligibleCount` / items so far.
- **Missed slot during downtime**: the tick fires the most recent due slot once on recovery (slot key dedupes); older missed slots are not replayed, deliberately - one run issues everything queued anyway.
- **Time-zone bugs**: confined to one pure function with DST specs.
- **Existing `trigger-model-batched` blocks on upgrade**: they were written by the throwing gate without a connection id. They stay out of the queue until the next transition re-evaluates them. Mitigation: the migration back-fills nothing (no data to derive the connection); documented, and "Run now" ignores rows without a connection id. *Low impact: batched never worked, so very few installs have it set.*

### Edge Cases
- Order invoiced manually while queued → next gate pass clears the marker; a run reaching it first gets `none` with `alreadyDocumented: true` from `reportBlock` (Phase 1 step 2) → item `already-documented`, shown as blocked in the run ("already has a document", M15 note 5), and nothing is enqueued.
- Connection switched from batched to auto while orders are queued → next transition enqueues them; a pending scheduled run finds the kind no longer batched and skips it (`findDueBatchSlots` reads the live config).
- Two kinds due in the same tick → two runs; the running-unique index makes the second wait for the next tick (its slot key is new until it runs once).

### Backward Compatibility
- ✅ Optional fields only on shared types.
- ⚠️ Behaviour change: batched orders stop counting as invoicing attention and become a queue - the intended change.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `batch-schedule.types.spec.ts` (slots, DST, month-end + B2C fallback, effectiveFrom).
- `auto-issue-trigger.service.spec.ts` (batched waiting / queued / proceed-in-run / other-connection).
- `sales-document-batch.service.spec.ts` (happy path, partial failure, empty, needs_reauth, already-running, segments).
- Worker handler specs (tick enqueues per due slot with the slot key; run handler outcome mapping).
- Controller spec (roles, 409 codes).

### Integration Tests
- `apps/api/test/integration/sales-documents/sales-document-batch-run.int-spec.ts`: real Postgres - queue marker round-trip, run claim unique index (two concurrent claims → one run), run + items persisted, migration/entity parity via the existing parity spec pattern if the new tables are added there.

### Mocking Strategy
- Unit: mock `IAutoIssueTriggerService`, `IOrderRecordService`/repository port, `ConnectionPort`, `ISalesDocumentViewService`. Integration: real DB, gate mocked at the module boundary.

### Acceptance Criteria (#3583)
- [ ] `batched` no longer throws; a run enqueues N per-order jobs on `fiscal`.
- [ ] A batch-waiting order is not counted as invoicing attention.
- [ ] Each run recorded with per-order outcomes (issued, blocked, in doubt, failed); empty run recorded healthy and distinct from failed-to-start.
- [ ] "Run now" enqueues the same per-order jobs as the scheduled pass.
- [ ] Month-end issues B2B only; B2C goes out in the daily run (D42).
- [ ] `needs_reauth` fails the run to start with a stated reason and leaves the queue untouched.
- [ ] Tests: happy path, partial failure, zero eligible.
- [ ] No CORE ↔ Integration boundary violations.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (unchanged job keys + slot keys + running-unique index)
- [x] Event-driven patterns used where applicable (n/a; scheduler + jobs)
- [x] Rate limits & retries addressed (per-order jobs keep their ladders; run is sequential)
- [x] Error handling comprehensive
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview § 14 Invoicing, § 7 Sync Manager, § 17 Sales Documents](../architecture-overview.md)
- [ADR-041](../architecture/adrs/041-sales-document-routing-policy.md), [ADR-050](../architecture/adrs/050-workload-isolation-concurrency-lanes.md), [ADR-065](../architecture/adrs/065-sales-document-read-surface.md)
- [Kind-scoped trigger model plan (#3582)](./implementation-plan-kind-scoped-trigger-model.md)
- [Testing Guide](../testing-guide.md), [Migrations](../migrations.md)
