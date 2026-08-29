# Implementation Plan: Return receive/dispose writes, counter invariants and `restock_blocked`

**Date**: 2026-08-26
**Status**: Ready for Review
**Issue**: #2370 (`W2-33`, Wave 2, stream S2, size L)
**Branch**: `2367-returns-custody` (on top of #2367 / #2368 / #2369)
**Estimated Effort**: 1.5–2 days

---

## 1. Task Summary

**Objective**: give the returns aggregate its two operator write paths — **receive** and **dispose** —
persist the custody move #2367 computes, drive the master stock write through #2368's
`adjustInventory` contract, and make a refused restock a loud, recoverable, operator-visible
`restock_blocked` fact rather than a silent no-op.

**Context**: Wave 1c shipped the counters and the two orthogonal per-line machines
(`ReturnCustodyState` / `ReturnMoneyState`) **defaulted and undriven**. #2367 shipped the pure
transitions that decide a custody move but persist nothing. #2368 widened
`InventoryMasterPort.adjustInventory` with a deterministic idempotency key, a reason and an outcome
report; #2369 implemented it for PrestaShop with four typed refusals. This issue is the write that
joins them.

**Classification**: CORE (Application + Domain + Infrastructure), **migration-bearing**.

---

## 2. Scope & Non-Goals

### In scope

- `IReturnCustodyService` — `receiveLine`, `disposeLine`, `markStockHandledManually`.
- A new **append-only per-line act ledger** (`return_line_events`) — see § 5 D1, the load-bearing
  design decision of this slice.
- Persisting the counters + custody state + `receivedAt` / `disposedAt` inside one transaction.
- The master restock write through `InventoryMasterPort.adjustInventory`, its deterministic
  idempotency key, and the full outcome taxonomy including `restock_blocked`.
- The operator attestation (`markStockHandledManually`), which clears a block and records
  `restockedBy: 'operator_out_of_band'` **without ever claiming OL wrote the stock**.
- Migration slot **`1852000000000`**.
- Unit tests + one integration test covering receive → dispose → blocked → attest.

### Out of scope (named, with owners)

- HTTP surface — **#2376** (`W2-39`).
- Frontend surfacing of `restock_blocked` — **#2381** (`W2-43`).
- Refund trigger / `in_doubt` money state — **#2371** (`W2-34`).
- `return.authorize`, orphan matching, operator-authored returns — **#2372** (`W2-35`).
- **Automation trigger EMISSION for T6 (`return.received`) / T7 (`return.disposed`)** — **#2360**.
  The `automation` context does not exist on this branch. This slice ships the substrate that makes
  those triggers *keyable* (§ 5 D1) and emits nothing. See § 5 D1 for why that substrate is the
  whole point.
- Marketplace-side stock writes. **Never originated here** — the ordinary
  `inventory.propagateToMarketplaces` fan-out carries the master adjustment onward. Asserted by a test.

---

## 3. Architecture Mapping

**Target layer**: `libs/core/src/returns/` (domain + application + infrastructure) plus one migration
under `apps/api/src/migrations/`.

**Capabilities involved**: `InventoryMasterPort` (consumer only — no port change), resolved per
connection through `IIntegrationsService.getCapabilityAdapter`.

**Existing seams reused, none invented**:

| Seam | Source | Use here |
|---|---|---|
| `applyReturnCustodyReceipt` / `applyReturnCustodyDisposition` | #2367 (pure) | decide the move inside the transaction that holds the row |
| `ReturnCustodyTransitionError` + its closed `reason` union | #2367 | branch on `error.reason`, **never** a message |
| `IReturnsService.assertAttributedForTrigger` | #2332 | the orphan block, called for `'restock'` |
| `InventoryMasterPort.adjustInventory` | #2368 | the master write, its key, its outcome |
| `MasterProductNotFoundError` | #1688, widened by #2369 | one of the `restock_blocked` causes |
| `ReturnRepositoryPort` | #2327/#2328/#2330/#2332/#2333 | widened, never replaced |

**Core vs Integration**: entirely CORE. The only external contact is through an existing capability
port; no adapter changes, no plugin changes.

---

## 4. The decisions this slice had to make

### D1 — A return line's history is a set of **ACTS**, and the counters remain the invariant

**The question** (raised by body D mid-flight): `quantityReceived` is a counter, not an act.
#2360's acceptance criteria require that a three-parcel return fires `return.received` **three
times**. A counter going `1 → 2 → 3` carries no per-arrival identity to key an idempotent firing on,
and is **indistinguishable from a correction** (a miscount fixed from 3 down to 2 and back to 3).
Under a counters-only model, T6/T7 are unimplementable as specified.

**Decision: persist each receive, each disposition and each attestation as its own append-only row**
in `return_line_events`, **while the counters stay on `return_lines` exactly as they are** — same
columns, same `CHK_return_lines_quantity_ordering`, written in the **same transaction** as the act.

Five things follow, and each is a reason:

1. **T6/T7 become keyable.** An act has an id, a per-line `seq` and an `occurredAt`. Three parcels
   are three rows, so three firings with three distinct keys. #2360 needs no new substrate.
2. **A correction is distinguishable from an arrival**, because it is a different row rather than a
   different value of the same number.
3. **The idempotency key #2368 already specifies finally means something.**
   `return:{returnId}:{lineId}:{seq}` names a per-line sequence — under a counters-only model there
   is no natural `seq` at all. The contract #2368 wrote presupposes an acts model; this slice
   supplies it.
4. **`restock_blocked` is a property of one disposition attempt, not of a line.** A line may carry
   one applied restock and one blocked one. Recording the block on the act is the only shape that
   can say so; the line-level and return-level flags are **derived** (§ 5 D3).
5. **The DB CHECK's guarantee is untouched, and that was a hard constraint.** The counters remain the
   CHECK-guarded columns, so no caller — including one bypassing this context — can persist an
   impossible line. The ledger is history *beside* the invariant, never *instead of* it. A spec
   asserts the acts sum back to the counters; an int-spec asserts the CHECK still refuses an
   impossible write.

**What this does NOT buy, stated so nobody assumes it**: the ledger is not a source the counters are
recomputed from at read time. The counters are authoritative; the acts explain them. Deriving the
counters would put an aggregate read on the hottest path and move the invariant out of the CHECK's
reach — the exact failure the orchestrator flagged.

### D2 — `not_returned` on a partially received line stays REFUSED (#2367's open question)

**Decision: decline. Do not add `quantityNotReturned`, do not widen the CHECK, do not reopen
`markReturnCustodyNotReturned`.**

Body D framed this and D1 as one question ("acts or running totals"). **They are not one question,
and the acts model is what makes that visible.** An act gives a shortfall *identity and history*; it
does not give it *somewhere to go*. `quantityAdvised >= quantityReceived >= restocked + scrapped` has
no slot for "the operator asserts 2 of 5 are never arriving", and the only fix is a **counter** —
`quantityNotReturned integer NOT NULL DEFAULT 0` plus a widened CHECK
(`quantityAdvised >= quantityReceived + quantityNotReturned`). Adding a ledger changes nothing about
that.

Declined here because:

- **No acceptance criterion in #2370 needs it.** The ACs cover over-receipt, restock idempotency,
  `restock_blocked`, the attestation and the no-marketplace-write assertion.
- **The shortfall is already visible** as `quantityAdvised - quantityReceived`, which is what spec
  §5.2 asks the operator to see; #2367 documented that reading deliberately.
- **The cost is not a column.** It is dropping and recreating a shipped CHECK constraint, amending
  #2367's just-shipped pure contract and its spec text, and re-deciding what custody state a line
  with both received and not-returned units holds — on an issue already sized L with two write paths
  and a migration.

**Known limitation recorded for #2376/#2381**: spec §5.2's *"Mark remainder not returned"* action
remains **unimplementable for a partially received line**. It works for a wholly unreceived one
(`markReturnCustodyNotReturned` already handles that). The fix is named above and is a one-column,
one-CHECK, one-contract-amendment follow-up — not a redesign.

### D3 — `restock_blocked` lives on the ACT; the line and return flags are derived

#2370's classification names *"the `restock_blocked` state column"* on the line. **Declared
deviation**: the authoritative fields live on `return_line_events`
(`restockState`, `restockBlockedReason`, `restockedBy`, `attestedBy`, `attestedAt`), because a line
can hold several restock attempts with different outcomes and a single line-level column cannot
express that without lying about one of them.

To keep the downstream list query (#2381's segment, #2376's response) index-served rather than a
table scan, the migration ships a **partial index** on
`("returnId") WHERE "restockState" IN ('blocked','in_doubt')`. The line/return-level flags are an
`EXISTS` over that index. If #2381 measures the list query as a problem, a denormalized boolean is a
purely additive follow-up — a cached derivation of a single authority, not a second authority.

### D4 — A blocked restock does NOT increment `quantityRestocked`

This reconciles two documents that appear to disagree, and getting it wrong is the one defect this
whole feature exists to prevent.

- Returns spec §5.4 (the **canonical copy owner** for `restock_blocked`): *"the line records
  `restock_blocked` and the units stay in `quantityReceived`, **not** in `quantityRestocked`"*, and
  the attestation is what *"moves the units into `quantityRestocked`"*.
- #2381's AC: *"a test asserts no component renders blocked units as restocked"*.
- #2367's docblock: a refused restock *"is still a disposition … #2370 records `restock_blocked`
  beside it and does not roll this back"*.

**Both hold, at different grains.** The **act** is the disposition and is never rolled back — it is
persisted, durable, and visible. The **counter** records book-confirmed restock, and a refused book
write has not confirmed anything. So:

| Path | Act row | `quantityRestocked` | Custody |
|---|---|---|---|
| `scrap` | written, `restockState: 'not_applicable'` | — (`quantityScrapped` moves) | per #2367 |
| `restock` → `applied` / `deduplicated` | settled | **+qty** | per #2367 |
| `restock` → `blocked` / `in_doubt` | settled, block recorded | **unchanged** | unchanged (stays `received` — the line genuinely still holds work) |
| attestation of a blocked/in-doubt act | new act, `handled_manually` | **+qty** | per #2367, evaluated now |

The consequence is that **`applyReturnCustodyDisposition` is called AFTER the master outcome is
known**, and never on the blocked branch — so #2367 needs no amendment at all, and the attestation
reuses the same pure function with the same guards. The `CHK_return_lines_quantity_ordering`
invariant holds throughout: blocked units simply remain counted in `quantityReceived`.

### D5 — The act is written BEFORE the master call (attempted-predicate), and `in_doubt` is a real state

The idempotency key must be deterministic and must name a stable `seq`. Deriving `seq` from a count
taken before the call and writing the row afterwards would lose the record of a real stock increase
if the process died mid-call — and the operator's natural remedy (dispose again) would mint a *new*
`seq`, a *new* key, and a genuine double-apply.

So the restock act is persisted first, in its own transaction, with `restockState: 'in_doubt'`; the
master is called; the act and the counters are settled in a second transaction. This is the same
ordering discipline ADR-056 requires of #2371's refund path, which keeps the two write paths on this
branch consistent rather than each inventing its own.

**`in_doubt` never auto-retries.** OL does not know whether the units reached the master's book, and
guessing in either direction moves real stock. Its remediation is the same operator attestation as a
block, with its own copy (*"OpenLinker did not get an answer"* rather than *"{connection} refused"*).

### D6 — Every #2368/#2369 contract detail is honoured explicitly, at one seam

One pure function, `classifyRestockOutcome`, reads the adapter's answer. It is the only place any of
these rules is spelled:

- **An absent `adjustmentOutcome` is read as `idempotency: 'unsupported'`** — never as a honoured
  dedupe, which would let a retry silently skip a restock that never ran.
- **`disposition: 'deduplicated'` is a SUCCESS.** Units are already in the master's book; counting
  them twice is the defect.
- **`appliedAt` is never consulted for success.** It is always `null` on PrestaShop
  (`stock_availables` has no timestamp column); `disposition` is the discriminator.
- **Any throw is `restock_blocked`** — the four typed PrestaShop refusals, the neutral
  `MasterProductNotFoundError`, and anything else. The catch is on `unknown`, **not** on
  `PrestashopNotSupportedException`, which core cannot and must not name.
- **A cache outage fails closed** (#2369's behaviour): the adapter refuses rather than risking a
  double-apply, so it surfaces here as `blocked` and is recoverable by attestation. A double restock
  is not recoverable.

### D8 — Concurrency: a row lock for the counters, a per-line lock for the boundary crossing

*Added after the plan-stage `/tech-review`, which raised both halves as BLOCKING.*

**The counters are read-then-write, and the DB CHECK cannot save them.** The pure transitions compute
`quantityReceived = line.quantityReceived + input.quantity` from a value read before the write, so two
concurrent receives of 3 against `advised: 5` both read `0`, both compute `3`, and the second write
wins — the line records 3, not 6. `CHK_return_lines_quantity_ordering` is silent, because `3 <= 5` is
perfectly legal. The constraint guarantees no *impossible* line is persisted; it does not guarantee no
*lost update*. So `findLineForUpdate` takes `SELECT … FOR UPDATE` on the `return_lines` row inside the
same transaction that writes it, and every counter write is computed from the locked read.

**The master write must not happen before the counter check.** Ordering the restock as
*append act → `adjustInventory` → `applyReturnCustodyDisposition`* puts the `over-disposition` guard
**after** the boundary crossing, so an illegal disposition increments the master's book and is refused
afterwards. For a feature whose premise is *"a restock that silently no-ops is worse than none"*, that
is the mirror-image defect and it is worse — the book and the counters disagree with no act explaining
it. The pure transition is therefore run **twice**: once as a **validation pass before** the master
call (outcome discarded), and once at settle time against the locked row for the authoritative
counters. It is pure and free, which is exactly what makes calling it twice the right answer.

**And the whole of `disposeLine` is serialized by a per-line lock** (`SyncLockPort`, key
`return:line:{lineId}`, TTL `OL_RETURN_CUSTODY_LOCK_TTL_MS`). The validation pass is a *read*, and a
read-then-act guard that crosses a provider boundary is exactly the shape ADR-041 §3a serializes with
`invoiceIssueLockKey` — two concurrent disposals both pass the check, both call `adjustInventory` under
different `seq` keys, and both apply. Keyed per LINE because that is the grain the counter invariant
is stated at. As with the invoice lock, TTL expiry is **not** a correctness cliff: the window that must
be covered is validation-read → act-append, and past that the `in_doubt` act row exists and a peer's
own read sees it. A contended attempt raises the retryable `ReturnCustodyContendedError` and **never
reaches the adapter**.

`receiveLine` needs the row lock but not the distributed lock — it crosses no boundary, so the
transaction is the whole of its critical section.

### D7 — Every downstream trigger goes through `assertAttributedForTrigger`

`disposeLine` calls `assertAttributedForTrigger(returnId, 'restock')` **before** the master write,
for the restock disposition. An orphan return restocks nothing, because a restock against a phantom
order moves real stock and no later log line recovers it. `receiveLine` and `scrap` do **not** call
it: neither moves goods, money or paperwork outside OL's own building, and blocking a parcel from
being *recorded as arrived* because OL cannot name its order would make the orphan bucket unusable
for exactly the returns it exists to hold.

---

## 5. Questions & Assumptions

### Assumptions

- **The master connection for a restock is the return line's product's `InventoryMaster`
  connection.** Resolved by listing `InventoryMaster`-capable connections; **exactly one** must
  resolve. Zero → `blocked` (`no-inventory-master`). More than one → `blocked`
  (`ambiguous-inventory-master`), never a silent pick — the #2047 discipline, because a wrong pick
  moves real stock in the wrong book.
- **Quantity is delta-positive**: `adjustInventory({ quantity: +n, reason: 'return_restock' })`.
- **`sku` and `connection name` for #2376's response body** are resolvable from the line and the
  connection; the service returns them on the blocked outcome so the UI needs no second read.

### Open questions (non-blocking, recorded)

- Whether `in_doubt` warrants distinct FE copy from `blocked` in #2381 (spec §5.4 defines copy for
  `blocked` only). Default: reuse the block surface, distinct sentence. **#2381's call.**
- The 90-day retention posture for `return_line_events` (the automation-runs precedent). Not
  applicable here — this ledger is the record of physical goods movement and is not prunable.

---

## 6. Implementation Plan

### Phase 1 — Domain vocabulary

1. **`domain/types/return-line-event.types.ts`**
   `ReturnLineEventKindValues` (`receive | dispose | stock_attestation`),
   `ReturnRestockStateValues` (`not_applicable | in_doubt | applied | deduplicated | blocked |
   handled_manually`), `ReturnRestockBlockReasonValues` (`master-refused | master-product-not-found |
   no-inventory-master | ambiguous-inventory-master | adapter-unresolved | unknown`)
   — **plus a free-text `restockBlockedDetail` carrying the adapter's own sentence**, because #2369
   distinguishes four refusals (unscoped multi-shop naming, `depends_on_stock=1` ASM, a combination
   product with no `variantId`, an unreadable quantity) that are four different operator actions, and
   a closed union alone can only ever say "it refused". The union is what code branches on; the detail
   is what the operator quotes in a support ticket — the #2231 precedent, where the platform's own
   words survive the round trip and an unrecognised one is surfaced rather than dropped —
   `RestockedByValues` (`inventory_master | operator_out_of_band`), plus the
   `ReturnLineEvent` create-input. `as const` + derived union, per standards.
   **Acceptance**: no enum, no inline types, every union has its runtime array.

2. **`domain/entities/return-line-event.entity.ts`** — anemic, fully `readonly` (ADR-011).

3. **`domain/domain-services/restock-outcome.domain-service.ts`** — the pure
   `classifyRestockOutcome(result | error)` of § 4 D6. No I/O, no injection.
   **Acceptance**: a spec covers absent-outcome, `deduplicated`, `applied` with `appliedAt: null`,
   `MasterProductNotFoundError`, and an arbitrary throw.

4. **`domain/exceptions/`** — `return-line-not-found.error.ts`,
   `return-restock-attestation-invalid.error.ts` (attesting a line with no outstanding block), and
   `return-custody-contended.error.ts` (D8's lock contention — **retryable**, and it never reaches
   the adapter). Each carries a closed reason where it has more than one cause.

4b. **`application/services/return-custody-lock.ts`** — `returnCustodyLockKey(lineId)` +
   `RETURN_CUSTODY_LOCK_TTL_MS`, the `invoice-issue-lock.ts` shape verbatim (module-load resolution,
   `OL_RETURN_CUSTODY_LOCK_TTL_MS`, clamped). Kept beside the service rather than in the domain,
   matching where the invoicing precedent puts it: locking is orchestration, not domain logic.

### Phase 2 — Persistence

5. **`infrastructure/persistence/entities/return-line-event.orm-entity.ts`** — table
   `return_line_events`. `uuid` PK (the `return_lines` precedent — never referenced from outside the
   aggregate). Columns: `returnId`, `returnLineId`, `seq int`, `kind`, `quantity int`, `disposition`,
   `restockState`, `restockBlockedReason`, `restockedBy`, `note`, `actorUserId`, `occurredAt`,
   `attestedByEventId`, `createdAt`. `UQ_return_line_events_line_seq` on `(returnLineId, seq)` — the
   uniqueness that makes the idempotency key stable. Partial index per § 4 D3.
   **No FK to `return_lines`** — consistent with the context's stated posture (the one FK in this
   schema is `return_lines.returnId`); the harness truncates explicitly.
   **Acceptance**: class-level `@Index`/`@Check` names match the migration verbatim (the
   `CHK_return_lines_quantity_ordering` precedent — the int-spec harness builds by `synchronize`).

5b. **Gate warnings folded in** (from the `/pre-implement` verdict):
   - **`return_line_events` joins the api truncate list**, immediately before `'return_lines'` in
     `apps/api/test/integration/setup.ts` (line ~134), with a reason comment matching the block's
     style. It carries no FK to `return_lines`, so `truncateTables`' CASCADE walk never reaches it and
     acts would leak between cases — colliding on `UQ_return_line_events_line_seq`. The worker harness
     truncates a hardcoded list that has never held the returns tables; nothing here needs it.
   - **Index and check names are declared class-level on the ORM entity, verbatim as the migration
     spells them.** `returns-schema.int-spec.ts:20-25` states the rule: the harness builds by
     `synchronize`, so a constraint present only in the migration holds in production and silently
     *not* in tests.
   - **`return_lines.disposition` gets a stated rule.** It is a shipped nullable column and a line can
     now hold several disposition acts, so: **last applied disposition wins**, documented on the
     column as a display convenience for the ordinary single-disposition line. The ledger and the
     counters are authoritative; nothing branches on this column.

6. **Migration `apps/api/src/migrations/1852000000000-create-return-line-events.ts`**
   class `CreateReturnLineEvents1852000000000`. Creates the table + two indexes. `down()` drops them.
   **Slot 1852 is the reserved one; siblings hold 1849–1851, 1853–1855, 1857.**
   **Acceptance**: `pnpm lint` (`check-migration-timestamps.mjs`) passes; `migration:show` lists it.

7. **`ReturnRepositoryPort` widening** — five methods, each documented with *why*:
   - `findLineForUpdate(lineId, manager)` → the line row under `SELECT … FOR UPDATE` (D8) plus its
     return header, so every counter write is computed from a read no peer can interleave with.
   - `findLineById(lineId)` → the unlocked read, for the validation pass and the reads that write
     nothing.
   - `appendLineEvent(input)` → allocates `seq` (`MAX(seq)+1` within the write) and inserts.
   - `applyCustodyOutcome(lineId, outcome, event)` → **one transaction**: settles the act and writes
     the counters + `custodyState` + `receivedAt`/`disposedAt` the #2367 outcome computed.
   - `settleRestockEvent(eventId, patch)` → the settle-only path for a blocked/in-doubt outcome that
     moves no counter.
   - `listUnhandledRestockBlocks(returnId)` → the derived flag of § 4 D3.

8. **`ReturnRepository`** implementation. Infrastructure errors converted to domain errors at this
   boundary, per standards.

### Phase 3 — The service

9. **`application/services/return-custody.service.interface.ts`** — `IReturnCustodyService` with the
   three methods and their result types (`ReceiveLineResult`, `DisposeLineResult` carrying the
   `restockBlocked` payload #2376 puts in its 2xx body, `AttestStockResult`).

10. **`application/services/return-custody.service.ts`**

    - `receiveLine(lineId, {quantity, note, actorUserId})`
      → load line → `applyReturnCustodyReceipt` → `appendLineEvent` + `applyCustodyOutcome` in one
      transaction. `ReturnCustodyTransitionError` propagates with its `reason` intact so #2376 can
      map `over-receipt` to its own 409 code.
    - `disposeLine(lineId, {quantity, disposition, note, actorUserId})`
      → load line → **for `restock`**: `assertAttributedForTrigger('restock')` → resolve the single
      `InventoryMaster` connection → `appendLineEvent(in_doubt)` → build the deterministic key
      `return:{returnId}:{lineId}:{seq}` → `adjustInventory` → `classifyRestockOutcome` → on success
      `applyReturnCustodyDisposition` + `applyCustodyOutcome`; on block/in-doubt
      `settleRestockEvent` **only** (§ 4 D4).
      → **for `scrap`**: no master contact, one transaction, `restockState: 'not_applicable'`.
    - `markStockHandledManually(lineId, {actorUserId})`
      → **addressed by LINE, not by act id** — #2376's route is
      `POST /returns/:id/lines/:lineId/mark-stock-handled` and spec §5.4 puts the action under the
      line row, so the line is the operator's unit and an `eventId` the controller cannot obtain
      would make this uncallable. Settles **every** outstanding `blocked` / `in_doubt` restock act on
      the line, which is what "clears the block" means at the grain the badge works at.
      → per act: `applyReturnCustodyDisposition` for that act's quantity against the locked row →
      append one `stock_attestation` act carrying `restockedBy: 'operator_out_of_band'`,
      `attestedBy`, `attestedAt`, `attestedByEventId` → one transaction, one row lock.
      **Never calls `adjustInventory`**, and never claims OL wrote the stock. A line with no
      outstanding block raises `ReturnRestockAttestationInvalidError` rather than silently succeeding.

11. **`ReturnsModule`** — register the service + its token
    (`RETURN_CUSTODY_SERVICE_TOKEN` in `returns.tokens.ts`, `export *` already in place).
    `IntegrationsModule` is already imported; **no new module edge**.

### Phase 4 — Tests

12. **Unit** — `return-custody.service.spec.ts` (mocking `ReturnRepositoryPort`,
    `IIntegrationsService`, `IReturnsService`), `restock-outcome.domain-service.spec.ts`,
    `return-line-event.types.spec.ts`.
    Including two ordering assertions the design would otherwise only assert by convention:
    a fake `adjustInventory` that **throws** must find the act already persisted as `in_doubt`
    (D5's attempted-predicate, the shape #2371's AC also requires), and a fake that **records the
    counters at call time** must observe them un-incremented (D8 — the validation pass ran, the
    settle did not).
13. **Integration** — `apps/api/test/integration/returns-custody-writes.int-spec.ts` (flat, matching
    the three existing `returns-*.int-spec.ts` files):
    receive → dispose(restock) against a refusing master → `restock_blocked` → attest → block clears
    and the counters land. Plus: over-receipt refused by the DB CHECK when the service is bypassed;
    a retried restock raises master stock exactly once against a deduping fake; and **a concurrent
    double receive leaves the counters correct** (D8's lost-update case, which is only observable
    against real Postgres).

---

## 7. Alternatives Considered

### A1 — Counters only, no acts table (the pre-body-D shape)

Smaller diff, one fewer table. **Rejected**: T6/T7 become unimplementable as #2360 specifies, a
correction is indistinguishable from an arrival, `restock_blocked` cannot be expressed per attempt,
and the `seq` in #2368's already-shipped key format names nothing. The follow-up would have recorded
a known defect rather than a design.

### A2 — Acts as the only truth, counters derived at read time

Rejected on the orchestrator's explicit constraint and on merit: it moves the invariant out of
`CHK_return_lines_quantity_ordering`'s reach — the one guarantee that holds against a caller
bypassing this context — and puts an aggregate on the hottest read.

### A3 — Roll back the disposition when the master refuses

Rejected: the goods really were disposed of. Erasing the operator's decision because a book write
failed loses the record of a physical act and re-prompts for a decision already made.

### A4 — Increment `quantityRestocked` on a blocked restock and carry a separate blocked flag

Rejected — it makes every read that sums `quantityRestocked` overstate what is in the master's book,
and it directly contradicts #2381's testable AC. See § 4 D4.

---

## 8. Validation & Risks

| Check | Status |
|---|---|
| Hexagonal layering (domain pure, application → domain, infra implements ports) | ✅ |
| Cross-context contract (`I*Service` + ports only; no sibling `*RepositoryPort`) | ✅ — `IReturnsService`, `IIntegrationsService`, `InventoryMasterPort` |
| No new module edge | ✅ — `IntegrationsModule` already imported by `ReturnsModule` |
| Idempotency | ✅ — deterministic key, `seq` uniqueness enforced by index |
| Error handling | ✅ — domain errors with closed reason unions, branched on `reason` |
| `as const` unions, types in `*.types.ts`, file headers, no `any`, no `console.log` | ✅ |
| Migration slot + ordering invariant | ✅ — `1852000000000` |

**Risks**

- **`seq` allocation under concurrency.** Two dispositions on one line racing could both compute the
  same `MAX(seq)+1`. Serialized by D8's per-line lock on the dispose path, and belt-and-braces by
  `UQ_return_line_events_line_seq` plus the `FOR UPDATE` row lock on every write path: the loser's
  insert fails, is converted to a domain error, and the caller retries — correct, because the losing
  attempt has not called the master yet.
- **A crash between the master call and the settle** leaves an `in_doubt` act. By design (§ 4 D5):
  visible, never auto-retried, remediated by attestation.
- **A blocked line stays `received` forever if nobody attests.** Intended — that is the alarm, and
  #2381 is the surface that rings it.

---

## 9. Acceptance Criteria (from #2370)

- [ ] Over-receipt is rejected with an actionable code; the counter invariant holds under concurrent writes
- [ ] A `restock` against a deduping master raises stock exactly once, including on retry
- [ ] A `restock` against a refusing master records `restock_blocked`, persists the reason, and does **not** report the units as restocked anywhere
- [ ] `markStockHandledManually` clears the block and records the attestation, never a stock write
- [ ] No marketplace stock write originates in this service (asserted)
- [ ] Tests added; no boundary violations

---

## Related Documentation

- [ADR-060](../architecture/adrs/060-returns-aggregate-above-source-projection.md) (amended by this slice)
- [ADR-056], [ADR-042] — the attempted-predicate / in-doubt discipline reused in § 4 D5
- `docs/specs/product-spec-oms-returns-operator-ux.md` §5.2 / §5.3 / §5.4
- `docs/architecture-overview.md § 22 Returns`
