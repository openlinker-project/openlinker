# Implementation Plan: ADR-054's timeout-as-rejection sweep for `FulfillmentWork`

- **Issue**: #2712
- **Branch**: `2712-fulfillment-work-timeout-rejection-sweep`
- **Depends on (merged)**: #2392 (schema + writer table), #2399 (handshake + attempt claim), #2352 (`omsAttention` / A3-X vocabulary), #2955 (dispatch producer)
- **Owns forward constraints for**: #2395 (re-source loop)

---

## 1. Task Summary

#2399 shipped the executor handshake but **nothing handles a holder that never
answers**. A `FulfillmentWork` sitting in `requestStatus = 'submitted'` stays
there forever: no sweep reaps it, no timeout converts it to a rejection, and no
operator surface says so. ADR-054 names the missing pass — *"timeout-as-rejection
by sweep"* — and #2392 pre-built the index it needs
(`IDX_fulfillment_works_request_status` on `['requestStatus', 'updatedAt']`,
whose own comment names this sweep).

This slice adds that pass: a paced, per-run-locked, frontier-as-query sweep that
converts an idle `submitted` dispatch into a rejection **through the same guarded
transition the handshake uses**, and raises the already-declared-but-unwritten
`fulfillment-unaccepted` (A3-X) operator state on the affected order.

The current behaviour is *safe, not merely absent* — a stalled work is never
silently retried. That property must survive: the reap is exactly the moment a
double-ship becomes possible.

---

## 2. Scope & Non-Goals

### In Scope

1. A pure timeout resolver + reason/detail vocabulary in the `fulfillment` leaf.
2. Two additive repository-port members: a bounded frontier read, and an
   **optional** `expectedAssignmentAttempt` precondition on `recordRejection`.
3. `IFulfillmentDispatchTimeoutService` — the core orchestration, which
   **reports** attention intents and writes none.
4. A new job type `fulfillment.work.timeoutSweep` on the **`bulk`** lane, its
   handler, and a scheduler task (default ON, hourly).
5. `IOrderRecordService.markOmsAttention` — the cross-context write seam the
   worker uses (a caller outside `orders` may not inject
   `OrderRecordRepositoryPort`).
6. A shared pure derivation of the order's A3-X state, called at **two** sites
   (the sweep and the dispatch handler) so the flag is level-triggered rather
   than sticky.

### Out of Scope

- **Re-routing / re-sourcing.** #2395 owns the re-source loop; it does not exist.
  `rejected` *is* the re-routable state (`CLAIMABLE_FROM` already includes it),
  which is what AC1 asks for.
- **An executor-declared timeout.** `fulfillment-executor.port.ts` states in
  terms that *"per-method error unions and **wall-clock budgets** are Wave-4
  hardening (`W4-1`, `W4-2`)"*. Adding a wall-clock sub-capability here would
  pre-empt a deferral the port itself records.
- **Clearing the holder.** The handshake does not `clearHolder` on rejection;
  a sweep that did would leave a different state for the same outcome.
- **A migration.** Verified unnecessary — see §8.
- **A frontend surface.** A3-X's badge/copy is #2357's; this slice produces the
  persisted fact it renders.

### Constraints

- `libs/core/src/fulfillment` is a registered **zero-sibling-edge leaf**
  (`barrel-purity.spec.ts`) and is covered by
  `scripts/check-no-injection-contracts.mjs`. No `orders` / `inventory` /
  `integrations` injection. Its one authorized specifier is
  `@openlinker/core/fulfillment-authority`, **type-only**.
- `fulfillment_works` has **no `save(work)`**. Every mutation is a narrow
  conditional UPDATE with a **named** writer in the repository's per-column
  table. Adding an *unnamed* writer is the defect that table exists to prevent.
- `sync-job.types.ts` and `handler-registration.service.ts` are contended with
  #2728 / #2731 — keep the diff on both to one surgical block each.

---

## 3. Architecture Mapping

| Layer | File | Change |
|---|---|---|
| CORE domain (types) | `fulfillment/domain/types/fulfillment-dispatch-timeout.types.ts` | **new** — pure rules |
| CORE domain (port) | `fulfillment/domain/ports/fulfillment-work-repository.port.ts` | +1 read, +1 optional input field |
| CORE application | `fulfillment/application/interfaces/fulfillment-dispatch-timeout.service.interface.ts` | **new** |
| CORE application | `fulfillment/application/services/fulfillment-dispatch-timeout.service.ts` | **new** |
| CORE infra | `fulfillment/infrastructure/persistence/repositories/fulfillment-work.repository.ts` | implement the two port members; extend the writer table |
| CORE wiring | `fulfillment/fulfillment.tokens.ts`, `fulfillment.module.ts`, `index.ts` | token + provider + barrel |
| CORE (orders) | `orders/application/interfaces/order-record.service.interface.ts` + `order-record.service.ts` | `markOmsAttention` seam |
| Worker | `sync/handlers/fulfillment-work-timeout-sweep.handler.ts` | **new** |
| Worker | `sync/handlers/fulfillment-work-dispatch.handler.ts` | recompute A3-X after a handshake outcome |
| Worker | `sync/handlers/handler-registration.service.ts` | one `register(..., 'bulk')` block |
| Worker | `sync/domain/types/sync-job.types.ts` (core) | one union member |
| Worker | `sync/domain/types/fulfillment-job-payloads.types.ts` (core) | the payload type, beside its `fulfillment.work.*` siblings |
| Worker | `scheduler/scheduler.service.ts` | one task |
| Docs | `apps/worker/.env.example` | two env vars |

**Why the orchestration is in CORE and the write is in the WORKER.** CLAUDE.md
puts sync orchestration policy in core application services, and ADR-053 forbids
this leaf from reaching `orders`. So the service **reports**
`AuthorityAttentionIntent[]` and the handler performs the write — the #2400
`FulfillmentRelayIntent` / report-don't-perform shape, which adds **zero** entries
to either guard's allow-set. Needing one would be the signal the placement is wrong.

---

## 4. Internal Patterns Being Reused

| Pattern | Source | Applied here |
|---|---|---|
| Frontier-as-query, no cursor | `ReservationExpiryHandler` (#2346), `InventoryProvenanceBackfillHandler` (#2317) | the candidate set consumes its own selection |
| Sweep primitives without the offset machinery | `bounded-sweep.ts` header | `resolveSweepBudget` + `resolveSweepLockTtlMs` only |
| Own lock namespace, no `MasterSweepKind` | #2346 | `sweepLockKey` renders `master:{kind}:sweep:{id}` — a false name here |
| Global scope under the nil-UUID system connection | #2346/#2347/#2349 | this pass has no connection axis |
| Attempt-scoped staleness guard | #2399 `claimOrResume` | `expectedAssignmentAttempt` |
| Reported === enforced through one path | #2229 | one resolver; its output feeds the cutoff *and* the operator-facing detail |
| Our inference warns, their declaration blocks | #2243 | `blocking: false` on a timeout |
| Level-triggered, never sticky | #2100 | one derivation, two call sites |

---

## 5. Questions & Assumptions

### Decisions taken (no ⏸️ pause — recorded here)

**D1 — Lane: `bulk`.** ADR-050 picks by *cost of starvation*, not I/O shape. This
is a cron-paced reconciler nobody waits on, over work that is **already stalled by
definition** — a tick's extra delay is immaterial. Its two `fulfillment.work.*`
siblings are `realtime` for the opposite reason (a buyer waits on a dispatch and
on a route). Direct precedent: `inventory.reservations.expire` is `bulk`, and its
registration reasons identically. Putting a reaper in `realtime` would let it take
a slot from an actual dispatch.

**D2 — Frontier-as-query, not scan-offset.** The candidate set is
`requestStatus = 'submitted' AND "updatedAt" < cutoff`, and **every page consumes
its own selection**: a reaped row moves to `rejected` and leaves the set. An
advancing offset over a shrinking set steps over rows — here that means a work
that is never reaped and an order that stalls forever, which is the exact defect
being fixed. `bounded-sweep.ts` draws this distinction in its own header; #2317
and #2346 recorded the same reasoning. **No cursor at all — the predicate is the
cursor.** No `MasterSweepKind` member is added.

**D3 — A timeout rejection is `blocking: false`.** Three reasons, in order of
weight:
1. `blocking` is a fact the **rejecter asserts**. A silence is not an assertion.
   The repo's standing rule (#2243) is *"a destination's own declaration is a fact
   and blocks; OUR inference only warns"* — a timeout is purely OL's inference.
2. Blocking exclusions **accumulate as rows and are never cleared**. On the only
   shipped topology there is exactly one executor (`openlinker.oms.v1`), so one
   blocking timeout would exclude the **only** possible holder permanently, making
   the order unroutable with no in-product remedy — an unrecoverable dead end
   caused by a transient outage.
3. The loop `blocking` exists to terminate cannot occur today: nothing
   re-sources. **Forward constraint recorded against #2395**: its re-source loop
   must bound attempts itself rather than rely on exclusion for a timeout,
   because a timeout deliberately does not exclude.

**D4 — No migration.** `IDX_fulfillment_works_request_status` already exists on
`['requestStatus', 'updatedAt']`, created by #2392 with a comment naming this
sweep. The predicate and the `updatedAt ASC` ordering match it exactly. Verified
against the ORM entity *and* the migration (see §8).

**D5 — The clock is `updatedAt`, and the semantics are "idle", not "submitted
since".** `updatedAt` moves on any applied write (`recordLineProgress` writes it
explicitly), so a work that something is actively touching resets its clock. That
is stated rather than papered over, and the failure direction is the safe one: it
can only **delay** a reap, never accelerate one. A `submittedAt` column would be
more literal and would cost a migration for a strictly worse failure direction
(reaping a work a holder is demonstrably progressing).

**D6 — Timeout default 2 h, env-overridable, clamped `[5 min, 7 d]`.** Every
shipped executor accepts synchronously, so 2 h reaps nothing healthy; the floor
stops an operator configuring a value that would reap live dispatches. Revisit
when #2395 makes a reap into a re-route.

The clamp SHAPE is taken from `routing-commit-lock.ts` (the only other
`OL_FULFILLMENT_*` knob in the tree), but its **derived-fraction** approach is
deliberately not: `FULFILLMENT_ROUTE_TIMEOUT_MS = floor(LOCK_TTL * 0.5)` works
because both bound one in-process call, whereas an executor's response deadline
is a property of a third party's turnaround with no lock to be a fraction of.
It therefore takes its own env var, `OL_FULFILLMENT_DISPATCH_TIMEOUT_MS`, beside
`OL_FULFILLMENT_ROUTE_LOCK_TTL_MS`. The enable flag follows the shipped sweep
convention (`OL_RESERVATION_*_SWEEP_ENABLED`,
`OL_AUTOMATION_DEADLINE_SWEEP_ENABLED`): `OL_FULFILLMENT_TIMEOUT_SWEEP_ENABLED`.

**D9 — the service seam is `markOmsAttention`, not `updateOmsAttention`.**
`IOrderRecordService` already carries TWO instances of this exact
report-then-write one-way edge, and both spell the service method `mark*` while
the repository method is `update*`: `markSalesDocumentBlock` (#2100) and
`markFulfillmentBlock` (#2396). The new seam follows them. It keeps the
three-arm `AuthorityAttentionOutcome` rather than those two precedents'
`T | null`, because `indeterminate` is #2352's load-bearing third state and
collapsing it into `null` would clear a true reason on a transient failure.
Note `markFulfillmentBlock` writes a DIFFERENT column pair
(`updateFulfillmentBlock`, the #2396 routing-intercept hold) and is a shape
precedent only, never a reuse target.

**D7 — Default ON.** The pass makes no platform call, writes only OL-owned rows,
and is **inert on every install that has not opted into routing** (routing is
opt-in and an OMS `Connection` is never seeded — ADR-055). The state it replaces
is a silent stall; the state it creates is visible and actionable.

**D8 — Operator visibility is A3-X on the order, not the rejection row.** With
`blocking: false` (D3) the rejection row is invisible to `listBlockingRejections`
— the only read over that table — so the rejection alone would **not** satisfy
AC4. `fulfillment-unaccepted` is the designed answer: its descriptor reads
*"every candidate rejected **or timed out**; the work is unassigned"*, its origin
is `persisted`, its producer is `acceptance`, and **nothing writes it today**.
This slice is its first producer.

### Assumptions

- A1: While `requestStatus = 'submitted'`, `assignmentAttempt` cannot move —
  `claimDispatchAttempt` guards on `requestStatus IN ('unsubmitted','rejected')`.
  This is what makes the attempt read in the frontier query safe to write back.
- A2: The worker composes both `FulfillmentModule` and `OrdersModule`.

---

## 6. Proposed Implementation

### Phase 1 — Pure rules (`fulfillment` leaf)

`domain/types/fulfillment-dispatch-timeout.types.ts`:

- `FULFILLMENT_DISPATCH_TIMEOUT_REASON = 'openlinker:dispatch-timeout'` —
  **namespaced**, because `FulfillmentWorkRejection.reason` is documented as *the
  rejecter's own vocabulary*; OL writing into it must stay distinguishable from a
  holder's own string.
- `resolveFulfillmentDispatchTimeoutMs(raw: string | undefined): number` —
  default/clamp per D6. **The single resolution path** (AC3).
- `describeFulfillmentDispatchTimeout(ms: number): string` — the operator-facing
  detail, built from the *same* number, so reported === enforced structurally.
- `deriveAcceptanceAttention(works): AuthorityAttentionOutcome<'acceptance'>` —
  `blocked` when any non-terminal work on the order sits at
  `requestStatus === 'rejected'`, else `none`. Covers a holder's own rejection as
  well as a timeout, which is exactly what A3-X's descriptor says.
  `AuthorityAttentionOutcome` is imported **type-only** from the leaf's one
  authorized specifier.

### Phase 2 — Port + repository

- `TimedOutFulfillmentDispatch` — a **narrow projection**
  (`workId`, `orderId`, `assignedConnectionId`, `assignmentAttempt`, `idleSince`),
  not the aggregate: the sweep needs four scalars, and hydrating lines for every
  candidate would be a join for nothing.
- **`listWorks` is deliberately NOT extended.** It already filters
  `requestStatus[]`, so widening it is the obvious move and it is the wrong one:
  it backs the operator worklist, returns a hydrated `FulfillmentWorkPage`, and
  its `FulfillmentWorkListFilter` is an operator-API-facing type whose `orderBy`
  offers only `createdAt_DESC | createdAt_ASC`. Adding an `idleBefore` axis and
  an `updatedAt_ASC` ordering would widen an operator filter with an axis no
  operator uses AND hydrate lines and holds this sweep never reads.
- `listTimedOutDispatches({ idleBefore, limit })` — ordered `updatedAt ASC`
  (oldest-idle first; matches the index, and is #2346's fairness rule).
- `RecordFulfillmentRejectionInput` gains a **NEW optional**
  `expectedAssignmentAttempt?: number` (it carries `assignmentAttempt` today and
  nothing else) — optional, so the handshake stays byte-identical. Applied as one extra
  `AND "assignmentAttempt" = :attempt` conjunct. This is #2399's own attempt-scoped
  discipline applied to a delayed actor, and is what makes a stale reap
  identifiable (AC2's framing).
- Extend the repository's per-column writer table: `requestStatus` gains
  `listTimedOutDispatches`'s consumer as a **named** writer via `recordRejection`
  (no new writer method — the sweep reuses `recordRejection` verbatim).

### Phase 3 — Core service

`IFulfillmentDispatchTimeoutService.reapTimedOutDispatches({ limit, timeoutMs, now })`:

1. Read the frontier.
2. Per candidate, call `recordRejection` with `expectedAssignmentAttempt`,
   `reason: FULFILLMENT_DISPATCH_TIMEOUT_REASON`, `blocking: false`,
   `detail: describeFulfillmentDispatchTimeout(timeoutMs)`, `rejectedAt: now`.
3. `false` ⇒ **raced**, not reaped: a peer (a late acceptance, or a concurrent
   sweep) moved the row first. **No attention intent is emitted** — writing A3-X
   there would be a false claim about a work the holder just accepted.
4. A throw ⇒ **failed**, counted, loop continues.
5. For each order with ≥1 applied reap, recompute the attention outcome from
   `findByOrderId` and emit one intent.
6. Report `{ examined, reaped, raced, failed, timeoutMs, attentionIntents }`.

### Phase 4 — Worker

- New handler: acquire the pass's own lock
  (`fulfillment:work:timeout-sweep:{scopeId}`), resolve budget + timeout, call the
  service, then write each intent through `IOrderRecordService.markOmsAttention`.
  Attention writes are best-effort and never fail the run — the reap is already
  durable, and failing would re-run a reap that has nothing left to reap.
  A wholly-failed page is reported (`fulfillment_timeout_sweep_page_all_failed`) —
  #2346's hazard: a permanently-failing row keeps its `updatedAt`, stays at the
  head of an oldest-first ordering, and starves the rest.
- `fulfillment-work-dispatch.handler.ts`: after a handshake outcome, recompute and
  write the same derivation. This is what makes A3-X **level-triggered** (#2100)
  — an accepted re-dispatch clears it — and it closes the same gap for a holder's
  own rejection through the one shared rule.
- One union member, one `register(..., 'bulk')`, one scheduler task
  (`35 * * * *`, `OL_FULFILLMENT_TIMEOUT_SWEEP_ENABLED`, default true, system
  scope).

---

## 7. Alternatives Considered

- **Executor-declared timeout sub-capability** — rejected: the port defers
  wall-clock budgets to `W4-1`/`W4-2` by name, and a sweep scanning all
  connections cannot resolve adapters from a leaf that may not inject
  `IIntegrationsService`.
- **A new `expireDispatch` writer on the repository** — rejected: it would be a
  second, unnamed writer of `requestStatus` doing what `recordRejection` already
  does correctly, and the whole point of the writer table is that such a method
  cannot appear silently.
- **`blocking: true`** — rejected per D3.
- **A `submittedAt` column** — rejected per D5 (migration, worse failure direction).
- **Scan-offset with a cursor** — rejected per D2 (steps over rows).
- **Rejection row alone as the operator surface** — rejected per D8 (invisible
  under `blocking: false`).

---

## 8. Validation & Risks

### Migration check (D4)

Confirm before implementing:
- the ORM entity declares `IDX_fulfillment_works_request_status` on
  `['requestStatus', 'updatedAt']`;
- the migration creates the same index under the same name;
- `fulfillment-work-migration-parity.int-spec.ts` already compares `indexdef`
  between the migration-built and `synchronize`-built schemas, so no new parity
  work is needed.

### Risks

| Risk | Mitigation |
|---|---|
| Reaping frees work for re-routing ⇒ double-ship | Nothing re-sources today; `blocking: false` + forward constraint on #2395; the reap goes through the same `submitted`-guarded UPDATE, so a late acceptance wins the race and the sweep records nothing |
| A late holder acceptance after a reap | `recordAcceptance` is guarded on `requestStatus = 'submitted' AND acceptedAt IS NULL` — it already refuses. The sweep adds `expectedAssignmentAttempt` so a reap cannot land on a row that has since been re-dispatched |
| Sticky A3-X flag | The derivation is level-triggered and runs at both the reap and the handshake outcome |
| Split order: one work reaped, a sibling accepted | The derivation reads **all** the order's works, so it is split-safe by construction — not a per-work overwrite |
| A permanently-failing candidate starves the page | Counted and reported; oldest-first ordering makes the stall visible as a flat `reaped` count |
| Boot failure from the new job type | Intended — `assertFullLaneCoverage()` is the guard; registration lands in the same commit |

### Edge cases

- Empty frontier ⇒ `examined: 0`, no lock churn beyond one acquire.
- A work whose `assignedConnectionId` is `null` cannot exist in `submitted`
  (dispatch throws `FulfillmentWorkUnassignedError` before claiming), but the
  projection types it as nullable and the sweep **skips** such a row rather than
  writing a rejection row that names no holder — a rejection that does not say
  who excludes nobody.
- `limit` clamped through `resolveSweepBudget`.

### Backward compatibility

Both port additions are additive; every existing caller is untouched. On any
install without routing there are no `fulfillment_works` rows, so the pass is a
no-op.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit
- `resolveFulfillmentDispatchTimeoutMs`: default, override, both clamps, junk.
- `describeFulfillmentDispatchTimeout` embeds the **same** number the cutoff uses
  (AC3 — reported === enforced).
- `deriveAcceptanceAttention`: rejected ⇒ blocked; accepted ⇒ none; terminal work
  ignored; **split order with one rejected + one accepted ⇒ blocked**.
- Service: reaps, counts raced/failed, emits no intent on a raced row, passes
  `blocking: false` and the namespaced reason, skips an unassigned row.
- Handler: lock skip, budget/timeout resolution, attention write, all-failed report.

### Integration (real Postgres)
- `fulfillment-work-timeout-sweep.int-spec.ts`:
  - a `submitted` row idle past the cutoff is reaped; a fresh one is not;
  - **AC2, overlapping not sequential**: a `recordAcceptance` and the sweep's
    `recordRejection` issued **concurrently** against one row — exactly one
    applies, the row lands in exactly one state, and `assignmentAttempt` does not
    move. A sequential test passes against no guard at all, which is why it is
    not the evidence.
  - `expectedAssignmentAttempt` mismatch ⇒ nothing written;
  - a reaped row is absent from the next run's frontier (the D2 property).

### Acceptance criteria mapping

| AC | Where |
|---|---|
| Expired `submitted` reaches a terminal/re-routable state | `rejected`; `CLAIMABLE_FROM` includes it |
| Late holder answer cannot cause a second dispatch — overlapping test | int-spec above |
| Timeout resolved through one reporting+enforcing path | `resolveFulfillmentDispatchTimeoutMs` → cutoff **and** detail |
| Reaping visible to an operator | A3-X `fulfillment-unaccepted` on the order |
