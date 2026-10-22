# Implementation plan - reconcile sweep for a lost `inventory.saleDecrement` enqueue (#3629)

Epic #3460. Branch `3629-sale-decrement-reconcile-sweep`, based on `origin/3453-routed-order-sale-decrement` (#3489, unmerged). **Local only: nothing committed or pushed.**

## 1. Task

Both producers of `inventory.saleDecrement` (`OrderIngestionService` intercept, `FulfillmentWorkRouteHandler`) swallow an enqueue failure by design. The job has no cron, and a retry of `route()` answers `already-routed` and reaches no enqueue, so a lost enqueue leaves the product master's stock high permanently. Add a cron-paced reconcile sweep that finds routed works whose decrement job was never enqueued and enqueues it.

Layer: CORE (fulfillment read) + worker (handler, scheduler, lane). Non-goals: no new write path into a product master; no change to `InventorySaleDecrementService`; no fix for a dead job (visible on the Jobs surface); no schema change.

## 2. Research (what is reused)

| Need | Reused |
|---|---|
| Sweep shape | `fulfillment-work-relay-sweep.handler.ts` (#2728): frontier-as-query, own lock, `resolveSweepBudget` / `resolveSweepLockTtlMs`, no `MasterSweepKind` member |
| Read service | `FulfillmentRelayReconcileService` -> new sibling `FulfillmentSaleDecrementReconcileService` in `libs/core/src/fulfillment` (leaf, injects only the work repository) |
| Enqueue | `JobEnqueuePort.enqueueJob` in the worker (as `FulfillmentWorkRerouteSweepHandler` does) |
| Key | `buildSaleDecrementJobDedupeKey(workId)` (`inventory:sale-decrement:{workId}`), the SAME key the producers use |
| Join across contexts | ADR-036 (read-only, by table name, parameterised, commented) |

## 3. Design

### The frontier is "no decrement job was ever enqueued for this work", not "no decrement row"

The issue proposes a work with a line lacking an `inventory_sale_decrements` row. That set does not shrink for lines that legitimately never get a row: an order item missing from the snapshot is logged and not persisted (#3489 known gap), a quantity `<= 0` line is skipped, and a cancelled order lowers nothing. Each would sit on the frontier and be re-driven every tick for ever.

The exact signature of a LOST enqueue is that `sync_jobs` holds no row with the producer's idempotency key. So the candidate set is:

```
fulfillment_works w
JOIN order_records o ON o.internalOrderId = w.orderId AND o.cancelledAt IS NULL
WHERE w.createdAt < now - grace
  AND NOT EXISTS (SELECT 1 FROM sync_jobs j
                   WHERE j."idempotencyKey" = 'inventory:sale-decrement:' || w.id)
ORDER BY w.createdAt ASC LIMIT :limit
```

A candidate leaves the set by being enqueued (the key now exists), which is what makes it frontier-as-query with no cursor. Enqueueing with the producers' own key also makes a race with a slow original enqueue a harmless `isExisting: true`.

Consequence to state in the docblock: a job that was enqueued and then died (`dead`) is NOT re-driven here; it is an operator-visible dead job. The sweep covers only the case nothing else can see.

### Grace and age bounds

- Grace `OL_SALE_DECREMENT_RECONCILE_GRACE_MS` (default 10 min, clamped): keeps the sweep off a work whose producer is still mid-enqueue.
- Lookback `OL_SALE_DECREMENT_RECONCILE_LOOKBACK_MS` (default 7 days, clamped 1 h .. 14 days): the frontier is "no `sync_jobs` row", and `sync_jobs` is pruned (#2946, 30 days for succeeded), so without a floor pruned rows make old decremented works look lost and the first deploy re-decrements every pre-#3453 work. Found in `/tech-review`; the max stays below the retention.
- Stuck horizon is not needed: an enqueued work leaves the frontier at once. A page in which every enqueue failed is reported (`sale_decrement_reconcile_page_all_failed`), as #2346 / #2712 surface starvation.
- Budget derived at 50 per run (one unit is one local `sync_jobs` insert, cheaper than the relay sweep's 25).

### Where things live

- `libs/core/src/fulfillment`: repository method `listWorksMissingSaleDecrementJob({ createdBefore, createdAfter, limit })`, service `IFulfillmentSaleDecrementReconcileService.listCandidates({ limit, graceMs, now })` returning `{ workId, orderId, sourceConnectionId? }`. The order source connection is needed as the job's `connectionId` (#2609: never the holder); the join to `order_records` already supplies it (`o.sourceConnectionId`).
- `apps/worker/src/sync/handlers/inventory-sale-decrement-reconcile-sweep.handler.ts`: composes the read service and `JobEnqueuePort`. Sequential; per-candidate failure counted, not thrown.
- Job type `inventory.saleDecrement.reconcileSweep` in `JobTypeValues`, `bulk` lane in `handler-registration.service.ts`, payload `InventorySaleDecrementReconcileSweepPayloadV1 { schemaVersion: 1; pageLimit? }`.
- Scheduler task `inventory-sale-decrement-reconcile-sweep`, `11,26,41,56 * * * *`, `OL_SALE_DECREMENT_RECONCILE_SWEEP_ENABLED` default ON, nil-UUID system connection, key `inventory:sale-decrement:reconcile-sweep:{timestamp}`.
- `apps/worker/.env.example`, `docs/architecture-overview.md` bullet under Inventory, and the known-gap note in `docs/plans/implementation-plan-routed-order-sale-decrement.md`.

## 4. Steps

1. Payload type + `JobTypeValues` member + barrel export (`libs/core/src/sync`).
2. Repository port + implementation (`listWorksMissingSaleDecrementJob`), ADR-036 comment.
3. Read service + interface + token, module wiring, barrel export.
4. Handler + lock key + page limit resolution + all-failed report.
5. Lane registration (`bulk`), worker module provider, scheduler task, `.env.example`.
6. Tests (below). 7. Docs.

## 5. Tests

- Handler unit: enqueues each candidate with the producers' key and the order source connection; lock contention skips; per-candidate failure does not abort the page; all-failed page is reported; nothing enqueued for an empty page.
- Service unit: grace cutoff computed from `now - graceMs` and floor from `now - lookbackMs`.
- Repository int-spec (real Postgres): a routed work with no job is returned; a work with a job (any status) is not; a work on a cancelled order is not; a work inside the grace window is not; ordering and limit.
- `handler-registration.service.spec`: lane coverage includes the new type (the boot tripwire).
- Scheduler spec: task registered, default ON.
- Acceptance check from the issue: a work whose enqueue was lost is picked up; a work with a decrement job (fully decremented, skipped or blocked) is never re-enqueued.

## 6. Risks and open questions

1. **Deviation from the issue's frontier** (job existence instead of missing rows). Reason above. Needs your OK.
2. The join reads `sync_jobs` and `order_records` from the fulfillment repository by table name (ADR-036). Alternative is composing in the handler across three services, which cannot keep the set shrinking.
3. `sync_jobs` has no retention yet (#3631), so the `NOT EXISTS` probe stays cheap only while `idempotencyKey` is indexed (it is unique); confirmed no new index needed.
4. Depends on #3453 (#3489) being merged; branch is stacked on it.
