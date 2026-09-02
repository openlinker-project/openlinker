# Readiness gate: returns write API (#2376)

**Date**: 2026-08-27
**Plan**: `docs/plans/implementation-plan-returns-write-api.md`
**Branch**: `2367-returns-custody`
**Verdict**: **NEEDS-REVISION** — no contract break; two additions the plan does not name, both small.

---

## 1. Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `ReturnActionsController` (write home) | **ALREADY EXISTS → extend** | `apps/api/src/returns/http/return-actions.controller.ts` — one route (`decline`), `@ApiBearerAuth` + `@ApiTags('returns')` + `@Controller('returns')`, actor from `@CurrentUser()` |
| `ReturnActionsApiModule` | **ALREADY EXISTS → extend** | `apps/api/src/returns/return-actions.module.ts`; sibling `ReturnsReadApiModule` holds the reads |
| `@Roles('admin','operator')` write guard | **ALREADY EXISTS → reuse** | the `decline` route's own decorator. **No `returns:*` permission value exists**, and both `ReturnsController`'s docblock and #2372 record that as deliberate — the plan's D5 is correct, add none |
| `ReturnsExceptionFilter` | **PARTIAL → extend** | `apps/api/src/common/filters/returns-exception.filter.ts` maps 4 exceptions; the 9 this surface raises are **all unmapped** and would answer 500 today. Registered in `main.ts` **and** in the int harness (`apps/api/test/integration/setup.ts:43`), so extending it needs no wiring change |
| `IReturnCustodyService` / `IReturnRefundService` / `IReturnAuthorizeService` / `IReturnsService` / `IReturnCorrectionProposalService` | **ALREADY EXISTS → reuse** | all five present and barrel-exported; every input/result type this surface needs is declared |
| `RestockBlockedDetail` (the 2xx-body AC) | **ALREADY EXISTS → reuse** | `return-custody.service.interface.ts` — already carries `quantity`, `sku`, `connectionName`, and its docblock states it is *"Returned in the 2xx body of #2376's dispose response, not as an error"* |
| `ReturnCustodyTransitionError.reason` (the 409-code AC) | **ALREADY EXISTS → reuse** | closed union `over-receipt`/`over-disposition`/`illegal-transition`/`non-positive-quantity`/`partially-received`; its docblock literally anticipates *"#2376 answers 409 with a code the frontend can branch on"* |
| `ORDER_REFUND_SERVICE_TOKEN` / `IOrderRefundService.recordRefund` | **ALREADY EXISTS → reuse** | `orders.tokens.ts:25`, exported from `OrdersModule` (`orders.module.ts:156`) |
| `previewProposal` on `IReturnCorrectionProposalService` | **NEW (confirmed absent)** | the interface has only `buildProposal` |
| `POST /returns/:id/commission-refund/claim` | **NO BACKING SERVICE** | grep for `commission` across `libs/` + `apps/`: only Allegro's raw `COMMISSION_REFUNDED` / `COMMISSION_REFUND_CLAIMED` status strings (stored verbatim, never interpreted) and one docblock citation. **No service, port or domain type.** The plan's D3 omission is correct and is now evidence-backed |
| A migration | **NOT NEEDED** | interface layer only. **Slot `1863000000000` stays free** |

---

## 2. Backward-compatibility findings

### W-1 (Warning) — `DuplicateRefundRecordException` is reachable from the refund route and the plan does not mention it

`CreateRefundRecordInput` carries an optional `idempotencyKey`, guarded by the partial unique index
`UQ_refund_records_order_idempotency (internalOrderId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`,
and `recordRefund` raises `DuplicateRefundRecordException` on a collision. That exception is mapped
**per-controller**, not globally — `apps/api/src/orders/http/refunds.controller.ts:98` catches it locally
and answers 409.

Two consequences the plan must state:

1. **It is an `orders` exception, so `ReturnsExceptionFilter` will not catch it** (that filter `@Catch`es
   returns errors only). The returns refund route needs the **same local catch** the orders refunds
   controller uses. That is not a convention violation: the returns "global filter, never a local catch"
   rule is about *returns'* own domain errors.
2. **Whether to send an `idempotencyKey` at all is a decision, not an oversight.** In practice the
   #2371 claim guard already prevents a second write — a retried `triggerRefund` finds no attemptable
   line and returns `refundRecordIntent: null` — so a key is defence-in-depth. Recommend passing a
   deterministic per-attempt key derived from the claimed line ids, and recommend against trying to make
   the endpoint retry-write the record: the documented survivable failure is *"line `triggered`, no
   record"*, whose remediation is the existing `POST /orders/:id/refunds` capture endpoint.

### W-2 (Warning) — the new `ReturnActionsApiModule → OrdersModule` import is acyclic, but say so

`OrdersModule` does **not** import `ReturnsModule` (grep: zero hits), and eight `apps/api` modules already
import `OrdersModule`, so this is ordinary interface-layer composition with no cycle. Worth a comment on
the module: the core rule this looks like it might breach (`OrdersModule` must never enter
`ReturnsModule.imports`) is about **core**, and is untouched — `apps/api` sits above both.

### CLEAR — no contract break anywhere

- **Barrels**: nothing removed or renamed; `previewProposal` is additive with **one** implementer and
  **no** `jest.Mocked<IReturnCorrectionProposalService>` doubles in the tree, so unlike #2374's
  `IInvoiceService` widening it breaks no existing spec.
- **DTOs**: every DTO is new; the Wave-1c response DTOs are untouched.
- **Tokens**: none added or renamed.
- **ORM schema**: unchanged; no migration.
- **`check:invariants`**: `check-service-interfaces` walks `libs/core/**/application/services/*.service.ts`
  and the service already implements its interface; `check-cross-context-imports` sees only `I*Service` +
  `*_TOKEN` allow-shapes from `apps/api`, which is in scope for that walker and satisfied.
- **`check-ui-vocabulary`** does not scan `apps/api`, so Swagger prose is unaffected.

---

## 3. Open questions

1. **The `ReturnMatchRefusedError` 409/400 split** (plan D4) is right, but note `ReturnRecordRefusedError`
   carries `unknown-order` too and the plan maps that class wholly to 400. Both are defensible under the
   plan's own stated rule (404 = addressed resource absent, 409 = its state refuses, 400 = payload
   inapplicable) because on `record` there is no addressed return at all — the payload is the whole
   request. Worth one sentence so the asymmetry does not read as an inconsistency.
2. **Route-order hazard**: `ReturnsController` already declares `GET /returns/ingestion-availability`
   *before* `GET /returns/:returnId` deliberately. The new `POST /returns/record` is a literal segment on
   the same prefix and must not be shadowed by a `:returnId` route. Nest matches per-controller in
   declaration order, and `record` lives on the actions controller while no `POST /returns/:x` bare route
   exists — so this is currently safe, but declare `record` first anyway.
3. **The AC's integration test cannot be run this session** (Docker wedged host-wide). Plan already says
   so; it must be compile-verified against the real api tsconfig, since
   `apps/api/tsconfig.type-check.json` excludes `test/`.

---

## 4. Verdict

**NEEDS-REVISION.** Every service, guard, error union and result shape the plan reaches for exists and is
shaped for exactly this use — several of them were written with #2376 named in their docblocks. The
commission-refund omission is now evidence-backed rather than assumed. Two additions make the plan
executable as written: (a) the `DuplicateRefundRecordException` local catch on the refund route plus an
explicit decision on `idempotencyKey`; (b) a one-line note that the `OrdersModule` import is
interface-layer and acyclic. The three open questions are clarifications, not blockers.
