# Implementation Plan: Credit-note correction proposal with positional ambiguity (#2374)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1 day
**Issue**: #2374 (`W2-38`, Wave 2, stream S2, size L)
**Branch**: `2367-returns-custody` (body E; on top of #2373 `c9718f72f`)

---

## 1. Task Summary

**Objective**: give a disposed return line a **credit-note correction proposal** — a diff of the
return's disposed lines against the invoice's `issuedLineSnapshot` (#1297), with each line classified
`matched | ambiguous | no-match`, every candidate listed, and every exclusion explained. The proposal
is **data**. Nothing here issues anything.

**Context**: ADR-060 § Decision — *"a disposed line **proposes** an invoice correction through the
existing `CorrectionIssuer` seam, showing the positional-line ambiguity — auto-issue stays gated on a
stable `InvoiceLine` reference."* Returns product spec § 5.8 is the operator-facing shape.

**Classification**: CORE / Application (plus one additive read on the `invoicing` service interface).

### Why "positional ambiguity" is the entire problem

`IssueCorrectionCommand.lines` is `CorrectionLine[]`, and `CorrectionLine.originalLineNumber` is a
**1-based position into the original document's line array**. There is no stable identifier on
`InvoiceLine`:

```ts
export interface InvoiceLine {
  name: string; quantity: number; unitPriceGross: number; taxRate: string; unit?: string;
}
```

`ReturnLine` carries `sku`, `name`, `offerId` and **no price at all**. The only axis the two shapes
share is `name`. So when one order repeats the same offer on more than one line — the exact shape the
#2375 spike found for Allegro commission refunds, where the claim keys on an order *line item* — the
invoice holds two identically-named lines and **nothing in either record can say which one a return
line refers to**.

**A proposal that cannot say which line it corrects is not a proposal, it is a guess about money.** So
the answer is not a better heuristic; it is to *show the ambiguity* and let a human decide. That is
what § 5.8 asks for and what ANALYSIS-1032 requires.

---

## 2. Scope & Non-Goals

### In scope

- A pure matching/classification domain service (`matched` / `ambiguous` / `no-match` + candidates).
- `IReturnCorrectionProposalService.buildProposal(returnId, actorUserId?)` — attribution-gated,
  reads the invoice projection, classifies, and persists the proposal as a **third** ADR-044
  `order_changes` kind.
- One additive `IInvoiceService` read (`getLatestIssuedInvoiceForOrder`) — no repository change.
- Wiring (`ReturnsModule` imports `InvoicingModule`), tokens, barrel, table-driven unit tests.

### Out of scope (named, with reason)

- **Issuing anything.** `CorrectionIssuer` / `IInvoiceService.issueCorrection` are never referenced;
  a spec asserts it. Confirmation + handoff is `W2-44` (#2382) through #2376's write API.
- **HTTP.** `GET/POST /returns/:id/correction-proposal` is #2376's.
- **Auto-issue.** Gated on `InvoiceLine` gaining a stable reference (the issue's own Assumption).
- **A provider capability pre-check** (`isCorrectionIssuer`). The proposal is data; whether the
  provider can issue it is a gate at the *issuing* act. Duplicating it here would give one refusal
  two homes, and the check costs an adapter construction (credential resolution) on a read.
- **A migration.** `order_changes.kind` is `varchar(64)` with no PG enum and no CHECK — the union's
  own docblock says widening is a one-line edit. **Slot `1863000000000` is NOT taken.**

### Constraints

- No country-specific vocabulary in `libs/core` (ADR-026). Nothing here says `KSeF`/`NIP`/`FA`/`KOR`.
- Core computes no net and rounds nothing (ADR-063). The proposal emits **quantities only**.
- `OrdersModule` must never enter `ReturnsModule.imports` (§ 22 cycle rule). We reach `order_changes`
  through `OrderChangesModule` + `IOrderChangeService`, as #2333/#2372 already do.

---

## 3. Architecture Mapping

**Target layer**: CORE — `libs/core/src/returns/` (application + domain), plus one method on
`libs/core/src/invoicing/application/services/invoice.service.interface.ts`.

**Existing seams reused (all of them; nothing new is invented)**:

| Seam | Used for |
|---|---|
| `IReturnsService.assertAttributedForTrigger(id, 'invoice_correction')` | the orphan block — the value is **already** in `ReturnDownstreamTriggerValues`, unused until now |
| `IInvoiceService` (`INVOICE_SERVICE_TOKEN`) | reading the invoice projection — never `InvoiceRecordRepositoryPort` |
| `IOrderChangeService` (`ORDER_CHANGE_SERVICE_TOKEN`) | the ADR-044 proposal row; **never** `OrderChangeRepositoryPort` |
| `InvoiceRecord.issuedLineSnapshot` (#1297) | the lines to diff against |
| `domain-services/` pure functions (`return-custody-transitions` precedent) | the classifier |

**New module edge**: `returns --> invoicing`. Acyclic — `invoicing` imports `orders`,
`sales-documents`, `fiscalization`, `identifier-mapping`, `integrations`, `sync`, and **not**
`returns`. `ReturnsModule` gains `InvoicingModule` to its `imports`; `InvoicingModule` gains nothing.

**Core vs Integration**: entirely CORE. The classification is a property of two neutral core shapes
(`ReturnLine`, `InvoiceLine`); no adapter is resolved and no platform is named.

---

## 4. Design decisions

### D1 — `targetRef` is a namespaced `correction:{returnId}:{invoiceRecordId}` composite

`UQ_order_changes_open_target` is `UNIQUE (internalOrderId, targetRef) WHERE status IN
('pending','requested')` and **does not include `kind`**. That one fact settles the whole question,
and it rules out both obvious answers:

- **`targetRef = returnId`** (what #2333 and #2372 use) collides with this return's own open
  `return.authorize` or `return.decline` proposal — opening one would expire or block the other.
- **`targetRef = invoiceRecordId`** collides across RETURNS. An order legitimately produces several
  returns (partial returns arriving in waves), each proposing against the same invoice. Return B's
  build would find return A's open row, compute a different payload, and under D2 abandon A's
  proposal to open its own — destroying a proposal an operator was mid-review on, with no error.

So the key must be unique per **(return, document)** and must not intrude on the bare-`returnId`
namespace the other two kinds own: `correction:{returnId}:{invoiceRecordId}`. ADR-044's *"names the
thing being mutated"* is satisfied in substance — the subject here is *this return's* correction of
*that document*, which is genuinely a pair, not a document alone. `findLatestByTarget` is kind-scoped
and unaffected. The reasoning is recorded on `OrderChangeKindValues` beside the new member, because
the next kind added to that union faces the identical namespace question.

### D2 — The persisted row always matches the proposal returned

`openOrReuse` has no update path, and a stale payload is worse here than in #2333 because the return
keeps accumulating disposals. Rule: compute the proposal fresh; if an open row exists whose payload is
byte-identical, reuse it; otherwise `abandon` it and open a new one. `abandon` is exactly right —
its own docblock covers *"a proposal that was NEVER PUT to the authority"*, and this proposal crosses
no boundary at all, so terminalising it is free. The row is therefore always the audit record of
precisely what the operator is being shown.

A reused-vs-reopened distinction is reported (`opened`), never hidden.

**The payload holds no operator picks, and must not.** A pick for an ambiguous line is made at the
confirm act (#2376 / #2382), not stored on this row — because this row is rewritten whenever the
computed proposal moves. Storing picks here would make the abandon-and-reopen rule destroy them, the
same failure D1 rules out one level up. #2376 must carry picks in its own confirm request.

### D3 — The disposed quantity comes from the **counters**, and a blocked restock is a named exclusion

Disposed quantity per line is `quantityRestocked + quantityScrapped` — the `CHK_return_lines_quantity_ordering`-guarded
columns, which the #2370 handover names authoritative (the act ledger is history *beside* the
invariant, never instead of it).

The consequence is real and is surfaced rather than swallowed: #2370 rule (1) says a **blocked**
restock does not increment `quantityRestocked`, so such units contribute nothing to the proposal until
an operator attests. Crediting a buyer for units whose disposition OL could not confirm is exactly the
guess this programme refuses. A line holding an outstanding disposition but no counter movement is
classified `no-match` with reason **`disposition-not-confirmed`**, so the operator reads *"attest the
blocked restock and re-open the proposal"* rather than seeing the line silently vanish.

**That fact comes from the act ledger, through the existing read.** Counters alone cannot separate
"nothing disposed" from "disposed, master refused", so the service calls
`ReturnRepositoryPort.findOutstandingRestockEventsForReturn` (already on the port, #2370) once per
build and keys the reason off it. Naming the read matters: without it the implementer either invents
a second route into the ledger or emits `no-line-by-name` for a blocked line, sending the operator to
fix the wrong thing. Only a restock can be blocked — a scrap crosses no boundary.

### D4 — Matching key: normalized `name`, feasibility-filtered by quantity

`InvoiceLine` carries no sku, so `name` is the only shared axis — which *is* the ambiguity. Names are
normalized (trim, collapse internal whitespace, case-fold) before comparison; nothing fuzzier, because
a fuzzy match on a fiscal document is a guess wearing a confidence score.

**Deliberately NOT diacritic-folded**, unlike `DestinationCategory.searchText` — a reader will assume
that precedent applies, so the refusal is recorded rather than left implicit. Both names descend from
the same catalogue through the same order, so folding buys nothing, while it can collapse two
genuinely distinct products onto one candidate set and manufacture an ambiguity that does not exist.

A candidate whose `quantity < disposedQuantity` is **filtered out**: you cannot return more of a line
than was invoiced on it, and proposing a negative post-correction quantity would be a defect the
provider discovers. If that filter empties a non-empty candidate set, the line is `no-match` with
reason `quantity-exceeds-invoiced` — distinct from `no-line-by-name`, because they are different
operator actions.

### D5 — The delta carries **quantity only**

`CorrectionLine.newQuantity = candidate.quantity - disposedQuantity`; `newUnitPriceGross` is left
absent. A return does not change the unit price. Core therefore computes no money, derives no net and
rounds nothing (ADR-063); the integer subtraction of units is not a money computation.

### D6 — `candidatesDiffer` is reported, and it is not a resolution

§ 5.8's ambiguous copy says *"the correction amount is the same either way **unless these lines were
priced differently**"*. The proposal reports `candidatesPriceOrRateDiffer: boolean` (do all candidates
share `unitPriceGross` **and** `taxRate`) so the panel can say so honestly — named for the two fields
it actually compares, so § 5.8's copy maps onto it without a lookup. It **never** collapses an
ambiguous line to `matched` — the operator still picks. Auto-picking on "the amount is the same" would
stamp a specific `originalLineNumber` into a fiscal document on the strength of an amount coincidence.

### D7 — Correction-of-a-correction falls out of "latest issued"

`getLatestIssuedInvoiceForOrder` returns the newest `issued` record, and a successful correction is
itself an `InvoiceRecord` carrying its own `issuedLineSnapshot` of post-correction lines. So #1297's
rule ("a correction-of-a-correction diffs against the prior correction's own lines") is satisfied by
construction, not by a special case. Reading `getLatestInvoiceForOrder` instead would target a `failed`
or `pending` row; filtering to `issued` is what makes "the document that exists" the target.

### D8 — Every non-proposing exit is a named outcome, never a silent empty

`ReturnCorrectionProposalOutcome`:

| Value | Meaning |
|---|---|
| `proposed` | ≥1 line is `matched` or `ambiguous`; a row was opened or reused |
| `nothing-correctable` | a document exists, lines were classified, **none** is correctable — the proposal body is still returned in full so the operator reads every exclusion reason; **no row is opened** (a slot must not be held for a proposal with nothing to confirm) |
| `no-invoice` | the order holds no `issued` invoice record |
| `no-line-snapshot` | the target document predates #1297 — **refused**, never diffed against the order's current state, which is the precise defect #1297 exists to prevent |
| `no-disposed-lines` | nothing has been disposed yet |

`ReturnNotAttributedError` / `ReturnNotFoundError` **throw** (the #2332 seam's contract); everything
else is a value, because these are states an operator reads, not failures.

---

## 5. Questions & Assumptions

**Assumptions**
- `InvoiceLine` still has no stable identifier (the issue states this). Auto-issue stays out.
- Wave-1c read DTOs are #2376's problem; this slice ships no DTO.
- `ReturnLine.name` is populated by both ingestion and `recordReturn`. Where it is `null`, the line is
  `no-match` / `no-line-by-name` — honest, since there is nothing to match on.

**Open question (recorded, not blocking)**
- Two return lines can legitimately resolve to the same candidate set, and confirming both against one
  `originalLineNumber` would need the deltas aggregated. Aggregation belongs to the confirm act
  (#2376/#2382), which is where the operator's picks exist. The proposal states the risk per line via
  `candidates`; it does not pre-aggregate, because it does not know the picks.

---

## 6. Implementation Plan

### Phase 1 — Vocabulary + pure classifier

1. **`libs/core/src/returns/domain/types/return-correction-proposal.types.ts`**
   `ReturnCorrectionLineStatusValues` (`matched|ambiguous|no-match`),
   `ReturnCorrectionNoMatchReasonValues` (`no-line-by-name` | `no-line-name` |
   `quantity-exceeds-invoiced` | `disposition-not-confirmed`),
   `ReturnCorrectionProposalOutcomeValues` (§ D8), and the shapes
   `ReturnCorrectionCandidate { originalLineNumber, name, quantity, unitPriceGross, taxRate, unit? }`,
   `ReturnCorrectionProposalLine`, `ReturnCorrectionProposal`, `ReturnCorrectionProposalResult`.
   *Acceptance*: `as const` + derived unions per standards; no function in this file.

2. **`libs/core/src/returns/domain/domain-services/return-correction-matching.domain-service.ts`**
   Pure `classifyReturnCorrectionLines(input): ReturnCorrectionProposalLine[]` — no I/O, no injection,
   mirroring `return-custody-transitions.domain-service.ts`. Every `switch` closes with `assertNever`.
   *Acceptance*: table-driven spec covering matched / ambiguous(2,3 candidates) / each no-match reason
   / `candidatesDiffer` true+false / the repeated-offer case.

### Phase 2 — The invoicing read

3. **`IInvoiceService.getLatestIssuedInvoiceForOrder(orderId)`** + impl in `InvoiceService`, over the
   existing `findAllByOrderId` (already `createdAt DESC, id DESC`) with a `status === 'issued'` find.
   **No repository-port change, no migration.** Docblock states D7.
   *Acceptance*: spec asserts a newer `failed` row does not mask the `issued` one, and that a
   correction row (newer, `issued`) wins over the original.

3b. **Update the three `jest.Mocked<IInvoiceService>` doubles.** `jest.Mocked<T>` is a mapped type over
   the *whole* interface, so each mock literal must gain the new method or it fails to type-check:
   `apps/api/src/orders/http/orders.controller.spec.ts`,
   `apps/api/src/invoicing/http/invoicing.controller.spec.ts`,
   `apps/worker/src/sync/handlers/invoicing-issue.handler.spec.ts`.
   (`fiscal-registration.service.spec.ts` is unaffected — it uses `Pick<…>` + `as unknown as`.)

### Phase 3 — The kind, and the guard that must move with it

4. **`OrderChangeKindValues`** += `'return.invoice_correction'`, with a docblock paragraph stating
   D1 (why `targetRef` is the document id here and not the return id, and what the shared index would
   otherwise do).
   *Acceptance*: `pnpm type-check` clean; no migration (varchar column, no enum/CHECK).
   *Verified by the gate*: no exhaustive `switch`, no `Record<OrderChangeKind, …>`, no `apps/web`
   mirror and no `check-*.mjs` invariant reads this union, so widening it is genuinely one line.

4b. **`no-second-proposal-mechanism.spec.ts` — narrow the token regex, do not rename the token.**
   Its third assertion bans any returns-barrel `*_TOKEN` matching `/PROPOSAL|CHANGESET|CHANGE_REPOSITORY/`,
   which `RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN` trips. The test's own name is
   *"should expose no proposal-**store** token"*, and a service token that persists through
   `IOrderChangeService` is not a store — the regex is blunter than the rule it encodes. Narrow it to
   `/PROPOSAL_(REPOSITORY|STORE)|CHANGESET|CHANGE_REPOSITORY/` **in this commit**, with a comment
   recording why #2374's token is not a second mechanism, and extend the first assertion to cover
   `'return.invoice_correction'`. Renaming the token to dodge the grep is rejected: it hides the
   artifact from the guard instead of satisfying it, and mis-names the thing every governing document
   calls a proposal. The other three assertions keep binding to this slice's code unchanged.
   *Acceptance*: the suite passes and still fails if a proposal-shaped repository, port, ORM entity or
   `OrderChangeRepositoryPort` import is added under `returns/`.

### Phase 4 — The service

5. **`return-correction-proposal.service.interface.ts`** + **`.ts`** + token
   `RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN` in `returns.tokens.ts`.
   Flow: `assertAttributedForTrigger('invoice_correction')` → `getLatestIssuedInvoiceForOrder` →
   snapshot guards → classify → persist per D2 → return.
   The class docblock states **plainly what the proposal is and is not**: it is a diff and a
   recommendation; it issues nothing, contacts no provider, and confers no authority to issue.
   *Acceptance*: spec per outcome; a spec asserting the file references neither `issueCorrection`
   nor `CorrectionIssuer`.

6. **Wiring**: `ReturnsModule` imports `InvoicingModule`, provides + exports the service; barrel
   export from `libs/core/src/returns/index.ts`. The `ReturnsModule` docblock currently claims **four**
   real outbound edges — update it (and `architecture-overview.md § 22`) to **five**, naming
   `returns -> invoicing` and why it is acyclic (`InvoicingModule` imports only `IntegrationsModule`,
   `IdentifierMappingModule`, `SyncModule`, `SalesDocumentsModule`; none reaches `returns`).
   *Acceptance*: `no-second-proposal-mechanism.spec.ts` still passes (we add no returns-side ORM
   entity, repository or `OrderChangeRepositoryPort` import); `barrel-purity` and
   `check-cross-context-imports` clean.

### Phase 5 — Docs

7. `docs/architecture-overview.md § 22 Returns` gains one bullet (D1/D3/D4/D6/D8 in prose).
   No ADR: ADR-060 already decides *that* a disposed line proposes; ADR-044 owns the row; #1297 owns
   the snapshot rule. Nothing here is a new architectural position.

---

## 7. Alternatives Considered

1. **Match by `sku`.** Rejected: `InvoiceLine` has no sku field. Adding one would change an issued
   document's persisted shape retroactively and still leave every pre-existing snapshot unmatched.
2. **Auto-pick the lowest `originalLineNumber` when candidates are price-identical.** Rejected — D6.
   It stamps a specific line into a fiscal document on an amount coincidence, and a transmitted
   correction cannot be withdrawn.
3. **Refuse the whole proposal when any line is ambiguous.** Rejected: § 5.8 requires the ambiguous
   line rendered *alongside* the clean ones, and an all-or-nothing refusal makes the common
   partially-ambiguous return uncorrectable.
4. **`targetRef = returnId`** (matching #2333/#2372). Rejected — D1; it collides on the shared
   partial unique index and names the wrong subject.
5. **Read `InvoiceRecordRepositoryPort` directly.** Rejected: cross-context repository ports are a
   deny shape (§ Cross-context dependencies).

---

## 8. Validation & Risks

- ✅ Hexagonal: pure rule in `domain/domain-services/`, orchestration in `application/services/`,
  cross-context reads through `I*Service` only.
- ✅ Naming: `*.types.ts`, `*.domain-service.ts`, `*.service.interface.ts` + `*.service.ts`, `*_TOKEN`.
- ✅ No migration; `1863000000000` stays free.
- **Risk — stale proposal**: mitigated by D2 (abandon-and-reopen on divergence).
- **Risk — two return lines, one candidate**: named in § 5, deferred to the confirm act with reason.
- **Edge — zero disposed lines**: `no-disposed-lines`, no row.
- **Edge — snapshot with zero lines**: every line `no-match`/`no-line-by-name` → `nothing-correctable`.
- **Backward compatible**: additive union member, additive interface method, additive module edge.

---

## 9. Testing Strategy & Acceptance Criteria

**Unit** (`pnpm test`): the classifier (table-driven, the matrix the issue calls unusually heavy), the
service per outcome, the invoicing read, plus the no-issuance spec.

**Integration**: one boot assertion, and no more. The slice touches no schema, and the vertical slice
(receive → dispose → propose → confirm) belongs to #2376, which owns the route — but it *does* add a
new cross-context NestJS module edge (`ReturnsModule` → `InvoicingModule`), which is exactly the class
of change that fails at DI boot rather than at type-check. Assert that
`RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN` resolves from the booted graph, following the
`invoicing-auto-issue-boot.int-spec.ts` precedent that exists for the same reason.

**Acceptance criteria (from #2374)**
- [ ] A proposal never issues anything — asserted by spec.
- [ ] An ambiguous line lists **every** candidate; a no-match line states its reason.
- [ ] A correction-of-a-correction diffs against the prior correction's own lines (D7).
- [ ] Table-driven tests over matched/ambiguous/no-match; no boundary violations.

---

## 10. Alignment Checklist

- [x] Hexagonal architecture
- [x] CORE vs Integration boundary respected (no adapter resolved)
- [x] Existing patterns reused (no new abstraction)
- [x] Idempotency considered (D2; `openOrReuse` + `abandon`)
- [x] Error handling: throws only for the attribution seam; every other exit is a named value
- [x] Testing strategy complete
- [x] Naming + file structure per standards
- [x] Execution-ready

---

## Related Documentation

- [ADR-060 — returns aggregate above source projection](../architecture/adrs/060-returns-aggregate-above-source-projection.md)
- [ADR-044 — order mutations as proposed-then-confirmed changes](../architecture/adrs/044-order-changeset-proposed-then-confirmed.md)
- [ADR-026 — country-agnostic invoicing domain](../architecture/adrs/026-country-agnostic-invoicing-domain.md)
- [ADR-063 — per-line tax rate resolution and provenance](../architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md)
- `docs/specs/product-spec-oms-returns-operator-ux.md` § 5.8
- `docs/architecture-overview.md` § 14 Invoicing, § 22 Returns
