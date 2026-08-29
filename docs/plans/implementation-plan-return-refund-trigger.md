# Implementation Plan: Return refund trigger, `in_doubt`, and the ADR-056 attempted-predicate ordering

**Issue**: #2371 (`W2-34`) · **Branch**: `2367-returns-custody` (on top of `697aa8f12` / #2370)
**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Migration slot reserved**: `1859000000000` (one migration, see § 6 Phase 1)

---

## 1. Task Summary

**Objective**: give a return a refund TRIGGER that is safe to press twice.

OpenLinker ships **no refund write** — every shipped adapter can read an order and none can move a
buyer's money. So the trigger's job today is to record that a human refunded out of band, and to be
built such that the day an adapter *can* refund, the ordering that makes a double refund impossible
is already in place rather than retrofitted onto a live money path.

**Context**: REVIEW §3 C11 found the refund guard lacked the ordering that makes the invoicing guard
(#2047) safe, and had no in-doubt member. [ADR-056](../architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md)
states the rule and requires it be **restated rather than inherited by analogy** (R1): the
attempted-predicate is persisted **before** the provider call, and `ReturnMoneyState.in_doubt`
records a crossed-but-unconfirmed boundary, blocking like `pending` and cleared only by a terminal
observation, so a crash between the marketplace's 200 and the predicate write cannot double-refund.

**Classification**: CORE — Domain + Application, plus one Infrastructure column and one narrow
module split in `orders`.

---

## 2. Scope & Non-Goals

### In scope

- `RefundExecutor` — a guard-only `OrderSourcePort` sub-capability, **implemented by nobody**, with
  a docblock saying so and why.
- `IReturnRefundService.triggerRefund` — the attempted-predicate claim, the (absent) executor call,
  and the settle.
- `IReturnRefundService.recordRefundObservation` — the only way a line reaches `refunded`, and the
  only way an `in_doubt` line reaches a terminal `denied` that re-permits a second attempt.
- The `RefundRecord` link: thread the already-existing `refund_records.returnId` column through the
  domain entity, its create-input and the repository (persistence-only since #2327).
- `refund_records.executedBy` — the honesty device ADR-056 names by that spelling. **The one
  migration**, slot `1859000000000`.

### Out of scope (and why)

- **Any HTTP surface.** `POST /returns/:id/refund` is #2376.
- **Any amount computation.** The prefill from received/disposed lines is #2382's form; core takes
  the amount it is given, exactly as `POST /orders/:id/refunds` already does.
- **Commission refunds.** A different money flow with a different owner (#2375 / spec § 5.7).
- **Widening `RefundCurrencyMismatchException` to compare against the ORDER's currency** rather than
  against prior refunds on it. That is a real gap (§ 8), but it is an `orders` guard and widening it
  from a returns slice would change behaviour for the pre-existing order-level capture path.
- **Setting `moneyState = 'pending'` at ingestion.** See § 5, assumption A2 — the column's `'not_refundable'`
  default is a #2327 artefact and correcting it belongs with ingestion, not with the trigger.

### Constraints

- **This path moves money.** Every crossing must be claim-guarded, and the record of the attempt
  must be durable *before* the crossing.
- **OL's clock may never stand in for a channel-reported fact** (#2336/#2367). A `refunded` state
  requires the provider's own instant.
- **Every non-refunding exit must be observable** — the `SalesDocumentBlockOutcome` precedent
  (#2100 / ADR-041 §54).
- One migration, slot `1859000000000` and no other (1849–1858 are held by sibling bodies).

---

## 3. Architecture Mapping

**Target layers**: CORE domain (`returns` + `orders`), CORE application (`returns`), CORE
infrastructure (`orders` persistence), plus one module-composition change.

| Concern | Where | Why there |
|---|---|---|
| `ReturnMoneyState`, the eligibility predicate | `returns/domain/types/return-line.types.ts` | The money axis is a per-line column on `ReturnLine`. The pure-rule exception (`engineering-standards.md § The pure-rule exception to "types only"`) already governs this file's neighbours. |
| `classifyRefundOutcome` / `classifyRefundFailure` | `returns/domain/domain-services/refund-outcome.domain-service.ts` | Exact sibling of #2370's `restock-outcome.domain-service.ts`. Pure, no I/O, no clock. |
| `RefundExecutor` + its command/result types | `orders/domain/ports/capabilities/` + `orders/domain/types/refund-execution.types.ts` | The refund is executed against the ORDER SOURCE (the marketplace holds the buyer's money), and its vocabulary (`RefundReason`) is owned by `orders`. Contrast #2333, where the `return.decline` command is *returns* vocabulary and therefore lives in `returns`. |
| `ReturnRefundService` | `returns/application/services/` | Owns the per-line money column and the lock. |
| `refund_records.returnId` / `.executedBy` | `orders/infrastructure/persistence` + entity + create-input | `RefundRecord` is an `orders` aggregate; #2327 deliberately left the column persistence-only until a writer existed. This slice is that writer. |

**Capabilities involved**: `OrderSourcePort` (existing, for the connection resolve) narrowed by the
new `isRefundExecutor` guard. No new registry capability value.

**Existing services reused**: `IReturnsService.assertAttributedForTrigger` (#2332, the ONE orphan
seam), `IIntegrationsService.getCapabilityAdapter`, `SyncLockPort`. `IOrderRefundService.recordRefund`
is reused too, but by the **caller** (#2376), not by this service — see R5.

**Closest in-tree template**: `ReturnDeclineService` (#2333) — the other OL→source write. It already
runs this exact ordering (open the ADR-044 proposal BEFORE the adapter call; confirm, decline or leave
in-doubt after) and already resolves a sub-capability the right way
(`getCapabilityAdapter<OrderSourcePort>(id, 'OrderSource')` then `isReturnDecliner`, never
`getCapabilityAdapter(id, 'ReturnDecliner')`). Follow it structurally.

**Core vs Integration**: entirely CORE. The one integration-facing artefact is a capability
*interface* with no implementer — which is the point (ADR-056: "Where no refund executor exists
(true of every shipped adapter today), the trigger confirms to `executedBy: 'operator_out_of_band'`").

---

## 4. Design of record — the five rules this slice exists to hold

### R1. The attempt is persisted BEFORE the crossing, and the persist IS the block

`ReturnRepositoryPort.claimRefundAttempt(returnId, at)` is a **conditional UPDATE** over the
return's lines:

```sql
UPDATE return_lines
   SET "moneyState" = 'in_doubt'
 WHERE "returnId" = $1
   AND "moneyState" IN ('not_refundable', 'pending', 'denied')
```

It returns the claimed line ids. **Zero claimed lines is the refusal** — either the return has no
lines at all, or every line already carries `triggered | refunded | in_doubt`.

This is the whole guard, and it is deliberately one statement rather than read-then-act: the
`invoiceIssueLockKey` shape (#2047) needs a lock precisely *because* its guard is a read, and
`ShipmentRepository.claimWaybillRelay` / `ReturnRepository.claimAttribution` are the in-tree
precedents for turning such a guard into a claim. A lost lock here cannot double-refund; the claim
can.

The per-return lock (`return:refund:{returnId}`, `returnRefundLockKey`, TTL env-clamped exactly like
`RETURN_CUSTODY_LOCK_TTL_MS`) is therefore **pacing, not correctness**: it refuses a contended
second attempt with a retryable `ReturnRefundContendedError` *before* it reaches the executor,
rather than letting it race to a claim-0 it would have to interpret. Stating which of the two
mechanisms is load-bearing matters — a future reader who "simplifies away" the conditional UPDATE
because "there is a lock anyway" reintroduces the defect.

**The claimed state depends on whether a boundary will actually be crossed, and that conditionality is
the point** *(revised after the plan `/tech-review` — BLOCKING finding)*. `in_doubt` means **boundary
crossed, outcome unobserved**. On the v1 path no adapter implements `RefundExecutor`, so nothing is
ever crossed — claiming `in_doubt` there would assert a provider call that did not happen, on the
*only* path reachable today, and strand it in a state whose remediation surface does not exist yet.
So the executor is resolved FIRST (a side-effect-free read, so moving it above the claim costs
nothing and the claim still strictly precedes `executeRefund`), and the claim's target state is:

- **executor present** → `in_doubt`. The ADR-056 ordering, meaning what it says.
- **executor absent** → `triggered` directly. One conditional UPDATE, equally atomic, equally
  blocking — and honest.

It is otherwise the same ordering `disposeRestock` uses for the master-stock write (#2370), and the
same spelling; **the two `in_doubt`s are never compared** (ADR-060 keeps goods and money orthogonal).

### R2. `refunded` is entered ONLY on observation, and an observation carries the provider's instant

`RefundExecutionResult.outcome: 'refunded'` is honoured **only when `refundedAt` is present**, and
that value must be the provider's own instant. A `'refunded'` with no instant is downgraded to
`triggered` with a warn: OL's clock may not stand in for a channel-reported fact (#2336/#2367), and
a rail step reading *"Confirmed by {source}"* against a timestamp OL invented is a false claim about
a third party.

Nothing in this slice lets an operator *type* `refunded`. `recordRefundObservation` requires an
`observedAt` supplied by its caller as a channel-reported fact, and its docblock says so; the FE
(#2382) surfaces it only where a source reported one.

### R3. Any throw is `in_doubt`; only an explicit terminal `denied` clears the block

This inverts #2370's classifier and the inversion is the point. `classifyRestockFailure` treats
every throw as a **block** because a blocked restock is recoverable by attestation while a double
restock is not. Here both directions are unrecoverable, so the classifier refuses to guess:

- an executor throw → the line **stays** `in_doubt` (blocking), never `denied`;
- `outcome: 'denied'` → `denied`, no `RefundRecord` written (no money moved), and the line becomes
  attemptable again;
- `outcome: 'accepted'` (the provider took the request but has not settled) → `triggered`.

`denied` is the ADR-042 discipline by name: only a terminal rejection means the provider definitely
created nothing.

### R4. An orphan refunds nothing

`assertAttributedForTrigger(returnId, 'refund')` — the ONE #2332 seam, called before anything is
written and before the lock is taken. `refund` is already a member of `ReturnDownstreamTriggerValues`.
A refund against a phantom order moves real money and no later log line recovers it.

### R5. The service REPORTS the refund record; it does not write it

*(Revised after the `/pre-implement` gate — finding F-1.)*

`triggerRefund` settles the money state and returns a `refundRecordIntent: ReturnRefundRecordIntent | null`
(`null` wherever no money moved — `denied`, `in_doubt`). **`ReturnRefundRecordIntent` is a `returns`-owned
type, deliberately NOT `orders`' `CreateRefundRecordInput`** *(plan `/tech-review` finding)*: returning
the other context's write-input would make this contract break whenever `orders` adds a required field
to its own write, and #2100 — the precedent — returns a NEUTRAL outcome its caller maps precisely so
the reporting context owns its type. The caller — #2376's controller, where both
`RETURN_REFUND_SERVICE_TOKEN` and the already-exported `ORDER_REFUND_SERVICE_TOKEN` are reachable — performs
the write. This is #2371's own wording ("the existing capture endpoint writes the linked `RefundRecord`") and
the shipped **#2100 report-don't-persist** seam: `AutoIssueTriggerService` returns a `SalesDocumentBlockOutcome`
for its caller to persist rather than persisting in place, precisely so an `OrdersModule` token never has to
appear inside another context's module.

The consequence is that `returns` gains **no new module edge at all** — its outbound count stays at four —
and `OrdersModule` is untouched, keeping `refunds.controller.ts` resolving exactly as it does today.

**The ordering across the two writes is stated, not left implicit**: the money state settles first and is
durable; the `RefundRecord` is written afterwards, in a different context with no shared transaction. A crash
between them leaves a `triggered` line with no record — visible, and fixable by re-recording — rather than a
record with no state, which would read as refunded while leaving the line attemptable. That asymmetry is why
the money write goes first.

### R6. Every non-refunding exit names its cause

`ReturnRefundBlockedError(returnId, reason: ReturnRefundBlockReason)` — a closed union
(`no-lines` / `already-attempted` / `outstanding-in-doubt`), so an operator reading "refund blocked"
learns which. **The claim alone cannot tell those apart** — it reports only the rows it claimed, so
`affected === 0` is all three at once — therefore the refusal path (and only the refusal path) runs
one classifying read of the return's line states before raising. That read is off the hot path by
construction, and without it the union would be a reason vocabulary the service can never populate:
the silent-decline defect one level down, which is the thing R6 exists to prevent. Plus `ReturnRefundContendedError` (retryable) and the inherited
`ReturnNotAttributedError` / `ReturnNotFoundError`. Every exit logs at `warn` or `error` with the
return id. Nothing declines silently.

---

## 5. Questions & Assumptions

### Assumptions

- **A1 — `RefundExecutor` hangs off `OrderSourcePort`.** The buyer's money sits with the source
  (the marketplace/PSP), not with the destination shop, and `ReturnSourceReader` (#2329) is the
  in-tree precedent for a returns-adjacent `OrderSource`-family sub-capability. Guard-only: absent
  from every manifest and from `CoreCapabilityValues`, following `ModifiedProductLister` (#2220).
- **A2 — the eligibility set includes `not_refundable`, and that is a #2327 artefact rather than a
  semantic claim.** `not_refundable` is the column DEFAULT and, since the union is entirely
  undriven, every existing line carries it. Excluding it would make no return refundable at all.
  The predicate is exported as ONE function (`isRefundAttemptable`) read by both the repository and
  the service, and its docblock states that a later slice setting `pending` at ingestion narrows the
  set without touching either caller.
- **A3 — a partial attempt is not modelled.** `triggerRefund` is per-RETURN (the refund is one
  amount against one order), so the claim covers every eligible line and the result reports the
  count. Per-line refunds would need a per-line amount the spec's form does not collect.
- **A4 — `recordedAt` on the linked `RefundRecord`** is the provider's `refundedAt` where one
  exists, and otherwise the operator's confirm instant. OL's clock is legitimate for the second:
  confirming an out-of-band refund is an act the operator performs inside OpenLinker, with OL as the
  sensor — the same rule as #2370's `occurredAt`.

### Open questions (surfaced, not blocking)

- **Q1** — should `recordRefundObservation` be reachable from a source *poll* rather than only from
  an operator? Erli/Allegro both carry refund state on the return observation. Deferred: #2330's
  ingestion write-set deliberately excludes every OL-owned column, and widening it is that slice's
  decision, not this one's.
- **Q2** — the currency guard gap (§ 8, R2).

---

## 6. Implementation Plan

### Phase 1 — `orders`: the link, the honesty field, and the leaf split

1. **`RefundExecutedByValues` + `RefundExecutedBy`**
   - **File**: `libs/core/src/orders/domain/types/refund-record.types.ts`
   - `['operator_out_of_band', 'refund_executor'] as const`. Parallel to #2370's `RestockedByValues`,
     same honesty device: OL records that a human did it and never claims it moved the money.
   - Widen `CreateRefundRecordInput` with optional `returnId` and `executedBy`.
   - **Note the column has no in-slice PERSISTER, and that is deliberate** — under R5 the write moves
     to #2376. It is not the #2327 "declared, unwritten" shape it resembles: the *value* is computed
     here by `classifyRefundOutcome`, so deferring the column would leave the classifier returning
     something nothing in the tree can store.
   - **Acceptance**: exported from the `orders` barrel; `@openlinker/core/orders/types` unchanged
     (the returns side does not need these — it passes them through the service).

2. **`RefundRecord` entity gains `returnId` + `executedBy`**
   - **File**: `libs/core/src/orders/domain/entities/refund-record.entity.ts`
   - Appended as trailing constructor params with defaults (`null`, `'operator_out_of_band'`) so
     every existing construction site compiles untouched.

3. **ORM + repository**
   - **Files**: `refund-record.orm-entity.ts` (add `executedBy`), `refund-record.repository.ts`
     (`toOrm` / `toDomain`).
   - `returnId` column already exists (#2327) — only the mapping is new.

4. **Migration `1859000000000-add-refund-record-executed-by.ts`**
   - `ALTER TABLE "refund_records" ADD COLUMN IF NOT EXISTS "executedBy" varchar(32) NOT NULL DEFAULT 'operator_out_of_band'`
   - The DEFAULT **is** the backfill and it is truthful: every refund recorded before this slice was
     recorded by a human who moved the money elsewhere.
   - `down()`: `DROP COLUMN IF EXISTS`.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists it; class suffix matches
     the filename prefix; strictly greater than every timestamp on `origin/main`.

5. *(removed by the `/pre-implement` gate, finding F-1 — no module split. `OrdersModule`,
   `RefundRecordOrmEntity`'s registration and `refunds.controller.ts` are all untouched.)*

6. **`RefundExecutor` capability**
   - **Files**: `libs/core/src/orders/domain/ports/capabilities/refund-executor.capability.ts`
     (interface + co-located `isRefundExecutor`), `libs/core/src/orders/domain/types/refund-execution.types.ts`.
   - ```ts
     interface RefundExecutor {
       executeRefund(command: ExecuteRefundCommand): Promise<RefundExecutionResult>;
     }
     ```
     `ExecuteRefundCommand` = `{ externalOrderId, externalReturnId, amount, currency, reason, note, idempotencyKey }`.
     `RefundExecutionResult` = `{ outcome: 'refunded' | 'accepted' | 'denied', providerRefundId, refundedAt, providerMessage }`.
   - Docblock: **implemented by nobody today**, and why the seam ships anyway (ADR-056 R1 — the
     ordering must exist before a live money path uses it); plus the `refundedAt` clock rule.
   - **The idempotency key's DERIVATION is part of the contract, not left to the first implementer**
     *(plan `/tech-review` finding)*. #2370's equivalent is deterministic (`return:{returnId}:{lineId}:{seq}`)
     precisely so a retry recomputes an identical key; there is no `seq` here, so the docblock states
     the rule explicitly: the key is built from the return id plus the claimed attempt's identity, is
     recomputed identically on retry, and an adapter must never mint its own. Unreachable today — no
     executor exists — which is exactly why it is nailed down now rather than by whoever implements
     one, since a fresh key per retry is a double refund.
   - Guard-only. Not in any manifest, not in `CoreCapabilityValues`, never resolved via
     `getCapabilityAdapter('RefundExecutor')`.
   - **The docblock must say UNDECLARED-because-unimplemented, not "advertised-without-dispatch"**
     (gate finding F-3). The neighbouring `ReturnDecliner` uses that phrase for a capability that *is*
     in a manifest; copying its paragraph here would assert a manifest entry that does not exist. The
     applicable precedent is `ModifiedProductLister` (#2220) — guard-only, absent from every manifest.
   - **Acceptance**: a spec asserts no in-tree adapter satisfies `isRefundExecutor`, so the day one
     does, that assertion is the deliberate edit.

### Phase 2 — `returns`: vocabulary, classifier, claim

7. **The eligibility predicate**
   - **File**: `libs/core/src/returns/domain/types/return-line.types.ts`
   - `REFUND_ATTEMPTABLE_MONEY_STATES` + `isRefundAttemptable(state)` / `blocksRefundAttempt(state)`.
     Exported as the ONE definition, read by the repository and the service, mirroring
     `OUTSTANDING_RESTOCK_STATES` / `isOutstandingRestockState` in the act-ledger types.
   - Extend the `ReturnMoneyStateValues` docblock with the block rule and assumption A2.

8. **`refund-outcome.domain-service.ts`**
   - **File**: `libs/core/src/returns/domain/domain-services/`
   - `classifyRefundOutcome(result) -> RefundTriggerOutcome` and `classifyRefundFailure(error)`.
     `RefundTriggerOutcome` = `{ moneyState, executedBy, providerRefundId, settledAt, providerMessage, writesRefundRecord }`.
   - Pure — no I/O, no clock, no argument mutation. Header states the three inversions vs
     `restock-outcome.domain-service.ts` (R2, R3) so the difference reads as deliberate.

9. **Repository: `claimRefundAttempt` + `settleRefundState`**
   - **Files**: `return-repository.port.ts`, `return.repository.ts`
   - `claimRefundAttempt(returnId, at)` — the conditional UPDATE of R1, returning claimed line ids.
   - `settleRefundState(returnId, lineIds, moneyState)` — narrow UPDATE scoped to the ids the claim
     returned **and** to `moneyState = 'in_doubt'`, so a settle can never move a line a peer has
     since observed.
   - **Acceptance**: a repository spec asserts a second `claimRefundAttempt` on an already-claimed
     return claims zero lines.

10. **Errors**
    - `return-refund-blocked.error.ts` (carries the closed `ReturnRefundBlockReason`),
      `return-refund-contended.error.ts` (retryable, mirrors `ReturnCustodyContendedError`),
      `return-refund-observation-invalid.error.ts` (a `refunded` observation with no `observedAt`).

11. **`return-refund-lock.ts`** — `returnRefundLockKey(returnId)` + `RETURN_REFUND_LOCK_TTL_MS`,
    resolved once at module load from `OL_RETURN_REFUND_LOCK_TTL_MS`, clamped `[5s, 300s]`. Copies
    `return-custody-lock.ts` including the "TTL expiry is not a correctness cliff" note — which is
    *more* true here, because the claim is a single statement.

### Phase 3 — the service

12. **`IReturnRefundService` + `ReturnRefundService`**
    - **Files**: `returns/application/services/return-refund.service.interface.ts` / `.service.ts`
    - `triggerRefund(returnId, input)` ordering, stated as executable steps:
      1. `assertAttributedForTrigger(returnId, 'refund')` (R4) — before anything is written.
      2. acquire `returnRefundLockKey` → `ReturnRefundContendedError` on refusal (R1).
      3. resolve the source connection's `OrderSource` adapter and narrow with `isRefundExecutor`
         — **before the claim**, because the claim's target state depends on the answer (R1). A
         side-effect-free read; the claim still strictly precedes `executeRefund`.
      4. `claimRefundAttempt(returnId, at, targetState)` → **the attempt is now durable**: `in_doubt`
         when an executor was found, `triggered` when none was (R1). Zero claimed lines → one
         classifying read, then `ReturnRefundBlockedError` with its reason (R6).
      5. executor absent → done; the v1 path already settled `triggered` in step 4, and reports
         `executedBy: 'operator_out_of_band'`. Executor present → `executeRefund(...)`, classified
         through the pure seam (R2, R3).
      6. settle the money state, and REPORT a `refundRecordIntent` where the outcome says money moved
         — `null` on `denied` and on `in_doubt` (R5). The service writes no `RefundRecord` itself.
      7. release the lock in a `finally`.
    - `recordRefundObservation(returnId, input)` — the only entry point that writes `refunded`
      (requires `observedAt`) or a terminal `denied`.
    - Docblock carries the five rules of § 4, in the shape of #2370's four-rule header.

13. **`RETURN_REFUND_SERVICE_TOKEN`** in `returns.tokens.ts`; barrel exports in `returns/index.ts`
    (service interface + input/result types + the three errors + the lock helpers + the classifier).

14. **`ReturnsModule`** — provide + export the service behind its token. **No new import**: under R5
    the service reaches `orders` only for the `RefundExecutor` type + guard (a value import off the
    main barrel, exactly as `ReturnIngestionService` already does for `isReturnSourceReader`), which
    creates no module-graph edge. `returns`' outbound edge count is unchanged at four, and the module
    docblock says so rather than claiming a fifth.

---

## 7. Alternatives Considered

**A. A new `return_refund_attempts` table as the attempted-predicate.**
Rejected. It would spend the reserved migration slot on a second source of truth for a fact
`return_lines.moneyState` already carries — and the ADR names that column by field
(`ReturnMoneyState.in_doubt`), so a rival table would have to be kept in sync with the union that is
actually read by every consumer.

**B. Recording the attempt as a `refund` kind on the #2370 act ledger.**
Rejected. `return_line_events` is per-LINE and keyed by `quantity` + `restockState`; a refund is
per-RETURN and keyed by an amount. Forcing it in would put a permanently-null quantity on refund
rows and a permanently-null amount on every other row.

**C. Read-then-act with the lock as the guard (the #2047 shape, copied literally).**
Rejected, and this is the finding ADR-056 R1 exists to force: the invoicing guard is a *read*, so a
lock is the only thing standing between two attempts. Here the guard can be a claim, and a claim
survives a lock that expired mid-provider-call. Copying the weaker shape by analogy is exactly what
R1 says not to do.

**D. Putting `RefundExecutor` on `OrderProcessorManagerPort`.**
Rejected: the destination shop never took the buyer's money. Refunding through it would refund from
the wrong ledger.

**E. Merging `ReturnMoneyState.in_doubt` with `ReturnRestockState.in_doubt`.**
Rejected — binding handover from #2370, and ADR-060 keeps the axes orthogonal. Two unions, never
compared.

---

## 8. Validation & Risks

- **Architecture**: ✅ pure domain services carry no framework import; the service depends on
  `I*Service` + capability ports + `SyncLockPort`, never a sibling context's repository port.
- **Cross-context contract**: ✅ `returns -> orders` already exists; this adds one module edge to a
  new leaf. `orders` gains no import of `returns`. `pnpm check:invariants` covers it.
- **Naming**: ✅ `*.capability.ts` + co-located `is*`; `*.service.interface.ts` beside `*.service.ts`;
  `as const` unions; `*.error.ts` under `domain/exceptions/`.

### Risks

- **R-1 — the currency gap.** `RefundCurrencyMismatchException` compares a new refund against
  *prior refunds on the order*, not against the order's own currency. A return whose order has no
  prior refund can therefore record a refund in the wrong currency. Named, not fixed: it is an
  `orders` guard predating returns, and #2382's form locks the field. **Recorded in the plan so
  #2376 can decide whether to validate at the controller.**
- **R-2 — `not_refundable` as an eligible state** reads oddly until the column is driven at
  ingestion. Mitigated by making the predicate one exported function with a docblock that says
  exactly this, so narrowing it later is a one-line edit with no call-site changes.
- **R-3 — RETIRED by the gate (F-1).** The leaf split is gone; no live path is touched. The residual
  risk it becomes is R-5.
- **R-5 — the money settle and the `RefundRecord` write are not atomic** (R5). Two contexts, two
  repositories, no shared transaction — and there never could be one. Mitigated by ordering: the
  durable money state goes first, so the survivable failure is "line `triggered`, no record" rather
  than "record written, line still attemptable". #2376 owns the retry.
- **R-4 — an `in_doubt` line has no remediation UI in this slice.** `recordRefundObservation` is the
  mechanism; #2376 gives it a route and #2382 a button. Until then the state is reachable only by a
  process crash mid-executor-call, and no executor exists. Stated rather than left implicit.

### Edge cases

| Case | Behaviour |
|---|---|
| Return has no lines | `ReturnRefundBlockedError('no-lines')` |
| Every line already `triggered` | `ReturnRefundBlockedError('already-attempted')` |
| Any line `in_doubt` | `ReturnRefundBlockedError('outstanding-in-doubt')` — a second attempt is refused |
| Orphan return | `ReturnNotAttributedError('refund')` |
| Executor throws | line stays `in_doubt`; no `RefundRecord`; error logged; the throw propagates |
| Executor returns `refunded` with no `refundedAt` | downgraded to `triggered` + warn |
| Executor returns `denied` | `denied`, no `RefundRecord`, line attemptable again |
| Lock contended | `ReturnRefundContendedError` — refused before the executor |

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests

- `refund-outcome.domain-service.spec.ts` — table-driven over every `outcome` × `refundedAt`
  presence; asserts the no-instant downgrade and that a failure never yields `denied`.
- `return-line.types.spec.ts` (extend) — the eligibility predicate over all six money states.
- `return-refund.service.spec.ts` — the load-bearing one:
  - **ordering, via a throwing fake executor**: assert `claimRefundAttempt` resolved *before*
    `executeRefund` was invoked, and that after the throw the persisted state is `in_doubt`;
  - **the no-executor path never writes `in_doubt`** — with no executor resolvable, assert the
    claimed state is `triggered` and that no line ever held `in_doubt` (the BLOCKING finding, as a
    test rather than a promise);
  - a **second** `triggerRefund` against that state is refused;
  - only `recordRefundObservation({ observedState: 'denied' })` makes it attemptable again;
  - `recordRefundObservation({ observedState: 'refunded' })` without `observedAt` throws;
  - the no-executor path settles `triggered` and REPORTS a `refundRecordIntent` carrying `returnId`
    and `executedBy: 'operator_out_of_band'` — and a spec asserts the service never touches
    `IOrderRefundService` itself (R5);
  - an orphan return refuses before any write (assert the repository was never called).
- `return.repository.spec.ts` (extend) — claim-then-claim returns zero the second time.
- A spec asserting **no in-tree adapter satisfies `isRefundExecutor`** (AC4's "implemented by
  nobody", as a test rather than a promise).

### Integration test

- `apps/api/test/integration/returns-refund-trigger.int-spec.ts` — boots the real graph and:
  1. resolves `RETURN_REFUND_SERVICE_TOKEN` off the api graph (the **boot-time DI gate**; proved real
     by removing the provider binding from `ReturnsModule` and confirming boot fails);
  2. triggers a refund on an attributed return, feeds the reported `refundRecordIntent` through the
     already-wired `IOrderRefundService`, and asserts the `refund_records` row carries `returnId` and
     `executedBy = 'operator_out_of_band'` — which also proves the migration applied;
  3. asserts a second trigger is refused and the line reads `triggered`.
  Seeds via the production path (`returns-read-api.int-spec.ts`'s style): `createTestConnection`,
  `IIdentifierMappingService.getOrCreateInternalId(CORE_ENTITY_TYPE.Order, …)` to register the
  mapping FIRST, then `upsertFromObservation`. `loginAsAdmin` at most ONCE. Sets `OL_PII_HASH_SALT`
  in its own file rather than relying on cross-file leakage.

### Acceptance criteria (mapped to #2371)

- [ ] The attempted-predicate is persisted before the provider call — asserted by a throwing fake.
- [ ] An indeterminate outcome yields `in_doubt` and a second attempt is refused.
- [ ] Only terminal `denied` clears the block; `refunded` requires an observation carrying the
      provider's own instant.
- [ ] `RefundExecutor` is declared, implemented by nobody, with a docblock saying so — and a spec
      asserting it.
- [ ] Tests added; `pnpm lint` / `type-check` / `test` green; no boundary violations.

---

## 10. Alignment Checklist

- [x] Hexagonal architecture — pure domain services, ports in domain, service in application
- [x] CORE vs Integration boundary — the executor is a core-declared capability with no adapter
- [x] Existing patterns reused (`restock-outcome`, `claimAttribution`, `OrderChangesModule`, the lock helper)
- [x] Idempotency — the conditional claim; the executor command carries an idempotency key
- [x] Error handling — three new domain errors, each naming its cause
- [x] Testing strategy complete, including the ordering assertion the AC names
- [x] Naming + file structure per `engineering-standards.md`
- [x] One migration, slot `1859000000000`
- [x] Execution-ready

---

## Related

- [ADR-056](../architecture/adrs/056-refund-and-fiscal-authority-never-leave-ol.md) — refund authority never leaves OL; the R1 ordering
- [ADR-060](../architecture/adrs/060-returns-aggregate-above-source-projection.md) — custody and money are orthogonal
- [ADR-042](../architecture/adrs/042-fiscalization-capability.md) — the in-doubt / terminal-rejected discipline this borrows by name
- `docs/specs/product-spec-oms-returns-operator-ux.md` § 5.5, § 5.7
- #2370 (custody writes + the act ledger), #2372 (`return.authorize` / orphan match), #2376 (write API), #2382 (FE)
