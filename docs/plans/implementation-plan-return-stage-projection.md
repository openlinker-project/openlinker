# Implementation Plan: Derived return stage projection + SQL/FE mirror (#2377)

**Date**: 2026-08-27
**Status**: Approved — option (A) confirmed; scope widened M → L
**Estimated Effort**: ~1 day
**Issue**: #2377 (`W2-40`, Wave 2, stream S3, size **L** — re-sized, see § 2)
**Branch**: `2367-returns-custody` (body E; on top of #2376 `abaa9dc5a`)

---

## 1. Task Summary

Render one glanceable **derived operator stage** per returns-list row — `Awaiting parcel`,
`Partially received`, `Received — awaiting disposition`, `Disposed`, `Not returned`, `Declined` —
computed purely from counters and timestamps, implemented **twice** (a SQL twin for the summary
counts and filter, a TS function for the browser) and pinned by
`scripts/check-return-stage-mirror.mjs`.

**It is a presentation projection and never a persisted column.** Spec § 3.2 is explicit: if a future
wave wants to persist it, that is a model change needing its own ADR, and this issue must not create
one by the back door.

**Classification**: Frontend + Interfaces + Tooling — **and one backend read change** (§ 2).

---

## 2. SCOPE QUESTION — the issue as written cannot be delivered

**The frontend has nothing to derive a stage from.**

`ReturnRepository.listReturns` ends `headers.map((header) => this.toDomain(header, []))` — headers
only, **no lines**. `ReturnListItemResponseDto` and the FE `ReturnListItem` carry `bucket`,
`rawStatus` and four timestamps; **no counters, no custody, no lines**. `ReturnStatusCell`'s own
docblock says so and names this issue:

> *"Deliberately NOT a derived stage. … computed from custody and money counters, and Wave 1c writes
> neither — the list projection carries no lines at all. … W2-40 owns the stage and its mirror
> invariant."*

So `return-row.ts` cannot be written against the data the list actually returns, and there is no
stage-aware summary SQL for a mirror script to pin. The issue's file list names
`return-row.ts` + *"the returns summary SQL"* + the mirror script, but not the read change that makes
either possible.

### Options

- **(A) Widen #2377 to include the read change — RECOMMENDED.** Add a per-return counter aggregate to
  the list projection, the `RETURN_STAGE_PREDICATES` / `RETURN_STAGE_EXPR` SQL twin, the FE
  derivation, the mirror script and the schema test. Size **M → L**. Every acceptance criterion
  becomes literally satisfiable, and § 4.2's adjacent counter line (`3 of 5 received`) comes free
  from the same aggregate.
- **(B) Split — REJECTED.** Ship only the TS function + mirror script now. `return-row.ts` would be
  dead code testing a function nothing calls, and the mirror would pin a SQL expression no read
  consumes. That is exactly the shape this programme keeps refusing.
- **(C) Server-derived stage only — REJECTED.** The API computes `stage`, the FE renders it. Then
  there is no FE derivation, so the mirror script has nothing to mirror and spec § 3.2's *"mirrored
  FE/SQL and pinned by a mirror test"* is not delivered.

**Option (A) is confirmed** and is the wave's standing rule: *a filter or a chip the backend cannot
serve is a control that looks live and cannot work* — a wider issue beats a green checkbox on dead UI.

**The issue's `File(s)` line understates this slice.** It names `return-row.ts`, "the returns summary
SQL" and the mirror script; the delivered diff additionally touches the core vocabulary, the returns
repository, `IReturnsService`, the controller, four DTOs and the list page. That is the widening, not
scope creep — recorded here so a reviewer is not surprised by the diff.

**Out of scope, named:** spec § 4.1's six **segments** (`Needs receiving`, `Needs disposition`,
`Restock blocked`, `Money pending`, `Orphans`, `All open`) are an overlapping, non-partitioning set and
are a different thing from § 3.2's six stages. #2377's acceptance criteria require only the *stage*
derivations to agree, and § 4.3 lists `stage` as the filter param — so the issue's "segment counts"
wording is read as stage counts. No MetricCard strip was dropped.

---

## 3. Design decisions

### D1 — Six stages, declared in PRECEDENCE order, first match wins

The array order **is** the ordinal, exactly as `OrderLifecyclePhaseValues` is (#2311/ADR-059): the
SQL `CASE` is built by iterating the same array, so a reorder changes behaviour and is a hard mirror
failure rather than a nit.

| # | Stage | Predicate |
|---|---|---|
| 1 | `declined` | `declinedAt IS NOT NULL` |
| 2 | `not_returned` | `lineCount > 0 AND notReturnedLineCount = lineCount` |
| 3 | `partially_received` | `0 < received < expected` |
| 4 | `received_awaiting_disposition` | `received >= expected AND received > restocked + scrapped` |
| 5 | `disposed` | `received >= expected AND received <= restocked + scrapped AND received > 0` |
| 6 | `awaiting_parcel` | `TRUE` (the fallback arm) |

Spec § 3.2 lists the six in *narrative* order (`Awaiting parcel` first). That is reading order for an
operator, **not** precedence, and the two must not both be encoded — one order, one rule. The
declaration comment says which it is.

**`expected` is `quantityAdvised - notReturnedQuantityAdvised`, and the semantic shift is the point:
in these arms `advised` means *still expected*, not *originally announced*.**

`markReturnCustodyNotReturned` refuses a partially-received line, so a `not_returned` line always has
`received = 0` — while its `quantityAdvised` would otherwise stay in the denominator forever. A
two-line return with one line fully received and disposed and the other marked `not_returned` would
then compute `received=3 < advised=5` and render **`Partially received` permanently, for a return the
operator has finished with** — a false statement about their own completed work. Arm 2 cannot rescue
it, because it requires *every* line to be `not_returned`.

Subtracting is not a patch on the arithmetic; it is what the arm was always testing. Stated here so
nobody "fixes" it back to the raw sum later.

**`partially_received` deliberately outranks `disposed`.** A return with 2 of 5 units arrived and both
disposed is *not* finished — three units may still turn up — so labelling it `Disposed` would tell
the operator the return is closed when it is not. Disposition completeness only means "done" once
receipt is complete.

### D2 — The FE derives; the API does NOT ship a `stage` field

Otherwise there is no second implementation and the mirror is theatre. The API ships the **counters**;
`deriveReturnStage` in `apps/web/src/features/returns/lib/return-row.ts` turns them into a stage, and
the SQL twin turns the same columns into the same stage for counting and filtering. Two
implementations of one rule, pinned — which is the issue's whole point.

### D3 — The aggregate is a lateral, and it is the same one the counter line reads

`listReturns` gains a `LEFT JOIN LATERAL` over `return_lines` producing six numbers per return:
`lineCount`, `notReturnedLineCount`, and the four `SUM(...)` counters. § 4.2's adjacent
`3 of 5 received` reads `quantityReceived` / `quantityAdvised` from that same aggregate, so the label
and the number can never disagree — they are one read.

Loading full line rows instead was rejected: a 50-row page would pull every line of every return to
compute six integers, and the projection is deliberately header-shaped.

### D4 — The SQL twin follows `LIFECYCLE_PHASE_PREDICATES` exactly

`RETURN_STAGE_PREDICATES: Record<ReturnStage, string>` plus
`RETURN_STAGE_EXPR = CASE ${ReturnStageValues.map(...)} END`, so the `CASE` is *built by iterating*
the vocabulary rather than hand-restating the ladder. `countReturnsByStage` then adds one
`COUNT(*) FILTER (WHERE ${EXPR} = '<stage>')` per stage inside the existing `buildListQuery(filter)`,
in one `getRawOne()` — so total = Σ buckets by construction, the shape `countReturnsByBucket` and
`countByLifecyclePhase` both already use.

### D5 — The mirror script pins THREE sides, with two rules of different strength

Following `check-order-lifecycle-phase-mirror.mjs`:

- **Rule A — value + order equality**, core `ReturnStageValues` vs the FE mirror. A copy drifts
  silently both ways: a stage added only to core never reaches the browser; one added only to the FE
  type-checks against a value the API will never send.
- **Rule B — structural only**, core vs `RETURN_STAGE_PREDICATES`: same keys, same order, and the
  literal `ReturnStageValues.map(` still present so the `CASE` cannot become a hand-written ladder.

**Rule B must NOT be strengthened into "this SQL predicate is semantically its TS arm."** Unlike the
lifecycle phase — which justifies its structural limit by pointing at three documented `FALSE`
placeholder arms — every return-stage arm *is* semantically real, which makes a semantic comparison
look both tempting and achievable. It is neither: the two are written in different languages against
different shapes (a TS function over numbers vs a SQL `CASE` over aggregate columns), and a script
claiming to prove them equivalent would be asserting something it cannot check. This is also why the
`check-shipping-tax-split-mirror` technique — `normalizeCode` + string equality over two TS functions
— is the wrong tool here despite being the closer *shape* precedent: textual equality across TS and
SQL is impossible, and a script attempting it would either never pass or be weakened into
meaninglessness. **The table-driven fixture set is what tests semantics** (§ 5). The script's own
docblock must say all of this, because the next reader will notice the missing `FALSE` arms and reach
for exactly the strengthening the two languages cannot support.

### D6 — `ReturnStageValues` lives in CORE, not only in the FE

The SQL twin needs it (to build the `CASE`) and the FE needs it (to render), so it is a core
vocabulary with a hand-copied FE mirror — the `OrderLifecyclePhaseValues` shape precisely. Putting it
only in the FE would leave the repository hand-listing stage names.

Its home is `libs/core/src/returns/domain/types/return-stage.types.ts`, and the pure derivation lives
beside it under the `*.types.ts` pure-rule exception (`engineering-standards.md`) — it IS the rule for
the union it sits with, takes no dependency, and must be edited in the same commit as the union.

### D7 — `ReturnStatusCell` is replaced, not supplemented

Its `declined`-only badge becomes the `declined` **stage**, so the column renders one stage badge plus
the counter line. Leaving both would put two competing lifecycle signals in one row — the #2100
three-independent-parts rule is about *different* facts (money, attention, action), not two renderings
of the same one.

---

## 4. Implementation Plan

### Phase 1 — Core vocabulary + pure derivation
1. `libs/core/src/returns/domain/types/return-stage.types.ts` — `ReturnStageValues` (precedence order),
   `ReturnStage`, `isReturnStage`, `ReturnStageCounters`, and `deriveReturnStage(counters)`.
   Barrel-export. Table-driven spec covering every arm and the D1 boundary cases.

### Phase 2 — The read
2. `ReturnRepository`: the lateral aggregate on `listReturns`; `RETURN_STAGE_PREDICATES` +
   `RETURN_STAGE_EXPR`; `countReturnsByStage`; a `stage` arm on `buildListQuery`. The filter **is** in
   scope — spec § 4.3 lists `stage` as a URL param, and it is one `andWhere` arm once the expression
   exists; shipping the expression without it would leave a segment an operator can see but not click.

   **Counts scoping — the single most likely defect in this slice, and invisible until an operator
   clicks a chip.** `ReturnBucketCounts`'s docblock already states the principle: the count for the
   dimension you are *not* looking at must stay truthful. A second filter dimension is exactly where
   that gets silently violated — get it wrong and every stage chip shows the count of the stage
   already selected. The rule: **stage counts are computed with `stage` REMOVED and `bucket` applied;
   bucket counts keep their existing scoping with `bucket` removed and `stage` applied; and
   `resolveScopedTotal` gains the `stage` arm.**
3. `ReturnRecord` gains `counters` as a **17th optional positional parameter defaulting to `null`**,
   following `matchedAt` / `matchedByUserId`. That is source-compatible with all eight construction
   sites (the repository plus seven specs), none of which needs an edit.
   **`null` means "this read did not load counters", never "all zero".** It is the honest value on the
   **detail** read, whose `ReturnRecord` carries real `lines` — the detail surface derives its stage
   from those instead. A zeroed default would claim "nothing advised, nothing received" for a
   fully-disposed return and render `Awaiting parcel` over it.
4. DTOs: `ReturnCountersDto` on the list item, stage counts on the summary, `stage` on the query DTO.

   *Alternative considered and rejected*: a `ReturnListRow { record, counters }` projection from the
   repository. Cleaner in the abstract, but it forces `IReturnsService.listReturns` to change its
   return type and the controller to zip two collections — recorded so the next reader does not
   re-litigate it.
   The DTO carries **`lineCount`, `notReturnedLineCount` and `notReturnedQuantityAdvised` as well as
   the four sums** — `not_returned`
   is "every line is `not_returned`", which no combination of quantity sums can express. They are the
   two fields with no operator-facing counter line to justify them, and therefore the two most likely
   to be dropped later as unused; they are not.

### Phase 3 — The frontend
5. `apps/web/src/features/returns/lib/return-stage.types.ts` (FE mirror of the vocabulary) and
   `return-row.ts` (`deriveReturnStage` + `satisfies Record<ReturnStage, …>` label/tone maps).
   **`apps/web/src/features/returns` is a `check-ui-vocabulary` scan root**, so the six labels and every
   copy-bearing attribute around them are linted against the nine banned terms. The labels themselves
   are clean — but `phase` is one of the nine, and this work copies a precedent literally named
   "lifecycle phase", so nothing here may be labelled or described as a phase.
6. Schema + types + filters + the Stage column; `ReturnStatusCell` → stage badge + counter line.
7. Component + table-driven tests, including the shared fixture set (§ 5). Two EXISTING tests in
   `returns-list-page.test.tsx` assert the cell D7 replaces — `should mark a declined return` and
   `should not mark a return the source has not declined`. Both are **updated, never deleted**:
   `declined` is still stage #1, so the behaviour they pin survives and must keep being pinned.

### Phase 4 — The invariant
8. `scripts/check-return-stage-mirror.mjs` with `--self-check`, chained into `check:invariants`
   beside the order-lifecycle pair.
9. A schema test asserting **no persisted stage column** exists on `returns` or `return_lines` (AC 3).

---

## 5. Testing — how "SQL and TS agree" is actually proved

The mirror script proves *structure*. Semantics are proved by **one fixture set consumed twice**: a
shared table of counter combinations with their expected stage, exercised in the TS unit test and —
as an int-spec — inserted and read back through `countReturnsByStage`, asserting the SQL bucket
matches the TS answer for every row.

**The int-spec cannot be run this session** (Docker wedged host-wide); it is compile-verified against
the real `apps/api` tsconfig and joins the wave-level unverified list. Stated rather than glossed:
until it runs, the SQL half of AC 1 is *written*, not *proven*.

---

## 6. Acceptance Criteria (from #2377)

- [ ] SQL and TS derivations agree over a table-driven fixture set *(TS proven; SQL half pending Docker)*
- [ ] A deliberate drift fails `pnpm check:invariants`
- [ ] No persisted stage column exists (asserted by schema test)
