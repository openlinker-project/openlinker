# Implementation Plan: Per-line return receive and dispose flows (#2380, `W2-42`)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days (L)

---

## 1. Task Summary

**Objective**: give the operator the two per-line acts the whole returns custody model exists to
record — *what physically arrived* (receive) and *what became of it* (restock / scrap) — as inline
forms on `/returns/:id`, usable at a warehouse bench on a tablet.

**Context**: Wave 1c shipped the counters and Wave 2 (#2376, `W2-39`) shipped their write API. Both
are inert from the UI: `ReturnLinesTable` renders `quantityAdvised` / `quantityReceived` read-only
and nothing in `apps/web` calls `POST .../receive` or `.../dispose`. This issue is the surface story
T4/T5 are judged on.

**Classification**: Frontend (Interfaces), **plus two small backend additions** — see § 2.

---

## 2. Scope & Non-Goals

### The premise check — two gaps between the issue and the shipped backend

The coordinator's standing rule is *check the issue's premise before building to it*, and *a control
the backend cannot serve is dead code that type-checks*. Two of the issue's own solution lines have
no backend today.

**Gap 1 — `Mark remainder not returned` has no route, and the model refuses its literal reading.**
`markReturnCustodyNotReturned` is shipped and exported (#2367,
`return-custody-transitions.domain-service.ts`), but it has **no application-service caller and no
HTTP route** — `grep` finds only the barrel re-export and two docblock mentions. More important, the
shipped rule **refuses a partially received line** (`partially-received`), and its docblock states
why at length: custody is single-valued per line, there is no `quantityNotReturned` counter, and the
shortfall stays visible as `quantityAdvised − quantityReceived`. So the action is **not** "mark the
*remainder* not returned"; it is *"mark this line not returned"*, available only where nothing
arrived. Naming the control after the remainder would promise a shortfall write the model refuses.

**Gap 2 — the dispose copy cannot name the connection.** Returns spec § 5.3 requires, under the
Restock option, *"Stock will be added in **{connection name}**."*, and calls that "the difference
between an operator trusting the number and going to check it by hand". The detail read
(`ReturnResponseDto`) carries no such field; the connection name reaches the client **only** on a
`restockBlocked` response, i.e. after the write already failed. The FE cannot derive it either:
`ReturnCustodyService.resolveInventoryMaster` takes `entries[0]` from `listCapabilityAdapters`
(which *constructs* adapters), so a client-side `enabledCapabilities.includes('InventoryMaster')`
pick could name a different connection than the one actually written to — worse than saying nothing.

### Recommendation — option (A), widen to include both backend halves

Both are small and both are strictly additive:

- `POST /returns/:returnId/lines/:lineId/mark-not-returned` — one `ReturnCustodyService` method
  wiring the already-shipped pure rule through the existing transactional write path, one route on
  `ReturnWritesController`, reusing the shipped `ReturnsExceptionFilter` 409 mapping.
- `ReturnResponseDto.restockTarget: { connectionId, connectionName, ambiguous } | null` — resolved
  by the same `resolveInventoryMaster` the write uses, so **reported === written to** structurally
  (the #2229 rule), with `null` meaning "no inventory master resolves" and the dispose copy then
  saying so instead of naming nobody.

Option (B) — ship FE only — drops the not-returned control entirely and renders the Restock option
with no destination named. That fails the issue's own Proposed Solution on both counts and § 5.3's
canonical copy. **This is the scope question for the coordinator; it is stated, not self-authorized.**

### In Scope

- Inline per-line **receive** form (RHF + `zodResolver`, `generate-label-form.tsx` conventions).
- `Receive all as advised` bulk pre-fill behind an explicit confirm.
- Over-receipt blocked client-side with § 5.2's message, and server-side (already shipped).
- Inline per-line **dispose** form: quantity, `Restock | Scrap` `SegmentedControl`, optional note,
  destination-naming copy.
- `Mark as not returned` per-line action (renamed per Gap 1), plus its backend route.
- `restockTarget` on the detail read, plus its FE consumption.
- Tablet-first: ≥44 px targets, interactive at 768 px, the § 5.2 declared style-guide departure
  restated in the component docblock.
- Component tests for both forms + an int-spec for the new route.

### Out of Scope

- `restock_blocked` surfacing and `Mark stock handled manually` (spec § 5.4) — its own surface, and
  the `markStockHandled` route already exists; wiring it is a sibling issue, not this one.
- The money panel, refund trigger, commission block (§ 5.7), correction proposal (§ 5.8).
- Any change to the custody transition rules, the counters, or the invariant constraint.
- A `quantityNotReturned` column — explicitly refused by #2367's adjudication.

### Constraints

- Migration slot `1863000000000` is reserved for this branch and **is not needed**: no schema change.
- No `any`, no `console.log`, no `--no-verify`, no `synchronize: true`.
- Node 22 LTS for every gate invocation.

---

## 3. Architecture Mapping

**Target Layer**: primarily `apps/web` Interfaces; the two additions are `libs/core/src/returns`
(application) + `apps/api/src/returns` (interface).

**Capabilities Involved**: `InventoryMaster` (read-only, for the destination disclosure — resolved
by the existing service, never by the client).

**Existing Services Reused**: `ReturnCustodyService` (receive / dispose / attest — all shipped),
`markReturnCustodyNotReturned` (shipped pure rule), `ReturnsExceptionFilter`, `useWriteAccess` /
`ReadOnlyLock`, `DataTable`, `SegmentedControl`, `FormField` / `FieldError` / `FormErrorSummary`.

**New Components Required**: one core service method, one route + two DTO fields, and the FE forms,
hooks and copy listed in § 6.

**Core vs Integration Justification**: nothing new crosses the boundary. The destination disclosure
reads a capability through `IIntegrationsService` inside `returns`, exactly as the write already
does; no adapter learns anything about returns.

---

## 4. External / Domain Research

No external system. Internal precedents that govern the shape:

- `generate-label-form.tsx` (#769) — the inline-expansion RHF form named by spec § 5.2, including
  `<fieldset disabled>` while pending and `FormErrorSummary` placement.
- `return-decline-action.tsx` (#2336) — the returns write posture: always visible, disabled with a
  reason, `useWriteAccess('orders:write', demoMode)` + `ReadOnlyLock`, never re-derived availability.
- `#2229` — reported must equal enforced, structurally, via one function with two callers.
- `#2378` (this branch) — segment/filters/rails, whose `ReturnLineStateChip` the table already uses.

---

## 5. Questions & Assumptions

### Open Questions (for the coordinator)

1. **§ 2's option (A) vs (B).** Recommendation: (A). The readiness gate confirmed both backend
   halves are genuinely absent and genuinely small — `runLineWrite`, the exception filter and the
   `resolveInventoryMaster` resolver are all already there. (B) ships two controls that cannot tell
   the truth.
2. **Control naming.** Recommendation: `Mark as not returned`, shown only when
   `quantityReceived === 0`, with the shortfall case explained in place rather than offered as an
   action the server will 409.
3. **Is a source-reported line with `quantityAdvised === 0` reachable?** It decides whether the
   quantity refusal above is a real branch or a defensive one, and it also affects the receive
   form's default (`advised − received` would be `0`, which the shipped DTO rejects at `@Min(1)`).

### Assumptions

- `orders:write` is the right permission (matches `return-decline-action.tsx`); returns have no
  permission of their own.
- The detail query is invalidated after each write (`returnsQueryKeys.detail`), and the list too
  (`returnsQueryKeys.all`) because the segment counts move.
- The `restockBlocked` field of a 2xx dispose response is surfaced in this slice only as a **toast +
  a persistent inline row placeholder**; its full § 5.4 treatment (the three surfaces, the explainer
  disclosure, the attestation) is the sibling issue. Rendering nothing at all would be worse — the
  operator would read a plain success for a stock write that did not happen.

### Documentation Gaps

- Spec § 5.2's *"Mark remainder not returned"* is contradicted by the shipped model (#2367). The
  plan resolves in favour of the code and records the divergence; a spec amendment is a follow-up.

---

## 6. Proposed Implementation Plan

### Phase 1 — Backend: the two additions

1. **`ReturnCustodyService.markLineNotReturned(lineId, { actorUserId, note })`**
   - **File**: `libs/core/src/returns/application/services/return-custody.service.ts`
   - **Action**: load the line, call `markReturnCustodyNotReturned`, persist through the same
     transactional path `receiveLine` uses, record a line event. The pure rule already throws
     `ReturnCustodyTransitionError` with `partially-received` / `illegal-transition`; the service
     adds nothing to it.
   - **Acceptance**: unit spec covers both refusals and the happy path.
   - **A new `ReturnLineEventKind` member is unavoidable, and it gets NO compile-time help.**
     `runLineWrite` requires an act (`return-repository.port.ts:373`) — there is no
     move-custody-without-recording path — so `not_returned` joins `ReturnLineEventKindValues`
     (`return-line-event.types.ts:46`). The readiness gate confirmed the union has **no**
     `assertNever` switch, no exhaustive `Record`, and reaches persistence through an unchecked
     `entity.kind as ReturnLineEventKind` cast (`return.repository.ts:1402`). So the compiler will
     not name the sites to update: every consumer of the kind must be found by grep, deliberately,
     and this step should close that gap rather than widen it.
   - **The act's quantity must satisfy `CHK_return_line_events_quantity_positive`** (`quantity > 0`,
     `1852000000000-create-return-line-events.ts:42`). The natural value is the shortfall, which —
     the rule refusing any partially received line — is exactly `quantityAdvised`. A line with
     `quantityAdvised === 0` would therefore hit a raw driver error instead of a domain refusal;
     refuse it in the domain rule with a named `reason` so it joins the closed union the exception
     filter already renders.
   - **No migration**: `return_line_events.kind` is a plain `varchar(32)` with no CHECK and no PG
     enum. Slot `1863000000000` stays unused.
   - **No repository change**: `runLineWrite` is the generic locked write and already applies any
     `ReturnCustodyOutcome` verbatim (`return.repository.ts:1376`).
   - **No exception-filter change**: `ReturnCustodyTransitionError` → 409 emitting `reason` as a
     field is already mapped globally (`apps/api/src/common/filters/returns-exception.filter.ts`).

2. **`POST /returns/:returnId/lines/:lineId/mark-not-returned`**
   - **File**: `apps/api/src/returns/http/return-writes.controller.ts` + a DTO in
     `apps/api/src/returns/dto/return-custody.dto.ts`
   - **Action**: `@Roles('admin','operator')`, `assertLineBelongsToReturn`, delegate, return the
     same `ReturnLineCountersDto` projection the siblings return.
   - **Acceptance**: 409 with `partially-received` on a received line; 201 with
     `custodyState: 'not_returned'` otherwise.

3. **`restockTarget` on the detail read**
   - **Files**: `apps/api/src/returns/dto/return-response.dto.ts`,
     `apps/api/src/returns/http/returns.controller.ts`, `ReturnCustodyService`
   - **Action**: expose the existing `resolveInventoryMaster` result through one narrow read
     (`getRestockTarget(): Promise<{connectionId, connectionName, ambiguous} | null>`), called by the
     detail read and by nothing else. **The write keeps calling the same private resolver**, so the
     name shown and the book written are one function's answer.
   - **Acceptance**: int-spec asserts the field is `null` with no `InventoryMaster` connection and
     names the resolved connection with one.

### Phase 2 — FE transport and state

4. **API + schema + types**: `receiveLine`, `disposeLine`, `markLineNotReturned` on `ReturnsApi`,
   each parsing its response through a Zod schema (the feature's existing rule — parse, never cast).
   - **Files**: `api/returns.api.ts`, `api/return-detail.schema.ts`, `api/returns.types.ts`
5. **Mutations**: `use-receive-return-line-mutation.ts`, `use-dispose-return-line-mutation.ts`,
   `use-mark-line-not-returned-mutation.ts`, each invalidating detail + list.
   - **Files**: `features/returns/hooks/`
6. **Error mapping**: extend `lib/decline-error.ts`'s sibling with a `custody-error.ts` translating
   the 409 `reason` codes (`over-receipt`, `over-disposition`, `partially-received`,
   `illegal-transition`, contention) into the spec's operator sentences. One map, consumed by both
   forms, so the two cannot phrase the same refusal differently.

### Phase 3 — FE forms

7. **`return-receive-form.tsx`** — inline expansion under the line row. Field: `quantity` (number,
   defaults to `quantityAdvised − quantityReceived`), optional `note`. Zod refinement blocks
   over-receipt client-side with § 5.2's exact message. `<fieldset disabled>` while pending.
8. **`return-dispose-form.tsx`** — `quantity` (defaults to
   `quantityReceived − quantityRestocked − quantityScrapped`), `disposition` via `SegmentedControl`,
   optional `note`. Under Restock, the § 5.3 destination sentence from `restockTarget`; with a
   `null` target, the honest alternative rather than a blank.
9. **`Receive all as advised`** — a table-head action that pre-fills every eligible line's form and
   requires an explicit confirm before submitting (a `Dialog`, the `return-decline-action` pattern).
10. **`ReturnLinesTable` gains an action column + expansion state**, and the three custody columns
    (`Received` / `Restocked` / `Scrapped`) the issue names. `hideBelow` is re-tuned so no column an
    operator needs at 768 px is dropped.
11. **Copy** — every string in `lib/return-detail.copy.ts` (or a new `return-custody.copy.ts`), so
    the form, the confirm and the toast cannot drift.

### Phase 4 — Tests

12. Component tests for both forms (default quantities, over-receipt block, disabled-while-pending,
    the destination sentence with and without a target, the bulk confirm gate).
13. `apps/api/test/integration/returns-custody-writes.int-spec.ts` extension (or a new spec) for the
    new route and the `restockTarget` field.
14. Re-run the whole returns int-spec set — #2378's segment counts read `custodyState`, and this is
    the first slice that moves it from the UI.

---

## 7. Alternatives Considered

**Modal instead of inline expansion.** Rejected by spec § 5.2 with a stated reason: a modal on a
tablet with a parcel in one hand hides the advised quantities the operator is typing against.

**Deriving the restock destination client-side** from `useConnectionsQuery` +
`enabledCapabilities`. Rejected: the backend's `entries[0]` ordering is not reproducible in the
browser, so the name shown could differ from the book written — a confident false statement, which is
strictly worse than the silence it replaces.

**Approximating `Mark remainder not returned`** by disposing the shortfall as `scrap`. Rejected: it
writes off units that may still arrive, and asserts a disposition the operator did not choose.

---

## 8. Validation & Risks

- **Architecture compliance** ✅ — no new cross-context edge; the destination read stays inside
  `returns` and goes through `IIntegrationsService`.
- **Naming** ✅ — `use-*.ts` hooks, kebab-case components, `*.dto.ts`, `*.int-spec.ts`.
- **Risk — reported ≠ enforced.** Mitigated structurally: one resolver, two callers.
- **Risk — the client-side over-receipt guard drifts from the server's.** Mitigated by deriving the
  bound from the same counters the server checks and keeping the refusal message in one copy map;
  the server remains authoritative and its 409 is rendered, never swallowed.
- **Risk — a dispose that silently no-ops.** Mitigated by surfacing `restockBlocked` in this slice
  even though its full treatment is a sibling issue.
- **Risk — the ≥44 px AC is unserved by the global rule.** `index.css:4367` applies the 44 px floor
  under `@media (hover: none) and (pointer: coarse)` — **pointer type, not viewport width** — so a
  768 px desktop window, and jsdom in a component test, get no floor at all, while both the issue's
  AC and spec § 5.2's declared departure frame the guarantee in terms of width. The two forms
  therefore carry their own explicit `min-height` on their controls, and the component test asserts
  against that rather than against a media query it cannot evaluate. Inheriting the global rule
  would ship the AC as a claim no test proves.
- **Risk — `check-ui-vocabulary` scans this folder.** A new `*.copy.ts` under `features/returns`
  enters the nine-term scan (`authority`, `posture`, `FulfillmentWork`, `AvailabilityAuthority`,
  `atpEffect`/`ATP`, `phase`, `Orchestrator`, `Gateway`, `holder`). None is needed here; noted
  because the gate is invisible until it fails. It sees literal strings only — a sentence assembled
  at runtime (`Stock will be added in ${name}`) is out of its reach either way.
- **Risk — the stage/segment projections go live against operator writes for the first time.** This
  is the first slice that moves `custodyState` from the UI, so #2377's stage derivation and #2378's
  segment counts are exercised by real transitions rather than fixtures. Step 14's full returns
  int-spec re-run is load-bearing, not routine.
- **FE contract note** — `return-detail.schema.ts` uses plain `z.object` (no `.strict()`), so an
  added nullable DTO field is parse-safe but **invisible** until the schema adds it; `restockTarget`
  needs both halves. A line-level field would additionally need `returnLineSchema` plus its mapping,
  since `lines` is parsed per row as `z.unknown()`.
- **Backward compatibility** ✅ — every backend change is additive; `restockTarget` is a new nullable
  field and the new route is new.
- **Edge case — an orphan return.** `dispose(restock)` is refused server-side (409) for an orphan;
  the form must state that up front rather than let the operator fill it in and bounce.

---

## 9. Testing Strategy & Acceptance Criteria

- **Unit (core)**: `markLineNotReturned` refusals + happy path.
- **Unit (web)**: both forms, the bulk confirm, the copy branches.
- **Integration (api)**: the new route's 201/409, and `restockTarget` present/`null`.
- **Full gate**: `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm test:integration`.

Acceptance criteria (from the issue):

- [ ] Over-receipt blocked client-side with the spec's message **and** server-side, both tested
- [ ] Bulk pre-fill requires an explicit confirm
- [ ] Dispose copy names the destination connection (or says honestly that none resolves)
- [ ] All targets ≥44 px; usable at 768 px; component tests for both forms

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no new abstractions)
- [x] Idempotency considered (writes are additive acts; the server owns contention)
- [x] Event-driven patterns unchanged (T6/T7 triggers already fire from #2370)
- [x] Rate limits & retries — n/a
- [x] Error handling comprehensive (one 409-code map, two consumers)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready **once § 5 Q1/Q2 are ruled on**
- [x] Plan saved as a markdown file

---

## Related Documentation

- [Returns operator UX spec](../specs/product-spec-oms-returns-operator-ux.md) § 5.1–5.4
- [ADR-060](../architecture/adrs/060-returns-aggregate-above-source-projection.md)
- [Frontend architecture](../frontend-architecture.md)
- [Frontend UI style guide](../frontend-ui-style-guide.md)
