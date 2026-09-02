# Readiness gate: return segments, filters and custody/money rails (#2378)

**Date**: 2026-08-27
**Plan**: `docs/plans/implementation-plan-return-segments-filters-rails.md`
**Branch**: `2367-returns-custody`
**Verdict**: **NEEDS-REVISION** — the plan's own § 2 scope question is confirmed, and the plan itself
carries one **wrong SQL predicate** that would have shipped a broken segment.

---

## 1. Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `ReturnSegment` / `countReturnsBySegment` / `RETURN_SEGMENTS` | **NEW (confirmed absent)** | zero hits across `libs/core/src`, `apps/api/src`, `apps/web/src` |
| `HEALTH_SEGMENTS` strip as the shape to copy | **ALREADY EXISTS → copy** | `orders-list-page.tsx:112` — a `readonly HealthSegment[]` of `{key, label, tone, countKey}`, rendered as a `<button aria-pressed>` wrapping a `MetricCard tone=…`, each click setting one URL filter. Transfers almost verbatim, including the `aria-pressed` + active-class pair |
| Segment tone vocabulary | **ALREADY EXISTS → reuse** | `error` / `warning` / `info` / `success` are live on `MetricCard`; D3's two-red rule is expressible without a new tone |
| `countReturnsByStage` / the counters subquery | **ALREADY EXISTS → extend** | #2377's `COUNTERS_SUBQUERY` + `COUNT(*) FILTER` in one `getRawOne`, and its caller-proof `stage`-stripping. The segment counts slot in beside it |
| `findOutstandingRestockEventsForReturn` | **ALREADY EXISTS → its predicate is the answer** | see C-1 |
| `returns.openedAt` column | **ALREADY EXISTS** | on `ReturnRecord`, applied `COALESCE` at ingestion. The filter arm is new; the column is not |
| `moneyState` / `custodyState` on detail lines | **ALREADY EXISTS → reuse** | `return-detail.schema.ts` parses both; the rails need no new read |
| `returns-filters.ts` (`RETURN_FILTER_PARAMS`, `hasActiveReturnFilters`, `clearAllFilters`) | **ALREADY EXISTS → extend** | four params today (`bucket`, `sourceConnectionId`, `createdFrom`, `createdTo`) |
| A migration | **NOT NEEDED** | every column the segments read already exists. **Slot `1863000000000` stays free** |

---

## 2. C-1 (CRITICAL) — the plan's proposed restock-blocked predicate is WRONG

The plan's Phase 1 step 1 proposes:

```sql
restockState IN ('blocked','in_doubt') AND attestedByEventId IS NULL
```

The second clause is not merely redundant, it is **backwards**, and it would make the
`Restock blocked` segment count attested blocks forever while excluding nothing.

Attestation does **not** work by stamping the blocked act. `ReturnCustodyService.markStockHandledManually`
writes a **new** attestation event carrying `attestedByEventId: blocked.id`, and then calls
`settleLineRestock`, which flips the ORIGINAL blocked act's `restockState` from `'blocked'` to
`'handled_manually'`. So after attestation:

- the **blocked** act has `restockState = 'handled_manually'` and `attestedByEventId = NULL`;
- the **attestation** act has `restockState = 'handled_manually'` and `attestedByEventId = <blocked.id>`.

`attestedByEventId IS NULL` therefore *keeps* the settled block and *drops* the attestation — the exact
inverse of the intent, and it would ship a red segment that never clears. The correct predicate is the
one `findOutstandingRestockEventsForReturn` already uses, unchanged:

```sql
restockState IN ('blocked', 'in_doubt')
```

**The existing method is the authority and the plan should say so**, rather than restating a predicate
beside it — which is how the two start disagreeing about what "outstanding" means.

*(Incidental, not this issue's to fix: `return-custody.service.ts:213` comments that "the blocked act
keeps its own state … forever" immediately above the call that changes its state. The reason is kept;
the state is not. Worth a follow-up note, not a change here.)*

**This also retro-validates #2374.** `ReturnCorrectionProposalService` reads the same method to decide
`disposition-not-confirmed`; because attestation moves the row out of `('blocked','in_doubt')`, an
attested line correctly re-enters the proposal. Had the plan's predicate been the real one, that
correction proposal would have excluded attested lines permanently.

---

## 3. The § 2 scope question is CONFIRMED

Independently verified:

- `ReturnListFilter` carries exactly `sourceConnectionId`, `bucket`, `createdFrom`, `createdTo`, `stage`
  — so four of the seven § 4.3 filters have no arm.
- `countReturnsByBucket` returns `{total, orphan, attributed}` — one of the six § 4.1 segments.
- **The `openedFrom`/`openedTo` trap is real.** `createdFrom`/`createdTo` filter `r."createdAt"`, OL's
  ingestion clock; `openedAt` is the source's own instant. Wiring the spec's param to the existing arm
  would answer a question about the marketplace's timeline with OL's.

Option (A) is the only path that satisfies AC 1. The plan's framing of (B) — *"#2378 minus one of its
four acceptance criteria"* rather than "#2378 minus polish" — is the accurate one and should be what the
coordinator decides against.

---

## 4. Backward-compatibility findings

### W-1 (Warning) — `ReturnSegmentCounts` must NOT be modelled on `ReturnStageCounts`

Both are "counts on the list response", which makes reuse tempting. They are different shapes: stages
**partition** (`Σ byStage === total`, asserted by an int-spec I shipped in #2377), segments **overlap**
(`All open` deliberately overlaps almost everything, and a return can be `Needs disposition` *and*
`Money pending` *and* `Orphans` at once). The plan's D1 is correct; the gate's addition is that the
no-sum-assertion comment must sit on the **type**, not only in the plan, because the int-spec next door
asserts the opposite for its sibling and a reader will copy it.

### W-2 (Warning) — three FE test fixtures gain required fields, as in #2377

`makeReturn` (`returns-list-page.test.tsx`), `makeDetail` (`return-detail-page.test.tsx`) and
`listResult` each grew a required field when #2377 added `counters` / `stageCounts`. Adding
`segmentCounts` repeats that; budget the three edits rather than discovering them at type-check.

### W-3 (Warning) — `check-ui-vocabulary` scans `features/returns`

Six new segment labels plus rail copy land in a scanned folder. The § 4.1 labels
(`Needs receiving`, `Needs disposition`, `Restock blocked`, `Money pending`, `Orphans`, `All open`) and
the money vocabulary are clean against the nine banned terms — but the rails' copy is new prose and
`authority` / `holder` / `phase` are all in that list.

### CLEAR

- **No migration**; slot `1863000000000` untouched.
- **`check-cross-context-imports`**: `apps/web` is outside the walker; the backend additions are
  intra-`returns`.
- **FE zod**: `returnListItemSchema` has no `.strict()`, so a server field can land ahead of the FE
  parse (the two halves may ship in either order).
- **Standing S3 rule (#939)**: `.nullish()` — every schema touched here must comply; the existing
  returns schemas already do.

---

## 5. Open questions

1. **Is option (A) approved?** Everything in Phase 1 is blocked on it.
2. **Does `attention` need a value vocabulary beyond `restock_blocked`?** Spec § 4.3 writes it as
   `attention=restock_blocked` (one value). Declaring it as a single-member `as const` union now is
   cheap and makes a second value additive; declaring it as a boolean would not.
3. **`All open`'s second arm reads money state after custody is finished.** Its predicate spans both
   rails, so it is the one segment that cannot be derived from the custody aggregate alone — worth
   confirming it is in scope rather than deferred, since it is the strip's default view.

---

## 6. Verdict

**NEEDS-REVISION.** The reuse story is strong — the orders `HEALTH_SEGMENTS` strip, the #2377 counters
subquery and the existing outstanding-restock read all transfer with little change, and no migration is
needed. But **C-1 is a wrong predicate in the plan itself**, and it is the kind that ships green: the
segment would populate, look plausible, and never clear. Fix C-1 by delegating to the existing method's
predicate, move D1's no-sum rule onto the type, budget the three fixture edits — then the plan is
executable the moment the § 2 option is confirmed.
