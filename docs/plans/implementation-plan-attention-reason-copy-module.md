# Implementation Plan: Attention-reason copy module + `check-attention-reason-mirror.mjs`

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~4 hours
**Issue**: #2357 (`W2-20`), Wave-2 stream S3
**Consumers (ship after this)**: #2354 (`W2-17`), #2355 (`W2-18`), #2356 (`W2-19`)

---

## 1. Task Summary

**Objective**: give the frontend ONE source for every operator-facing sentence about an inert
state (spec §4.2), and a build-time gate that makes the frontend's copy of the backend vocabulary
unable to drift — in membership, in order, in `badge`, and in `counted`.

**Context**: #2352 shipped `AUTHORITY_ATTENTION_REASON_DESCRIPTORS` in
`libs/core/src/fulfillment-authority/domain/types/authority-attention-reason.types.ts` as the single
data table spec §4.3 mandates ("one table, two readers"). Core is deliberately **codes-only** — it
emits no operator-facing English, because a string in `libs/core` bypasses
`scripts/check-ui-vocabulary.mjs`, can never enter the frontend's `t(key, fallback)` seam, and would
make #2354's own copy-gate acceptance criterion unsatisfiable. So the copy half is owed by the
frontend, and the browser bundle cannot depend on `@openlinker/core` (#591) — hence a **mirror
script**, not an import.

Two surfaces describing one state in two sentences is the defect §4 exists to prevent. #2356 renders
the same eight states in the `Needs attention (N)` table *and* on order / product / return /
connection rows; without one module those are two wordings the operator eventually meets both of.

**Classification**: DX (Tooling) + Frontend (Interfaces).

---

## 2. Scope & Non-Goals

### In Scope

- `apps/web/src/features/fulfillment-authority/lib/attention-reason.ts` — the codes-only frontend
  mirror of the backend vocabulary (values arrays, per-reason `badge` + `counted`, guards, badge tone).
- `apps/web/src/features/fulfillment-authority/lib/attention-reason.copy.ts` — every operator-facing
  string, `satisfies Record<…>`-exhaustive.
- `apps/web/src/features/fulfillment-authority/index.ts` — the feature's public barrel (#2354 AC bullet 1,
  satisfied early because #2356 consumes this module from *three other features*).
- `.eslintrc.js` — `fulfillment-authority` added to both `no-restricted-imports` pattern groups.
- `scripts/check-attention-reason-mirror.mjs` + wiring into `pnpm check:invariants`.
- Vitest coverage for the copy module; `--self-check` fixtures for the script.

### Out of Scope

- Any renderer. No component, no badge, no table — #2354 / #2355 / #2356 own those.
- Any backend change. `libs/core` is read, never edited.
- AF-X. Deliberately absent from the union (per-firing lifecycle, owned by body D's #2387); the design
  below must make a ninth member an ordinary addition.
- Generalising the mirror-script family into one parameterised checker (the issue's own stated
  assumption; a separate cleanup).
- Any database migration. None is needed.

### Constraints

- Node 22 LTS. No `any`, no `console.log`, no `--no-verify`.
- Copy must pass `check-ui-vocabulary.mjs` — nine banned terms, of which `authority`, `phase` and
  `holder` are *word-mode* and the most likely accidental hits here.
- `apps/web` dependency direction: `app → pages → features → shared`; `shared` must not import
  `features`.

---

## 3. Architecture Mapping

**Target layer**: `apps/web` (Interfaces) + repo tooling. Nothing in `libs/core`, `apps/api` or
`apps/worker` is touched.

**Existing patterns reused**:

| Concern | Precedent |
|---|---|
| Mirror script shape (parsers, differ, `--self-check`, fatal-on-empty) | `scripts/check-authority-kind-mirror.mjs` (#2311/#2441), `check-sales-document-reason-mirror.mjs` (#2100) |
| Depth-aware nested-object-literal key parsing with hyphenated quoted keys | `maskObjectBody` / `parseDescriptorEntries` in `check-authority-kind-mirror.mjs` |
| "matched nothing is a FAILURE" + PENDING declarations with a parent-directory typo guard | `check-ui-vocabulary.mjs` (#2384), `check-authority-kind-mirror.mjs` #2441 S-6 |
| Feature-local `*.copy.ts` module | `apps/web/src/features/returns/lib/return-detail.copy.ts`, `returns-list.copy.ts` (#2335) |
| Feature public barrel + both ESLint pattern groups | frontend-architecture § Feature Public Surface |

**New components**: two `lib/` modules, one barrel, one invariant script. No port, no service, no
entity, no DI token — so no `*.tokens.ts` and no NestJS module.

**Core vs Integration**: not applicable; this is entirely frontend + tooling. The load-bearing
boundary here is the *opposite* one — core stays codes-only and this module stays copy-only.

---

## 4. Domain Research

### The backend table this mirrors

`AUTHORITY_ATTENTION_REASON_DESCRIPTORS` carries six fields per reason. Two of them are read by the
frontend and therefore **must** be mirrored:

- `badge` — the closed four-value row label (`stopped` / `at-risk` / `blocked` / `not-matched`).
- `counted` — whether the state contributes to `Needs attention (N)`.

The other four (`specRow`, `surfaces`, `origin`, `producer`, `equivalentAuthorityKind`) are backend-side
concerns the frontend receives already-resolved through the API projection, and are deliberately **not**
mirrored — mirroring a field the frontend does not read creates maintenance with no guarantee behind it.

Mirroring `badge` and `counted` (not titles alone) is the load-bearing decision. A mirror over the
*union only* would let the aggregate count and the badge renderer disagree while the gate stayed green —
exactly the failure the single table exists to prevent.

**Today every member is `counted: true`**, so `attention.routine` is always empty. The copy module must
not imply otherwise: routine states live on the who-decides ROW as `AuthorityState` / `AuthoritySource`
values from #2351 and are structurally incapable of entering this union. The flag is mirrored so that
opting a future member out is a deliberate edit on both sides.

### Spec §4.2 copy (verbatim source of the strings)

| # | Reason | Badge | Title | Body | Fix |
|---|---|---|---|---|---|
| A1-U | `availability-unknown` | `stopped` | "We don't know how much stock to publish" | Two of your systems both say they're in charge of your stock, so OpenLinker won't guess. Publishing for these products is paused. | Name both connections; link to each |
| A2-A | `sourcing-ambiguous` | `stopped` | "Nothing is deciding where {channel} orders ship from" | Two systems are set up to decide, so OpenLinker is doing neither. Orders are going out the way they did before. | Name both; link to each |
| A3-X | `fulfillment-unaccepted` | `stopped` | "No one took the job for order {ref}" | Every place that could have shipped it said no. It's waiting for you. | Link to order; show each rejection reason |
| UF-L | `line-unfulfillable` | `at-risk` | "{n} line(s) on order {ref} can't be shipped from anywhere" | There isn't stock for it in any place that can ship to this buyer. This is a refund or return decision, not something OpenLinker can fix. | Link to order; offer the refund/return action |
| RS-S | `reservation-shortfall` | `at-risk` | "Order {ref} is short {n} × {sku}" | Your stock master dropped below what this order was promised. Nothing was silently reduced — this order is the one at risk. | Link to order; link to the product |
| A5-A | `returns-disposition-ambiguous` | `stopped` | "Nothing is deciding what happens to returns from {channel}" | Two systems are set up to decide, so OpenLinker is doing neither. Returns are still being recorded, but nothing is being restocked or scrapped automatically. | Name both |
| RB-L | `restock-blocked` | `blocked` | *owned by the returns spec §5.4* — "Stock was not added" | (see §5) | Link to the return; name the system |
| OR-P | `return-unmatched` | `not-matched` | *owned by the returns spec §5.5* — "This return is not matched to an order" | (see §5) | Link to the return |

### The RB-L / OR-P ownership question (the one real design fork)

Spec §4.2 is emphatic: RB-L and OR-P copy is **owned by the returns spec, imported, never restated**,
and "the mirror check that S2-1 mandates covers **both** feature folders, so a divergence fails the
build rather than shipping as two truths."

`features/returns` already ships the OR-P title as `RETURN_ORPHAN_BANNER_COPY.title` in
`lib/return-detail.copy.ts`, exported from the returns barrel. It does **not** ship an RB-L string —
that surface belongs to #2364.

A literal `import` from `../../returns` was considered and **rejected**: `features/returns` is itself one
of #2356's four badge surfaces, so it will import *this* module, and a static cycle between two feature
barrels is exactly the shape #337/#359 established as a runtime hazard. Pulling the whole returns barrel
(api factories, query hooks) into a pure copy module to obtain one string is also wildly disproportionate.

**Decision**: declare both titles here and enforce agreement with a **check**, not an import — which is
literally what the spec asked for ("the mirror check … covers both feature folders"). MIRROR 6 below
compares this module's OR-P title byte-for-byte with `RETURN_ORPHAN_BANNER_COPY.title`, and carries a
declared-PENDING pair for RB-L naming #2364, so the moment the returns feature words that state the build
fails until the two agree.

**One byte matters**: spec §4.2 renders the OR-P title with a trailing period; the shipped returns copy has
none. The spec's own tie-break says the returns spec wins, and the shipped string is what an operator sees
today, so the period is dropped. Recorded here because it looks like a typo and is not.

---

## 5. Questions & Assumptions

### Assumptions

1. **The file must be `attention-reason.copy.ts`, not `attention-reason-copy.ts`** (the issue body's
   spelling). This is not cosmetic: `isScannable` in `check-ui-vocabulary.mjs` matches
   `path.endsWith('.copy.ts')`, and `features/fulfillment-authority` is a declared SCAN_ROOT whose Z3
   rule **fails** a root that exists but yields zero scannable files. The hyphenated name would create
   the folder, contribute no scannable file, and turn the vocabulary gate red. It also matches the repo's
   own `return-detail.copy.ts` / `returns-list.copy.ts` convention.
2. **Shipping the barrel + the two ESLint entries here is correct**, though #2354's AC also names them.
   They are additive and idempotent; without them #2356 would have to deep-import across features, which
   `.eslintrc.js` does not yet ban for this slug — i.e. the wrong shape would silently be legal.
3. `check-authority-kind-mirror.mjs`'s PENDING entry for `features/orders/lib/authority-kind.ts` is
   **not** touched. Its parent directory exists, so its own typo guard is satisfied; #2354 re-points it.
4. Titles carry `{placeholder}` tokens. The frontend, not the API, substitutes them.

### Open questions (surfaced, not blocking)

- Whether #2364 will word RB-L identically to the provisional string here. MIRROR 6's pending pair makes
  that a build failure rather than a silent divergence, which is the right failure direction.
- Whether `attention.routine` ever gains a member. The `counted` mirror is in place for that day; nothing
  in the copy module asserts the split is live.

---

## 6. Proposed Implementation Plan

### Phase 1 — the frontend mirror (codes only)

1. **`apps/web/src/features/fulfillment-authority/lib/attention-reason.ts`**
   - `AuthorityAttentionReasonValues` — the eight values, **one per line, in core's order**, so the script
     can read them textually (the same promise core's own docblock makes).
   - `AuthorityAttentionBadgeValues` — the four badge codes, same shape.
   - Derived `AuthorityAttentionReason` / `AuthorityAttentionBadge` types.
   - `ATTENTION_REASON_MIRROR: Readonly<Record<AuthorityAttentionReason, { badge; counted }>>` — the
     mirrored half of the backend descriptor table, nested `{ … }` per key so MIRROR 3 can read it with
     the depth-aware parser.
   - `AuthorityAttentionCountedReasonValues` — **derived by filtering the mirror**, never hand-listed,
     exactly as core derives its own.
   - `isAuthorityAttentionReason(value: unknown)` — narrows an untrusted API string. An unrecognised
     value must render neutrally and stay uncounted (#2356 AC).
   - `attentionBadgeTone(badge)` → `'danger' | 'warning' | 'neutral'`. Tone is a frontend presentation
     decision (§4.3: attention-worthy renders `danger`/`warning`), so it lives here and is *not* mirrored.
   - **Acceptance**: `pnpm --filter @openlinker/web type-check` clean; no operator English in this file.

### Phase 2 — the copy

2. **`apps/web/src/features/fulfillment-authority/lib/attention-reason.copy.ts`**
   - `AttentionReasonCopy = { title; titleFallback; body; fix }`.
   - `ATTENTION_REASON_COPY = { … } satisfies Record<AuthorityAttentionReason, AttentionReasonCopy>` —
     `satisfies`, not `:`, so the literal keeps its literal key types *and* a missing reason is a compile
     error. Keys in core's order, one per line.
   - `ATTENTION_BADGE_COPY satisfies Record<AuthorityAttentionBadge, string>` — `Stopped` / `At risk` /
     `Blocked` / `Not matched`.
   - `ATTENTION_SECTION_COPY` — the §4 section heading, the zero-state reassurance line (one line, not an
     illustration), and the unrecognised-reason neutral label.
   - `attentionTitle(reason, params)` — substitutes `{channel}` / `{ref}` / `{n}` / `{sku}`. **If any
     placeholder the template needs is missing, it returns `titleFallback`** — a complete placeholder-free
     sentence — rather than rendering a literal `{ref}` to an operator. That is the whole reason
     `titleFallback` exists as a field instead of a per-token default: "Some line(s) on order this order"
     is not a sentence.
   - Every title is produced through this one function, which is what makes "byte-identical titles on both
     surfaces" (#2356 AC) structural rather than a review promise.
   - **Acceptance**: `node scripts/check-ui-vocabulary.mjs` passes with the folder now live.

3. **`apps/web/src/features/fulfillment-authority/index.ts`** — public barrel: the types, the values
   arrays, the guard, `attentionBadgeTone`, `ATTENTION_REASON_COPY`, `ATTENTION_BADGE_COPY`,
   `ATTENTION_SECTION_COPY`, `attentionTitle`. Start narrow; #2354–#2356 add their own exports.

4. **`.eslintrc.js`** — add `**/fulfillment-authority/{api,hooks,components,lib,types}/**` to both
   `no-restricted-imports` pattern groups (`features/**` and `plugins/**`), alphabetically placed.

### Phase 3 — the gate

5. **`scripts/check-attention-reason-mirror.mjs`** — zero-dependency, textual, `--self-check`able.

   Six mirrors:

   | # | Rule |
   |---|---|
   | M1 | `AuthorityAttentionReasonValues` identical, same order, core ↔ `attention-reason.ts` |
   | M2 | `AuthorityAttentionBadgeValues` identical, same order, core ↔ `attention-reason.ts` |
   | M3 | per reason, `badge` and `counted` equal in `AUTHORITY_ATTENTION_REASON_DESCRIPTORS` and `ATTENTION_REASON_MIRROR` |
   | M4 | `ATTENTION_REASON_COPY` has exactly one entry per reason, in the same order (a backend reason with no FE copy fails) |
   | M5 | `ATTENTION_BADGE_COPY` has exactly one entry per badge value |
   | M6 | cross-feature title agreement: the OR-P title equals `RETURN_ORPHAN_BANNER_COPY.title` in `features/returns/lib/return-detail.copy.ts`; an RB-L pair is declared PENDING against #2364 |

   Zero-case discipline (the family's hard-learned rules):
   - Any declaration that parses to **zero** entries is **FATAL**, never a pass (#2384). A regex that stops
     matching must fail the build, not silently approve everything.
   - A PENDING cross-feature pair whose FILE does not exist is a **failure** (the #2441 S-6 typo guard); a
     pair whose file exists but whose *declaration* is absent is a visible note and exit 0.
   - `--self-check` exercises the parsers and the differ against synthetic inputs, **including deliberately
     drifted fixtures** for every one of M1–M6, so a broken regex cannot pass vacuously.

   Two parser notes: `counted` is a **boolean**, so the existing `field()` helper (quoted strings only) needs
   a `booleanField()` sibling — a `counted: false` read as `null` on both sides would compare equal and the
   mirror would be inert. And every reason key is hyphenated and quoted, so the depth-aware
   `maskObjectBody` masking is required, not optional.

6. **`package.json`** — append `&& node scripts/check-attention-reason-mirror.mjs --self-check && node
   scripts/check-attention-reason-mirror.mjs` to `check:invariants`, after the authority-kind pair.

### Phase 4 — tests

7. **`apps/web/src/features/fulfillment-authority/lib/attention-reason.copy.test.ts`**
   - every reason yields a non-empty title, body and fix;
   - `attentionTitle` substitutes each placeholder;
   - **a template with a missing placeholder returns `titleFallback` and the result contains no `{`** —
     the regression that would otherwise ship `{ref}` to an operator;
   - `AuthorityAttentionCountedReasonValues` is derived, not hand-listed (all eight today);
   - `isAuthorityAttentionReason` rejects an unknown string;
   - `ATTENTION_BADGE_COPY` covers every badge value.

---

## 7. Alternatives Considered

**A. One file, `attention-reason.copy.ts`, holding codes and copy.** Rejected: `check-ui-vocabulary.mjs`
scans *every* string literal in a `*.copy.ts`, and the vocabulary array itself contains no banned terms
today but is exactly the kind of code list that would eventually collide with a word-mode ban. Splitting
also mirrors core's own codes-vs-copy split, so the two halves stay legible against each other.

**B. Import RB-L / OR-P titles from the returns barrel.** Rejected — see §4: it creates a feature-barrel
cycle with #2356's returns surface and pulls a query layer into a copy module. The spec's own remedy is a
check covering both folders, which MIRROR 6 is.

**C. Mirror only the reason union (the issue's literal wording).** Rejected: the aggregate count and the
badge renderer could still disagree under a green gate, which is precisely what the single §4.3 table exists
to prevent. `badge` and `counted` are mirrored.

**D. Generalise the three existing mirror scripts into one parameterised checker.** Deferred — the issue
states this assumption explicitly, and a refactor of three live gates is not this issue's risk to take.

**E. Per-token placeholder defaults instead of `titleFallback`.** Rejected: the defaults produce
ungrammatical sentences ("Some line(s) on order this order"), and a title is the string an operator scans a
list by.

---

## 8. Validation & Risks

| Risk | Mitigation |
|---|---|
| Creating `features/fulfillment-authority/` turns on `check-ui-vocabulary`'s first SCAN_ROOT | Intended. The `.copy.ts` naming satisfies Z3; copy is written against the nine banned terms from the start. Run the gate before commit. |
| `counted` boolean parsed as `null` on both sides → inert mirror | Dedicated `booleanField()` parser; `--self-check` includes a `counted` drift fixture. |
| Hyphenated quoted keys misread as values | Reuse the proven depth-aware `maskObjectBody` masking. |
| A ninth reason (AF-X, #2387) later | Every list is derived or `satisfies`-exhaustive, and M4 fails on a missing copy entry. Adding a member is: core edit → FE mirror edit → copy edit; the gate names each missing one. |
| Barrel/ESLint edits collide with #2354 | Additive, alphabetically placed, idempotent. Flagged in handover. |
| #2364 words RB-L differently | MIRROR 6's PENDING pair fails the build the day it lands, forcing one wording. |
| Duplicating a title inline in a renderer | Not gated by this script (out of its stated scope); #2356's own component tests assert titles come from the module. Stated in the script header so no reviewer over-trusts the gate. |

**Backward compatibility**: additive only. No runtime behaviour changes; nothing consumes the module yet.

**Migration**: none.

---

## 9. Testing Strategy & Acceptance Criteria

- `node scripts/check-attention-reason-mirror.mjs --self-check` — parsers + differ, with drifted fixtures.
- `node scripts/check-attention-reason-mirror.mjs` — the live repo.
- Manual proof for the report: temporarily add a ninth value to core, show the script failing with an
  actionable message, revert, show it passing.
- `pnpm --filter @openlinker/web test` — the copy module's Vitest file.
- `pnpm lint` (runs `check:invariants`, including `check-ui-vocabulary`), `pnpm type-check`, `pnpm test`.

### Acceptance criteria (from #2357)

- [ ] Adding a backend reason value without the FE mirror fails `pnpm check:invariants` — M1 and M4.
- [ ] Both surfaces import titles from the module — the barrel + `attentionTitle` are the only way to
      produce a title; #2356 consumes them.
- [ ] Script has its own test fixture proving it fails on a deliberate drift — `--self-check` carries one
      per mirror, plus the manual live-repo demonstration above.
- [ ] `badge` and `counted` are covered, not titles alone — M3.

---

## 10. Alignment Checklist

- [x] Follows the repo's frontend folder + barrel conventions
- [x] Respects `app → pages → features → shared`; no `shared` → `features` import; no feature-barrel cycle
- [x] Uses existing patterns (three mirror-script precedents, two `*.copy.ts` precedents)
- [x] Idempotency / events / rate limits — not applicable (pure frontend + tooling)
- [x] Error handling — the script's fatal/pending/drift taxonomy is explicit and each case is exercised
- [x] Testing strategy complete
- [x] Naming conventions followed (`.copy.ts` required, not optional)
- [x] No migration
- [x] Execution-ready

---

## Related Documentation

- `docs/specs/product-spec-oms-wave2-operator-experience.md` §2.1, §4.2, §4.3
- `docs/plans/implementation-plan-inert-state-reason-vocabulary.md` (#2352)
- `docs/architecture/adrs/052-independently-assignable-fulfillment-authorities.md`
- `docs/frontend-architecture.md` § Feature Public Surface
- `docs/engineering-standards.md`
