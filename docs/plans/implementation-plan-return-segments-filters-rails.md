# Implementation Plan: Return segments, filters and custody/money rails (#2378)

**Date**: 2026-08-27
**Status**: Approved — option (A) confirmed; scope widened M → L. Rulings 1–4 folded in.
**Estimated Effort**: ~1.5 days under option (A)
**Issue**: #2378 (`W2-41`, Wave 2, stream S3, size **L** — re-sized, see § 2)
**Branch**: `2367-returns-custody` (body E; on top of #2377 `455512690`)

---

## 1. Task Summary

Wave 1c shipped the returns list and the detail shell. #2378 gives them the state they were built to
show: the six § 4.1 **segments**, the § 4.3 **filter set**, and — the headline — the **two independent
rails**, custody and money, whose independence is the single most misread thing about the model.

**Classification**: Frontend / Interfaces — **plus a backend read change** (§ 2).

**Standing S3 rule** (#939): `.nullish()`, never `.optional()`, in every schema touched here.

---

## 2. SCOPE QUESTION — one of six segments and two of seven filters have a backend

Verified against the live tree before planning, per the standing rule that a premise is checked
rather than built to.

### Segments (spec § 4.1)

| Segment | Backend today |
|---|---|
| Needs receiving | ✗ |
| Needs disposition | ✗ |
| Restock blocked | ✗ |
| Money pending | ✗ |
| **Orphans** | **✓** `countReturnsByBucket.orphan` |
| All open | ✗ |

### Filters (spec § 4.3)

| Filter | Backend today |
|---|---|
| **`stage`** | **✓** shipped by #2377 |
| **`sourceConnectionId`** | **✓** |
| `orphan=true` | ✓ *as* `bucket=orphan` — the FE param name differs from the backend's |
| `attention=restock_blocked` | ✗ |
| `money` (incl. `money=in_doubt`) | ✗ |
| `reason` | ✗ |
| `openedFrom` / `openedTo` | ✗ — **and this one is a trap** |

**`openedFrom`/`openedTo` is not simply missing.** `ReturnListFilter` carries `createdFrom`/`createdTo`,
which filter `returns.createdAt` — OL's **ingestion** clock. `openedAt` is the **source's own** instant
(applied with `COALESCE`, never latest-wins, precisely because it is the source's). Wiring the spec's
`openedFrom` to the existing `createdAt` arm would silently answer a question about the marketplace's
timeline with OL's, which is the exact substitution this programme refuses everywhere else. It needs
its own arm.

### What the ACs need

| AC | Needs backend? |
|---|---|
| Segments are clickable filters; routine segments carry no danger tone | **YES** |
| `in_doubt` renders as a warning with the do-not-refund-again copy | No — `moneyState` is on the detail lines |
| `refunded` never renders without an observation | No — see § D4 |
| Component tests; usable at 375 px | No |

### Options

- **(A) Widen #2378 to include the read change — RECOMMENDED.** Five segment counts and four filter
  dimensions, all derivable from `return_lines` / `return_line_events` by extending the #2377 counters
  subquery. Size **M → L**. This is the wave's standing rule applied unchanged: *a filter or a chip the
  backend cannot serve is a control that looks live and cannot work.*
- **(B) Split: rails now, segments+filters later — REJECTED, but it is the honest alternative and worth
  stating.** The rails are the issue's headline, are fully unblocked today, and would ship clean. But
  AC 1 is unsatisfiable without the backend, so (B) is not "#2378 minus polish" — it is #2378 minus one
  of its four acceptance criteria, and the segment strip is what makes the list a worklist rather than
  a table.
- **(C) Client-side filtering / counting — REJECTED.** The list is paged; counting a segment over the
  current page states something false about the operator's data, which is worse than the control not
  existing.

**Option (A) is confirmed.** The wave's standing rule, applied unchanged: *a filter or a chip the
backend cannot serve is a control that looks live and cannot work.*

**Note the widening is larger than #2377's** (which added one aggregate and one filter arm): this adds
five counts and four filter dimensions, one of which needs a new timestamp arm. That is the honest size,
and it is why the recommendation is stated with the alternative rather than assumed.

---

## 3. Design decisions

### D1 — Segments OVERLAP; stages PARTITION. They are different shapes and must not share a mechanism

`ReturnStageCounts` (#2377) is a partition — six mutually exclusive buckets that sum to the total, so
`countReturnsByStage` can assert `Σ byStage === total`. Segments are **not**: a single return can be
`Needs disposition` **and** `Money pending` **and** `Orphans` at once, and `All open` deliberately
overlaps almost everything. So:

- a separate `ReturnSegmentCounts` type, never an extension of the stage counts;
- **no sum assertion** anywhere, and the comment saying why sits **on the type**, not only here —
  #2377's int-spec asserts `Σ byStage === total` for the sibling shape one file over, so a reader
  copying it is the likely failure and the type is where they will look;
- each segment is an independent `COUNT(*) FILTER (WHERE …)` over the same scan.

Conflating the two is how a chip strip starts claiming a total it cannot support.

### D2 — Segment counts are scoped with the SEGMENT dimension removed, per #2377's rule

The counts-scoping rule generalises: the count for the dimension you are *not* looking at stays
truthful. A segment click sets a filter; the segment counts are therefore computed with **that filter
removed** and every other dimension applied. `countReturnsBySegment` strips it itself — the same
defence-in-depth `countReturnsByStage` uses, so the rule survives a caller that forgets.

### D3 — Only two segments are attention-worthy, and the tone split is the point

Per spec § 4.1 and the #2100 attention-worthy/routine split: **`Restock blocked` and `Orphans`** alone
may render a non-zero count in red, because both mean *OL did something the operator has not been told
about anywhere else*. `Money pending` is routine on any active seller and is **never** red — a warning
tone on an ordinary state trains the operator to ignore the strip, which is the failure mode the split
exists to prevent. Declared as a `satisfies Record<ReturnSegment, SegmentTone>` map so a seventh
segment cannot be added without choosing.

### D4 — `refunded` renders from `moneyState`, and that is *already* observation-only

The AC — *"`refunded` never renders without an observation (test with a `triggered`-only fixture)"* — is
satisfiable purely in the frontend, because of a backend property worth stating rather than assuming:
`triggerRefund` writes `triggered`, and **only** `recordRefundObservation` writes `refunded` / `denied`.
So `moneyState === 'refunded'` *is* the observation. The FE renders the rail off `moneyState` and adds
no inference of its own; the `triggered`-only fixture test pins that no code path derives `refunded`
from a trigger.

`in_doubt` is a **first-class warning step**, not an error and not a variant of `pending`: OL crossed a
boundary and does not know the outcome, so the copy must say *do not refund again* rather than implying
failure. A retry there moves real money twice.

### D5 — The rails are two labelled tracks with a standing sentence, never one merged timeline

Custody and money move independently — marketplaces routinely refund before the goods arrive — so a
single merged rail would have to lie about one axis on the most common path there is. The
*"these move independently"* sentence ships as copy, not as a comment.

### D6 — ONE `segment` URL param with six values — a deliberate deviation from spec § 4.3

**The spec's own param list cannot express three of its own segments.** `Needs receiving` spans
`awaiting_parcel` **or** `partially_received`; `Needs disposition` spans
`received_awaiting_disposition` **or** a partially-received line with undisposed units; `Money pending`
means `pending` **or** `in_doubt`. `stage` and `money` are each single-valued, so none of the three is
expressible as a value of any param § 4.3 names — which makes AC 1 ("segments are clickable filters")
unimplementable on that param set. This is not a preference between two workable designs.

So: **`segment` takes the six segment keys**, and `attention` / `orphan` are dropped as separate params
because they *are* segments — two spellings of one filter is drift by construction. `money`, `reason`,
`stage`, `sourceConnectionId` and `openedFrom` / `openedTo` remain value filters and compose with
`segment` by AND.

**`ReturnListFilter` gains a real `segment` arm, and `orphans` is an ordinary segment predicate beside
the other five.** An earlier draft mapped `segment=orphans` onto the backend's `bucket: 'orphan'` at the
API boundary; composed with D7's strip-the-`segment`-dimension rule that is a **self-scoping bug** — the
FE would send `bucket=orphan`, leaving no `segment` value to strip, so `bucket` stays applied and the
orphans card reports the count of the scope it is already in. That is exactly the defect #2377's rule
exists to prevent, arriving through the mapping instead of through a forgotten strip. One dimension, one
strip rule, no boundary translation: the arm is cheaper than the class of bug it avoids.

Two constraints on the predicate, both load-bearing:

- It must be **the same rule** `ReturnRecord.isOrphan()` states. #2332's docblock forbids a second
  definition — the bucket count, the trigger guard and the reconcile candidate query all derive from it —
  so the SQL side gets ONE shared `ORPHAN_PREDICATE` constant consumed by the bucket count, the bucket
  filter arm and the orphans segment alike. A hand-written `IS NULL` in the segment `CASE` that happens
  to agree today is two rules, not one.
- **`bucket` stays an independently-usable filter** behind the existing bucket chips, untouched by the
  strip. A segment click must never write `bucket`, or the two surfaces start fighting over one param.

*Recorded as a deviation rather than left for a later reader to reconstruct from the diff.*

### D7 — `segmentCounts` is authoritative for the strip; `ReturnBucketCounts` keeps its own job

All six cards read `segmentCounts`, **`Orphans` included**. `ReturnBucketCounts` stays exactly what it
is — the attribution partition behind the existing bucket chips — and nothing renders both into the same
strip.

The failure this prevents is two numbers for one fact, scoped by two different rules (bucket counts have
`bucket` removed; segment counts have `segment` removed), which therefore disagree under any other active
filter — with no way for the operator to tell which is lying.

**#2377's scoping rule carries through verbatim**: segment counts are computed with the `segment`
dimension REMOVED and every other filter applied, and `countReturnsBySegment` strips `segment` **itself**
rather than trusting a caller. That defence already survived a caller forgetting it once.

### D8 — SEVEN cards: `All returns` clears `segment`; the six segments sit beside it

The orders-list precedent is the right shape but must not be read too literally: its `All orders` card
**is** the cleared state, whereas § 4.1's `All open` carries a real predicate spanning both rails
(custody unfinished, **or** money still `pending` / `in_doubt`). `All open` is a filter, not a clear.

So the strip is `All returns` (clears `segment`; the default, unfiltered) **plus** the six segments,
`All open` among them. Stated explicitly because the failure if a reader guesses wrong is a card labelled
*open work* listing closed, fully-refunded returns — a false statement about the operator's own queue.

### D9 — The tone map is keyed off `MetricCard`'s own prop type

Not a locally-declared tone union: a local one type-checks against a tone the primitive does not render,
which is the same class of defect as a mirror that drifts.

---

## 4. Implementation Plan

### Phase 1 — Backend reads (the § 2 widening)
1. Extend the #2377 counters subquery with the aggregates the segments need: custody-state counts,
   money-state counts, a `restockBlocked` EXISTS over `return_line_events`, and a reason set.

   **The restock-blocked predicate is `restockState IN ('blocked','in_doubt')` and NOTHING ELSE**, and it
   is taken from `findOutstandingRestockEventsForReturn` rather than restated beside it. An earlier draft
   of this plan proposed `AND attestedByEventId IS NULL`, which is **backwards**: attestation writes a
   NEW event carrying `attestedByEventId`, then `settleLineRestock` flips the ORIGINAL blocked act's
   `restockState` to `'handled_manually'` while leaving its `attestedByEventId` null. So that clause
   would have KEPT every settled block and DROPPED the attestation — a red segment that populates, looks
   plausible, and never clears. The existing method is the authority on what "outstanding" means; two
   copies of the predicate is how they start disagreeing.
2. `SEGMENT_PREDICATES` + `countReturnsBySegment` — one `COUNT(*) FILTER` per segment in one scan,
   scoped per D2/D7, stripping `segment` inside the method. **No sum assertion**, and the comment saying
   why lives on the type.
3. Filter arms: `attention`, `money`, `reason`, and `openedFrom`/`openedTo` against **`openedAt`**
   (§ 2's trap), each optional and each adding no arm when absent.
4. Port + `IReturnsService` + controller + DTOs; `openedAt` filtering and the segment counts on the list
   response.

### Phase 2 — Frontend segments + filters
5. `RETURN_SEGMENTS` with the D3/D9 tone map; a `MetricCard` strip mirroring the orders-list
   `HEALTH_SEGMENTS` pattern, each card setting `segment=<key>` (D6) and reading `segmentCounts` (D7),
   with an `All open` card beside the strip and the default unfiltered (D8).
6. `returns-filters.ts` gains `segment`, `money`, `reason`, `openedFrom`, `openedTo` with type-guard
   narrowing, extends `RETURN_FILTER_PARAMS`, and keeps the one-call `clearAllFilters` + offset reset.
   `attention` and `orphan` are NOT added — see D6.

### Phase 3 — The rails
7. `ReturnCustodyRail` + `ReturnMoneyRail` (+ the shared "these move independently" copy), rendered on
   the detail page. `in_doubt` warning + do-not-refund-again copy; `refunded` attributed
   *"Confirmed by {source}"*.

### Phase 4 — Tests + docs

*Budgeted, not discovered at type-check*: `makeReturn` (`returns-list-page.test.tsx`), `makeDetail`
(`return-detail-page.test.tsx`) and `listResult` each gain the new required field, exactly as they did
when #2377 added `counters` / `stageCounts`.

*Copy gate*: `features/returns` is a `check-ui-vocabulary` scan root. The six § 4.1 segment labels and
the money vocabulary are clean, but the rails' copy is new prose — `authority`, `holder` and `phase` are
all banned terms.
8. Component tests for the strip (tones, click-to-filter), the filters (unrecognised value ignored,
   never thrown), and both rails — including the `triggered`-only fixture (D4) and 375 px.
9. An int-spec for the segment counts against real rows; § 22 gets one bullet.

---

## 4b. Open questions carried from the gate

1. ~~`attention` as a single-member union~~ — **settled**: `attention` is dropped entirely; it is a
   segment, not a value filter (D6).
2. **`All open` is in scope**, and it is the one segment whose predicate spans BOTH rails (custody
   unfinished, OR custody finished with money still `pending`/`in_doubt`). **SQL consequence, stated
   rather than implied**: its `COUNT(*) FILTER` therefore needs the **money-state aggregate in the same
   counters subquery** — it cannot be satisfied from the custody columns alone. Implied is not stated
   when the cost of missing it is discovering it mid-implementation. It is one of the six segments, and
   the seventh card (`All returns`) is the cleared state (D8).

---

## 5. Risks

- **Segment/stage confusion** — mitigated by D1 (separate type, no sum assertion, comment).
- **`openedAt` vs `createdAt`** — the trap is named in § 2 and in the filter arm's own comment.
- **Tone creep** — the `satisfies` map makes adding a segment a choice, not a default.

---

## 6. Acceptance Criteria (from #2378)

- [ ] Segments are clickable filters; routine segments carry no danger tone
- [ ] `in_doubt` renders as a warning with the do-not-refund-again copy
- [ ] `refunded` never renders without an observation (test with a `triggered`-only fixture)
- [ ] Component tests; usable at 375 px
