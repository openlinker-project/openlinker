# Implementation Plan: Wave-2 responsive audit across the new surfaces (#2388)

**Date**: 2026-08-30
**Status**: Ready for Review
**Estimated Effort**: 1–1.5 days
**Issue**: [#2388](https://github.com/openlinker-project/openlinker/issues/2388) (`W2-46b`, epic #2389)
**Branch**: `2388-wave2-responsive-audit`, based on `origin/oms-programme-wave-2`

---

## 1. Task Summary

**Objective**: Measure the rendered geometry of every surface OMS Wave 2 added, at 375 / 768 / 1024 px, and fix what the measurements show. Specifically: no horizontal page scroll at any of the three widths; mobile cards and desktop cells share one renderer on every new list; the automation composer dialog is fully operable at 375 px with no clipped control.

**Context**: Responsiveness was filed separately from the feature issues precisely so it could not be quietly dropped from any of them, and it is the wave's last FE issue by construction — it can only *run* once the surfaces exist. Several of the acceptance criteria are already partly satisfied by the feature issues that shipped them (`#2354` gave the who-decides row its single-column reflow, `#2365` declared the composer's fully-interactive-at-375 departure, `#2335` gave the returns list a `cardView`). This issue is therefore an **audit**: verify by measurement, and fix the residue.

**Classification**: Frontend (Interface layer). No CORE change, no adapter change, no migration.

---

## 2. Scope & Non-Goals

### In Scope

- A measured no-horizontal-scroll audit at **375 / 768 / 1024 px** of every Wave-2 surface:
  - `/orders` list + `/orders/:id` detail — order holds (badges, `place-order-hold-dialog`, `release-order-hold-dialog`), the packed control, reservation shortfall (`stock-at-risk-badge` / `stock-at-risk-callout`)
  - `/orders/dispatch-risk`
  - `/settings/who-decides` — the authority surface, its seven-row table, preset cards, `ConfirmDialog`
  - Attention badges/rows on `/orders`, `/connections`, `/products`
  - `/automations`, `/automations/activity`, `/automations/:trigger` — including the run log (#2386) and the composer dialog (#2365)
  - `/returns` list + `/returns/:id` detail — segment strip, custody panel, dispose/receive forms
- Fixes for whatever the measurement shows, kept minimal and local.
- A CSS contract test for any **new or changed** CSS carrying a real invariant, anchored (whole-token selector matching) with a guard-of-the-guard.
- Verification that the returns list `cardView` reuses the desktop cell renderers, and closing the gap where it does not.

### Out of Scope

- Redesign. This is an audit and its repairs, not a visual pass.
- New responsive behaviour for surfaces Wave 2 did not touch.
- Touch-target auditing beyond what a no-scroll/clipping fix requires (`custody-touch-targets.test.ts` already pins the returns 44 px floor; #2380 pinned the custody rules).
- Backend changes of any kind.
- Re-litigating the two documented departures in `docs/frontend-ui-style-guide.md § Responsive` (the automation composer, the who-decides row carve-out). They are the spec; this issue verifies them.

### Constraints

- `apps/web` **cannot** import `@openlinker/core` (#591). Anything shared with core is a guarded mirror.
- **Nothing in the pipeline parses `index.css`** (#2674), so a CSS contract test is the only gate CSS can have.
- There is exactly **one** CSS file in `apps/web` (`src/index.css`, 21 029 lines). All Wave-2 styling landed there.
- Copy must pass `scripts/check-ui-vocabulary.mjs`. If the gate rejects a string, fix the copy, never the gate.
- `visible` and `canWrite` are different answers; admin-gated routes use `useIsAdmin() && <permission>`.

---

## 3. Architecture Mapping

**Target Layer**: Interface (`apps/web/src`). Pages and feature components compose; `shared/ui/data-table.tsx` is the shared list primitive.

**Existing components reused** (nothing new is introduced):

| Component | Path | Role in this issue |
|---|---|---|
| `DataTable` | `apps/web/src/shared/ui/data-table.tsx` | The `cardView` seam (#2091). Card view renders **solely** from `cardView` — there is **no `columns` fallback** — so anything living only in a column disappears below the breakpoint. |
| `.card-button-reset` | `apps/web/src/index.css` | The shared reset for a card inside a `<button>`. Applied to `.returns-segment` / `.orders-segment` / `.products-segment`; pinned by `card-button-reset-styles.test.ts`. **Use it** for any card-in-button touched here; do not hand-roll another partial reset. |
| `who-decides-styles.test.ts` | `apps/web/src/features/fulfillment-authority/` | Existing CSS contract test — class coverage, custom-property declaration, grid-area disjointness. |
| `returns-styles.test.ts` | `apps/web/src/features/returns/` | Existing class-coverage contract test. |
| `custody-touch-targets.test.ts` | `apps/web/src/features/returns/lib/` | Existing 44 px floor assertion, declared **outside** any media query. |

**No new components, hooks, services, ports, adapters, entities or routes.** If the audit shows a surface needs a `cardView` it does not have, that is a config object added to an existing `DataTable` call site, reusing the existing cell renderers.

**Core vs Integration**: not applicable — this issue changes only `apps/web`.

---

## 4. Research

### The three named acceptance criteria, and their current state

| AC | Current state (read from the branch) | What this issue must do |
|---|---|---|
| Who-decides table collapses to stacked question/answer cards | **Shipped by #2354.** `/settings/who-decides` is a CSS-grid definition list (`.who-decides-row`, grid areas `question / answer / why / extras / inactive / badge`), with a single-column reflow at `@media (max-width: 768px)` (index.css L20097). It is deliberately **not** a `DataTable` — a `hideBelow` on the why-line would delete the feature on mobile (style guide § Density & Row Heights carve-out). | **Verify by measurement**, and fix the breakpoint (see finding F1). |
| Attention rows render as mobile cards carrying the same badge | `OmsAttentionBadges` is rendered at both the desktop-cell and card/expand call sites on `/orders` (`orders-list-page.tsx:931` and `:2027`) and `/connections` (`:83` and `:235`). `/products` was touched by the wave. | **Verify the badge is present in the card branch at 375 px on all three**, and that the card and cell use the *same* component. |
| Composer dialog fully operable at 375 px, no clipped control | **Declared** in `docs/frontend-ui-style-guide.md § Responsive` as a documented departure (#2365): fully interactive at 375 px, single column below 768 px, ≥ 44 px targets, no "open on desktop" hint. CSS exists at index.css L20517 (`min-width: 768px` two-column) and L20526 (`max-width: 767px` stack). | **Verify by measurement** — every control reachable and unclipped, dialog does not overflow the viewport. |
| Returns list `cardView` reusing the same cell renderers (#2091) | **Shipped by #2335** (`returns-list-page.tsx:349`), citing #2091 in a comment. `meta` uses the real `<ReturnStageCell>`; `detail` uses the real `<ConnectionEntityLabel>` / `<ReturnOpenedCell>` / `<ReturnSourceStatus>`. But `title` and `subtitle` use plain-text summaries (`returnIdentitySummary` / `returnOrderSummary`) co-located with the cells, **not** the cell components. | **Assess** (see finding F2) — this is the one AC where the shipped state may not literally satisfy the wording. |

### Findings already established from reading the branch

**F1 — the breakpoint values are inconsistent, and one of them lands exactly on an audit width.**
The house convention (style guide § Responsive) is mobile ≤ 767 px, tablet 768–1023 px, desktop ≥ 1024 px, expressed as mobile-first `min-width` queries. Wave-2 CSS uses four different spellings of the mobile bound:

| index.css line | Query | Surface |
|---|---|---|
| 19055 | `@media (max-width: 767.98px)` | `.attention-list__item` |
| **20097** | **`@media (max-width: 768px)`** | **`.who-decides-row`** |
| 20342 | `@media (max-width: 767px)` | order-hold panel + dialog |
| 20434 | `@media (max-width: 640px)` | automation rules state / suggestion actions |
| 20526, 20614, 20658 | `@media (max-width: 767px)` | automation composer / dry-run / activity |

`max-width: 768px` **fires at exactly 768 px**, which is the tablet band and one of the three audit widths. So at 768 px the who-decides row renders its mobile single-column layout while every other surface is in tablet — and the `min-width: 768px` tablet rules apply simultaneously to anything else on the page. This is a real, measurable inconsistency at an audited breakpoint, not a style nit. The `767.98px` spelling is the fractional-pixel-safe form; `767px` is the plain complement. Picking one is in scope; a wholesale sweep of the other 100+ media queries in the file is not.

**F2 — the returns card `title`/`subtitle` are plain-text summaries, not the cell renderers.**
`ReturnOrderCell` renders an **orphan `StatusBadge` with `tone="error"`** plus a hover explanation; `returnOrderSummary` degrades that to the plain string `"Unmatched · {externalOrderId}"`. So at 375 px the red badge that means *this return is blocked and needs attention* is not rendered — the very signal the wave's attention model exists to surface. Whether this satisfies AC-2 is a judgement call the audit must state explicitly rather than assume:
- **Reading A (literal)**: the AC says *"mobile cards and desktop cells share one renderer"*. Title/subtitle do not. Gap.
- **Reading B (as-designed)**: the card `title` slot renders inside `<strong>` (style-guide note on `.orders-cell-sub`), so a badge-bearing component is not a drop-in; the plain-text summaries live in the same file as the cell and share its fallback rule by construction, which is the spirit of #2091.

**Recommendation**: treat the *orphan badge specifically* as the gap, and surface it in the card without restructuring the slots — the `meta` slot already renders a real component (`<ReturnStageCell>`) and is the natural home for a second status signal, or `detail` can carry it. Do not move `ReturnIdentityCell`/`ReturnOrderCell` wholesale into `title`/`subtitle`; that fights the primitive. State the reasoning in the PR.

**F3 — three surfaces have no card safety net, and one has a thin one.**
- `/settings/who-decides` has **no `DataTable` at all**; its responsiveness rests entirely on hand-written grid CSS, guarded only by the class-coverage/grid-area text test.
- `automation-run-log.tsx` is a bare `<ul>`, not a `DataTable` — no `cardView`, no `hideBelow`. Its list-item CSS at index.css L20579–20607 is its only responsive behaviour.
- `dispatch-risk-page.tsx:288` configures a `cardView` with **only `title` + `subtitle`** — no `meta`, no `detail`, no `actions`. Given `DataTable`'s documented no-columns-fallback rule, every other column vanishes below the card breakpoint. Worth measuring and reporting even if the fix is deferred.
- Dialogs (`place`/`release-order-hold`, `automation-composer-dialog`, return custody/decline actions, the who-decides `ConfirmDialog`) have **no CSS contract test** covering small-viewport sizing.

**F4 — the card-in-button fix is recent and must be built on, not redone.**
The global `button, .button` rule (index.css:541) sets `height: 2rem; display: inline-flex; align-items: center; box-shadow: …; white-space: nowrap`. `.card-button-reset` releases all seven properties (`height: auto` specifically) and is applied to the three `*-segment` classes; `card-button-reset-styles.test.ts` asserts both the CSS half and the markup half (every `['…-segment', …]` className array must also contain `card-button-reset`). At 500 px the returns strip previously wrapped to four mutually-overlapping rows; that is fixed. **Re-verify at 375 px** rather than assuming.

### Testing patterns to follow

The repo has four existing CSS/geometry contract tests, all reading `src/index.css` from disk. The anchoring rule is the important one (#2589): `card-button-reset-styles.test.ts` strips comments, matches `([^{}]*)\{([^{}]*)\}`, splits the selector list on `,`, trims, and requires `selectors.includes(selector)` — **whole-token equality**, so `.card-button-reset--wide` cannot satisfy a test for `.card-button-reset`. It carries a guard-of-the-guard (`ruleBodiesFor(css, '.card-button-rese')` must return `[]`). `custody-touch-targets.test.ts` additionally strips media blocks by brace-counting, and tests its own stripper on nested blocks. Any new test here follows both patterns.

---

## 5. Questions & Assumptions

### Open Questions

- **Q1**: Is the F2 orphan-badge gap in scope for this issue, or a follow-up? The AC wording says renderers are shared; the shipped design deliberately does not share them for `title`/`subtitle`. **Proposed default**: fix the *badge* (a real operator-facing loss of a red attention signal at 375 px), leave the title/subtitle summary shape alone, and state both readings in the PR.
- **Q2**: Should `dispatch-risk-page`'s two-slot `cardView` be enriched here? It is a Wave-2-touched file but the thin `cardView` is arguably pre-existing. **Proposed default**: measure it, report it, fix only if the measurement shows an actual loss of an actionable control (not merely a hidden informational column).
- **Q3**: How wide should the breakpoint normalisation go? **Proposed default**: normalise only the Wave-2 rules this audit touches (F1), to the `767.98px` spelling already used at L19055, and only where a measurement showed a defect. A repo-wide media-query sweep is a separate change.

### Assumptions

- Desktop remains the design anchor; tablet and mobile are first-class (issue's own stated assumption + the house responsive-scope rule).
- The two documented departures in the style guide are the spec, not defects.
- The dev stack (API :3011, web :4174) can be seeded well enough that the returns list, the automation run log and the attention rows render **non-empty**. Where a surface can only be audited empty, the plan says so explicitly and states what that does not cover — an empty state cannot exercise long content, wrapping, or overflow.

### Documentation Gaps

- The style guide's parity matrix says `Tables → card view` at mobile but does not state which `cardView` slots are mandatory for a list to count as having one. `DataTable`'s own JSDoc (no columns fallback) is the real constraint and is the better citation.

---

## 6. Proposed Implementation Plan

### Phase 0 — Instrument and seed (no product change)

**Goal**: make the measurement real and repeatable.

1. **Bring the stack up and confirm both halves.** API on :3011 (`.env.local`, gitignored), web on :4174 pointed at it. Verify a Wave-2 route answers (not 404/401-only).
   - *Acceptance*: `/v1/health` 200; a wave-2 route reachable; the web app loads and authenticates.
2. **Seed enough data that the audited surfaces are non-empty.** At minimum: some orders (for holds / attention / shortfall badges), some returns, some automation rules and runs. Where seeding is impractical, record the surface as **audited empty** and state what that does not cover.
   - *Acceptance*: for each surface, either rows are present or the report names it as an empty-state audit.

### Phase 1 — Measure

**Goal**: numbers, per surface, per breakpoint. "Looks fine" is not a result.

3. **For each surface × {375, 768, 1024}**, via Chrome DevTools MCP: resize, navigate, then evaluate and record
   `document.documentElement.scrollWidth` vs `clientWidth` (and the same on `document.body`), plus `getBoundingClientRect()` for elements where overlap or clipping is plausible.
   - Horizontal page scroll is a defect **except** inside `.data-table__container` and `RawPayloadPanel` (style guide § Responsive).
   - **Also record `window.innerWidth` and the two `matchMedia` verdicts** — `matchMedia('(max-width: 767.98px)').matches` and `matchMedia('(max-width: 768px)').matches` — at every width. A classic vertical scrollbar makes `documentElement.clientWidth` ~15 px narrower than the width media queries evaluate against, which at the 768 px boundary (the whole subject of F1) can invert the reading. Recording both verdicts **observes** which branch each rule took instead of inferring it from a rect.
   - *Acceptance*: a table of measured numbers covering every surface in § 2, at all three widths, each row carrying both `matchMedia` verdicts.
4. **Open every dialog and measure it too** — `place-order-hold`, `release-order-hold`, `automation-composer-dialog`, return custody/decline/dispose, the who-decides `ConfirmDialog`. At 375 px specifically: every control reachable (scroll within the dialog is acceptable; clipped/unreachable is not), no control cut off horizontally, footer buttons not pushed off-screen.
   - **Vertical scroll inside a dialog is by design, not a finding.** `.dialog__content` is `width: min(520px, 92vw); max-height: min(90vh, 720px); overflow-y: auto` (index.css:5241-5244), so at 375 px it is 345 px wide and scrolls internally on purpose. What to look for is **horizontal** clipping, or a footer rendered outside the scroll container so it cannot be reached at all.
   - *Acceptance*: per dialog, at 375 px, a recorded rect for the dialog and for its footer actions, and an explicit statement that each control is reachable.
5. **Re-verify the returns segment strip at 375 px** (F4) — measure each `.returns-segment` rect and assert no vertical overlap between consecutive rows.
   - *Acceptance*: recorded rects; no overlap.
6. **Verify the attention badge renders in the card branch** at 375 px on `/orders`, `/connections`, `/products`, and that it is the same `OmsAttentionBadges` component as the desktop cell.
   - *Acceptance*: badge present at 375 px on all three; same component confirmed by reading the call sites.

### Phase 2 — Fix

**Goal**: minimal, local repairs for what Phase 1 measured. Each fix is justified by a recorded number.

**If a surface measures clean, nothing is changed for it, and that is a complete result.** The deliverable of this issue is the recorded geometry; a surface with no defect owes no fix and no CSS test, and the PR says so per surface. Stated explicitly because an audit that finds little creates quiet pressure to manufacture a change to justify the issue — which would add unmeasured risk to surfaces that are working.

7. **F1 — normalise the who-decides breakpoint** if the 768 px measurement shows the mobile layout firing in the tablet band. Change `max-width: 768px` → the `767.98px` spelling already in the file.
   - *File*: `apps/web/src/index.css` (the `.who-decides-row` block, ~L20097)
   - *Acceptance*: at 768 px the row renders its multi-column grid; at 375 px it renders single-column; both measured.
8. **F2 — surface the returns orphan signal in the mobile card** (per Q1's default), reusing the existing badge rendering rather than a new component.
   - **Use the `summary` slot**, not `meta` and not `detail`. `data-table.tsx` documents `summary` as the *"always-visible summary block … the handful of facts worth showing before expanding"* — an orphan flag is a fact. `meta` already carries `<ReturnStageCell>` (a different fact, and stacking two status signals in one slot is what #2100's independent-parts rule warns against), and `detail` can be collapsed behind `collapsibleDetail`, which would re-hide the badge the fix exists to reveal.
   - **Reuse the existing copy constants** (`RETURNS_ORPHAN_COPY.badge` / `.explanation`, `features/returns/lib/returns-list.copy.ts`). `features/returns` is a live `check-ui-vocabulary` scan root; reused copy is gate-clean by construction, and a new string is not.
   - **Prefer an existing class.** `returns-styles.test.ts` asserts every rendered `returns-*` class has a rule in `index.css`, so a NEW `returns-*` class obliges a CSS rule in the same commit. Reusing `StatusBadge`'s own markup avoids the obligation entirely.
   - *Files*: `apps/web/src/pages/returns/returns-list-page.tsx` (the `cardView` config), possibly `apps/web/src/features/returns/components/return-order-cell.tsx`
   - *Acceptance*: at 375 px an orphan return's card carries the same error-tone badge the desktop cell carries; the existing `returns-list-page.test.tsx` still passes; a new assertion covers the card branch.
9. **Any horizontal-overflow fix Phase 1 surfaced**, scoped to the offending rule. Use `.card-button-reset` for any card-in-button; never a fresh partial reset.
   - *Acceptance*: the measured `scrollWidth === clientWidth` at the width that failed.

### Phase 3 — Pin

**Goal**: nothing in the pipeline parses `index.css`, so any CSS invariant introduced or changed here gets a test.

10. **Add or extend a CSS contract test** for each CSS invariant this issue introduces or changes. Combine the two in-tree precedents:
    - **Finding the right rule** — `ConnectionFold.test.tsx:105` (`queryFor`): brace-match each `@media` block so only that block's OWN body is searched. Its comments record why the naive approaches fail (a `split('@media ')` sweeps up every rule following a block, and the selector also appears outside any media query in a comma group).
    - **Anchoring the selector** — `card-button-reset-styles.test.ts`: strip comments, match rule bodies, compare selectors as **whole tokens** (never `css.includes('.' + name)` — the #2589 trap, which has already produced a false pass on this branch), plus a **guard-of-the-guard** (a deliberately-truncated selector must return no rules).

    **The assertion is per-selector, never file-wide.** An earlier draft proposed *"every Wave-2 mobile-bound media query uses one spelling"*; that is **unimplementable** and must not be attempted. `index.css` is one global 21k-line stylesheet with no provenance marker, so a test cannot know which rules are Wave-2 — written literally it fails on `.error-list__row` (index.css:10458, `max-width: 768px`, **pre-existing**) and on the `640px` automation block that R3 deliberately leaves alone. The only outcomes are a permanently-red test or one quietly narrowed to an unstated hardcoded list, and a test weakened after it failed is the #2589 shape in a new costume.
    - **Concrete form**: assert that the media query guarding `.who-decides-row` is exactly `(max-width: 767.98px)`. One selector, one expected string, honest about its scope, and it still catches the regression.
    - *File*: extend `who-decides-styles.test.ts`, or add a focused sibling.
11. **See every new assertion fail first.** Temporarily break the CSS (or the markup), observe red, restore, observe green. State in the PR, per test, that it was seen red. An assertion nobody has seen fail is a claim, not a guard.
    - *Acceptance*: an explicit red-then-green statement for every new assertion.

### Phase 4 — Gate and ship

12. `pnpm lint` (0 errors), `pnpm type-check`, `pnpm test`, `pnpm test:integration` — all four exit codes reported as numbers, read from the runner's own `Tests:` / `FAIL` lines. Never run the unit suite concurrently with integration. Node 22 throughout, including on the hook's PATH.
    - Known pre-existing failures, named and not chased: **#2638** `earliest-order-date` (TZ offset), **#2639** `allegro-prestashop-carrier-mapping` (S-3 assertion failure, or whole-suite Docker container-creation errors — the latter is infrastructure: `docker container prune -f`, retry once).
13. `git commit -s` (multi-line via tmp file + `-F`). Never `--no-verify`. PR into **`oms-programme-wave-2`**, never `main`.

---

## 7. Alternatives Considered

### Alternative 1: Audit by reading CSS instead of measuring

- **Description**: reason about the media queries and grid definitions to conclude the layouts are correct.
- **Why rejected**: the issue is about rendered geometry, and the brief is explicit that measurement is required. Reading CSS would not have surfaced F1's off-by-one-pixel breakpoint as a *behaviour at an audited width*, and cannot detect overflow caused by content (a long connection name, an unwrapped mono id) rather than by a rule.

### Alternative 2: Convert `/settings/who-decides` and the automation run log to `DataTable` so they inherit `cardView`

- **Description**: replace the hand-written grid and the bare `<ul>` with the shared primitive.
- **Why rejected**: the style guide documents the who-decides carve-out with a stated reason — the only column cheap enough to `hideBelow` is the why-line, which spec § 3.3 calls the whole point of the table, so `DataTable`'s hiding strategy would delete the feature on mobile. Seven fixed rows with no sort, no pagination and no row link are not a table's shape. Converting would be a redesign, explicitly out of scope, and would reverse a decision made with reasons on the record.

### Alternative 3: Normalise every media query in `index.css` to one spelling

- **Description**: sweep all 113 media queries to a single mobile bound.
- **Why rejected**: out of proportion to the issue, touches surfaces this wave did not add, and risks regressions in areas with no measurement backing the change. Scoped to Wave-2 rules whose measurement showed a defect (Q3).

---

## 8. Validation & Risks

### Architecture Compliance

- ✅ Changes confined to `apps/web` (Interface layer). Dependency direction `app → pages → features → shared` untouched.
- ✅ No `@openlinker/core` import added to `apps/web` (#591).
- ✅ No new abstraction. Reuses `DataTable`, `.card-button-reset`, and the existing CSS-contract-test pattern.

### Naming Conventions

- ✅ Components `kebab-case.tsx` / `PascalCase` export; tests `*.test.ts(x)`; CSS contract tests follow the shipped `*-styles.test.ts` naming.

### Risks

- **A CSS contract test that passes on a prefixed class** — the #2589 trap, already responsible for one false pass on this branch. *Mitigation*: whole-token selector matching plus a guard-of-the-guard, per Phase 3; and every assertion seen red first.
- **A fix at one breakpoint regressing another.** *Mitigation*: re-measure all three widths after each fix, not just the one that failed.
- **Auditing an empty state and reporting it as coverage.** *Mitigation*: Phase 0 step 2 forces an explicit statement per surface; the report names any empty-state audit and what it does not cover.
- **Scope creep into redesign.** *Mitigation*: § 2 non-goals; each fix must cite a recorded measurement.
- **The shared dev stack.** Another session's servers occupy :3000/:4173; this work runs on :3011/:4174 against the shared Postgres. *Mitigation*: read-mostly; any seeding is additive.

### Edge Cases

- **Exactly 768 px** — the boundary between two bands and the case F1 is about. Measure at exactly 768, not 767 or 769.
- **Long unbroken content** (a mono id, a long connection name) is the usual real cause of overflow, and is invisible in an empty state.
- **A dialog taller than the viewport at 375 px** — internal scroll is acceptable; a clipped or unreachable control is not. The distinction must be stated per dialog.

### Backward Compatibility

- ✅ No API, schema or contract change. A breakpoint normalisation changes rendering in a 1 px band at one width, deliberately.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit / component tests

- Extend the existing `returns-list-page.test.tsx` for the card-branch orphan badge (F2 fix).
- Extend or add a CSS contract test for the breakpoint invariant (Phase 3), anchored, with a guard-of-the-guard, seen red first.
- Existing tests that must keep passing: `card-button-reset-styles.test.ts`, `who-decides-styles.test.ts`, `returns-styles.test.ts`, `custody-touch-targets.test.ts`.

### Integration tests

- None expected — this issue changes no backend behaviour. `pnpm test:integration` is run as a regression gate, not extended.

### Manual measurement (the primary evidence)

Chrome DevTools MCP against the running app, per surface per breakpoint, recording `scrollWidth` vs `clientWidth` and bounding rects where overlap is plausible. Numbers go in the PR body.

### Acceptance Criteria (from the issue)

- [ ] All Wave-2 surfaces pass a no-horizontal-scroll audit at 375 / 768 / 1024 px — **with recorded numbers per surface per width**
- [ ] Mobile cards and desktop cells share one renderer on every new list — **or the deviation is stated with its reason** (F2 / Q1)
- [ ] The composer dialog is fully operable at 375 px with no clipped control — **verified by measurement, not by reading the documented departure**

### Additional gates

- [ ] `pnpm lint` 0 errors; `pnpm type-check`; `pnpm test`; `pnpm test:integration` — four exit codes reported as numbers
- [ ] Every new assertion seen red before green, stated per test
- [ ] Copy passes `check-ui-vocabulary`
- [ ] Main checkout clean and on `main` (`git status --porcelain` empty)
- [ ] PR opened into `oms-programme-wave-2`, not `main`

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — Interface layer only
- [x] Respects CORE vs Integration boundaries — neither is touched
- [x] Uses existing patterns (`DataTable` `cardView`, `.card-button-reset`, the `*-styles.test.ts` contract-test shape); no new abstraction
- [x] Idempotency — not applicable (no jobs, no writes)
- [x] Event-driven patterns — not applicable
- [x] Rate limits & retries — not applicable
- [x] Error handling — not applicable (no new failure paths)
- [x] Testing strategy complete — CSS contract tests + component tests + recorded measurements
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
- [x] Plan is saved as a markdown file

---

## Related Documentation

- [Frontend UI Style Guide § Responsive](../frontend-ui-style-guide.md) — breakpoints, parity matrix, the two documented departures, the no-horizontal-scroll rule
- [Frontend UI Style Guide § Density & Row Heights](../frontend-ui-style-guide.md) — the who-decides question-row carve-out
- [Frontend Architecture](../frontend-architecture.md) — folder conventions, dependency rules, feature barrels
- [Engineering Standards](../engineering-standards.md) — naming, testing standards
- [Testing Guide](../testing-guide.md)
