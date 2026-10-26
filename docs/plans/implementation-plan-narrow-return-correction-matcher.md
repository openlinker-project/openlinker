# Implementation Plan: Narrow `return-correction-matching.domain-service.ts` onto `ReturnLine.resolvedOrderLineId`

**Date**: 2026-09-21
**Status**: Ready for Review
**Estimated Effort**: 1-1.5 days (CORE + a small FE tone tweak)

**Issue**: [#3312](https://github.com/openlinker-project/openlinker/issues/3312)

---

## 1. Task Summary

**Objective**: Stop matching a disposed return line to an issued invoice's line by **product
name**, and match it deterministically by the order-line id the return already carries
(`ReturnLine.resolvedOrderLineId`, populated at ingestion by #3171/#3172) whenever that id is
present on the invoice's own line snapshot.

**Context**: Two identically-named invoice lines (an order that repeats one offer across two
lines) collide under name matching, and the operator has no more information to disambiguate than
the system does — the question is unanswerable, not merely hard. `resolvedOrderLineId` already
carries the answer for most return lines; nothing reads it.

**Design decisions already made** (per issue #3312 discussion — not re-litigated here):

1. **`InvoiceLine.orderLineId` is added in THIS plan's scope**, not sequenced after #3290. Nobody
   has started #3290 yet, so there is nothing to coordinate around; #3290 lands its own
   `lineKind` discriminator independently, whenever it starts.
2. **The residual case where no deterministic match exists** (an unresolved
   `resolvedOrderLineId`, or an invoice predating the `orderLineId` field) is surfaced as a **new
   value in the existing `ReturnCorrectionNoMatchReason` union**, rendered as a highlighted,
   non-blocking "no automatic match — needs manual review" row — **not** a candidate-picker list.
   `status: 'ambiguous'` (and its `candidates` list) simply stops being produced by the matcher;
   the type value is left in place (removing it is a separate, larger cleanup — see § 7).

**Classification**: CORE (Domain, Application), plus one small Interface-layer (frontend) tone
adjustment so the new reason reads as attention-worthy rather than as a neutral, camouflaged note.

---

## 2. Scope & Non-Goals

### In Scope

- Add `InvoiceLine.orderLineId?: string`, set by `toInvoiceLine` from `OrderItem.id`.
- Add `CorrectionSnapshotLine.orderLineId?: string` (the returns context's local restatement of
  `InvoiceLine` — see § 4) and thread `ReturnLine.resolvedOrderLineId` into
  `CorrectionReturnLineInput`.
- Rewrite `classifyOne` in `return-correction-matching.domain-service.ts` to try the id-based
  match first, falling back to today's by-name logic only when the id path cannot decide.
- Add `'ambiguous-invoice-line'` to `ReturnCorrectionNoMatchReasonValues` +
  `describeCorrectionNoMatchReason`, covering both the by-name-fallback-still-ambiguous case and
  (never actually reachable today, but structurally possible) an id match against more than one
  snapshot line.
- Update `toMatcherInput` (`return-correction-proposal.service.ts`) to pass
  `resolvedOrderLineId`.
- One small FE tone fix in `apps/web/src/features/returns/components/return-proposal-panel.tsx` +
  `lib/return-proposal.copy.ts` (the file that exists on `main` today — see § 4) so the new reason
  renders with a `warning` badge tone and is counted by the page-level "needs attention" banner,
  instead of silently reading as `neutral`/clean.
- Update `docs/architecture-overview.md` § 22 Returns (the "matcher still joins by product name"
  sentence).
- Tests: unit tests for the domain-service and the application service; no integration test
  needed (no new HTTP surface, no schema change — see § 4).

### Out of Scope

- `#3290` (delivery-line crediting) — untouched, unblocked by this plan, and this plan adds no
  edge to its work. `InvoiceLine.orderLineId` and #3290's eventual `lineKind` are two independent
  optional fields on the same struct; nothing here reserves the shape #3290 will use.
- Removing `'ambiguous'` from `ReturnCorrectionLineStatusValues` or the `candidates` field from
  `ReturnCorrectionProposalLine`. The matcher will simply never produce `status: 'ambiguous'`
  after this change; the type stays as-is so nothing already merged against it (any code
  pattern-matching `line.status === 'ambiguous'`) needs to change. A follow-up cleanup issue can
  retire the dead branch later — see § 7 Alternative 2.
- The unmerged frontend work on other branches (`correction-proposal-panel.tsx` / #3090-#3095) —
  those live on branches not yet on `main`; this plan touches the panel that **is** on `main`
  today (`return-proposal-panel.tsx`, shipped by #2382). Whoever rebases those branches picks up
  this change's reason value for free through the same `noMatchReasons` copy map pattern.
- A migration. `IssuedLineSnapshot` is a `jsonb` column
  (`invoice-record.orm-entity.ts:199`); `orderLineId?: string` is a pure, source-compatible type
  widening — an old row simply has the field absent on every line, which the fallback path
  already treats correctly (see § 6, Phase 1).

### Constraints

- **Must not break the by-name fallback's existing behaviour** for a line whose id path cannot
  decide — asserted by an existing-behaviour test, not by inspection (this plan's own AC).
- **No cross-context import** — `CorrectionSnapshotLine` stays a local restatement of the shape
  `InvoiceLine` carries (documented reason: "the classifier is a property of two shapes, not of
  the invoicing context"). This plan widens both types independently and keeps that separation.

---

## 3. Architecture Mapping

**Target Layer**: CORE — Domain (`domain/domain-services/`, `domain/types/`) and Application
(`application/services/`), in two contexts (`returns`, `invoicing`); one small Interface-layer
(frontend feature) touch.

**Capabilities Involved**: None — no port changes. This is a pure-function rule change plus one
type widening on an existing jsonb-backed value type.

**Existing Services Reused**:

- `classifyReturnCorrectionLines` / `classifyOne` (`return-correction-matching.domain-service.ts`)
  — modified, not replaced.
- `ReturnCorrectionProposalService.buildProposal` (`return-correction-proposal.service.ts`) —
  its `toMatcherInput` mapper gets one new field; no other change.
- `toInvoiceLine` (`order-to-issue-invoice-command.mapper.ts`) — gets one new field write.
- `describeCorrectionNoMatchReason` (co-located with the matcher, per the repo's `assertNever`
  exhaustiveness convention) — gets one new `case`.

**New Components Required**: None — this is a widening of three existing types
(`InvoiceLine`, `CorrectionSnapshotLine`, `CorrectionReturnLineInput`) and one new value in an
existing closed union (`ReturnCorrectionNoMatchReasonValues`).

**Core vs Integration Justification**: Entirely CORE. The matching rule is a pure domain service
(`libs/core/src/returns/domain/domain-services/`) with "no I/O, no injected dependency, no
framework import, no clock, no mutation of its arguments" per its own docblock; this plan
preserves that shape. No integration package is touched.

**Reference**: `docs/architecture-overview.md#hexagonal-architecture-structure`

---

## 4. External / Domain Research

### Internal Patterns (codebase search results)

**`InvoiceLine` has no id field today** — confirmed by reading the type and its one production
writer:

```typescript
// libs/core/src/invoicing/domain/types/invoicing.types.ts:382
export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPriceGross: number;
  taxRate: string;
  unit?: string;
}
```

```typescript
// libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts:264
function toInvoiceLine(item: OrderItem, orderId: string): InvoiceLine {
  // ...
  return {
    name: item.name?.trim() || item.sku || item.productId,
    quantity: item.quantity,
    unitPriceGross: item.price,
    taxRate: item.taxRate?.trim() ?? '',
  };
  // item.id is available on the parameter and is discarded.
}
```

`item.id` is the **exact same id** `ReturnLine.resolvedOrderLineId` points at (both are
`OrderItem.id` / `order.items[].id` values — see #3171/#3172's own description: "invoice line *N*
is `order.items[N-1]`"). It is available at the call site and simply never carried forward.

**The snapshot is `jsonb`, so widening `InvoiceLine` needs no migration**:

```typescript
// libs/core/src/invoicing/infrastructure/persistence/entities/invoice-record.orm-entity.ts:199
@Column({ type: 'jsonb', nullable: true })
issuedLineSnapshot!: IssuedLineSnapshot | null;
```

**`return-correction-matching.domain-service.ts` restates the invoice-line shape locally, on
purpose** (its own docblock): `CorrectionSnapshotLine` mirrors `InvoiceLine` field-for-field so the
matcher takes no cross-context import into `invoicing`. This plan follows the existing pattern —
widen `CorrectionSnapshotLine` independently, do not import `InvoiceLine`.

**The resolver (`return-order-line-resolution.domain-service.ts`) genuinely returns `unresolved`
on returns ingested TODAY**, not only historically — confirmed by reading its branches:

```typescript
// return-order-line-resolution.domain-service.ts (~line 164, 169, 223)
if (unitPrice === null) {
  return { status: 'unresolved', reason: 'ambiguous' };
}
// ...
return { status: 'unresolved', reason: byPrice.length === 0 ? 'no-candidate' : 'ambiguous' };
```

This is why the residual `ambiguous`-outcome design decision matters and is not merely a
migration-era edge case: `ReturnLine.resolvedOrderLineId` can be `null` on a brand-new return, so
the by-name fallback path is permanent, not transitional.

**`toShippingLines` never carries an order-item id** — its `InvoiceLine`s are synthesized from
`order.totals.shipping`, not from an `OrderItem`, so they legitimately never populate
`orderLineId`. This is exactly the boundary #3290 owns (delivery-line crediting); this plan does
not touch it and does not need to — a shipping line simply never participates in the id-based
match, and (being invisible to the return-side matcher entirely, since no `ReturnLine` points at
it) never reaches the by-name fallback either.

**`describeCorrectionNoMatchReason` is the single copy source, closed by `assertNever`**:

```typescript
// return-correction-matching.domain-service.ts:256
export function describeCorrectionNoMatchReason(reason: ReturnCorrectionNoMatchReason): string {
  switch (reason) {
    case 'no-line-name': return '...';
    case 'no-line-by-name': return '...';
    case 'quantity-exceeds-invoiced': return '...';
    case 'disposition-not-confirmed': return '...';
    default: return assertNever(reason, 'ReturnCorrectionNoMatchReason');
  }
}
```

Adding a member to `ReturnCorrectionNoMatchReasonValues` without adding a `case` here is a
**compile error**, which is exactly the guardrail this plan relies on to avoid a silent
fallthrough.

**The DTO layer already threads `noMatchReason` → `noMatchExplanation` generically** — no DTO
change needed:

```typescript
// apps/api/src/returns/http/return-writes.controller.ts:~618
noMatchExplanation:
  line.noMatchReason === null
    ? null
    : describeCorrectionNoMatchReason(line.noMatchReason),
```

**The FE panel that is actually on `main` today is `ReturnProposalPanel` /
`return-proposal-panel.tsx`** (shipped by #2382) — **not** `CorrectionProposalPanel` /
`correction-proposal-panel.tsx`, which exists only on unmerged feature branches for #3090+. This
plan's one FE touch targets the file that is really on `main`:

```typescript
// apps/web/src/features/returns/components/return-proposal-panel.tsx
const hasAmbiguity = proposal.lines.some((line) => line.status === 'ambiguous'); // page-level banner driver
// ...
tone={
  line.status === 'matched' ? 'success'
    : line.status === 'ambiguous' ? 'warning'
    : 'neutral'                                                                  // per-line badge tone
}
// ...
{line.status === 'no-match' ? (
  <p className="text-muted">
    {line.noMatchExplanation ?? (line.noMatchReason !== null
      ? RETURN_PROPOSAL_COPY.noMatchReasons[line.noMatchReason] ?? line.noMatchReason
      : null)}
  </p>
) : null}
```

**Why this needs a small FE change, not zero**: after this plan ships, `status: 'ambiguous'` is
never produced. Without a change, `hasAmbiguity` becomes permanently `false` and the page-level
banner silently downgrades to the "clean" state (`RETURN_PROPOSAL_COPY.cleanBanner`) even when a
line genuinely needs manual review — the opposite of "displayed and highlighted" that the design
decision calls for. The per-line badge would also render `neutral` (grey, unremarkable) for a
`no-match` line carrying the new reason, same visual weight as a routine, resolved exclusion like
`disposition-not-confirmed`. Both need one small, explicit fix (Phase 3 below); this is not scope
creep, it is the direct consequence of retiring the `ambiguous` status value's only producer.

---

## 5. Questions & Assumptions

### Open Questions

- None blocking. The reason-value name (`'ambiguous-invoice-line'`) is this plan's proposal;
  swap it for whatever reads better in review — it is a single string literal used in one
  `Values` array, one `case`, and one FE copy-map key.

### Assumptions

- An id-based match against **more than one** snapshot line is treated the same as the by-name
  fallback's ambiguous case (`'ambiguous-invoice-line'`), even though today's single mapper
  (`toInvoiceLine`, one call per `order.items` entry) can never actually produce two snapshot
  lines sharing one `orderLineId`. The branch is written anyway — a matcher that could
  silently swallow a duplicate id (picking the first) is worse than one that reports it, and the
  branch costs nothing to have permanently present per the repo's own "refuse rather than guess"
  convention (`return-correction-matching.domain-service.ts`'s own docblock, rule 1).
- A pre-`orderLineId` snapshot (every line's `orderLineId` is `undefined`) is treated identically
  to a resolved-but-not-found id: **fall through to by-name matching**, not a hard refusal. This
  differs from the original issue draft's "refuse with a named reason" framing (written before the
  scope was simplified to reuse the existing by-name path as the fallback rather than inventing a
  parallel refusal). Falling back to by-name matching for such a snapshot is **exactly today's
  shipped behaviour** — it is not a new guess, it is the absence of a new capability, which is a
  materially different and more defensible claim than "guessing at a line this build cannot
  trust." Recorded as Alternative 1 in § 7 for visibility.

### Documentation Gaps

- None. `docs/architecture-overview.md` § 22 Returns already documents the matcher's current
  by-name behaviour precisely enough to update in place (Phase 4 below).

---

## 6. Proposed Implementation Plan

### Phase 1: Widen `InvoiceLine` and its writer (`invoicing` context)

**Goal**: Make the order-line id available on every future issued document's line snapshot,
without touching persistence.

**Steps**:

1. **Add the field to `InvoiceLine`**
   - **File**: `libs/core/src/invoicing/domain/types/invoicing.types.ts`
   - **Action**: Add `orderLineId?: string;` to the `InvoiceLine` interface, with a doc comment
     explaining it is the order line this invoice line was built from (present only for a
     product line built from an `OrderItem`; absent for a synthesized line such as shipping).
   - **Acceptance**: `pnpm --filter @openlinker/core type-check` passes; the field is optional so
     every existing construction site (test fixtures, other mappers) remains valid without
     changes.
   - **Dependencies**: None.

2. **Set it in `toInvoiceLine`**
   - **File**: `libs/core/src/invoicing/application/mappers/order-to-issue-invoice-command.mapper.ts`
   - **Action**: In `toInvoiceLine(item, orderId)`, add `orderLineId: item.id` to the returned
     object.
   - **Acceptance**: A unit test asserts the mapped `InvoiceLine.orderLineId` equals the source
     `OrderItem.id` for a normal product line.
   - **Dependencies**: Step 1.

3. **Leave `toShippingLines` unchanged**
   - **File**: same mapper, `toShippingLines`.
   - **Action**: None — explicitly do not add `orderLineId` here. Document with a one-line
     comment why (no `OrderItem` backs a shipping line; #3290 owns crediting it).
   - **Acceptance**: Existing shipping-line tests are unaffected (no snapshot/assertion change).
   - **Dependencies**: Step 1.

### Phase 2: Widen the matcher's input types and rewrite `classifyOne` (`returns` context)

**Goal**: Resolve a return line's invoice line deterministically via
`resolvedOrderLineId` → `orderLineId` when possible; fall back to by-name matching otherwise;
report an unresolved outcome as a named `no-match` reason rather than as `status: 'ambiguous'`.

**Steps**:

4. **Widen `CorrectionSnapshotLine`**
   - **File**: `libs/core/src/returns/domain/domain-services/return-correction-matching.domain-service.ts`
   - **Action**: Add `orderLineId?: string;` to `CorrectionSnapshotLine`, matching `InvoiceLine`'s
     new field (kept as an independent, restated type per the file's own documented reason for not
     importing `InvoiceLine`).
   - **Acceptance**: Type-check passes; no runtime change yet.
   - **Dependencies**: Phase 1 complete (for the field to ever be populated in practice).

5. **Widen `CorrectionReturnLineInput`**
   - **File**: same file.
   - **Action**: Add `resolvedOrderLineId: string | null;` to `CorrectionReturnLineInput`.
   - **Acceptance**: Type-check passes.
   - **Dependencies**: None (independent of step 4).

6. **Add the new reason value**
   - **File**: `libs/core/src/returns/domain/types/return-correction-proposal.types.ts`
   - **Action**: Add `'ambiguous-invoice-line'` to `ReturnCorrectionNoMatchReasonValues`, with a
     doc-comment bullet in the existing enumerated list explaining: "the return line's order-line
     join is itself unresolved, or the join is resolved but no single invoice line can be
     identified from it or from the line's name — the operator must check the invoice by hand;
     this is never a picker, per #3091's retirement of the candidate-picker interaction."
   - **Acceptance**: Type-check passes (the union grows; nothing consumes it yet at this step).
   - **Dependencies**: None.

7. **Rewrite `classifyOne`'s resolution order**
   - **File**: `return-correction-matching.domain-service.ts`
   - **Action**: Restructure so the order of checks is:
     1. `hasUnconfirmedDisposition` → `no-match('disposition-not-confirmed')` (unchanged, first).
     2. `line.name === null || line.name.trim() === ''` → `no-match('no-line-name')`
        (unchanged — a line with no name at all cannot be reasoned about by *either* path, so
        this guard stays ahead of the new id-based attempt too; document why explicitly, since a
        future reader will otherwise wonder if the id path should run first here).
     3. **New**: if `line.resolvedOrderLineId !== null`, build (or reuse, memoized once per
        `classifyReturnCorrectionLines` call — see `indexSnapshotByName`'s existing precedent for
        a call-scoped index) a `Map<string, CorrectionSnapshotLine[]>` keyed by `orderLineId` over
        `snapshotLines` (skipping lines whose `orderLineId` is `undefined`), and look up
        `line.resolvedOrderLineId`:
        - **Exactly one snapshot line found, feasible** (`candidate.quantity >=
          line.quantityDisposed`) → `status: 'matched'`, `selectedOriginalLineNumber` = that
          line's 1-based position, `newQuantity` = `candidate.quantity - line.quantityDisposed`,
          `candidates: [candidate]` — **no name lookup performed**.
        - **Exactly one found, infeasible quantity** → `no-match('quantity-exceeds-invoiced')`,
          `candidates: [candidate]` (mirrors the existing by-name infeasible-quantity branch).
        - **More than one found** → `no-match('ambiguous-invoice-line')`, `candidates:` every
          match found (evidence, per the file's existing "every candidate is surfaced anyway"
          convention).
        - **None found** → fall through to step 4 (by-name matching) unchanged.
     4. Existing by-name logic runs **only when** either `line.resolvedOrderLineId === null` or
        the id lookup found nothing — with **one change**: where today's code returns
        `status: 'ambiguous'` (i.e. `feasible.length > 1`), return
        `no-match('ambiguous-invoice-line')` instead, carrying the same `candidates:` list as
        evidence (unchanged field population otherwise).
   - **Acceptance**:
     - A return line with a `resolvedOrderLineId` matching exactly one snapshot line's
       `orderLineId` is `matched`, and the by-name index is never consulted for it (assert via a
       spy/counter in the unit test, or by constructing a fixture where the by-name path would
       give a *different* wrong answer and asserting the id-based one wins).
     - A return line whose `resolvedOrderLineId` is `null` falls through to the **existing**
       by-name behaviour, byte-identical to before this change, for every existing test case.
     - A return line whose `resolvedOrderLineId` is set but matches no snapshot line's
       `orderLineId` (pre-field snapshot, or a stale id) falls through to by-name matching.
     - What used to assert `status: 'ambiguous'` now asserts `status: 'no-match'`,
       `noMatchReason: 'ambiguous-invoice-line'`, same `candidates` list.
   - **Dependencies**: Steps 4, 5, 6.

8. **Extend `describeCorrectionNoMatchReason`**
   - **File**: same file.
   - **Action**: Add `case 'ambiguous-invoice-line': return '...';` — operator-facing sentence,
     destination-neutral (ADR-026, per the function's own docblock), naming the fact plainly, e.g.
     "This return could not be matched to exactly one invoice line automatically. Check the
     invoice by hand before crediting it." (final wording subject to copy review — this string
     must still pass `check-ui-vocabulary` for whichever FE surface renders it).
   - **Acceptance**: `assertNever` compiles (the `switch` is exhaustive again); a unit test asserts
     the new case's string is non-empty and does not contain a forbidden vocabulary term.
   - **Dependencies**: Step 6.

9. **Thread `resolvedOrderLineId` from the caller**
   - **File**: `libs/core/src/returns/application/services/return-correction-proposal.service.ts`
   - **Action**: In `toMatcherInput`, add `resolvedOrderLineId: line.resolvedOrderLineId` to the
     returned `CorrectionReturnLineInput`.
   - **Acceptance**: A unit test on `ReturnCorrectionProposalService` (mocking the matcher's
     dependencies as it already does) confirms the field reaches `classifyReturnCorrectionLines`'s
     input unchanged from `ReturnLine.resolvedOrderLineId`.
   - **Dependencies**: Step 5.

### Phase 3: FE tone fix (the file that is on `main` today)

**Goal**: The new residual reason reads as attention-worthy, not as a routine, closed exclusion —
the "displayed and highlighted" the design decision calls for — with the existing `no-match`
rendering path otherwise doing all the work (no picker, no new component).

**Steps**:

10. **Extend the "needs attention" signal**
    - **File**: `apps/web/src/features/returns/components/return-proposal-panel.tsx`
    - **Action**: Change
      `const hasAmbiguity = proposal.lines.some((line) => line.status === 'ambiguous');`
      to also cover the new reason:
      `const hasAmbiguity = proposal.lines.some((line) => line.status === 'ambiguous' ||
      line.noMatchReason === 'ambiguous-invoice-line');`
      A local `const NEEDS_ATTENTION_NO_MATCH_REASON = 'ambiguous-invoice-line' as const;` (or a
      shared constant if this reads better co-located with the copy map) avoids a bare string
      literal duplicated across this check and the badge-tone check below.
    - **Acceptance**: The page-level banner (`ambiguousBanner` vs `cleanBanner`) renders the
      "needs attention" copy when at least one line carries the new reason, even though no line
      has `status: 'ambiguous'` anymore.
    - **Dependencies**: Phase 2 shipped (the reason value must exist to reference it).

11. **Extend the per-line badge tone**
    - **File**: same component.
    - **Action**: The badge tone expression
      `line.status === 'matched' ? 'success' : line.status === 'ambiguous' ? 'warning' :
      'neutral'` gains one more condition so a `no-match` line carrying the new reason also
      renders `warning`, not `neutral`:
      `line.status === 'matched' ? 'success'
        : line.status === 'ambiguous' || line.noMatchReason === 'ambiguous-invoice-line'
          ? 'warning' : 'neutral'`.
    - **Acceptance**: A component test renders a proposal with one `no-match` /
      `'ambiguous-invoice-line'` line and asserts the badge carries the `warning` tone class, not
      `neutral`.
    - **Dependencies**: Step 10 (same file, same constant if extracted).

12. **Add the FE copy-map entry**
    - **File**: `apps/web/src/features/returns/lib/return-proposal.copy.ts`
    - **Action**: Add an entry for `'ambiguous-invoice-line'` under `noMatchReasons` — this is the
      **fallback** copy used only if a future response's `noMatchExplanation` is somehow absent;
      the DTO already always populates it server-side (§ 4), so this entry is defensive, matching
      the existing pattern for the other three reasons.
    - **Acceptance**: `pnpm --filter @openlinker/web lint` (which runs `check-ui-vocabulary`)
      passes on the new string.
    - **Dependencies**: None (independent literal addition).

### Phase 4: Documentation

**Goal**: `docs/architecture-overview.md` § 22 Returns stops asserting the matcher is name-based
without qualification.

**Steps**:

13. **Update the architecture doc**
    - **File**: `docs/architecture-overview.md`, § 22 Returns
    - **Action**: Amend the sentence "the matcher still joins by product name and still emits
      `status: 'ambiguous'` with a `candidates` list" (and its neighbours describing the by-name
      matcher) to state the id-first, name-fallback order this plan ships, and note the residual
      case now surfaces as `no-match('ambiguous-invoice-line')` rather than `status: 'ambiguous'`.
    - **Acceptance**: A reviewer reading § 22 after this change no longer finds a statement that
      contradicts the shipped matcher.
    - **Dependencies**: Phase 2 shipped (so the doc describes real, not planned, behaviour).

---

## 7. Alternatives Considered

### Alternative 1: Hard-refuse a pre-`orderLineId` snapshot (the original issue draft's framing)

**Description**: Rather than falling back to by-name matching when a snapshot predates the
`orderLineId` field, refuse the line outright with a named reason (mirroring the `no-line-snapshot`
outcome's "refused, never diffed against the order's current state" posture).

**Why Rejected**: The `no-line-snapshot` precedent refuses because diffing against the order's
*current* state would be a genuinely new, riskier kind of guess than what the system already does.
Falling back to by-name matching for an old snapshot is not that — it is **exactly today's shipped
behaviour**, unconditionally correct for every return processed before this plan ships and for any
provider snapshot this plan does not touch. Refusing it would make this a regression for every
in-flight return whose invoice predates the new field, trading a real, working (if imperfect) match
for a guaranteed dead end, to prevent a risk (guessing) that was never actually present on this
specific path.

**Trade-offs**: The rejected alternative would have been marginally "safer" in the abstract sense
of refusing more often, at the direct cost of turning a currently-working match into a manual-review
item for every historical invoice — a strictly worse operator outcome for no correctness gain.

### Alternative 2: Remove `status: 'ambiguous'` from the type entirely

**Description**: Since the matcher will never produce `status: 'ambiguous'` after this change,
also delete the value from `ReturnCorrectionLineStatusValues` and the now-always-empty
"candidates to pick from" framing around it.

**Why Rejected**: This is a wider, breaking type change touching the DTO, the FE schema
(`return-proposal.schema.ts`), and every component that pattern-matches `status === 'ambiguous'`
across both the merged (`return-proposal-panel.tsx`) and several unmerged (#3090-#3095) branches.
It buys nothing functionally this plan needs — an unreachable union member costs nothing at
runtime — and would turn a scoped CORE-plus-one-FE-tweak change into a cross-cutting one that
also has to chase down every unmerged sibling branch. Filed as a follow-up cleanup instead of
folded into this plan.

**Trade-offs**: Leaves one dead, never-produced status value in the type system until the
follow-up lands. Accepted — it is inert, not incorrect.

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ The matcher stays a pure domain service — no I/O, no injected dependency, no clock added.
- ✅ No cross-context import introduced — `CorrectionSnapshotLine` remains a local restatement,
  widened in parallel with (never by importing) `InvoiceLine`.
- ✅ No port, adapter, or capability changes — this is a pure rule change plus type widening.

**Reference**: `docs/architecture-overview.md`

### Naming Conventions

- ✅ `orderLineId` follows the existing `resolvedOrderLineId` / `originalLineNumber` naming style
  already in this file family.
- ✅ `'ambiguous-invoice-line'` follows the existing kebab-case reason-value convention
  (`no-line-by-name`, `quantity-exceeds-invoiced`).

**Reference**: `docs/engineering-standards.md#naming-conventions`

### Existing Patterns

- ✅ New union member gated by `assertNever` — matches `return-custody-transitions`'s closed-switch
  convention cited in the matcher's own docblock.
- ✅ `describeCorrectionNoMatchReason` remains the single copy source (DTO passthrough unchanged).

### Risks

- **A real cross-invoice id collision** (two different orders' invoices sharing an `OrderItem.id`
  value): not possible under the current id-minting scheme (`identifier-mapping` service mints
  globally unique internal ids per `docs/architecture-overview.md § Identifier Mapping Service`),
  so the id-based lookup is safe to key on the bare id with no order-scoping. No mitigation coded
  defensively for this — it would be masking a defect elsewhere, not a real risk here.
- **A snapshot line whose `orderLineId` collides with another line's in the SAME invoice**: covered
  by the `no-match('ambiguous-invoice-line')` branch in step 7 (the "more than one found" case) —
  reported rather than silently resolved to the first hit.
- **Silent behaviour drift for the by-name-only path**: mitigated by an explicit
  byte-identical-fallback unit test (step 7's acceptance criteria), run against the *existing*
  test fixtures for `classifyReturnCorrectionLines` before adding any new ones.

### Edge Cases

- **`resolvedOrderLineId` set, snapshot has zero lines with any `orderLineId` at all** (every
  pre-field invoice) → falls through to by-name, unchanged behaviour (Alternative 1's rejection
  covers why this is correct, not merely convenient).
- **A `no-match` line with `hasUnconfirmedDisposition: true` and a resolved `resolvedOrderLineId`**
  → still exits at the FIRST check (`disposition-not-confirmed`), never reaching the id-based
  lookup — unchanged precedence, since that guard exists for a reason orthogonal to which invoice
  line would otherwise be found.
- **A line with an empty/null `name` but a resolved `resolvedOrderLineId`** → per step 7's design,
  still exits at the second check (`no-line-name`) before the id lookup runs. This is a genuine,
  deliberate design choice worth a reviewer's attention: it means a return line with no product
  name recorded is never matched even when its order-line join is perfectly known. Flagged here
  rather than silently decided, because the alternative (moving the id-check ahead of the
  name-empty check) is equally defensible and cheap to swap if review disagrees — the two guards
  are independent and reordering costs one line move.

### Backward Compatibility

- ✅ `InvoiceLine.orderLineId` and `CorrectionSnapshotLine.orderLineId` are both optional —
  every existing construction site (fixtures, other mappers, any out-of-tree code depending on
  the shape) remains valid.
- ✅ `ReturnCorrectionNoMatchReasonValues` grows by one member — additive, not breaking; consumers
  that already fall back gracefully on an unrecognised value (the FE panel's
  `RETURN_PROPOSAL_COPY.noMatchReasons[line.noMatchReason] ?? line.noMatchReason`) keep working
  even without the Phase 3 FE change, just with a raw-string fallback instead of nice copy.
- ⚠️ `status: 'ambiguous'` becomes unreachable in production going forward. Nothing breaks (the
  value stays in the type), but any manual QA script or E2E fixture asserting a *live* ambiguous
  state from real ingested data will need to seed the fixture pre-field or via a genuinely
  unresolved `resolvedOrderLineId`, since a fresh two-identical-lines order now resolves
  deterministically.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

- **File**: `libs/core/src/returns/domain/domain-services/__tests__/return-correction-matching.domain-service.spec.ts`
  - id-based match wins when it disagrees with what by-name would have picked (proves precedence,
    not merely that both paths individually work).
  - id-based match with an infeasible quantity → `no-match('quantity-exceeds-invoiced')`.
  - id-based match against two snapshot lines sharing an id → `no-match('ambiguous-invoice-line')`.
  - `resolvedOrderLineId: null` → existing by-name suite passes unchanged (regression guard).
  - `resolvedOrderLineId` set but unresolvable against the snapshot → falls through to by-name,
    same outcome as `null` would have produced for that fixture.
  - By-name fallback yielding >1 feasible candidate → now `no-match('ambiguous-invoice-line')`
    (replaces the old assertion of `status: 'ambiguous'`).
  - `describeCorrectionNoMatchReason('ambiguous-invoice-line')` returns a non-empty string.

- **File**: `libs/core/src/returns/application/services/__tests__/return-correction-proposal.service.spec.ts`
  - `toMatcherInput` forwards `ReturnLine.resolvedOrderLineId` verbatim (including `null`).

- **File**: `libs/core/src/invoicing/application/mappers/__tests__/order-to-issue-invoice-command.mapper.spec.ts`
  (existing file — confirm exact name before writing)
  - `toInvoiceLine` sets `orderLineId` from `OrderItem.id`.
  - `toShippingLines` output carries no `orderLineId` (explicit negative assertion, not merely
    absence-by-omission).

- **File**: `apps/web/src/features/returns/components/return-proposal-panel.test.tsx`
  - A proposal with one `no-match` / `'ambiguous-invoice-line'` line renders the `warning` badge
    tone and the page-level "needs attention" banner, not the clean-state copy.

### Integration Tests

- None required — no new HTTP surface, no schema/migration, and the existing
  `POST /returns/:returnId/correction-proposal` int-spec (if any) already exercises the endpoint
  end-to-end; this change is transparent to that contract (same DTO shape, one new possible
  `noMatchReason` string value).

### Mocking Strategy

- Domain-service tests: pure function, no mocks — direct fixture input/output assertions.
- Application-service test: mock the repository/port dependencies exactly as the existing spec
  already does; only the `toMatcherInput` mapping is new surface.

### Acceptance Criteria

- [ ] A disposed return line with a resolved, unique `resolvedOrderLineId` **and** a resolvable
      `InvoiceLine.orderLineId` is matched deterministically — no name-based lookup performed for
      it.
- [ ] The by-name fallback path (unresolved or out-of-range `resolvedOrderLineId`) is exercised
      and tested explicitly, and is byte-identical to today's behaviour for every pre-existing
      test fixture.
- [ ] The residual case (still unresolved after both paths) reports
      `no-match('ambiguous-invoice-line')`, never `status: 'ambiguous'`.
- [ ] The FE panel on `main` (`return-proposal-panel.tsx`) highlights the new reason with a
      `warning` tone badge and counts it toward the page-level "needs attention" banner.
- [ ] `docs/architecture-overview.md` § 22 Returns reflects the id-first, name-fallback order and
      the retirement of `status: 'ambiguous'` as a live outcome.
- [ ] Tests added or updated for non-trivial logic (all listed above).
- [ ] No architecture boundary violations (CORE ↔ Integration) — no cross-context import added.

**Reference**: `docs/testing-guide.md`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (pure domain service, unchanged application-layer wiring)
- [x] Respects CORE vs Integration boundaries (no integration package touched)
- [x] Uses existing patterns (no unnecessary abstractions — reuses `assertNever`, the
      `Map`-index-then-lookup shape `indexSnapshotByName` already establishes, the DTO-passthrough
      copy pattern)
- [x] Idempotency considered (pure function; no I/O to make idempotent)
- [x] Event-driven patterns used where applicable (n/a — no event emitted or consumed here)
- [x] Rate limits & retries addressed (n/a — no external call)
- [x] Error handling comprehensive (every new branch reports a named, non-throwing outcome — no
      new exception type needed, matching the existing file's "refuse rather than guess, reported
      as data" convention)
- [x] Testing strategy complete (§ 9)
- [x] Naming conventions followed (§ 8)
- [x] File structure matches standards (no new files — all changes land in existing files at
      their existing layer)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md) § 22 Returns
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Code Review Guide](../code-review-guide.md)
- Issue [#3312](https://github.com/openlinker-project/openlinker/issues/3312)
- Related, deliberately unsequenced: issue #3290 (delivery-line crediting)
- Superseded interaction this plan does not resurrect: issue #3091 (retired candidate-picker)
