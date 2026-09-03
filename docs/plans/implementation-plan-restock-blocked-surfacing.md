# Implementation Plan: `restock_blocked` surfacing and remediation (#2381, `W2-43`)

**Date**: 2026-08-27
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days (M+)

---

## 1. Task Summary

**Objective**: make a refused restock impossible to miss and impossible to mistake for success.
A restock that silently no-ops is worse than none — the operator believes stock came back, sells
it, and discovers the truth from a buyer.

**Context**: `ReturnCustodyService.disposeLine` already records a refused inventory-master write
correctly — the disposition is persisted, the units stay in `quantityReceived`, and nothing
anywhere reports them as restocked (#2370/#2376). What is missing is that **no operator can see
it**. #2380 shipped a deliberate placeholder: an inline `Alert` fed only from the 2xx dispose
response, held in component state, lost on reload.

**Classification**: Frontend (Interfaces) **plus two additive backend reads**.

---

## 2. Scope, and a corrected sizing

### The third surface is SPLIT OUT (coordinator ruling)

Returns spec § 5.4 names three required surfaces. This issue ships **two**:

1. **List row badge + its segment** — `/returns`.
2. **Persistent inline line-row error + remediation + attestation + explainer** — `/returns/:id`.

The third — the **order-detail returns panel badge** — is split to its own issue. It is not a
badge: `features/orders/components/` contains no returns panel, the order-detail page has zero
returns presence (no panel, no link, no import of the returns feature), and there is no
order-scoped returns read at all (`ReturnListFilter` carries no `internalOrderId` arm). Building
it means a filter arm through core + DTO + repository, an FE query, **a panel that does not
exist**, and only then a badge. **The coordinator owns the AC amendment naming that issue; this
plan does not edit issue text.**

### Corrected sizing — this issue DOES widen the backend

An earlier report of "no backend widening needed" was **wrong** and is corrected here so the plan
does not inherit it. The WRITE path is complete; the READ path to the client does not exist:

| Piece | State |
|---|---|
| `POST .../lines/:lineId/mark-stock-handled` (attestation) | **exists** (#2376) |
| `IReturnCustodyService.listOutstandingRestockBlocks(returnId)` | **exists**, and its port docblock already names #2381 as a caller |
| `ReturnRepositoryPort.findOutstandingRestockEventsForReturn` | **exists**, one indexed lookup |
| An HTTP route reaching any of that | **absent** — `listOutstandingRestockBlocks` has zero callers |
| A blocked flag on the list row | **absent** — `restock_blocked` exists only as a #2378 *segment* |

So surface 2 — the highest-severity one — is unbuildable as specified without a read. Built on
#2380's session state it would be a persistent error that vanishes on reload, which is
functionally the toast § 5.4 forbids by name (*"A toast is not sufficient and must not be the
only signal"*), and it would pass a demo because nobody reloads mid-demo.

Both additions are small because the SQL already exists.

### In scope

- Shared copy module `features/returns/lib/restock-blocked.copy.ts` (see § 3).
- **Move** `RETURN_RESTOCK_BLOCKED_COPY` out of `return-custody.copy.ts` into it, call sites updated.
- Backend: a `restockBlocked` boolean on the list row, reusing the **existing** `RESTOCK_BLOCKED_EXISTS`.
- Backend: `restockBlocks` on the detail read, from the **existing** `listOutstandingRestockBlocks`.
- Backend: `returnLineId` added to `RestockBlockedDetail` (see § 5, Q1).
- FE: list badge; per-line persistent error; `Mark stock handled manually`; `Open {connection}`;
  `Why did this happen?` disclosure; the post-attestation neutral row.
- Tests including one asserting **no surface renders blocked units as restocked**.

### Out of scope

- The order-detail returns panel (split, above) and its `internalOrderId` filter arm.
- Any change to the custody transition rules, the counters, or `disposeLine`'s behaviour.
- A mirror script (see § 3).
- Actor **name** resolution. `actorUserId -> display name` needs an `IUsersService` that does not
  exist (the `users` barrel publishes only `IMcpTokenService`) and a new `returns -> users`
  cross-context edge. Step 10 renders you/another-operator instead; a real name is a follow-up that
  would improve several surfaces at once, not just this one.
- The two pre-existing integration reds (#2638 `earliest-order-date`, #2639 carrier-mapping S-3).

---

## 3. The shared copy module

**Created here, on #2357's behalf** (`W2-20`, the RB-L attention state). #2357's implementer must
find this module rather than starting a rival — it is named in the module docblock for that
reason. Sizing it to exactly the two surfaces #2381 ships is deliberate: no speculative entries
for states this issue does not render.

**Form: the #2100 precedent, `features/invoicing/lib/sales-document-block-copy.ts`.** That module
lives in one feature, is exported from that feature's barrel, and is consumed by two surfaces in a
*different* feature (`features/orders`' `sales-document-panel.tsx` and `order-row.ts`) via
`from '../../invoicing'`. That is exactly this shape. (`analytics/lib/needs-attention-copy.lib.ts`
— the stock-at-risk one — has a single in-feature consumer and does not demonstrate the property.)

So: `features/returns/lib/restock-blocked.copy.ts`, exported from `features/returns/index.ts`,
imported later by the split-out panel issue as `from '../../returns'`.

**Filename: the dotted `restock-blocked.copy.ts`** (ruled). The folder is already split 3-1 —
`return-custody.copy.ts` / `return-detail.copy.ts` / `returns-list.copy.ts` dotted, against the
lone hyphenated `restock-target-copy.ts` that #2380 added. `engineering-standards.md` does not
cover copy modules, so the local convention governs: #2100's `sales-document-block-copy.ts` is the
precedent for the **cross-feature barrel shape** and carries no authority over filenames in a
different feature's folder. Converging a 3-1 split beats importing a fourth spelling.
`restock-target-copy.ts` is **not** renamed here — this issue does not otherwise touch it, and a
drive-by rename would put an unrelated file in the diff; noted for whoever next edits it.

**Two constraints.**

- **The module is the ONLY place the sentence exists.** A variant interpolated at a call site
  belongs IN the module. That is what makes byte-identity structural — a second copy cannot exist
  without someone deleting an import — rather than aspirational.
- **No mirror script.** A `scripts/check-*-mirror.mjs` holds two *independently authored* halves
  identical across a boundary that forbids imports (the frontend-cannot-import-`@openlinker/core`
  case). Every consumer here can import the module directly, so a mirror would guard a boundary
  that does not exist and add build cost for nothing. If #2357 later needs a backend-side
  counterpart that genuinely cannot import it, the mirror is that issue's to add, with its reason.

### The move is part of the issue, not cleanup

#2380 created `RETURN_RESTOCK_BLOCKED_COPY` in `return-custody.copy.ts` for its placeholder Alert.
If this issue stands up the shared module while those strings stay put, **the module ships with
the exact defect it exists to prevent, on day one**, and a later reader cannot tell which of two
homes is authoritative.

**Move, do not re-export.** A re-export keeps the old import path working and therefore keeps it
in use, so new call sites keep reaching for the wrong home — the two-homes condition survives in a
form that *looks* resolved.

The gate confirmed the blast radius is **exactly one file**: `RETURN_RESTOCK_BLOCKED_COPY` is
defined at `return-custody.copy.ts:132` and imported only by `return-custody-panel.tsx:49` (used at
lines 229–237). No test references it, and it is not exported from the returns barrel — `lib/` has
no barrel of its own. So the move is a two-file change with no external consumers to break, and the
cross-feature reachability the module needs comes from the **new** barrel export in step 4, not
from anything that exists today.

This carries its own acceptance line (§ 9) so a reviewer **checks** for it rather than trusting it
happened.

---

## 4. Architecture mapping

**Target layers**: `apps/web` Interfaces (primary); `libs/core/src/returns` (application, one
projection field) + `apps/api/src/returns` (interface, two DTO fields).

**Capabilities involved**: none new. `InventoryMaster` is reached only by the already-shipped
dispose path; nothing in this issue constructs an adapter.

**Existing services reused**: `IReturnCustodyService.listOutstandingRestockBlocks` /
`markStockHandledManually`, `ReturnRepositoryPort.findOutstandingRestockEventsForReturn`,
`ReturnRepository.RESTOCK_BLOCKED_EXISTS`, `useWriteAccess` / `ReadOnlyLock`, `Alert`,
`StatusBadge`, `DataTable`.

**New components**: the copy module, one FE hook, three FE components, two DTO fields, one
domain-projection field.

**Core vs Integration**: entirely core + interface. No adapter learns anything.

---

## 5. Questions & assumptions

### Open questions (for the coordinator)

*(Both questions this plan opened have been ruled on and are recorded below as decisions rather
than left open.)*

1. **DECIDED (ruled): add `returnLineId` to `RestockBlockedDetail`.** It maps
   `skuByLineId.get(event.returnLineId)` to fill `sku` and then **drops the key**. Surface 2 is a
   *per-line* error, so the FE has no way to attach a block to its line; `sku` is not a
   substitute, because two lines of one return can legitimately share a SKU (a re-order of the
   same item; `return_lines` is unique on `(returnId, lineIndex)` only, never on `sku`), and
   attaching by SKU would render one line's block under another's. **This is not a near-miss: it
   is the UI asserting a specific false fact about which goods are stuck, on the exact surface an
   operator uses to decide what to do about them. A per-line surface needs a per-line key.**

   Corrected from an earlier draft: the type has **two** construction sites, not one — the
   `listOutstandingRestockBlocks` mapper and the dispose path's `DisposeLineResult.restockBlocked`.
   Both already hold the line (`event.returnLineId` / `locked.id`), so it is still one line each.
   The change is safe on every axis the gate checks: nothing outside `libs/core` constructs the
   type (consumers only read it), `toRestockBlockedDto` is an explicit field allowlist so the field
   cannot leak into the dispose response by accident, and both existing shape assertions are
   non-exhaustive (`objectContaining` / `toMatchObject`) so neither breaks.

### Assumptions

- The list badge derives from a boolean the server sends, never from the counters. "Blocked"
  cannot be computed from `quantityReceived`/`quantityRestocked`: a line awaiting disposition and
  a line whose restock was refused have identical counters, which is precisely the ambiguity #2370
  chose (units stay in `quantityReceived`) and precisely why the act ledger exists.
- The detail read may carry `restockBlocks` unconditionally; the extra query is one indexed
  lookup on a page that already fans out to several reads, and `restockTarget` (#2380) set the
  precedent for a custody fact on that response.
- The attestation clears attention but not history. § 5.4's post-state table is explicit, and
  `markStockHandledManually` already implements it — this issue renders it, it does not change it.

---

## 6. Implementation plan

### Phase 1 — Backend reads (additive)

1. **`returnLineId` on `RestockBlockedDetail`**
   - **File**: `libs/core/src/returns/application/services/return-custody.service.interface.ts` (+ the mapper in `return-custody.service.ts`)
   - **Acceptance**: unit spec asserts the field is the act's own line, on a two-line fixture where both lines share a SKU.

2. **`restockBlocked` on the list row — via `aggregateCounters`, NOT the paged query**
   - **Files**: `libs/core/src/returns/infrastructure/persistence/repositories/return.repository.ts`, `ReturnRecord`, `ReturnListItemResponseDto`
   - **It is a SIBLING field, never a member of `ReturnCounters`.** The fetch mechanism must not
     dictate the projection shape. `ReturnCounters` is a published FE type whose docblock states it
     is *"the per-return counter rollup the derived stage is computed from"*, and #2377 was
     deliberate that the stage derives from counters **alone** — a blocked flag inside it silently
     widens the input to a derivation that must not see it. `restockBlocked` is a boolean FACT, not
     a counter: it lands beside `counters` on `ReturnRecord` / `ReturnListItem`, merged from the
     same raw row that `aggregateCounters` already returns.
   - **The readiness gate caught a defect in an earlier draft of this step.** It said
     "`addSelect` the constant on the list query". That would have shipped a badge that never
     renders: `listReturns` materialises with **`getMany()`**, which silently discards a raw
     `addSelect` — no error, no warning, just a field that is always `undefined`. It would have
     passed type-check (the DTO field exists), passed a unit test with a stubbed repository, and
     failed only against real Postgres, as a badge that never appears for a state whose entire
     purpose is to be impossible to miss.
   - **Action**: add the EXISTS as a column on the **second** query, `aggregateCounters`
     (`getRawMany`, grouped by `l."returnId"`), which already merges per-return aggregates in JS
     and is where every other counter on the row comes from. It correlates on the **group key**, so
     it neither fans out the `COUNT(*)`s (a `LEFT JOIN` to events would) nor forces a join onto the
     paged query — which also keeps it clear of the distinct-pagination trap documented in
     `docs/lessons.md` and in that method's own comment.
   - **One rule, two consumers — preserved by parameterising the correlation.**
     `RESTOCK_BLOCKED_EXISTS` correlates on `r.id`; `aggregateCounters` has only `l."returnId"` in
     scope, so the constant cannot be reused verbatim. Convert it to a small function of the
     correlating expression (`restockBlockedExists('r.id')` / `restockBlockedExists('l."returnId"')`)
     consumed by BOTH the #2378 segment predicate and this column. Copying the SQL instead would be
     two rules that agree today — the mistake #2378 already paid for once with `orphans`, and the
     one the coordinator's ruling is specifically guarding against.
   - **Acceptance**: int-spec asserts a return with a blocked act reads `restockBlocked: true`
     **and** appears in the `segment=restock_blocked` count, from one seeded row — the two read
     through one predicate, so the test proves they cannot diverge. A second case asserts the flag
     is `false`, not `undefined`, for a return with a line awaiting disposition and no block.

3. **`restockBlocks` AND `restockAttestations` on the detail read**
   - **Files**: `libs/core/src/returns/domain/ports/return-repository.port.ts`, `.../return-custody.service.ts` (+ its interface), `apps/api/src/returns/dto/return-response.dto.ts`, `apps/api/src/returns/http/returns.controller.ts`
   - **A `/tech-review` of this plan found step 10 had no data source.** The outstanding read is
     defined by `restockState IN ('blocked','in_doubt')` (`return.repository.ts:151-155`), and
     `markStockHandledManually` **flips** the act to `handled_manually` — the repository docblock
     says so, and it is why `RESTOCK_BLOCKED_EXISTS` keys on state membership rather than
     `attestedByEventId`. So the instant an operator attests, the act **leaves** the outstanding
     set, `restockBlocks` returns `[]`, and § 5.4's post-attestation row renders nothing.
     It would have *appeared* to work in manual testing, off the mutation's own
     `AttestStockResult.events`, and vanished on reload — #2380's session-state defect
     reintroduced by the plan whose purpose is to remove it, one surface down.
   - **The row is not a fourth surface; it is the TERMINAL STATE of surface 2**, which is why it is
     widened into this step rather than split. Shipping the attestation without it means the only
     observable result of *"I handled this myself"* is that the alarm disappears — the next reader
     sees a line that was never blocked. § 5.4's reasoning cuts both ways: a resolution that leaves
     the alarm ringing trains the operator to ignore it, and a resolution that leaves no trace
     trains them to distrust that the click did anything. A remediation loop without its terminal
     state is not a smaller feature, it is a broken one.
   - **Action**: add `findAttestationsForReturn(returnId)` beside `findOutstandingRestockEventsForReturn`
     — the same shape, one indexed lookup, filtered to `kind: 'stock_attestation'` — and project
     both arrays onto the detail response. `listLineEvents(lineId)` is deliberately NOT used: it is
     per-line and unfiltered, so rendering one sentence would cost N calls returning every act.
   - **Acceptance**: int-spec asserts `restockBlocks: []` + `restockAttestations: []` on a clean
     return; a populated block naming quantity, sku, connection and **line** after a refused
     restock; and — the case that motivated this — after attesting, `restockBlocks` empties **and**
     `restockAttestations` carries the actor and instant, **on a re-read**, not from the mutation.

### Phase 2 — The shared copy module

4. **Create the module**, export it from the returns barrel, docblock naming #2357 and the
   split-out panel issue as its future consumers.
   - **The barrel export is load-bearing, not decorative.** `.eslintrc.js` registers the `returns`
     slug in both `no-restricted-imports` pattern groups for all five canonical subdirectories, so
     a future cross-feature consumer is **hard-blocked** from deep-importing `lib/…` and can only
     reach the module through `features/returns/index.ts`. Omitting the export would leave the
     module unreachable by the very issue it is being created for.
5. **Move** `RETURN_RESTOCK_BLOCKED_COPY` in, delete it from `return-custody.copy.ts`, update
   `return-custody-panel.tsx`. **No re-export.**

### Phase 3 — Frontend

6. **Types + schema**: `restockBlocked: boolean | null` on `ReturnListItem`, `restockBlocks` +
   `restockAttestations` on `ReturnDetail` — all parsed, never cast.
   - **`null` means NOT REPORTED, and is the only honest third state.** The row's degradation has a
     harder answer than the detail's: `false` asserts the operator's stock is fine, and `true`
     cries wolf on every row of an unreadable page. #2024 is the precedent — a sparse response
     records "not reported" rather than a value an operator cannot tell apart from a real one.
     `null` renders **no badge**, and the absence is routed through the list's existing
     `droppedCount` reporting so it is **counted** rather than merely rendered as nothing.
7. **The attestation mutation joins `use-return-custody-mutations.ts`** rather than getting a file
   of its own. That module (#2380) already holds receive / dispose / not-returned, and its docblock
   states they live together *because they share the invalidation contract exactly* — detail plus
   list-by-prefix, the latter because a custody write moves the #2378 segment counts. The
   attestation shares that contract precisely (attesting clears a `restock_blocked` segment
   membership), so a fourth entry belongs there; a separate file would be the same body under a
   different name, and one of the two would eventually forget a key.
8. **List badge** in `return-row.ts` / the returns list cell — error tone, § 5.4's exact `Restock blocked`.
9. **`return-restock-blocked-notice.tsx`** — the persistent inline line-row error: title, the
   remediation sentence naming quantity/sku/connection, the three actions, and the
   `Why did this happen?` **inline disclosure** (not a modal, not a link out).
10. **Post-attestation row** — neutral tone (not success, not error), no actions.
    - **`{user}` cannot be interpolated as a name, and the plan must not pretend otherwise.** The
      re-review found that `actorUserId` is written by every returns write path and **resolved to a
      display name nowhere** — the FE renders no actor anywhere, and the `users` context publishes
      only `IMcpTokenService`, so there is no `IUsersService` to ask. Creating one is a new
      cross-context edge (`returns -> users`) and is well outside this issue.
    - **Resolution: say what OL can actually stand behind.** The row reads
      *"Stock added manually by you on {date}"* when `actorUserId` matches the session user — which
      the FE already holds, needs no backend, and is the overwhelmingly common single-operator
      case — and *"Stock added manually by another operator on {date}"* otherwise. Both keep the
      load-bearing second sentence verbatim: *"OpenLinker did not change your stock."*
    - Rendering the raw `actorUserId` is rejected: a UUID in operator copy is not an answer to
      *who*, and it reads as a defect. Asserting a name OL cannot verify is worse still — the
      same rule that governs every other surface in this epic.
11. **Replace #2380's placeholder** in `return-custody-panel.tsx`; `blockedByLine` session state is
    retired in favour of the server read, which is what its docblock said would complete it.

### The response describes an EVENT; the read describes STATE

Two things now report the same block, and the rule separating them is what stops that becoming
two homes for one fact.

- **`DisposeLineResult.restockBlocked` (the 2xx response) answers *"the thing you just clicked was
  blocked"*.** It is a fact about an ACTION, true at one instant. It is legitimately the input to a
  **toast**, which is itself an event-shaped surface — and it is the only direct answer to "did MY
  click just get blocked". It is **never rendered as state.**
- **`restockBlocks` (the detail read) answers *"this line is currently blocked"*.** A fact about the
  world that survives a reload, and therefore the only honest source for the **persistent notice**.

The notice appears because the **invalidation settled**, never because the response arrived. That
gives exactly one source for what is on screen and no window in which the two could disagree —
settled by construction rather than by timing luck.

Suppressing the response read entirely would be worse, not purer: it would either lose the
immediate toast or force "did my click get blocked" to be reconstructed by diffing state, which is
inference where a direct answer already exists.

**#2380's `blockedByLine` session state is retired in the same step**, for the same reason it was
always temporary — it was the only thing available before a read existed, and keeping it beside the
server read would leave two homes for one fact. That is the copy-module argument in a different
medium, and its own docblock names this issue as what completes it.

**The overlap window is specified, not left to chance.** For a few hundred milliseconds after a
blocked dispose, the toast and the notice are both visible. They must not read as two problems:
the toast is transient, past-tense and names the action (*"…could not be added"*), while the notice
is persistent, present-tense and names the remediation. A test asserts both are present in that
window and that the notice — not the toast — is what remains after it.

### Phase 4 — Tests

12. Component tests for the notice, the disclosure, the attestation flow, the post-state, 375 px.
13. **The AC test**: no component renders blocked units as restocked — asserted against a fixture
    whose line has `quantityReceived: 3, quantityRestocked: 0` **and** an outstanding block, across
    the line row, the counters and the badge.
14. Int-spec extensions per Phase 1.

---

## 7. Alternatives considered

**Derive the badge from counters.** Rejected: impossible. A line awaiting disposition and a line
whose restock was refused carry identical counters by design.

**Keep the copy local and let #2357 consolidate.** Rejected by ruling, and the reasoning
generalises: widening an existing module later is routine, consolidating three drifted local
copies is a refactor nobody schedules.

**A dedicated `GET /returns/:id/restock-blocks` route.** Rejected: a second round trip on a page
that already reads the detail, for a field the detail can carry — the `restockTarget` precedent.

---

## 8. Validation & risks

- **Architecture** ✅ — no new cross-context edge; the read stays inside `returns`.
- **Naming** ✅ — `use-*.ts`, kebab-case components, `*.dto.ts`, `*.int-spec.ts`.
- **Risk — badge/segment drift.** Mitigated structurally: one SQL constant, two consumers.
- **Risk — a copy variant at a call site.** Mitigated by the module rule (§ 3) and by the move
  leaving no rival home to reach for.
- **Risk — an unreadable row flag degrading the wrong way.** `restockBlocked` is
  `boolean | null`; `null` is *not reported*, renders no badge, and is counted through
  `droppedCount`. Never coerce it to `false` (asserts their stock is fine) or `true` (cries wolf
  page-wide).
- **Risk — an unreadable `restockBlocks` degrading the wrong way.** A parse failure must yield
  *no claim*, never "no blocks": an empty array asserts the operator's stock is fine. Degrade to
  the badge-only state and report it, matching the `UNREADABLE_RESTOCK_TARGET` posture (#2380),
  which chose `adapter-unresolved` over `no-inventory-master` for the same reason.
- **Risk — the attestation clearing attention it should not.** `markStockHandledManually` settles
  every outstanding act *on the line*; the badge must clear only when no line on the return is
  still unhandled (§ 5.4). Derived from the same server read, never from the mutation's result.
- **Backward compatibility** ✅ — every backend change is additive.
- **Migration** — none.

---

## 9. Testing strategy & acceptance criteria

- [ ] Both shipped surfaces render for one blocked line, with the **same title text**, from the
      shared module (the third surface is tracked in the split-out issue named on #2381)
- [ ] A test asserts no component renders blocked units as restocked
- [ ] The attestation clears the block and records who attested; the post-state row renders
      **on a re-read**, from `restockAttestations`, not from the mutation's own result — the
      terminal state of surface 2 must survive a reload or it is #2380's session-state defect again
- [ ] Component tests; usable at 375 px
- [ ] **`RETURN_RESTOCK_BLOCKED_COPY` has exactly one home** — moved into the shared module, call
      sites updated, `return-custody.copy.ts` no longer exports it and does not re-export it
- [ ] `pnpm lint` / `type-check` / `test` / `test:integration` (the two pre-existing reds #2638 and
      #2639 excepted, and asserted still-pre-existing rather than assumed)

---

## 10. Alignment checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no new abstractions; two existing reads, one existing SQL constant)
- [x] Idempotency considered (attestation is settle-once; the reads are pure)
- [x] Error handling comprehensive (unreadable-parse degrades away from a false all-clear)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] Plan is execution-ready **once § 5 Q1 is ruled on**

---

## Related documentation

- [Returns operator UX spec](../specs/product-spec-oms-returns-operator-ux.md) § 5.4 — the canonical copy owner
- [ADR-060](../architecture/adrs/060-returns-aggregate-above-source-projection.md)
- [Frontend architecture](../frontend-architecture.md) § Feature Public Surface
