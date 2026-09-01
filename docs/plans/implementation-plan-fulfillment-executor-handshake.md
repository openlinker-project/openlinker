# Implementation Plan: Executor handshake + `assignmentAttempt` + `fulfillment.work.dispatch`

**Date**: 2026-08-30
**Issue**: #2399 (`W3a-10`, Wave 3a epic #2412, stream S1)
**Status**: Revised after `/pre-implement` (NEEDS-REVISION) and `/tech-review` (Request changes) — all findings applied
**Estimated Effort**: ~1.5 days

---

## 1. Task Summary

**Objective**: Drive the *negotiation axis* of a `FulfillmentWork` — offer the work to its assigned
holder through `FulfillmentExecutorPort`, record the holder's answer, and do it under an idempotency
key that survives a job retry.

**Context**: REVIEW C7 named the defect. `FulfillmentRequest.idempotencyKey` is mandatory (#2398) and
formatted `work:{workId}:{assignmentAttempt}`. Were `assignmentAttempt` the **job-runner** attempt it
would change on exactly the retries the key must survive — a re-minted key means a second fulfilment
request to a 3PL, i.e. **a double-ship**. So the counter is a persisted, monotonic column on the work
row, bumped only by a router-driven **re-request** and written **before** the outbound call (the
Amazon MCF `sellerFulfillmentOrderId` model).

**Classification**: CORE (Application) + Infrastructure (persistence, migration) + App (worker handler).

---

## 2. Scope & Non-Goals

### In Scope

- `FulfillmentHandshakeService` driving `unsubmitted | rejected → submitted → accepted | rejected`
  and `accepted → cancellation_requested → cancellation_accepted | cancellation_rejected`.
- One atomic **claim-and-increment** repository method (replacing `incrementAssignmentAttempt`), plus
  result-stamp methods for each arm and the blocking-exclusion read.
- Schema: `fulfillment_works.acceptedAt` + `.externalWorkId`; append-only
  `fulfillment_work_rejections`; migration + parity-spec extension.
- Job type `fulfillment.work.dispatch`, worker handler, lane registration, ADR-007 outcome mapping.

### Out of Scope — each with a named owner

| Deferred | Owner | Why |
|---|---|---|
| The re-source loop (choosing a different holder) | #2395 | This slice *records* and *exposes* the exclusion; selecting on it is the router's |
| **ADR-054 timeout-as-rejection sweep** | **needs an issue — reported to the programme owner** | `IDX_fulfillment_works_request_status` (#2392) says "#2399 owns the sweep". It needs its own job type, lane and scheduler task. **Consequence while deferred, stated rather than hidden: a `submitted` work whose holder never answers stays `submitted` indefinitely.** It is not silently retried into the ground — §4.2's resume path is attempt-scoped and terminal-safe — but nothing reaps it |
| A cancellation job type | — | The handshake ships as a service method; no caller yet, and a `JobType` costs a lane registration plus a boot-coverage entry |
| Progress ingestion / relay hygiene / `supportedActions` | #2400 / #2401 / #2406 | |

### Constraints

- **ADR-053 no-injection invariant** (§3).
- `check-migration-timestamps` rule 4 — re-verify the tail at commit time.
- Every new column nullable; the new table additive.

---

## 3. Architecture Mapping

`fulfillment` is a **registered zero-sibling-edge leaf** (`barrel-purity.spec.ts:249`), authorized only
for **type-only** imports of `@openlinker/core/fulfillment-authority` and
`@openlinker/core/order-lifecycle`. `scripts/check-no-injection-contracts.mjs` covers it and scans
specs too.

| Need | Naive route | Why refused | Route taken |
|---|---|---|---|
| The executor adapter | inject `IIntegrationsService` (a **value** import from a sibling) | fails `barrel-purity.spec.ts`; the authorized list is type-only, and the brief forbids weakening a guard for convenience | **the resolved `FulfillmentExecutorPort` is a method ARGUMENT** |
| `shipTo` | inject an orders service | ADR-053 forbids it outright | **`RoutingShipTo` is a method ARGUMENT** (same-leaf type) |
| `deliveryMethod` | pass as an argument too | **it is already a persisted column** on the work row, written insert-only by the router; a second source could disagree with the row | **read from the loaded work** |

This is ADR-053's own rule ("order data enters as arguments") applied to a second kind of dependency.
No guard weakened, no allow-list entry spent. `SyncLockPort` is likewise not used — it is a `sync`
value edge, and the conditional UPDATE makes a lock unnecessary.

**Known duplication, named now rather than discovered later**: the handler is the only place that
assembles a dispatch (work → holder → executor → order → `shipTo`). #2406/#2410's operator actions
will need the identical chain in `apps/api`; the intended landing spot is a host-side helper, not a
second copy.

---

## 4. Design

### 4.1 The claim is one conditional UPDATE — and it replaces an existing writer

`incrementAssignmentAttempt` already exists (#2392, shipped *for* this issue) and the repository's
per-column writer table names it the **sole writer** of `assignmentAttempt`. Its `WHERE` is `"id" = :id`
alone — no state guard — so any caller could bump the counter out from under a live `submitted`
dispatch and invalidate an in-flight idempotency key. It has **zero production callers**.

It is therefore **replaced**, not supplemented, by `claimDispatchAttempt`:

```sql
UPDATE fulfillment_works
   SET "requestStatus"     = 'submitted',
       "assignmentAttempt" = "assignmentAttempt" + 1,
       "version"           = "version" + 1
 WHERE "id" = $1
   AND "requestStatus" IN ($2…)      -- 'unsubmitted' | 'rejected'
RETURNING "assignmentAttempt";
```

The writer table is updated in the same commit: `claimDispatchAttempt` becomes the sole writer of
`assignmentAttempt` and joins `create` / `transitionRequestStatus` on `requestStatus`. A **named**
additional writer is the table's convention (`status` and `assignedConnectionId` each already list
three); an *unnamed* one is the defect it guards against.

Three properties:

1. **`affected > 0` IS the claim.** At READ COMMITTED the loser blocks on the row lock, re-evaluates
   the `WHERE` against the committed row and matches zero. The shipped `claimWaybillRelay` /
   `claimAttribution` / `claimDispatchRelay` idiom.
2. **The attempt is written BEFORE the outbound call, structurally** — it reaches the caller only via
   `RETURNING` from the statement that persisted it. Minting a key without the row already holding
   that value is not expressible, which is stronger than asserting call order in a spec.
3. **No unique index and no lock.** `x = x + 1` in one UPDATE is atomic at row level, so two
   increments yield 1 and 2 — never both 1. The bounded/unique concern applies to *inserted* rows; an
   attempt is a column, not a row. The live-state uniqueness that does matter is the `requestStatus`
   guard, which is state-based and needs no partial index.

`applyGuardedUpdate` returns `boolean`, so a sibling helper surfaces `RETURNING` rather than widening
a method with seven existing callers.

### 4.2 Retry re-mints an identical key (attempt-scoped claim-or-resume)

The job payload carries the **claimed** `assignmentAttempt`.

```
claimDispatchAttempt(workId, from: ['unsubmitted','rejected'])
  ├─ affected > 0 → attempt = RETURNING value              (first run / re-request)
  └─ affected = 0 → re-read
       ├─ 'submitted' AND persisted attempt === payload attempt → resume on that attempt  ← RETRY
       ├─ 'submitted' AND persisted attempt !== payload attempt → NO CALL, outcome 'ok'
       │     (a delayed duplicate for attempt 1 waking after a re-request must not mint a key
       │      it never claimed, for a holder it was not enqueued against)
       ├─ 'accepted'                       → no-op, 'ok'
       ├─ 'cancellation_requested'         → no-op, 'ok' (in-flight on the OTHER axis, not terminal)
       └─ 'cancellation_accepted' | 'cancellation_rejected' → no-op, 'ok' (terminal)
```

**What concurrency actually guarantees — corrected.** Because the resume arm re-issues the call, two
concurrent runs *both* reach `requestFulfillment`. The row guard is therefore **not** what prevents a
second outbound call; the port's replay guarantee is. The honest invariant is: **exactly one claim,
exactly one distinct idempotency key, at most one `assignmentAttempt` increment** — a duplicate call
is absorbed by the port's stated contract ("a repeat under the same key returns the ORIGINAL outcome
and never creates a second assignment"). §6 test 5 asserts that, not "one executor invocation".

### 4.3 Recording the answer

**Accept arm** — one guarded UPDATE writing `requestStatus='accepted'`, `acceptedAt` and
`externalWorkId` together, guarded:

```sql
WHERE "id" = $1 AND "requestStatus" = 'submitted' AND "acceptedAt" IS NULL
```

`acceptedAt IS NULL` is not decoration: `fulfillment-request-status.types.ts:31` states that ADR-054
makes acceptance a **conditional claim** and that "the claim column and its at-most-once semantics
land with #2399". It is the only guard that survives a future writer moving `requestStatus` without
going through this method.

**Reject arm — a table, not two columns.** #2392 deferred "the rejection pair
(`rejectionReason`, `blocking`)" here. **This plan deviates deliberately.** Per
`fulfillment-execution.types.ts` property (a), `blocking` exists so re-sourcing can *exclude the
rejecter* — otherwise "re-source plus a deterministic sort re-picks the refuser forever". Exclusion is
a **set**: A rejects blocking, the router tries B, B rejects too. A scalar pair holds only the last
rejection, so A's exclusion is silently lost and the loop the field exists to terminate runs anyway.

```
fulfillment_work_rejections
  id                  uuid pk
  fulfillmentWorkId   text  → fulfillment_works.id (FK, ON DELETE CASCADE)
  orderId             text        -- DENORMALISED lineage; see below
  connectionId        uuid        -- WHO rejected; without it the row excludes nobody
  assignmentAttempt   integer
  reason              text        -- opaque, the rejecter's vocabulary
  blocking            boolean NOT NULL
  detail              text null
  rejectedAt          timestamptz NOT NULL
```

Indexes: unique `(fulfillmentWorkId, assignmentAttempt)` — "one recorded answer per attempt" is a real
invariant the transaction guard only enforces incidentally; a plain `(fulfillmentWorkId)` index so the
`ON DELETE CASCADE` does not seq-scan (the partial index cannot serve it); and partial
`(fulfillmentWorkId, connectionId) WHERE blocking = true` for the exclusion read.

**Why `orderId` is denormalised — an open question this slice must not close silently.** The writer
table says re-routing may **mint a new work row** (`locationId`/`deliveryMethod` are insert-only
precisely to force #2395 to choose). If it does, a `workId`-keyed read returns `[]` and the exclusion
is lost. This slice does not own that choice, so it refuses to bind it: the row carries `orderId` so
the lineage survives **either** decision with no later migration, and the shipped read stays
`workId`-keyed. Recorded as an explicit constraint on **#2395**: *if re-sourcing mints a new work row,
it must carry the blocking exclusions forward — the data is there, the read is one line.*

The reject stamp is **two writes in one transaction**: the guarded `submitted → rejected` UPDATE plus
the INSERT. If the guard does not apply, nothing is inserted — pinned by its own spec, since
durability and rollback are different assertions.

**A lost race is a handled state, not an omission.** `recordAcceptance` / `recordRejection` returning
`false` means a peer moved the row first; the service reports outcome `'ok'` without re-calling and
logs, because the holder's answer is already recorded by whoever won.

### 4.4 The cancellation key must not collide with the dispatch key

`FulfillmentCancellationRequest.idempotencyKey` is mandatory. The only format the tree defines is
`work:{workId}:{assignmentAttempt}` — *the dispatch key for the same attempt*. Because the port
guarantees a repeat under one key returns the **original** outcome, a cancellation sent under the
dispatch key would be answered with the dispatch's cached `accepted`, and OL would record
`cancellation_accepted` for a cancellation that was never delivered.

Cancellation therefore uses a distinct namespace: **`work:{workId}:{assignmentAttempt}:cancel`**. Both
formats are stated together in `fulfillment-execution.types.ts` property (d), and a spec pins that the
two keys are never equal for the same work and attempt.

### 4.5 Writer discipline

`acceptedAt` / `externalWorkId` have exactly one narrow atomic writer (`recordAcceptance`). The header
has no `toOrm`, so the discipline is `create` initialising both to `null` and no other method
mentioning them — how `cancelledAt` and `dispatchRelayedAt` are already handled. Both rows are added
to the writer table.

### 4.6 The job

`fulfillment.work.dispatch` in `JobTypeValues`; payload `{ workId, assignmentAttempt }`. Handler under
`apps/worker/src/sync/handlers/` — where all existing registrations live — plus a worker module and
`jobs`-role wiring (ADR-051).

**`SyncJob.connectionId` = the work's `assignedConnectionId`.** That column is non-nullable and *is*
the lane scope (`resolveJobScope`). #2609 is exactly this defect: `inventory.propagateToMarketplaces`
used a synthetic zero-uuid, so every job in the installation shared one scope and the per-scope cap
serialised the lot. Noted honestly: at `OL_LANE_REALTIME_SCOPE_CAP` (default 2) a router minting N
works for one holder drains two at a time — event-paced work against a cap sized for a different shape.

Outcome mapping (ADR-007):

| Result | Outcome | Why |
|---|---|---|
| `accepted` | `'ok'` | |
| `rejected` | **`'business_failure'`** | deterministic business answer; retrying burns the ladder to no effect |
| already accepted / terminal / attempt mismatch | `'ok'` | nothing to do |
| **unassigned work** | **retryable throw** | *not* `business_failure`. That is terminal, and this slice does not own the enqueue: if #2395 enqueues before `assignHolder` commits, a terminal outcome dead-ends permanently on work that becomes assignable a second later. The ladder absorbs the race |

**Lane: `realtime`.** ADR-050 picks by *cost of starvation*. A dispatch is the outbound "tell the
holder to ship" for a just-routed order — someone is waiting, and lateness costs a shipment. Same
class as `marketplace.order.sync` / `marketplace.return.sync`, both `realtime`; emphatically not a
paced sweep. #2594's split-by-trigger has nothing to separate: one trigger, one cost, so the type
stays single. Tripwire in `handler-registration.service.spec.ts`: realtime **13→14**, job types
**50→51**, dummy handlers **48→49**.

---

## 5. Implementation Steps

**Phase 1 — Persistence.** (1) `acceptedAt` / `externalWorkId` on the work ORM entity. (2) New
`fulfillment-work-rejection.orm-entity.ts` per §4.3. (3) `FulfillmentWork` + `FulfillmentWorkRejection`
types. (4) Port: `claimDispatchAttempt`, `recordAcceptance`, `recordRejection`,
`listBlockingRejections`; **delete `incrementAssignmentAttempt`**. (5) Repository impl; `create`
initialises the new columns to `null`; **update the writer-discipline table**. (6) Migration
`1865000000000-add-fulfillment-handshake.ts` — re-verify the tail before committing. (7) Parity spec:
add the table to `TABLES`, fix the **hardcoded three-element** non-vacuity array at
`:154-158`, its `it` title, and the CASCADE smoke test — **four edits, not one**.

**Phase 2 — Core service.** (8) `fulfillment-handshake.service.interface.ts` + implementation +
`FULFILLMENT_HANDSHAKE_SERVICE_TOKEN` + module provider/export + barrel (minimal additions —
`fulfillment.tokens.ts` and `index.ts` are shared with five siblings). (9)
`fulfillment-handshake.types.ts`. (10) Key minting helper + the two formats documented in
`fulfillment-execution.types.ts`. (11) Unit specs (§6).

**Phase 3 — Worker.** (12) `JobTypeValues` + payload type. (13) Handler, worker module, registration
at `'realtime'`, tripwire counts. (14) Handler spec.

**Phase 4 — Integration + docs.** (15) `fulfillment-handshake.int-spec.ts`. (16)
`docs/architecture-overview.md` § Fulfillment.

---

## 6. Testing Strategy

Red-first is mandatory, **and the red must be for the right reason** — a container that refuses to
boot, or `TS6133` with `Tests: 0 total`, proves nothing.

| # | Assertion | Kind | Made to fail first by |
|---|---|---|---|
| 1 | A job retry re-mints an **identical** key (AC-1) | unit | returning a fresh attempt on resume — key differs |
| 2 | The attempt is persisted **before** `requestFulfillment` (AC-2) | unit | executor double asserts the repo already holds it; reordering fails it |
| 3 | `rejected{blocking:true}` is durable and readable as an exclusion (AC-3) | integration | dropping the INSERT |
| 4 | Terminal rejection ⇒ `business_failure` (AC-4) | unit | mapping it to `'ok'` |
| 5 | Two concurrent dispatches ⇒ **exactly one claim, one distinct key, one increment** | integration | removing the `requestStatus` guard ⇒ two claims, two keys. Deterministic, not timing-dependent: an independent transaction holds the row, the second claim observes committed state |
| 6 | An accepted work is never re-offered | unit | widening `from` to include `accepted` |
| 7 | A losing reject stamp inserts **zero** rejection rows (rollback ≠ durability) | integration | dropping the transaction |
| 8 | The cancellation key never equals the dispatch key for the same work+attempt | unit | reusing the dispatch format |
| 9 | An attempt-mismatched resume makes **no** outbound call | unit | dropping the payload-attempt comparison |

Migration verified separately from empty against a **throwaway** Postgres on a spare port (5432 is
held); report the `migration:show` tail, confirm 0 pending, remove the container.

---

## 7. Alternatives Considered

**A. Rejection as two columns on the work row.** Rejected — §4.3; a scalar cannot hold an exclusion
set. **B. Inject `IIntegrationsService` and widen the leaf's authorized list.** Rejected — value
import, type-only list, and weakening a guard for convenience is forbidden. **C. A `SyncLockPort` lock
on the claim.** Rejected — the conditional UPDATE already serialises; a lock adds a `sync` value edge
to buy nothing. **D. A unique index on `(workId, assignmentAttempt)` in `fulfillment_works`.**
Rejected — nothing is inserted per attempt there. (The *rejections* table does get one, for a
different invariant: one recorded answer per attempt.) **E. Keep `incrementAssignmentAttempt` beside
the claim.** Rejected — two writers on one column, and the old method's unguarded `WHERE` can
invalidate a live key. **F. A cancellation job type.** Deferred — no caller.

---

## 8. Risks, Reachability & Coordination

**Reachability.** `FulfillmentExecutor` is in `CoreCapabilityValues` (#2403) but **no shipped adapter
manifest advertises it**, and both capability-checkbox surfaces intersect an adapter's advertised list
with the core set. So after this slice the handshake, counter, schema and job are **complete and
test-exercised but not reachable from the UI**: A3 becomes assignable only via a direct
`PATCH /connections/:id`, and end-to-end only when the first executor adapter declares the capability
(#2409). Nothing here closes that gap and nothing here should.

**Risks.** Migration ordering — five siblings ship migrations onto this branch concurrently; re-verify
at commit time. Merge conflicts — `fulfillment.tokens.ts` / `index.ts` are shared; additions kept to
one token and a small export block (verified: no sibling has touched either yet). `uuid_generate_v4()`
without extension creation — migration `1766246163229`, tracked as **#2684**; cite if hit.

**Adjacent to #2400.** `externalWorkId` is persisted here because it arrives on the **accepted** arm
and is on that arm's allowlist — #2398 states plainly that "#2399 stamps `FulfillmentWork.requestStatus`
from this result, so a field an adapter adds there is a field core may persist". #2400 will *read* it
to correlate progress. Reported to the orchestrator as an adjacency. **No service seam from
`fulfillment` to `orders` is created or needed.**

---

## 9. Alignment Checklist

- [x] Hexagonal layering respected
- [x] CORE ↔ Integration boundary intact — the executor crosses as an argument, resolved host-side
- [x] ADR-053 no-injection invariant preserved; **no guard weakened, no allow-list entry spent**
- [x] Existing patterns reused (`applyGuardedUpdate`, the `claim*` idiom); the superseded writer deleted
- [x] Idempotency is the subject; the key survives a retry by construction and is attempt-scoped
- [x] ADR-007 outcome split honoured; ADR-050 lane by cost of starvation; ADR-054 accept-claim honoured
- [x] Migration + the repo's only migration-parity check extended (four edits)
- [x] Every deferral has a named owner; the one with no issue is reported

---

## Related Documentation

- `docs/plans/analysis/DESIGN-oms-authority-model.md` §5.4
- ADR-007, ADR-050, ADR-053, ADR-054, ADR-062
- `implementation-plan-fulfillment-work-schema.md` (#2392), `implementation-plan-fulfillment-executor-port.md` (#2398)
