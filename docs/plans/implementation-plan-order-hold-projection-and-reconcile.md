# Implementation Plan: `order_records.activeHoldReason` projection + reconcile pass (#2340)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: persist a denormalised `order_records.activeHoldReason` so `deriveOrderLifecyclePhase`
(#2307) and its SQL `CASE` twin (#2309) can answer `held` **without joining `order_holds`**, and add a
bounded `orders.holds.reconcile` pass that repairs the projection when the write is missed.

**Context**: `order_holds` (#2338) is the authority; the `held` arm of both the pure derivation and the
SQL twin are hard-coded `null`/`FALSE` placeholders because no persisted source existed. The `/orders`
list filter and phase-summary buckets run one non-sargable `CASE` over `order_records` columns — a join
to `order_holds` per bucket is not an option the shape admits.

**Classification**: Infrastructure (+ a Worker handler and a Scheduler task). **Migration-bearing.**

---

## 2. Scope & Non-Goals

### In scope
- `order_records.activeHoldReason` (nullable text) + a partial index, migration slot **`1855000000000`** (mandated).
- One narrow conditional UPDATE as the projection's only writer, with two callers.
- Column excluded from `toOrm` **and** from `upsert()`'s explicit column tuple.
- `deriveOrderLifecyclePhase` input + the SQL `held` predicate both wired to the projection.
- `orders.holds.reconcile`: bounded, locked, hourly, `bulk` lane, default ON.

### Out of scope (explicitly)
- **Re-pointing either provisioning/dispatch gate at the projection.** They keep reading `order_holds`
  through `getOpenHold` → `findOpenByOrder`. That is the epic's L4 exit criterion and #2339's int-spec
  asserts it against a database where this column does not exist.
- The release→enqueue gap (a released order is not re-provisioned until something else fires) — **#2341**.
- HTTP surface for holds, hold history, FE badge — #2341 / #2342.

### Constraints
- Migration slot `1855000000000` exactly (siblings hold 1849–1854 and 1857).
- No `any`, no `console.log`, no `synchronize: true`.

---

## 3. Architecture Mapping

**Target layers**: CORE (`libs/core/src/orders/` — domain port, application service, infrastructure
repository + ORM entity + migration), App (`apps/worker/` handler + scheduler task, `apps/api` read
projection).

**Capabilities involved**: none. This pass makes zero platform calls; it reads and writes two OL-owned
tables in one context.

**Reused**: `SyncLockPort`, `resolveSweepBudget` / `resolveSweepLockTtlMs` / `sweepLockKey` from
`apps/worker/src/sync/bounded-sweep.ts`, `SyncJobHandler`, `SchedulerTaskConfig`.

**Core vs Integration**: entirely CORE. The rule ("the projection must equal the open hold's reason")
is a domain invariant over two OL tables; no adapter can express or observe it.

---

## 4. Design decisions

### D1 — The projection is a CACHE, and the gates must never read it
`order_holds` wins on drift, one-directionally. Both hold gates keep calling `IOrderHoldService.getOpenHold`.
The only consumers of the column are the **derived phase** (a display/filter fact) and its SQL twin.
`OrderHoldRepositoryPort.findOpenByOrder`'s docblock already records this; the new port's docblock repeats it,
because the next reader will be tempted by the cheaper column.

### D2 — One writer statement, two callers, level-triggered
`OrderHoldProjectionRepositoryPort.setActiveHoldReason(internalOrderId, reason | null)` is a narrow
absolute-set `UPDATE … SET "activeHoldReason" = $1 … WHERE "internalOrderId" = $2 AND "activeHoldReason"
IS DISTINCT FROM $1` — the `updateSalesDocumentBlock` (#2100) shape verbatim, including the
`IS DISTINCT FROM` no-op guard that keeps the `@UpdateDateColumn` bump off the common unchanged path
and avoids a caller-side read-then-compare race.

**Storing `null` is what clears a stale value** (#2100's level-triggered rule). `place()` writes the
reason, `release()` writes `null`; the reconcile calls the same method. Two callers of one statement is
not two writers — `persistOrder` is never a writer, which is the property that matters.

**The two callers differ in ONE respect: the reconcile's write is a compare-and-set** (see D5a). The
authority path (`place` / `release`) writes unconditionally, because it IS the authority and must not be
conditional on whatever a stale reconcile left behind.

**Failure is logged, never thrown, and the log token is the only signal.** The write hangs off the hold,
so a throw would fail `place()` and leave the operator with neither a hold nor a projection. It logs at
`warn` with the stable, greppable token `order_hold_projection_write_failed` — and that token is the sole
notice anyone gets that a badge is stale for up to one cron interval, which is what makes A2's "hourly is
enough" an accepted cost rather than an invisible one. Keep it stable; it is alertable.

### D3 — Excluded from `toOrm` AND from `upsert()`'s raw column tuple
`persistOrder` runs on every ingestion with an in-memory record that knows nothing about holds, so a
round-trip would null the column and a peer's hold reason with it — the `cancelledAt` / `salesDocument*`
precedent. `OrderRecordRepository.upsert()` additionally enumerates its columns in a raw parameter tuple;
the column must be absent from **both** or the exclusion is only half done. A regression spec asserts a
`persistOrder` round-trip leaves a peer-written reason intact.

### D4 — `OrderHoldService` gains the leaf's first outbound edge, deliberately
#2338/#2339 kept `OrderHoldsModule` at "one repository". The projection write has to hang off `place()`
and `release()` (both already return the hold, so no re-read), so the module grows a second
`TypeOrmModule.forFeature` entry and the service a second injected port. This is stated in the service's
docblock rather than left to be discovered: the leaf's "one repository" posture is over, and the
justification is that a hold's projection is part of placing a hold, not a separate workflow.

The write is **best-effort and never throws**: a failed projection write must not fail the hold itself
(the hold IS the authority, and a refused `place()` would leave the operator with neither). It logs at
`warn` with a greppable `order_hold_projection_write_failed` token, and the reconcile repairs it —
which is precisely why the reconcile exists rather than being belt-and-braces.

### D5a — The repair is a COMPARE-AND-SET, and a lost CAS is a normal outcome

`findDivergentProjections` reads `(open hold, projection)` and the repair then writes `expectedReason`.
`release()` can commit in that window, so an unconditional write would put the released hold's reason
BACK — the cache contradicting the authority in exactly the direction this pass exists to prevent, and
worse than not running at all, since the release's own write may already have cleared it.

The reconcile therefore carries the **observed** projected value through and the repair adds
`AND "activeHoldReason" IS NOT DISTINCT FROM $observed`, reporting `affected > 0`. This is the
`ShipmentRepository.claimWaybillRelay` conditional-write shape, widened from `IsNull()` to a NULL-safe
equality because the observed value may be a reason rather than `null`; `updateSalesDocumentBlock`'s own
comment (#2100) names this hazard as the reason its guard lives in the `WHERE` rather than at the caller.

A lost CAS means a peer wrote first and is **not** an error: it is counted as `superseded`, never retried
in-loop (a retry re-reads the same stale value), and the next tick re-examines the row if it still
diverges.

### D5b — A failing row must not park the frontier

The candidate page is `LIMIT n` ordered by `internalOrderId`, so an exception on one row would, if it
aborted the page, permanently starve every row behind it — the failure mode #2330's returns sweep
documents and designs around. Each repair is therefore wrapped per row, counted as `failed`, and never
rethrown. A poison row costs one repair per tick instead of the whole pass.

### D5 — Frontier-as-query, NOT scan-offset — a deliberate deviation from the issue's wording
The issue says "cursor-resumed via `runBoundedSweep`". `runBoundedSweep` is the **scan-offset** family:
`{limit, offset}` over a stable set, enqueueing child jobs. This pass has neither property — it enqueues
nothing, and every page **consumes its own selection** (a repaired row leaves the divergence predicate).
An advancing offset over a shrinking set steps over rows silently. `bounded-sweep.ts`'s own header draws
this exact distinction, and `InventoryProvenanceBackfillHandler` (#2317) is the shipped precedent for
answering it the same way — reusing the sweep *primitives* (budget resolution, lock TTL, lock key) and
not the offset machinery.

The AC's actual requirement — *"budgeted, and never enumerates the whole table in one tick"* — holds
structurally: one `LIMIT n` per tick, and a failed page persists nothing.

**Candidate selection matters more than paging here.** Divergence is bidirectional:

| Case | Detected by |
|---|---|
| open hold, projection `NULL` or wrong reason | scanning `order_holds WHERE "releasedAt" IS NULL` |
| **no** open hold, projection non-`NULL` (a missed clear) | scanning `order_records WHERE "activeHoldReason" IS NOT NULL` |

A sweep over open holds alone misses the second — the one that leaves an order reading `held` forever.
The candidate set is therefore the UNION of both, and both arms are index-served: the partial unique
`UQ_order_holds_open_order` and a new partial index `IDX_order_records_active_hold`. Both sets are bounded
by "orders currently held or currently marked held", which is small — this never approaches a table scan.

`listOpenHolds(limit, offset)` (#2338) is consequently **not used**; its own docblock warns that offset
paging over a shrinking open set steps over rows. That warning is what this decision acts on.

### D6 — Every non-repair exit is observable
`runPage` returns `{ examined, repaired, superseded, failed }` and the handler logs a single structured
line per tick. `superseded` (D5a) and `failed` (D5b) are counted separately from `repaired` precisely
because collapsing them would make "the pass ran and changed nothing" indistinguishable from "the pass
ran and could not change anything". A cache with a staleness window whose repairs are invisible is a cache nobody can trust; the counters
are what an operator reads to tell "no drift" from "the pass is not running".

**No completion latch**, unlike #2317: this pass never finishes — divergence can reappear at any time. The
handler therefore has no early-return, and its steady-state cost is one indexed query returning zero rows.

### D7 — Global scope, nil-UUID system connection
Divergence has no connection axis. `SyncJob.connectionId` is non-nullable, so the task runs once for the
deployment under `SYSTEM_CONNECTION_ID` via a synthetic single-element `connectionFilter` — the
`inventory-provenance-backfill` (#2317) shape verbatim, including constructing a real `Connection` rather
than casting.

### D8 — The mirror script needs no change, and that is not a shortcut
`scripts/check-order-lifecycle-phase-mirror.mjs` rule B is **structural only** by explicit design — its
own header forbids strengthening it into a semantic assertion, naming `held` as one of the three
placeholder arms it must not interpret. Changing `held: 'FALSE'` to a real predicate keeps every
structural assertion (same keys, same order, `CASE` still built by `.map(`) green. Semantic coverage
lands where it belongs instead: a colocated repository spec asserting the `held` predicate references
`activeHoldReason`, and an int-spec asserting a held order is returned by `?phase=held`.

**Declared for review**: AC bullet 2 says the script is "extended". Strengthening rule B is what that
literal reading asks for, and the script says in prose why that is wrong. Recorded rather than done.

---

## 5. Questions & Assumptions

- **A1** — one open hold per order (`UQ_order_holds_open_order`), so the projection is a single value.
  The reconcile predicate matches that index's predicate exactly (`"releasedAt" IS NULL`).
- **A2** — hourly is enough: a drift window shows a stale badge, never a wrong gate (D1).
- **A3** — an unrecognised persisted value is coerced with `isHoldReason` on read (no default —
  `hold-reason.types.ts` is explicit that silently becoming `operator` attributes a machine's hold to a
  human). The SQL twin tests `IS NOT NULL` and so is deliberately more permissive than the TS read;
  both are honest about what they can see, and the reconcile is what removes such a value.
- **Q1** (deferred, #2341) — releasing a hold does not enqueue the next provisioning run.

---

## 6. Implementation plan

### Phase 1 — Schema
1. **`order-record.orm-entity.ts`** — add `activeHoldReason!: string | null` (`text`, nullable) with a
   docblock naming `order_holds` as the authority and this as a cache.
2. **`apps/api/src/migrations/1855000000000-add-order-record-active-hold-reason.ts`** —
   `ADD COLUMN IF NOT EXISTS "activeHoldReason" text` plus
   `CREATE INDEX IF NOT EXISTS "IDX_order_records_active_hold" ON "order_records" ("internalOrderId") WHERE "activeHoldReason" IS NOT NULL`;
   `down()` drops both. Class suffix `1855000000000`.
   *Acceptance*: `pnpm lint` (timestamp invariant) + `migration:show`.

### Phase 2 — The writer
3. **`orders/domain/ports/order-hold-projection-repository.port.ts`** — new intra-context port, NOT
   exported from the barrel (the `OrderHoldRepositoryPort` precedent). Two methods:
   - `setActiveHoldReason(internalOrderId, reason, options?: { ifCurrentlyIs: string | null }): Promise<boolean>`
     — the D2 statement; `ifCurrentlyIs` adds D5a's CAS arm and is passed ONLY by the reconcile.
   - `findDivergentProjections(limit)`.
   The docblock states D1 in the imperative: no hold gate may read this port.
4. **`orders/domain/types/order-hold-projection.types.ts`** — `HoldProjectionDivergence`
   (`{ internalOrderId, expectedReason: HoldReason | null, projectedReason: string | null }`).
   `projectedReason` is typed `string | null`, not `HoldReason | null`, on purpose: it is what the column
   actually holds, including a value no longer in the vocabulary, and it is the CAS witness of D5a.
5. **`.../repositories/order-hold-projection.repository.ts`** — implements both. The divergence query is
   a single parameterised `LIMIT n` union over the two arms of D5; both tables are same-context so no
   ADR-036 concern arises. Ordered by `internalOrderId` for determinism.
6. **`order-hold.service.ts`** — after `place()` / `release()`, call `setActiveHoldReason` **without**
   `ifCurrentlyIs`, best-effort (D2/D4). Docblock updated to state the leaf's posture change.
7. **`order-holds.module.ts`** — `forFeature([OrderHoldOrmEntity, OrderRecordOrmEntity])`, provide the
   new repository + token.
   *Acceptance*: unit specs — place writes the reason, release writes `null`, a throwing projection write
   never fails the hold.

### Phase 3 — The read path
8. **`order-record.repository.ts`** — map the column in `toDomain`; **do not** map in `toOrm`; **do not**
   add to `upsert()`'s tuple; add both to the existing exclusion docblock. Change
   `LIFECYCLE_PHASE_PREDICATES.held` from `'FALSE'` to `rec."activeHoldReason" IS NOT NULL`.
9. **`orders/domain/entities/order-record.entity.ts`** — readonly `activeHoldReason: HoldReason | null`
   (coerced with `isHoldReason` in `toDomain`). **Appended LAST**, after `taxRateEra`: the constructor is
   positional with ~30 defaulted parameters, so inserting it anywhere else silently retypes a positional
   argument at every construction site including `toDomain`'s own call.
10. **`orders.controller.ts`** — `toDto` passes `activeHoldReason: order.activeHoldReason` into
    `deriveOrderLifecyclePhase` (replacing the `null` placeholder and its Wave-2 comment).
    *Acceptance*: a held order derives `held` from both the TS ladder and `?phase=held`.

### Phase 4 — The reconcile pass
11. **`IOrderHoldProjectionReconcileService` + `OrderHoldProjectionReconcileService`** (`orders/application/`)
    — `runPage(limit)`: read divergences, repair each through `setActiveHoldReason` with
    `ifCurrentlyIs: divergence.projectedReason` (D5a), per-row `try/catch` (D5b), returning
    `{ examined, repaired, superseded, failed }`. Provided by `OrderHoldsModule`; token in
    `orders.tokens.ts`.
12. **`sync-job.types.ts`** — add `'orders.holds.reconcile'` with a comment stating it makes zero platform
    calls (the `inventory.provenance.backfill` naming precedent).
13. **`orders-job-payloads.types.ts`** — `OrdersHoldsReconcilePayloadV1 { schemaVersion: 1; pageLimit?: number }`.
14. **`apps/worker/src/sync/handlers/orders-holds-reconcile.handler.ts`** — lock via
    `sweepLockKey('order-hold-projection', scopeId)`, budget via `resolveSweepBudget(payload.pageLimit ?? 500)`,
    call `runPage`, log the counters, always release the lock. No latch (D6).
15. **`handler-registration.service.ts`** — register on the **`bulk`** lane (nothing a buyer waits on;
    bumps the tally comment).
16. **`scheduler.service.ts`** — `registerOrderHoldReconcileTask()`: hourly, `OL_ORDER_HOLD_RECONCILE_ENABLED`
    default true, `OL_ORDER_HOLD_RECONCILE_CRON`, synthetic system connection.
17. **`apps/worker/.env.example`** — document both vars.
    *Acceptance*: handler spec (lock contention → skip, counters logged); int-spec — divergence created by
    direct SQL is repaired and logged.

### Phase 5 — Tests
18. Unit: repository predicate spec (D8 — asserts the `held` arm references `activeHoldReason`, which is
    also where A3's TS-coerces / SQL-`IS NOT NULL` asymmetry is pinned rather than left to prose),
    service specs, handler spec, reconcile-service spec (CAS lost → `superseded`; throwing row →
    `failed` and the rest of the page still repaired).
19. Integration (`apps/api/test/integration/orders/`): (a) `persistOrder` round-trip does not clear a
    peer-written reason; (b) place → `?phase=held` → release → phase leaves `held`; (c) both divergence
    directions repaired by `runPage`.
20. `apps/api/test/integration/setup.ts` — no new table, so no truncate change.
21. **`listOpenHolds` disposition** — #2338 added it for this issue and D5 declines it, leaving it with
    zero callers. Amend its docblock to record that #2340 chose frontier-as-query (or delete it); leaving
    a "for #2340's reconcile sweep" docblock on an uncalled method advertises the shape this plan rejected.

---

## 7. Alternatives considered

- **Repoint the gates at the column** — rejected: the epic's L4 exit criterion, and a cache that loses on
  drift must not decide whether a parcel leaves the building.
- **`runBoundedSweep` with a scan offset** — rejected per D5 (silently skips rows over a shrinking set).
- **Sweep open holds only** — rejected: misses the missed-clear direction, the one that strands an order
  reading `held` forever.
- **A DB trigger keeping the column in sync** — rejected: invisible to the ORM and to every test that
  builds schema by `synchronize`, so it would hold in production and silently not in the int-suite.
- **No projection; join `order_holds` in the `CASE`** — rejected: the `CASE` is already non-sargable and
  evaluated twice per request by `getManyAndCount()`; a correlated join per bucket multiplies that.

---

## 8. Risks

- **R1 — stale badge window.** Bounded by the cron; never affects a gate (D1). Accepted, documented.
- **R2 — the projection becomes a second source of truth.** Mitigated by D1 + the port docblock; a
  reviewer's check is that no gate imports the new port.
- **R3a — reconcile un-clears a released hold.** Closed by D5a's CAS; without it this is the plan's
  worst failure, since the pass would actively create the drift it exists to remove.
- **R3 — `upsert()` tuple missed.** Mitigated by the D3 regression int-spec, which is the only thing that
  catches it (the `toOrm` exclusion alone is not sufficient).
- **R4 — index bloat.** The partial index covers only currently-held orders; on a healthy install that is
  single digits.

---

## 9. Alignment checklist

- [x] Hexagonal layering (port in domain, repo in infrastructure, service in application)
- [x] CORE/Integration boundary untouched (no capability, no adapter)
- [x] Existing patterns reused (#2100 writer, #2317 pass, `bounded-sweep` primitives)
- [x] Idempotency (the repair is an absolute set; re-running a page is a no-op)
- [x] Error handling (best-effort write, greppable token, reconcile as the backstop)
- [x] Testing strategy complete
- [x] Naming + file structure per `engineering-standards.md`
