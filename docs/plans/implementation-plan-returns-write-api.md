# Implementation Plan: Returns write API (#2376)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #2376 (`W2-39`, Wave 2, stream S2, size M)
**Branch**: `2367-returns-custody` (body E; on top of #2374 `f79b42c24`)

---

## 1. Task Summary

**Objective**: give every Wave-2 returns write an HTTP surface, on the existing
`ReturnActionsController`. Counter-invariant violations answer **409 with a
distinguishable code**; a `restock_blocked` outcome is returned in the **2xx
body**, because the disposition succeeded and only the master write did not.

**Classification**: Interface / Interfaces layer. `apps/api/src/returns/**` only —
no core behaviour is added except one read-only service method (§ D2).

---

## 2. Scope

### Endpoints in scope

| Route | Service call |
|---|---|
| `POST /returns/record` | `IReturnsService.recordReturn` |
| `POST /returns/:returnId/authorize` | `IReturnAuthorizeService.authorize` |
| `POST /returns/:returnId/match-order` | `IReturnsService.matchOrphanToOrder` |
| `POST /returns/:returnId/lines/:lineId/receive` | `IReturnCustodyService.receiveLine` |
| `POST /returns/:returnId/lines/:lineId/dispose` | `IReturnCustodyService.disposeLine` |
| `POST /returns/:returnId/lines/:lineId/mark-stock-handled` | `IReturnCustodyService.markStockHandledManually` |
| `POST /returns/:returnId/refund` | `IReturnRefundService.triggerRefund` **+** the `RefundRecord` write (§ D1) |
| `GET /returns/:returnId/correction-proposal` | `IReturnCorrectionProposalService.previewProposal` (§ D2) |
| `POST /returns/:returnId/correction-proposal` | `IReturnCorrectionProposalService.buildProposal` |

### Out of scope, named with reason

- **`POST /returns/:id/commission-refund/claim` — OMITTED.** See § D3. There is
  no service to call: `grep -ri commission libs/ apps/` returns exactly one hit,
  a docblock in my own #2374 file. `W2-37` (#2379) has not landed on this branch,
  and SPIKE-2375 leaves the *shape* undecided (Branch A = a real Allegro write;
  Branch B = a deep link plus an operator attestation). Shipping a route now
  means either a 501 placeholder or inventing a contract the spike exists to
  decide. Both are worse than the route not existing.
- **Frontend** — #2382.
- **`recordRefundObservation`** — an OBSERVATION, not an operator write; it
  belongs to the source-ingestion path, not this surface.
- **`IReturnCustodyService.listOutstandingRestockBlocks`** — the per-return list
  backs #2381's badge surface, and its own docblock names that issue. The blocked
  detail this surface owes is the one in the **dispose** 2xx body (the AC), which
  `disposeLine` already returns. Named here so an omission is not read as an
  oversight.

---

## 3. Design decisions

### D1 — The refund endpoint performs the second write, and the ORDER is fixed

`ReturnRefundService` writes **no** `RefundRecord` (#2371's report-don't-persist
seam, which is what keeps `OrdersModule` out of `ReturnsModule`). The controller
owns it: call `triggerRefund`, then — iff `refundRecordIntent !== null` — write
through `IOrderRefundService`. `ReturnsModule` is untouched; the **API** module
imports whatever exports `ORDER_REFUND_SERVICE_TOKEN`, which is an interface-layer
composition and creates no core cycle.

The ordering is load-bearing and is core's, not mine: the money state settles
first and durably, so the survivable failure is *"line `triggered`, no record"*
(visible, fixable by recording again) rather than *"record written, line still
attemptable"*, which reads as refunded while leaving the buyer refundable twice.
The controller must therefore **not** try to be clever and roll the money state
back when the second write throws.

`refundRecordIntent === null` (a `denied` or `in_doubt` outcome) is a **2xx**, not
an error: the attempt was recorded and no money moved. The response says which.

**`DuplicateRefundRecordException` is caught LOCALLY on this route → 409.** It is an
`orders` exception, so `ReturnsExceptionFilter` — which `@Catch`es returns errors —
will not take it, and the orders refunds controller already handles it with exactly
this local catch. The returns "global filter, never a local catch" convention is
about *returns'* own domain errors, so this is consistent rather than an exception.

**A NON-duplicate `recordRefund` failure answers 2xx, not 500.** By the time that
write runs, `triggerRefund` has already claimed the lines and settled the money
state durably — the primary outcome succeeded. Propagating the error would report
failure for an operation that worked, and the operator's retry would then answer
`409 already-attempted`, which reads as "your refund was rejected" when the truth
is "it went through and only its record is missing". So the route catches it,
answers 2xx carrying `refundRecordWritten: false` with the reason and the
remediation route (`POST /orders/:id/refunds`), and logs at `error`.

That makes `refundRecordId: null` ambiguous unless the two cases are named, so
they are: `moneyMoved: false` (a `denied` / `in_doubt` outcome — there was nothing
to write) versus `refundRecordWritten: false` (money moved, the record is
pending). Collapsing both into a null field would hide the one that needs an
operator action behind the one that does not.

**An `idempotencyKey` IS passed, as defence-in-depth, and the route deliberately
does not retry-write.** `CreateRefundRecordInput.idempotencyKey` is guarded by the
partial unique index `UQ_refund_records_order_idempotency`; the key is derived
deterministically from the claimed line ids (`return:{returnId}:{sorted ids}`), so
one attempt cannot insert twice and inflate `RefundSummary.totalAmount`. The
readable composite is chosen over a hash deliberately: the column is `text` so
there is no length limit, and the key participates in a btree index whose ~2.7 KB
tuple cap is comfortable past 60 lines — far beyond any real return. A hash would
buy nothing here and cost the ability to read the key in a support query. In practice
the #2371 claim guard already prevents a second write — a retried `triggerRefund`
finds no attemptable line and returns `refundRecordIntent: null` — which is also why
the route must **not** try to be clever about the "triggered, no record" failure:
its remediation is the existing `POST /orders/:id/refunds` capture endpoint, and a
retry-write here would need to re-open a claim the money state has already settled.

### D2 — `GET` must not write, so #2374 gains a read-only `previewProposal`

`buildProposal` opens (or abandons-and-replaces) an ADR-044 `order_changes` row.
A `GET` bound to it would write on every page load, and — because the row is
rewritten whenever the computed proposal moves — would churn `changeId` and
abandon rows purely because someone opened the panel. That is both an HTTP-
semantics violation and real write amplification on a slot with a partial unique
index.

So `IReturnCorrectionProposalService` gains `previewProposal(returnId)`: the
identical computation, **no persistence**, returning the same
`ReturnCorrectionProposalResult` with `changeId: null` and `opened: false`. Both
methods delegate to one private `compute`, so the read and the write can never
disagree about what the proposal *is* — which is the only property that matters
here. `POST` keeps recording; `GET` previews.

This is an additive interface method with one implementer and one new spec; it is
the smallest honest way to give the issue's `GET/POST` pair correct semantics.

### D3 — An endpoint with no service is not shipped as a stub

Stated as a decision rather than an omission, because silence would read as an
oversight. A 501 route advertises a capability OL does not have; a route that
records an attestation OL has not designed is a contract invented at the HTTP
layer, below where SPIKE-2375 says the decision belongs. #2382's commission block
is `Absent, not empty, on non-Allegro returns` — an absent route is consistent
with that, and #2379 adds both together.

### D4 — Every domain refusal is mapped in the ONE global filter

`ReturnsExceptionFilter` currently maps four exceptions. This surface can raise
**nine more**, and an unmapped domain error is a 500 for a state the service
raised deliberately — the failure the filter's own docblock exists to prevent.
Extending the existing global filter (rather than adding controller-local
catches) is the repo convention and is what keeps a second caller of the same
service from answering differently.

| Exception | Status | Why |
|---|---|---|
| `ReturnLineNotFoundError` | **404** | no such line — the `ReturnNotFoundError` sibling |
| `ReturnCustodyTransitionError` | **409** | the AC's counter-invariant violation. Its closed `reason` (`over-receipt` / `over-disposition` / `illegal-transition` / `non-positive-quantity` / `partially-received`) is emitted as a **`reason` field**, exactly as `ReturnNotAttributedError.trigger` already is — the error's own docblock says *"#2376 answers 409 with a code the frontend can branch on"*, and a message-parsing consumer would break on the first reword |
| `ReturnCustodyContendedError` | **409** | another custody write holds the line; **retryable**, and the body says so |
| `ReturnRestockAttestationInvalidError` | **409** | nothing outstanding to attest — a state conflict, not a malformed request |
| `ReturnAuthorizeRefusedError` | **409** | a `source_ingested` return: the state refuses, and the operator must learn *why* — `reason` emitted |
| `ReturnMatchRefusedError` | **409** *or* **400** | split by reason (see below) — `reason` emitted either way |
| `ReturnRecordRefusedError` | **400** | OL's own pre-flight refused the *payload* (the `ReturnDeclineInvalidRequestError` precedent) — `reason` emitted |
| `ReturnRefundBlockedError` | **409** | no line is refund-attemptable — `reason` emitted |
| `ReturnRefundContendedError` | **409** | a concurrent refund attempt holds the return; retryable |

The statuses follow one rule, stated so the next mapping is not a coin toss:
**404** = the addressed resource does not exist (the return, the line); **409** =
it exists and its STATE refuses; **400** = the request PAYLOAD was inapplicable.

That rule is what splits `ReturnMatchRefusedError`, and the split is not
pedantry — the two reasons are different operator actions. `already-attributed`
is the return's own state refusing (**409**; attribution is monotonic, there is no
unmatch). `unknown-order` means the return is fine and the *order id the operator
supplied* names nothing OL has minted (**400**; the fix is in the request, or in
ingesting that order). Answering 409 for both would tell an operator the return
was in a bad state when their typo was the problem. `ReturnRecordRefusedError`'s
four reasons (`no-lines` / `invalid-quantity` / `unknown-order` /
`order-not-on-connection`) are all payload faults, so that class maps wholly to
400; `ReturnRefundBlockedError`'s three (`no-lines` / `already-attempted` /
`outstanding-in-doubt`) are all state, so it maps wholly to 409.

`ReturnRecordRefusedError` maps wholly to 400 even though it too carries an
`unknown-order` reason, and that is not an inconsistency with the `match-order` split
above: `POST /returns/record` addresses **no return at all**, so there is no resource
whose state could be in conflict — the payload is the entire request.

`non-positive-quantity` is deliberately **also 409** rather than 400 even though
it reads like a validation fault: the DTO's `@IsInt() @Min(1)` catches every
malformed request first, so reaching the domain check means the value was
well-formed and the *state* refused. Two statuses for one union would make a
frontend branch on status as well as code.

### D5 — Guarding, and the actor

`@Roles('admin', 'operator')` on **every** write, matching the existing
`decline` route — the issue's *"existing write-permission model; no new permission
value"*. The read-only role is refused by the same guard, which is the AC.

The actor is always taken from the verified token (`@CurrentUser()`), never from
the body. A body-supplied `actorUserId` would let a caller attribute their own act
to someone else in the audit trail these records exist to be — the rule the
decline route already states.

### D6 — `GET` is a read and carries no `@Roles`

The correction-proposal preview joins the #2334 read surface's posture (reads are
not role-gated; writes are). Putting it on the actions controller with the writes
would be a fifth thing on a page of `@Roles`-carrying routes and invites the next
editor to gate it by symmetry.

---

## 4. Implementation Plan

### Phase 1 — The read-only preview (core)

1. `IReturnCorrectionProposalService.previewProposal(returnId)` + implementation:
   extract the existing body into a private `compute(...)`, called by both.
   *Acceptance*: a spec asserting `previewProposal` calls **no** `IOrderChangeService`
   method at all and returns `changeId: null`, and one asserting both methods
   return an identical `proposal` for the same state.

### Phase 2 — The filter

2. Extend `ReturnsExceptionFilter` per § D4, emitting `reason` for every exception
   that carries one (the `trigger` precedent).
   *Acceptance*: table-driven spec, one case per exception, asserting status **and**
   the presence/absence of `reason`. A spec that fails if a returns exception class
   exists with no mapping, so the next domain error cannot silently become a 500.

### Phase 3 — DTOs

3. `apps/api/src/returns/dto/` — request DTOs with `class-validator` at the
   boundary (`@IsInt() @Min(1)` on quantities, `@IsIn` on dispositions/reasons,
   decimal-string validation on `amount`, ISO-4217 on `currency`), and response
   DTOs with `@ApiProperty`. `RestockBlockedResponseDto` carries `quantity`, `sku`
   and `connectionName` verbatim (the AC). Every closed union is declared
   `@ApiProperty({ enum: <the exported *Values array> })`, never a bare string —
   same reason D4 puts `reason` in the 409 body: a client branches on the
   vocabulary, so the vocabulary has to be in the contract.

### Phase 4 — The controller

4. Nine routes on `ReturnActionsController`, each `@ApiOperation` + `@ApiResponse`
   documented, each write `@Roles('admin','operator')`. Declare the literal-segment
   `POST /returns/record` **first**, so no future `POST /returns/:x` route can shadow
   it — the same hazard `ReturnsController` already avoids by declaring
   `GET /returns/ingestion-availability` before `GET /returns/:returnId`.
   *Acceptance*: controller spec per route — happy path, the guard, and for
   `dispose` the **blocked** branch returning 2xx with `restockBlocked` populated.

### Phase 5 — Wiring + docs

5. `ReturnActionsApiModule` imports `OrdersModule` (which exports
   `ORDER_REFUND_SERVICE_TOKEN`). **Acyclic and interface-layer**: `OrdersModule`
   does not import `ReturnsModule`, and eight `apps/api` modules already import it.
   Comment it, because it superficially resembles the core rule it does not breach —
   that rule forbids `OrdersModule` in **`ReturnsModule.imports`**, and `apps/api`
   sits above both.
6. `docs/architecture-overview.md § 22` — one bullet.
7. Integration spec `returns-write-api.int-spec.ts` covering
   receive → dispose → blocked → attest (the AC). **Compile-verified only** —
   Docker is wedged host-wide this session, so it joins the wave-level unverified
   list rather than being reported as passing.

---

## 5. Risks

- **`previewProposal` drifting from `buildProposal`** — mitigated structurally by
  the shared private `compute`, and asserted.
- **The refund double-write** — not atomic and cannot be (two contexts, two
  repositories). The ordering makes the surviving failure the visible one; stated
  in the route's docblock so nobody "fixes" it with a rollback.
- **An unmapped future returns exception** — mitigated by the filter's coverage
  spec.

---

## 6. Acceptance Criteria (from #2376)

- [ ] Over-receipt answers **409** with an actionable code (`reason: 'over-receipt'`)
- [ ] A blocked restock answers **2xx** carrying `restockBlocked` with quantity, sku and connection name
- [ ] Every endpoint guarded; read-only role refused on all writes
- [ ] Swagger annotations; integration test for receive → dispose → blocked → attest *(written; unrun — Docker)*
