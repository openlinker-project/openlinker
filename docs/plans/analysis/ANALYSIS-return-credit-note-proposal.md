# Readiness gate: credit-note correction proposal (#2374)

**Date**: 2026-08-27
**Plan**: `docs/plans/implementation-plan-return-credit-note-proposal.md`
**Branch**: `2367-returns-custody`
**Verdict**: **NEEDS-REVISION** — one Critical, mechanically resolvable; everything else clears.

---

## 1. Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `ReturnCorrectionProposalService` + interface | **NEW** | zero hits for `CorrectionProposal` / `correction-proposal` / `proposeCorrection` / `RETURN_CORRECTION` in `libs/` or `apps/`. `credit-note` exists only as an invoicing `DocumentTypeValues` member — a document type, not a proposal concept |
| Pure line-matching classifier | **NEW** | `originalLineNumber` has ~20 consumers, all of them the invoicing **correction-delta applier** (`InvoiceService.issueCorrection` builds `Map<originalLineNumber, delta>` and applies it onto the snapshot) plus its DTOs, adapters and FE picker. Nothing anywhere *matches* return lines to invoice lines |
| `return-correction-proposal.types.ts` | **NEW** | no returns type file references corrections |
| `RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN` | **NEW** *(but see C-1)* | `returns.tokens.ts` holds 9 tokens, none correction-related |
| `IInvoiceService.getLatestIssuedInvoiceForOrder` | **NEW** | the interface's 10 methods include `getLatestInvoiceForOrder`, which is explicitly **status-agnostic** ("most recently created"), and `findBlockingInvoiceForOrder`, which answers the #2047 question. Neither is "the latest ISSUED document" |
| `InvoiceRecordRepositoryPort.findAllByOrderId` | **ALREADY EXISTS → reuse** | `invoice-record.repository.ts:97`, already ordered `createdAt DESC, id DESC`. **No repository-port change needed**, as the plan assumes |
| `assertAttributedForTrigger('invoice_correction')` | **ALREADY EXISTS → reuse** | already a member of `ReturnDownstreamTriggerValues`, with no caller until now |
| `IOrderChangeService` (`openOrReuse` / `abandon` / `confirm` / `findLatestByTarget`) | **ALREADY EXISTS → reuse** | `ReturnAuthorizeService` is a working template for the whole cycle |
| `order_changes` table + `kind` column | **ALREADY EXISTS → reuse** | `varchar(64)`, no PG enum, no CHECK (migration `1849000000009` confirms) |
| Migration slot `1863000000000` | **NOT NEEDED** | confirmed: no schema change in this slice |
| `assertNever` | **ALREADY EXISTS → reuse** | `@openlinker/shared/types` |
| `domain-services/` pure-function precedent | **ALREADY EXISTS → reuse** | `return-custody-transitions.domain-service.ts` argues the exact "pure, deliberately not a service" position the plan adopts |

---

## 2. Backward-compatibility findings

### C-1 (CRITICAL) — the planned token name fails an existing spec

`libs/core/src/returns/__tests__/no-second-proposal-mechanism.spec.ts` asserts:

```ts
const tokenNames = Object.keys(returnsBarrel).filter((n) => n.endsWith('_TOKEN'));
const offenders = tokenNames.filter((n) => /PROPOSAL|CHANGESET|CHANGE_REPOSITORY/.test(n));
expect(offenders).toEqual([]);
```

`RETURN_CORRECTION_PROPOSAL_SERVICE_TOKEN` matches `/PROPOSAL/` and **fails the suite on the day the
code lands**.

The test's own name is `should expose no proposal-store token`, and its docblock names the failure it
guards: a *second store* for "what did the operator ask for". A service token that computes a proposal
and persists it **through `IOrderChangeService`** is not a store — the regex is blunter than the rule
it encodes.

Two resolutions, and only one is acceptable:

- REJECTED — rename the token to dodge the grep (`RETURN_CREDIT_NOTE_SERVICE_TOKEN`). That hides the
  artifact from the guard rather than satisfying it, and mis-names the thing: the issue, ADR-060 and
  the product spec all call it a proposal.
- ADOPT — **narrow the regex to express what the test's own name says**:
  `/PROPOSAL_(REPOSITORY|STORE)|CHANGESET|CHANGE_REPOSITORY/`, in the same commit, with a comment
  recording that #2374 added a proposal *service* token and why that is not a second mechanism.

The other three assertions are the load-bearing ones and all still bind to #2374's code:
1. the kind lives on `OrderChangeKindValues` — **extend this assertion to `return.invoice_correction`**;
2. no proposal-shaped ORM entity / repository / port under `returns/` — passes as planned (the new
   files are `.types.ts` / `.domain-service.ts` / `.service.ts` / `.service.interface.ts`, none of
   which matches the filename regex);
3. no returns-side `OrderChangeRepositoryPort` import — passes.

**The plan must name this edit as an explicit step.** Silently widening a guard while it is red is the
worst of the available options.

### W-1 (Warning) — `OrderChangeKindValues` widening: verified safe

Every consumer: `order-change.types.ts` (definition), `order-change.service.{ts,interface.ts}`,
`order-change.repository.ts`, `order-change.orm-entity.ts` (comment only),
`order-change-repository.port.ts`, `order-change.entity.ts`, `orders/index.ts` (re-export), the returns
spec above, and migration `1849000000009`.

**No exhaustive `switch`, no `Record<OrderChangeKind, …>`, no `apps/web` mirror, and no
`scripts/check-*.mjs` invariant guards this union** (explicitly grepped for `Record<OrderChangeKind`
and `case 'return.decline'` — zero hits; `order-change.service.ts` reads and logs `.kind` and never
switches on it). Adding a third member compiles and changes no behaviour. No migration.

### W-2 (Warning) — `IInvoiceService` gains a required method: THREE spec files need a line each

Sharper than the plan assumed. One real implementer (`InvoiceService`), but **three test doubles are
typed `jest.Mocked<IInvoiceService>`** — a mapped type over the *whole* interface, so each fails to
type-check until the new method is added to the mock literal:

- `apps/api/src/orders/http/orders.controller.spec.ts`
- `apps/api/src/invoicing/http/invoicing.controller.spec.ts`
- `apps/worker/src/sync/handlers/invoicing-issue.handler.spec.ts`

(`fiscal-registration.service.spec.ts` is safe — it uses `Pick<IInvoiceService, …>` + `as unknown as`.)

Add the three mock entries in the same commit. Still additive and low-risk, but it is three files, not
zero. Note also that a **required** method on a barrel-exported interface is technically a break for an
out-of-tree implementer; ADR-026 positions `IInvoiceService` as an internal application seam (adapters
implement `InvoicingPort`, untouched), so this matches every prior widening.

### CLEAR — the new `returns → invoicing` module edge is acyclic

`InvoicingModule.imports = [TypeOrmModule.forFeature([…]), IntegrationsModule,
IdentifierMappingModule, SyncModule, SalesDocumentsModule]` — none reaches `returns`, and
`InvoicingModule` never imports `ReturnsModule`. `INVOICE_SERVICE_TOKEN` **is** in
`InvoicingModule.exports`; `InvoicingModule` **is** exported from `libs/core/src/invoicing/index.ts`.
The rule that matters (§ 22: `OrdersModule` must never enter `ReturnsModule.imports`) is untouched —
the plan reaches `order_changes` through `OrderChangesModule`, exactly as #2333/#2372 do.

### CLEAR — `check:invariants`

- `check-cross-context-imports`: `IInvoiceService` (`I*Service`) and `INVOICE_SERVICE_TOKEN` (`*_TOKEN`)
  are allow shapes; the plan explicitly refuses `InvoiceRecordRepositoryPort` (a deny shape).
- `check-architecture-gates`: the other script sensitive to a new module edge — the edge is acyclic and
  one-way, so nothing to trip.
- `check-service-interfaces`: satisfied (service + sibling `.service.interface.ts`).
- `check-migration-timestamps`: no migration.
- `barrel-purity`: `returns` is correctly absent from `ZERO_SIBLING_EDGE_LEAVES`, so a fifth outbound
  edge trips nothing — but **the `ReturnsModule` docblock says "four real outbound edges" and must be
  updated to five**, as must § 22 of `architecture-overview.md`.

### CLEAR — no `apps/web` mirror

Zero hits for order-change kinds or correction proposals in `apps/web/src`. #2382 authors the FE fresh.

---

## 3. Open questions

1. **`nothing-correctable` opens no row.** Confirm #2376's `GET` can return a proposal body with
   `changeId: null`. The plan's result shape allows it; the DTO must too.
2. **Two return lines resolving to one candidate.** Deferred to the confirm act with reason — correct,
   but #2376/#2382 must be told, since aggregating two deltas onto one `originalLineNumber` is theirs
   and sending two would be a provider-visible defect (`InvoiceService.issueCorrection` builds a
   `Map` keyed on that number and **silently drops the duplicate**).
3. **`ReturnLine.name` nullability** — classified `no-match` / `no-line-name`; worth one sentence of
   operator copy so it does not read as a system fault.

---

## 4. Verdict

**NEEDS-REVISION.** The design is sound, every reuse assumption checks out against the live tree, the
new module edge is acyclic and one-way, and no migration is needed. But C-1 is a red test on landing,
and its resolution — narrowing an existing guard's regex rather than renaming the token — is a
deliberate act that belongs in the plan, not in a surprise diff. Three additions make the plan
executable as written: (a) the guard edit as an explicit step, with its kind assertion extended to
`return.invoice_correction`; (b) the three `jest.Mocked<IInvoiceService>` mock updates; (c) the
`ReturnsModule` docblock and § 22 edge count moved from four to five.
