# Implementation Plan: refund confirmation + credit-note proposal review (#2382, `W2-44`)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days (L, reduced from the issue's three surfaces to two)

---

## 1. Task Summary

**Objective**: give the money panel its two operator surfaces — confirm a buyer refund (T6), and review a
credit-note proposal before an irreversible confirm (T7).

**Classification**: Frontend (Interfaces) **plus one additive backend read** (see § 2).

---

## 2. Scope, verified rather than assumed

### T10 is SPLIT OUT to #2642 (coordinator ruling)

The commission-refund block cannot be correct as specified. Its status is meant to be *"read from the
observed `rawStatus` timeline"*, but `ReturnRecord.rawStatus` is a **single current value** — the returns
context has exactly three tables (`returns`, `return_lines`, `return_line_events`) and none retains status
history. So the moment Allegro says anything later, the block reverts to **`Not claimed`** about money that
has already arrived, and § 5.7's stated value is precisely *noticing the refund land*. It would also look
right in a demo, because a staged return's last observed status is the one you just set. Its `Claim` action
additionally needs #2379, which is unstarted.

### Corrected sizing — T7 is served, T6 is NOT

Checked against the code rather than inferred, because "the write exists" is exactly the claim that was
wrong on #2381:

| Surface | Write | Read reaching the client | Verdict |
|---|---|---|---|
| T6 refund | `POST /returns/:returnId/refund` ✅ | **none** — no refund `GET` anywhere in the returns controllers; neither `ReturnResponseDto` nor the FE `ReturnDetail` carries a refund projection | **needs widening** |
| T7 proposal | `POST /returns/:returnId/correction-proposal` ✅ | `GET /returns/:returnId/correction-proposal` ✅ returning `outcome` + per-line `status` / `candidates` / `selectedOriginalLineNumber` / `noMatchReason` / `noMatchExplanation` / `candidatesPriceOrRateDiffer` | **fully served** |

So after confirming a refund, a reload would show nothing — #2381's defect exactly.

**The widening is small, and the schema anticipated it.** `RefundRecord` already carries `returnId`, and a
partial index **built for this read** already exists:

```
IDX_refund_records_return_id ON ('returnId') WHERE "returnId" IS NOT NULL
```

…but `RefundRecordRepository` has only `findByOrderId`. So: one repository method, one service method, one
projection.

**The by-order read cannot substitute**, for two reasons that belong in the plan rather than in a commit
message. An **orphan** return has no `internalOrderId` at all, so its refund panel would be permanently
empty — on exactly the returns most likely to need manual handling. And an order carrying **two** returns
would render each return's panel with the other's refunds: the same false-attribution shape as the per-act
`masterConnectionId` bug and the sku-keyed notice, both fixed in #2381. `findByReturnId` is required, not
tidier.

### In scope

- Backend: `findByReturnId` + `getRefundsForReturn` + a `refunds` projection on the return detail read.
- FE: the refund confirmation form, scoped for reuse (see § 3), and its mutation.
- FE: the credit-note proposal review, its ambiguity rendering, and the handoff.
- The FE `RefundReason` vocabulary, which **does not exist in `apps/web` at all** today.

### Out of scope

- T10 / the commission block (#2642), and #2379's claim write.
- Any change to `ReturnRefundService`'s report-don't-persist seam or to the money state machine.
- Issuing a correction. This surface hands off; it never calls `CorrectionIssuer`.
- The two pre-existing integration reds (#2638, #2639).

---

## 3. Where the shared refund form lives — NOT `shared/`

The issue specifies *"a shared refund form under `shared/`"*. **That placement is not available**, and the
rule that forbids it is explicit: `docs/frontend-architecture.md` § Dependency Rules states `shared` must not
import `features`, and § Components And Pages that *"shared components must not import feature modules"* /
*"Shared UI must stay domain-agnostic"*. A refund form is the opposite of domain-agnostic — it is built from
`RefundReason`, a locked order currency and a `RefundRecord` shape.

**It goes in `features/orders/components/` and is exported from the orders barrel**, consumed by returns as
`from '../../orders'` — the #2100 `sales-document-block-copy.ts` cross-feature shape, and the same one #2381
used. Orders is the right owner rather than returns: `refund_records` lives in the orders context, and
`IOrderRefundService` is an orders service. `orders` is already the most cross-imported feature barrel in the
app (§ Feature Public Surface names five consumers), so the slug is registered in both `no-restricted-imports`
groups already and no eslint edit is needed.

**The FE reason vocabulary lands beside it**, mirroring core's `RefundReasonValues` — grep finds **no
`RefundReason` in `apps/web` at all**, only a docblock reference in `returns.types.ts`. One home, exported
from the orders barrel, so the returns panel and the future order-level capture path cannot spell it two ways.

---

## 4. Architecture mapping

**Target layers**: `apps/web` Interfaces (primary); `libs/core/src/orders` (one repository + one service
method) + `apps/api/src/returns` (one DTO field).

**Existing services reused**: `IOrderRefundService`, `ReturnRefundService` (#2371), the correction-proposal
`GET`/`POST` (#2374/#2376), `useWriteAccess` / `ReadOnlyLock`, `Dialog`, `SegmentedControl`, RHF + Zod.

**Core vs Integration**: entirely core + interface. No adapter is resolved and no capability is narrowed.

**One new module edge**: `ReturnsReadApiModule` gains `OrdersModule` (§ 6 step 3). No new *core*
edge — `returns -> orders` already exists in `libs/core` and is real.

---

## 5. Questions & assumptions

### Open questions

*(None blocking. The two placement questions — T10's split and the form's home — are settled above, the
first by ruling and the second by a documented dependency rule.)*

### Assumptions, each checked

- **The `CorrectionIssuer` handoff target exists**, so the handoff is a route link and not a
  reimplementation (the issue's own Assumption). Verified: `invoiceCorrectionFlow` is a per-provider plugin
  contribution mounted by `OrderInvoicePanel` and `InvoiceDetailPage`, and the route is `/invoices/:invoiceId`.
  The proposal body carries `invoiceRecordId`, so the link is constructible without a further read.
- The refund panel reads `refunds` from the detail response; a mutation invalidates detail + list by prefix
  (the money rail and the segment counts both move).

---

## 6. Implementation plan

### Phase 1 — The one backend read

1. **`findByReturnId(returnId)`** on `RefundRecordRepositoryPort` + its repository, riding the existing
   partial index.
   - **Acceptance**: int-spec asserts it returns only that return's refunds where an order carries two returns.
2. **`getRefundsForReturn(returnId)`** on `IOrderRefundService` (never the repository port cross-context —
   the `getFailedSyncValueSummary` / `getEarliestOrderDateByConnection` precedent).
3. **`refunds` on the return detail read** — `ReturnResponseDto` + controller, projected explicitly
   (amount, currency, reason, note, recordedAt, executedBy; `idempotencyKey` omitted).
   - **It also carries the ORDER's currency, and the reason is not "another field".** The panel locks its
     currency input to it, and that lock is the only protection against a wrong currency reaching
     `RefundRecord` — no refund-side mismatch guard exists (step 5). The return detail response carries
     no currency today, so without this the field cannot be rendered read-only with a real value.
   - **This adds a NEW MODULE EDGE, and calling it "a projection" would hide that.** The write side
     needs nothing — `return-actions.module.ts:32` already imports `OrdersModule`. But the detail
     `GET` lives on `ReturnsController`, in **`ReturnsReadApiModule`, whose `imports` are
     `[ReturnsModule]` and nothing else**, deliberately: that module's docblock says the read and
     write halves are separate *because they inject different services*. So this step adds
     `OrdersModule` to `ReturnsReadApiModule.imports`.
   - It is acyclic and interface-layer — `OrdersModule` does not import `ReturnsModule`, and eight
     other `apps/api` modules already import it, an argument the write module's docblock already
     makes. But it is stated as an edge because **a reader auditing module boundaries greps for
     edges, not for projections.**
   - **Acceptance**: int-spec asserts `[]` before, and the recorded refund after `POST .../refund` —
     **on a re-read**, which is the property #2381 established.
   - **`executedBy` is projected and rendered**, because `'operator_out_of_band'` is the honesty device: the
     panel must be able to say OpenLinker did not move the money.

3b. **Add the exact-key allowlist the detail ENVELOPE has never had.**
   - **The gate went looking for it and it does not exist.** `returns.controller.spec.ts` asserts
     `Object.keys(...).sort()` over the **list row** (line 213) and the **line** (line 301), and
     nothing over `Object.keys(result)`. So adding `refunds` breaks no test — the **inverse** of
     #2381, where the row allowlist caught `restockBlocked` and did its job. "Nothing broke" is the
     symptom here, not the result.
   - **Three fields have already landed on that envelope unguarded** — `restockTarget` (#2380),
     `restockBlocks` and `restockAttestations` (#2381) — and nobody noticed across three consecutive
     issues, which is the evidence it will keep happening. The detail read is where money- and
     buyer-adjacent data lands, and T6 puts refund amounts on it.
   - **Write the allowlist from what the envelope CURRENTLY returns, and let it fail if that is not
     what was expected.** Do not derive it from `ReturnResponseDto` or from this plan's intent: the
     guard exists to catch a field arriving that nobody decided to expose, and an allowlist generated
     from the type it polices cannot do that. Run it first, read the actual key set, and only then
     decide whether every key on it belongs there.

### Phase 2 — The refund form (T6)

4. **`features/orders/lib/refund-reason.ts`** — the FE mirror of `RefundReasonValues` + labels, exported
   from the orders barrel.
5. **`features/orders/components/refund-confirmation-form.tsx`** — RHF + zodResolver, exported from the
   orders barrel for the future order-level path.
   - **The label is `Confirm refund`, never `Refund`.** OpenLinker does not move money; the operator does,
     and the form records it. The copy says so.
   - **Currency is display-only, never an input** — locked to the order's. An editable currency invites
     a record that disagrees with the money that actually moved.
   - **The lock IS the protection, because no refund-side guard exists.** An earlier draft of this plan
     cited an "existing refund-currency-mismatch guard"; there is none. The only `currency-mismatch` in
     the tree is `sales-documents`' threshold evaluator, an unrelated routing rule. `currency` is a
     REQUIRED input to `ReturnRefundService` and an ISO-4217-validated field on the confirm DTO, so
     nothing downstream catches a wrong one — which is why step 3 must carry the order's currency.
   - **The amount field starts EMPTY. It is not computed, and that is a decision, not a gap.**
     `ReturnLine` carries no price and no currency — its columns are sku/name/reason, four quantities,
     two states, a disposition, two timestamps and a note. Neither fallback is available: the order
     snapshot has line prices but reaching them needs `resolvedOrderLineId`, which **nothing in the tree
     populates**; and a sku match against the order's items is *technically available*, which is what
     makes it dangerous — two lines of one return can share a sku (the ambiguity #2374 refuses to
     resolve, and the shape #2381 fixed in the restock notice), so prefilling from it would put **a
     money figure derived from a coincidence** on the one surface where being wrong moves real money.
     An empty field is not a worse feature than a wrong number.
   - **The label settles it independently of computability**: `Confirm refund` confirms an amount the
     operator has ALREADY sent, so OpenLinker proposing one was the wrong shape regardless. Stated in
     these terms because a later reader who finds `resolvedOrderLineId` populated would otherwise read
     the empty field as a gap to close.
   - The order total renders **beside** the field as labelled context — named as the order total, never
     as a suggestion. It helps without asserting.
6. **`use-confirm-return-refund-mutation.ts`**, joining `use-return-custody-mutations.ts` if the invalidation
   contract is identical, or standing alone if it is not — decided by reading that module's docblock, not by
   default.
7. **The panel renders `refunds` from the read**, and `refunded` is **never** reachable from a button:
   `triggerRefund` writes `triggered`, and only an observation writes `refunded` (#2378's pinned rule).

### Phase 3 — The proposal review (T7)

8. **`return-correction-proposal-panel.tsx`** — leads with the irreversibility warning, renders per line
   `Matched` / `Ambiguous` / `No match`, and hands off.
   - **An ambiguous proposal is visually distinguishable BEFORE any confirm**, which is the issue's own AC
     and the whole reason the panel exists: `ambiguous` lists every candidate and selects none, because
     `originalLineNumber` is a 1-based array position and picking one on a price coincidence stamps a line
     number into a fiscal document.
   - `candidatesPriceOrRateDiffer` renders as evidence, never as a tie-break.
   - `no-match` renders its `noMatchReason` + `noMatchExplanation` — a line excluded silently is the
     `disposition-not-confirmed` case (a #2370 blocked restock) disappearing without saying so.
   - **A footer states that nothing here auto-issues**, and the handoff is a link to `/invoices/:invoiceId`.
   - **Mounting is a step, not a detail — and it is bigger than a barrel export.** The proposal is a
     separate `GET`, not a field on the detail read, so nothing fetches it by default: the panel needs
     an API method, a parse module, a query key, a query hook, a barrel export AND a mount. A
     component test cannot catch a missing mount (it renders the component itself), so the assertion
     lives in the PAGE test. The query is gated on attribution — the route answers 409 for an orphan,
     and asking anyway renders an error for a state the page already explains with its own banner.

### Phase 4 — Tests, checked BY NAME

Per the `docs/lessons.md` corollary (a promised test that was never written is indistinguishable from a
passing one), each of these is verified to exist by name before the work is called done:

- `refund-confirmation-form.test.tsx` — currency is not editable; `Confirm refund` copy; amount prefill.
- `return-correction-proposal-panel.test.tsx` — an ambiguous proposal is distinguishable from a clean one
  before the confirm; every candidate is listed; nothing auto-issues; the footer explains why.
- `returns-write-api.int-spec.ts` extension — `refunds` empty, then populated on a **re-read**; a
  two-return order does not cross-attribute.
- 375 px rendering for both panels.

---

## 7. Alternatives considered

**Put the form in `shared/ui`.** Rejected by a documented rule, not by taste — `shared` may not import
`features`, and the form is built from feature vocabulary.

**Reuse `getRefundsForOrder` and filter client-side.** Rejected: an orphan return has no order id, so it
would render permanently empty, and the filter would ship the sibling return's refunds to the browser.

**Render the commission block off the current `rawStatus`.** Rejected — that is #2642's whole subject.

---

## 8. Validation & risks

- **Architecture** ✅ — no new cross-context core edge (`returns -> orders` already exists and is real).
- **Risk — a refund recorded but its `RefundRecord` write failing.** Already handled by #2376: the route
  answers 2xx with `refundRecordWritten: false`, because the money state settled durably and reporting a
  failure would send the operator into a retry that answers 409. The panel must render that distinction
  rather than showing a plain success.
- **Risk — the panel implying OL moved money.** Mitigated by the `Confirm refund` label and by projecting
  `executedBy`.
- **Risk — an unreadable `refunds` array degrading to `[]`.** Empty must not assert "no refund was given":
  the array is parsed element-wise and an unreadable response reports rather than claiming.
- **Backward compatibility** ✅ — the backend change is one additive array field plus one additive
  port method.
- **Warning — `RefundRecordRepositoryPort` is a PORT, not an interface.** Adding a method is breaking
  for any out-of-tree implementer. Rated nominal, and the reason is specific rather than general:
  there is exactly one in-tree implementation, and this port is not published to plugin authors the
  way capability ports are.
- **Migration** — none. The column and its index already exist.

---

## 9. Acceptance criteria

- [ ] Refund form writes a linked `RefundRecord`; currency is not editable
- [ ] An ambiguous proposal is visually distinguishable from a clean one before any confirm (test)
- [ ] Nothing on this panel auto-issues; the footer says why
- [ ] Component tests for both; usable at 375 px
- [ ] The refund survives a reload (read-backed, not response-backed)
- [ ] The detail response envelope has an exact-key allowlist, written from what it actually returns
- [ ] *(T10's AC moves to #2642 — the coordinator owns that amendment)*

---

## 10. Alignment checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (one repository method on an existing index; the #2100 barrel shape)
- [x] Idempotency considered (#2376 owns the refund idempotency key)
- [x] Error handling comprehensive
- [x] Testing strategy complete, and named tests are checkable by name
- [x] Naming conventions followed
- [x] Plan is execution-ready

---

## Related documentation

- [Returns operator UX spec](../specs/product-spec-oms-returns-operator-ux.md) § 5.5–5.8
- [ADR-060](../architecture/adrs/060-returns-aggregate-above-source-projection.md)
- [Frontend architecture](../frontend-architecture.md) § Dependency Rules, § Feature Public Surface
