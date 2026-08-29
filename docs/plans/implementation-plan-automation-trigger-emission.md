# Implementation Plan: Automation trigger emission (#2360, scoped to T4 + T5)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #2360 (`W2-23`) — Wave-2 body D, third in the chain (after #2358 storage, #2359 evaluator)

---

## 1. Task Summary

**Objective**: Emit automation triggers so that authored rules can actually fire, building **both firing
modes** — `edge` (caused by a write) and `deadline-sweep` (caused by a clock crossing a persisted
timestamp) — as a general mechanism.

**Context**: #2358 landed storage, #2359 the pure evaluator and the §5.4 legality matrix. Nothing yet
*calls* the evaluator, so every authored rule is inert.

**Classification**: CORE (application layer) + Worker (handler, scheduler task).

---

## 2. Scope & Non-Goals

### In scope — 2 of 8 triggers

| Trigger | Mode | Backing fact | Emission point |
|---|---|---|---|
| **T5** `order.packed` | `edge` | `order_records.packedAt` null→value (#2287) | `OrderRecordService.markPacked` |
| **T4** `order.dispatch_deadline_near` | `deadline-sweep` | `order_records.dispatchByAt` (persisted, inert since Wave 1a) | new sweep job |

### Out of scope — 6 triggers, blocked on unmerged siblings (verified in-tree, not assumed)

| Trigger | Blocked on | Seam it will need |
|---|---|---|
| T1 `order.hold.placed` | #2339 `order_holds` (body A) | the `order_holds` INSERT site; key = the hold **row** id |
| T2 `order.hold.released` | #2339 | the `releasedAt` write site; key = hold row id + `released` |
| T3 `order.on_hold_for` | #2339 | `placedAt` + an "open holds older than N" paged query |
| T6 `return.received` | W2-33 returns custody | the receive writer — **and a per-arrival identifier** (see risk R5) |
| T7 `return.disposed` | W2-33 | the disposition writer |
| T8 `inventory.reservation_shortfall` | #2349 episodes | the shortfall **episode** id |

Evidence: `order_holds` appears only in comments that record its absence
(`orders.controller.ts:494`, `order-record.repository.ts:1059`,
`derive-order-lifecycle-phase.ts:69`); the returns custody columns are explicitly excluded from every
write path (`return.repository.ts:134-139`, *"the enumeration is the contract"*); migration slots
1849/1850 are absent from `apps/api/src/migrations/`.

**Also out of scope**: action execution (#2361), the at-most-one gate (#2362), the API (#2363), the
`automation_runs` write path (#2385).

### Deferred acceptance criteria — recorded, not pretend-satisfied

ACs **3** (T1 twice across hold→release→hold), **6** (three sweeps over one standing open hold), **7**
(threshold edit does not erase the firing record — T3-shaped), **S3-9** (40 held orders, T3 rule) and
the T6 three-parcel AC are all `order_holds`/returns-dependent and cannot be satisfied here. They move
to the orchestrator-filed follow-up. Every other AC is in scope.

### Constraints

- **No migration.** `automation_trigger_firings` was created by #2358 (`1851000000000`) with exactly the
  `UQ_automation_trigger_firings_rule_subject` index the sweep's at-most-once needs, verified green
  (14/14 int-spec). Slot `1856000000000` is **returned to the pool**.
- No push, no PR, no touching `main` or a sibling worktree.

---

## 3. Architecture Mapping

**Target layers**: CORE application (`libs/core/src/automation/application/`), CORE domain port, one
CORE infrastructure repository, worker handler + scheduler task.

**Reused, not rebuilt**: `evaluateAutomationRules` (#2359), `AUTOMATION_TRIGGER_FIRING_MODE` (#2358),
`AutomationRuleRepositoryPort`, `SyncLockPort`, `ConnectionCursorRepositoryPort`, `SyncJobQueuePort`.

**New**:

| Component | Path | Why |
|---|---|---|
| `AutomationTriggerFiringRepositoryPort` + impl | `automation/domain/ports/`, `.../infrastructure/persistence/repositories/` | #2358 shipped the entity with no repository |
| `IAutomationTriggerEmissionService` + impl | `automation/application/` | the one seam every trigger emits through |
| `IAutomationDispatchService` + `InertAutomationDispatchService` | `automation/application/` | #2361/#2362 do not exist; ship the seam with an inert implementation. **A service interface, not a `*Port`** — #2362 implements it in `automation/application/services/**`, the same context and layer family, so a `*Port` name would assert a boundary that does not exist (`EmptyReservationLedgerReader` earned its port name by crossing to a future EXTERNAL reader). |
| `AutomationDeadlineSweepService` | `automation/application/services/` | T4's paged, bounded evaluation. Carries its own `*.service.interface.ts` (`check-service-interfaces`). |
| `AutomationDeadlineSweepHandler` | `apps/worker/src/sync/handlers/` | job execution |
| `findDispatchDeadlineCandidates` | `orders` repository + `IOrderRecordService` | T4's candidate page |

**CORE vs Integration**: entirely CORE — no platform call anywhere in this slice. T4 reads OL's own
`order_records`; T5 fires off OL's own write.

**Cross-context edges added**: exactly ONE — `orders → automation`, for T5's emission.

**`automation` imports no sibling context in this slice, and that is deliberate.** An earlier draft put
T4's candidate read inside `automation` (`automation → orders`), which together with T5 formed a real
module cycle that would then have needed `ModuleRef.get(..., { strict: false })` to survive. The cycle
is avoidable, and the repo already prefers avoiding it: #2100's `AutoIssueTriggerService.onOrderTransition`
is **called from** `OrderIngestionService` (`order-ingestion.service.ts:534`) precisely so `invoicing`
needs no `OrdersModule` token.

So the composition happens **at the worker handler**, which may inject both freely: it asks
`IOrderRecordService` for the candidate page, projects `AutomationSubjectFacts`, and hands them to
`IAutomationTriggerEmissionService`. This also matches #2359's own contract, which takes an
*already-assembled facts projection* specifically so the assembling caller — not the evaluating
context — owns the read. No `ModuleRef` anywhere: it hides a dependency from the constructor, and here
it would hide one that need not exist.

---

## 4. Design decisions

### D1 — One emission seam, two callers

`IAutomationTriggerEmissionService.emit({ trigger, facts })`:

1. load **every** rule on `trigger` (`findByTrigger`) — active and inactive alike. Pre-filtering to
   active in SQL is the attractive "optimisation" that must NOT be taken: `evaluateAutomationRules`
   already classifies an inactive rule as `rule-inactive` and excludes it from `matched`, and that
   reason is the only way #2363's dry run can tell the operator *"your rule is switched off"*,
2. call the pure `evaluateAutomationRules({ trigger, facts, rules, now })`,
3. for a `deadline-sweep` trigger, claim each match's firing row (`ON CONFLICT DO NOTHING`) and drop
   the matches that lost the claim,
4. hand the survivors to `IAutomationDispatchService`.

**`now` is an argument, never a clock read.** The seam takes it and passes it straight to the
evaluator, which must never read the system clock; the sweep supplies its tick instant and the specs
supply a fixed one.

Both T4 and T5 call this. Nothing about the seam is T4- or T5-shaped, which is the orchestrator's
"build both modes as a general mechanism" constraint made structural: the six deferred triggers each
become one call site plus a facts projection.

### D2 — The dispatcher is a declared seam with an inert implementation

`InertAutomationDispatchService` logs `{ruleId, trigger, subjectId, actionCount}` and returns. This is the
`EmptyReservationLedgerReader` precedent (#2321): ship the seam so the consumer (#2362) is a
provider swap rather than a change under a live caller. **It must not be mistaken for a working
automation** — the log line says `dispatch not yet wired (#2361/#2362)` explicitly.

### D3 — Firing records: claimed, not checked

The at-most-once guarantee is a conditional INSERT (`ON CONFLICT DO NOTHING`, `affected > 0` as the
answer) — the `claimWaybillRelay` / `markPacked` shape — never a read-then-write. A read-then-write is
a race that buys a second label. Recorded **before** dispatch: a crash between record and dispatch
loses a firing (safe), the reverse buys two labels (not).

**The firing table is not the run log.** A lost firing is therefore silent: the operator-facing record
of "nothing happened" is `automation_runs`, which is #2385's job, not this slice's.

**The key is `(ruleId, subjectKind, subjectId)` and must never gain `definitionHash`** — #2358's entity
docblock states why, and the follow-up must not "improve" it.

### D4 — T5 takes the guard boolean that already exists

`OrderRecordRepository.markPacked` already returns `boolean` meaning *this call performed the
null→value transition* (`{ packedAt: IsNull() }` in the WHERE). `OrderRecordService.markPacked`
currently discards it and re-reads. Capture it; emit only when `true`. That is exactly the AC
*"T5 does not re-fire when an already-set `packedAt` is re-written"*, for free, with no new state.

Emission is **best-effort and never throws** — a wrapped catch, so a failing automation can never fail
or roll back the pack (AC: *"a trigger emission failure never fails the originating write"*).

### D5 — T4's sweep does NOT call `runBoundedSweep`, and the reason is #2330's, not #2317's

**The candidate query is NOT filtered on `automation_trigger_firings`.** Filtering it would be a
cross-context read-model join from an `orders` query into an `automation` table, needing the full
ADR-036 treatment — and, decisively, the firing key is per **rule**, so an orders-level query cannot
express "not yet fired" without knowing the rule set. The query is therefore the natural one:
`dispatchByAt` inside the window AND not shipped. That set is stable within a run, so the
frontier-as-query argument (#2317) does **not** apply here and is deliberately not claimed.

What justifies processing inline rather than fanning out is #2330's rule, which stands on its own:
**a page enqueues nothing, so a page of deadline work can never fan out into an unbounded child wave.**
A child job per (rule, order) would also carry no work #2361 does not already own.

Dedup is the firing row, not the query: an already-fired pair is re-read each cycle and its claim
simply loses. That is the correct place for it — the claim is per (rule, subject), which is exactly the
grain the query cannot see.

What is reused from the bounded-sweep family is the **primitives and the properties**: a page budget, a
per-scope `SyncLockPort` lock whose TTL covers one RUN, and a rolling scan offset on
`connection_cursors` — so the sweep is budgeted, resumable, lock-serialised and self-terminating, which
is what the AC *"time triggers are budgeted, cursor-resumed and lock-serialised"* actually asks for.
The deviation and this reasoning are recorded in the service docblock.

### D6 — Scoped per connection, not globally

Every candidate is an `order_records` row carrying `sourceConnectionId`, and `SyncJob.connectionId` is
non-nullable. Scoping per `OrderSource`-capable connection gives a natural job scope, cursor scope and
lock scope, and matches every other scheduler task — no system/nil connection id has to be invented.

### D7 — No wall-clock in any idempotency key

The firing row IS the dedupe (`ruleId`+subject). The sweep's job idempotency key is
`automation:deadline-sweep:{connectionId}:{cycleId}`, where `cycleId` is minted per cycle and persisted
on the cursor — never `Date.now()`. Asserted by a spec (AC).

---

## 5. Implementation phases

### Phase 1 — Firing record persistence
1. `AutomationTriggerFiringRepositoryPort` — `claim(input): Promise<boolean>` only. A read method is
   deliberately absent: exposing one invites a read-then-write caller.
2. `AutomationTriggerFiringRepository` — `INSERT … ON CONFLICT DO NOTHING`, `affected > 0`.
3. Token + module binding + barrel export.
   *Acceptance*: unit spec — second claim for the same triple returns `false`.

### Phase 2 — The emission seam
4. `IAutomationDispatchService` + `InertAutomationDispatchService` (+ token).
5. `IAutomationTriggerEmissionService` + `AutomationTriggerEmissionService` (D1).
   *Acceptance*: specs — evaluator called with the loaded rules; only `matched` dispatched; firing
   claimed for `deadline-sweep` and **not** for `edge`; a lost claim drops that rule only.

### Phase 3 — T5 (edge)
6. `IOrderRecordService.markPacked` captures the guard boolean; emits on `true` only, wrapped.
   *Acceptance*: specs — emits once on first pack; **no** emission on re-write; a throwing emitter still
   returns the record.

### Phase 4 — T4 (deadline sweep)
7. `findDispatchDeadlineCandidates(connectionId, {withinHours, limit, offset})` on the orders
   repository + `IOrderRecordService`, reusing the existing `notShipped` predicate.
8. `AutomationDeadlineSweepService` — lock, page, evaluate, claim, dispatch, advance offset by rows
   **read**; clear the cursor and mint a new cycle on exhaustion.
9. `automation.trigger.deadlineSweep` job type + `bulk` lane + handler + scheduler task
   (`OL_AUTOMATION_DEADLINE_SWEEP_ENABLED` / `_CRON`, `*/15`).
   *Acceptance*: three sweeps over one standing candidate fire **once** (the AC-6 shape, proven on T4
   since T3 is unavailable); a failing page holds the offset.

### Phase 5 — Docs
10. Architecture-overview § 23 — the two modes, the six deferred triggers and why, the
    `runBoundedSweep` deviation.

---

## 6. Alternatives considered

- **Fan out one child job per (rule, order).** Rejected: unbounded child wave from one page (#2330's
  stated rule), and the child would carry no work #2361 does not already own.
- **Emit T5 from a `sync_jobs` row rather than inline.** Rejected for this slice: it would make the
  emission durable but adds a job type whose only purpose is to call a service in the same process;
  the write-site emission matches how every other post-commit best-effort hook in the repo works. The
  cost — a crash between commit and emit loses the firing — is stated, and is the *safe* direction.
- **Wait for #2339/#2349.** Rejected by the orchestrator: #2349 is ~5 issues down body B's chain, and
  cross-body merging defeats the one-PR-per-body review structure.

---

## 6b. The `occurredAt` derivation for T4 — read this before touching the sweep

`occurredAt` must be **`dispatchByAt − withinHours`**, the instant the deadline came within the rule's
window. It must **not** be `dispatchByAt`.

`dispatchByAt` is a *future* instant relative to the sweep, so passing it clears
`occurredAt < rule.createdAt` unconditionally: the retroactivity floor would never engage, and a rule
created today would fire for every order already inside its window. T4 is legal for
`dispatch-shipment` (A2) under the §5.4 matrix, so that is the S3-9 failure — *"40 orders, 40 labels"* —
reproduced on the one trigger this slice ships, with real money spent.

The triggering fact is the **crossing**, not the deadline. A rule saved after a candidate's crossing
correctly reports `fact-precedes-rule`. A spec pins exactly this, because the wrong value is plausible
enough that a future reader will "simplify" it back.

## 7. Risks

| Risk | Mitigation |
|---|---|
| **R1** T4 fires for orders whose deadline crossing happened before the rule was saved | #2359's retroactivity floor, enforced by default — and the sweep passes **`occurredAt = dispatchByAt − withinHours`**, the CROSSING instant, never `dispatchByAt` itself (see the note below) |
| **R2** A rule edited to a shorter threshold re-fires an already-fired pair | Impossible — the firing key excludes `definitionHash` (D3) |
| **R3** A module cycle between `automation` and `orders` | **Avoided, not survived** — composition happens at the worker handler, so `automation` imports no sibling context and the only edge is `orders → automation` (#2100's direction). No `ModuleRef`. |
| **R4** `InertAutomationDispatchService` mistaken for working automation | Explicit log copy naming #2361/#2362; architecture-overview says so |
| **R5** (for the follow-up, not this slice) T6's *"three parcels → three firings"* is unimplementable while `quantityReceived` is a counter | Relayed to body E's #2370 as a design input |

---

## 8. Testing strategy

**Unit**: firing-claim idempotency; emission seam (evaluator wiring, edge-vs-sweep claim behaviour,
partial claim loss); T5 transition-only + never-throws; sweep pagination, lock, cursor advance, budget.
**Integration** (`apps/api/test/integration/`): three sweeps over one standing candidate → exactly one
`automation_trigger_firings` row (AC-6 shape); a pack + re-pack → one firing.
**Invariant spec**: the wall-clock AC is asserted concretely — the sweep's composed job idempotency key
is built twice from the same cursor at two different fake `now` values and must be byte-identical, and
the key must contain the `cycleId` rather than any digits derived from the clock. "Asserted by a spec"
without naming the assertion is how this AC passes vacuously.

**Retroactivity spec** (§6b): a rule whose `createdAt` is after a candidate's crossing
(`dispatchByAt − withinHours`) must not fire for that candidate.

---

## 9. Alignment checklist

- [x] Hexagonal layering (port in domain, impl in infrastructure, orchestration in application)
- [x] CORE/Integration boundary — no platform call
- [x] Existing patterns reused (`claimWaybillRelay` conditional write, #2330 inline sweep, #2321 inert seam)
- [x] Idempotency — durable conditional INSERT, no wall-clock keys
- [x] Error handling — emission never fails its originating write
- [x] Testing complete; naming + file structure per standards
- [x] **No migration** (slot 1856 returned)
