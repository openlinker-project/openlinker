# Readiness gate: derived return stage projection (#2377)

**Date**: 2026-08-27
**Plan**: `docs/plans/implementation-plan-return-stage-projection.md`
**Branch**: `2367-returns-custody`
**Verdict**: **NEEDS-REVISION** — the plan's own § 2 scope question is confirmed by the live tree and must be
answered before implementation; three smaller findings below.

---

## 1. Reuse findings

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `ReturnStage` vocabulary + `deriveReturnStage` | **NEW (confirmed absent)** | zero hits for `ReturnStage` / `returnStage` across `libs/core/src/returns`, `apps/api/src/returns`, `apps/web/src/features/returns` |
| `apps/web/src/features/returns/lib/return-row.ts` | **NEW** | the `lib/` folder holds `decline-error`, `return-detail.copy`, `returns-filters`, `returns-list.copy` only |
| `scripts/check-return-stage-mirror.mjs` | **NEW** | nine mirror scripts exist; none is returns-related |
| `check-order-lifecycle-phase-mirror.mjs` as the shape | **ALREADY EXISTS → copy** | two rules of different strength (A: value+order equality core↔FE; B: **structural only** core↔SQL, asserting `OrderLifecyclePhaseValues.map(` still builds the `CASE`), `--self-check`, textual parsing, zero dependency |
| `LIFECYCLE_PHASE_PREDICATES` / `LIFECYCLE_PHASE_EXPR` as the SQL-twin shape | **ALREADY EXISTS → copy** | `Record<Phase, string>` of predicate fragments + a `CASE` built by `.map()` over the precedence array; consumed by both a filter arm and `countByLifecyclePhase`'s per-phase `COUNT(*) FILTER (WHERE …)` in one `getRawOne()`. The plan's D4 matches it exactly |
| `check-shipping-tax-split-mirror.mjs` (function-mirroring) | **ALREADY EXISTS → reference** | `extractFunction` + `normalizeCode` + string equality. Useful contrast, but **not** the right tool here — see W-3 |
| `countReturnsByBucket` + `buildListQuery` | **ALREADY EXISTS → extend** | `return.repository.ts:439` — `COUNT(*) FILTER (WHERE …)` in one `getRawOne()`, sharing `buildListQuery(filter)` with `listReturns` so page and counts cannot drift. A `countReturnsByStage` sibling slots in unchanged |
| A returns list page to render into (#2335) | **ALREADY EXISTS** | `apps/web/src/pages/returns/returns-list-page.tsx` + test; six columns, the last being `status` → `ReturnStatusCell` |
| `ReturnStatusCell` as the replacement target | **ALREADY EXISTS → replace** | its own docblock: *"Deliberately NOT a derived stage … **W2-40 owns the stage and its mirror invariant.**"* The plan's D7 is what that file is waiting for |
| A migration | **NOT NEEDED** | presentation projection; AC 3 asserts the opposite of a column. **Slot `1863000000000` stays free** |

---

## 2. The plan's scope question is CONFIRMED (and it is the gate's headline)

Three independent facts in the live tree, all agreeing:

1. `ReturnRepository.listReturns` ends `headers.map((header) => this.toDomain(header, []))` — **headers only, no
   lines** (its docblock says so: *"Headers only; `toDomain(header, [])` for the reason `listOrphans` gives"*).
2. `ReturnListItemResponseDto` / the FE `ReturnListItem` carry `bucket`, `rawStatus`, `origin` and four
   timestamps — **no counters, no custody, no lines**.
3. `ReturnStatusCell`'s docblock states the consequence outright: *"the list projection carries no lines at all.
   A stage rendered here would be derived from columns nothing fills."*

So option **(B)** in the plan is not merely inelegant, it is undeliverable: `deriveReturnStage` would have no
input on the surface it exists for. Option **(A)** — widen to include the read change — is the only one that
satisfies all three acceptance criteria. **Recommend confirming (A) with the coordinator before implementation**,
and re-sizing M → L.

---

## 3. Backward-compatibility findings

### W-1 (Warning) — `ReturnRecord`'s constructor has EIGHT construction sites

`new ReturnRecord(` appears in `return.repository.ts` plus **seven spec files**
(`return-refund`, `return-correction-proposal`, `return-authorize`, `return-custody`,
`return-refusal-identity`, `return-decline`, `return-record.entity.spec`). Adding `counters` as a further
**optional positional parameter with a default** (following `matchedAt` / `matchedByUserId`, which already are)
is source-compatible and breaks none of them — but it makes a 17-parameter positional constructor, and the plan
should say which shape it is taking rather than leaving the implementer to decide mid-edit.

**And the default value carries meaning.** `null` must mean *"this read did not load counters"* — which is the
honest answer on the **detail** read, whose `ReturnRecord` carries real `lines` and should derive from those.
A zeroed object would instead claim "nothing advised, nothing received" for a return that has both. State the
rule, or the detail page will one day render `Awaiting parcel` for a fully-disposed return.

### W-2 (Warning) — two FE tests assert the cell the plan replaces

`returns-list-page.test.tsx` has `should mark a declined return` and `should not mark a return the source has
not declined`. D7 replaces `ReturnStatusCell` with a stage badge, so both must be **updated** (the `declined`
stage still renders, and is stage #1 in the precedence order) — never deleted. Naming them keeps that a
deliberate edit.

### W-3 (Warning) — the mirror script must NOT use the `check-shipping-tax-split` technique

That script compares two TS functions by `normalizeCode` string equality. The two sides here are a **TS function
over numbers** and a **SQL `CASE` over aggregate columns** — different languages, different shapes — so textual
equality is impossible and a script attempting it would either never pass or be weakened into meaninglessness.
The plan's D5 already says Rule B is structural-only and explicitly forbids strengthening it; that instruction
is correct and load-bearing, and the semantic proof belongs to the § 5 fixture set. Worth restating in the
script's own docblock, since the lifecycle-phase original justifies its structural limit by pointing at three
`FALSE` placeholder arms that **this** projection will not have — a later reader will notice the difference and
reach for a strengthening the languages cannot support.

### W-4 (Warning) — `apps/web/src/features/returns` IS a `check-ui-vocabulary` scan root

Confirmed in the last lint run (*"11 file(s) scanned across 1 of 3 feature folder(s)"*). The gate scans
copy-bearing attributes (`title`, `label`, `aria-label`, `placeholder`, `alt`, `description`, `heading`,
`caption`, `hint`) for nine banned terms — of which **`phase`** (word mode) is the one this work could plausibly
trip, given the lifecycle-phase precedent it is copying. The six stage labels themselves (`Awaiting parcel`,
`Partially received`, `Received — awaiting disposition`, `Disposed`, `Not returned`, `Declined`) are clean.
Do not name the FE copy constant or any label "phase".

### CLEAR — additive surfaces

- **FE zod**: `returnListItemSchema` is a plain `z.object({...})` with **no `.strict()`**, so a server field
  added ahead of the FE parse is ignored rather than throwing — the two halves can land in either order.
- **`OrderChangeKind` / tokens / ORM schema**: untouched.
- **`check-cross-context-imports`**: the new core vocabulary is consumed by `returns`' own repository
  (same-context) and by the API DTO layer via the `@openlinker/core/returns` barrel — both allow shapes.
- **`check:invariants` registration**: every mirror script is chained **twice** (`--self-check`, then the real
  run). Splice the new pair in beside the order-lifecycle pair, matching that convention exactly.

---

## 4. Open questions

1. **Is option (A) approved?** Everything below it is blocked on that answer.
2. **Does the `stage` filter param ship in this issue?** Spec § 4.3 lists it, the plan's Phase 2 step 2 includes
   it, but #2377's own ACs do not mention filtering. Cheap once `RETURN_STAGE_EXPR` exists (one `andWhere` arm);
   worth being explicit rather than incidental.
3. **`not_returned` needs a line-level rollup, not just sums.** "every line is `not_returned`" cannot be derived
   from four quantity sums — it needs `lineCount` + `notReturnedLineCount`. The plan's D3 includes both; confirm
   the DTO carries them, since they are the two aggregate fields with no operator-facing counter line to justify
   them and are therefore the two most likely to be dropped as "unused".

---

## 5. Verdict

**NEEDS-REVISION.** Every pattern the plan copies exists and is a close fit — the lifecycle-phase mirror script,
the `Record<…, string>` + `.map()`-built `CASE`, and the `COUNT(*) FILTER` summary all transfer almost verbatim,
and `ReturnStatusCell` is a placeholder that names this issue as its successor. But the plan's § 2 scope question
is confirmed rather than hypothetical: the list projection carries no lines, so the frontend has nothing to
derive from and option (A) is the only deliverable path. Confirm the widening, then fold in W-1 (the constructor
shape and what a `null` counters means), W-2 (two named FE tests), W-3 (the script's own docblock) and W-4 (the
banned-vocabulary root).
