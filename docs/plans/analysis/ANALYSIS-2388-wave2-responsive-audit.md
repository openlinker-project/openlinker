# Readiness Analysis: Wave-2 responsive audit (#2388)

**Plan**: `docs/plans/implementation-plan-wave2-responsive-audit.md`
**Date**: 2026-08-30
**Baseline**: `origin/oms-programme-wave-2` (**not** `main` — every "already exists" check below is against the wave branch)
**Gate**: read-only. No source and no plan file was edited.

---

## Verdict: **READY**

No Critical findings. The plan creates no port, service, DI token, ORM entity, capability, controller or DTO, so the usual reuse-collision and contract-break classes are structurally absent — the only artifacts it touches are `apps/web` CSS, one `cardView` config, and test files. Three findings below are **reuse hits that strengthen the plan** (an existing test pattern the plan should copy rather than invent, and a canonical breakpoint spelling that settles the plan's own open question Q3), plus two Warnings about gates the work will pass through.

---

## Phase B — Reuse audit

| Plan artifact | Classification | Evidence |
|---|---|---|
| Ports (`*Port`) | **None proposed** | Plan section 3 states no new port. Confirmed: no `libs/core` change in scope. |
| Services (`*Service`) | **None proposed** | — |
| DI tokens (`*.tokens.ts`) | **None proposed** | — |
| ORM entities / schema | **None proposed** | No migration; `docs/migrations.md` not engaged. |
| Capabilities (`CoreCapabilityValues`) | **None proposed** | — |
| Controllers / DTOs | **None proposed** | — |
| `DataTable` `cardView` seam | **ALREADY EXISTS -> reuse** | `apps/web/src/shared/ui/data-table.tsx` — `DataTableCardView<Row>` with `title` / `subtitle` / `meta` / `detail` / `summary` / `select` / `actions`. The plan correctly reuses it and adds no slot. |
| `.card-button-reset` | **ALREADY EXISTS -> reuse** | `apps/web/src/index.css`, pinned by `apps/web/src/shared/ui/card-button-reset-styles.test.ts`. Plan section 3 already mandates reuse. |
| CSS contract-test pattern | **ALREADY EXISTS -> reuse (see R1)** | Four in-tree precedents; one is a near-exact fit the plan did not cite. |
| Breakpoint normalisation target | **ALREADY EXISTS -> reuse (see R2)** | The repo has a canonical spelling; the plan's Q3 can be closed. |

### R1 — A closer precedent than the plan cites, for the Phase-3 breakpoint test

The plan (section 4 "Testing patterns to follow", Phase 3) proposes copying `card-button-reset-styles.test.ts`'s anchoring discipline. That is right, but there is a **nearer** precedent the plan does not mention:

`apps/web/src/features/connections/components/ConnectionFold.test.tsx:105` — *"is the exact CSS complement of the column it replaces"* — already extracts a **media query for a given selector** by brace-matching, and its own comments record why the naive approaches fail:

> Brace-matched, so only the media block's OWN body is searched. A naive `split('@media ')` also sweeps up every rule that follows a block until the next one — and `.data-table__cell--hide-below-1024` appears outside any media query too (in a comma group), so a looser guard finds the wrong [block].

The Phase-3 test needs exactly this primitive (`queryFor(selector)` -> the media condition guarding it). **Recommendation**: copy `ConnectionFold.test.tsx`'s brace-matched `queryFor` for the query-extraction half and `card-button-reset-styles.test.ts`'s whole-token selector matching + guard-of-the-guard for the anchoring half. Neither alone is sufficient: the first finds the right block, the second stops a prefixed class satisfying the assertion (the #2589 trap).

This is a **reuse finding, not a defect** — the plan's approach is sound, it just under-cites.

### R2 — The canonical breakpoint spelling is `X.98px`, which closes the plan's Q3

The plan's finding F1 flags four spellings of the mobile bound and asks (Q3) how far normalisation should go, defaulting to the `767.98px` form "already used at L19055". The grep settles it more strongly than the plan states — `767.98px` is not merely *one of* the spellings in use, it is the spelling **the shared primitive and every column-hiding rule use**:

| Consumer | Query | File:line |
|---|---|---|
| `DataTable` card/table switch | `(max-width: 767.98px)` | `data-table.tsx:248` |
| `.data-table__cell--hide-below-480` | `(max-width: 479.98px)` | `index.css:3088` |
| `.data-table__cell--hide-below-768` | `(max-width: 767.98px)` | `index.css:3094` |
| `.data-table__cell--hide-below-1024` | `(max-width: 1023.98px)` | `index.css:3100` |

So the `.98` form is the house convention for the *fractional-pixel complement of a `min-width` band*, applied consistently across the one primitive every list renders through. `.who-decides-row`'s `max-width: 768px` (index.css:20097) is the outlier, and the consequence is exactly what F1 predicts and is worth restating precisely:

**At a viewport of exactly 768 px, `DataTable` is in its desktop-table branch (`767.98` does not match) while `.who-decides-row` is in its mobile single-column branch (`768` does match).** Two components on the same page disagree about which band they are in, at one of the three audited widths. That is a measurable defect, not a style preference.

**Recommendation**: close Q3 in favour of the plan's own default — normalise `.who-decides-row` to `767.98px` and leave the rest of the file alone. Note that `index.css:10458` (`.error-list__row`) carries the same `max-width: 768px` spelling and is **pre-existing, not Wave 2**; the plan's scoping rule (Q3 default: Wave-2 rules only, and only where a measurement showed a defect) correctly excludes it. Say so in the PR so the next reader does not read the survivor as an oversight.

### R3 — `640px` is a fifth band with no counterpart anywhere

`@media (max-width: 640px)` (index.css:20434, `.automation-rules__state` / `.automation-suggestion__actions .button`) is not any documented band — the style guide defines only 768 and 1024. It is **not** one of the three audited widths, so it cannot be measured directly by this audit, and normalising it would be a behaviour change with no measurement behind it. **Recommendation**: report it as an observation in the PR, change nothing. Flagging it costs nothing and prevents it being mistaken for a bound this audit endorsed.

---

## Phase C — Backward-compatibility checklist

| Surface | Assessment | Severity |
|---|---|---|
| Top-level barrels (`@openlinker/core/<ctx>`) | Untouched. `apps/web` cannot import `@openlinker/core` (#591) and the plan adds no such import. | — |
| Port method signatures | Untouched. | — |
| DTO shapes | Untouched — no API change. | — |
| Symbol tokens | Untouched. | — |
| ORM schema | Untouched. No migration required. | — |
| **FE feature barrels** (`features/*/index.ts`) | The F2 fix may need the orphan badge rendering reachable from `returns-list-page.tsx`. `ReturnOrderCell` and `returnOrderSummary` are already used there, so the existing barrel surface is very likely sufficient. **If** a new symbol must be exported, that is a one-line barrel edit, not a break. | — |
| `check-ui-vocabulary` | **W1** — see below. | Warning |
| Existing CSS contract tests | **W2** — see below. | Warning |
| `check-cross-context-imports` / `check-service-interfaces` | Not engaged — neither walker covers `apps/web`. | — |

### W1 — Every folder the plan touches is a live `check-ui-vocabulary` scan root

All four Wave-2 feature folders are declared **`pending: false`** in `scripts/check-ui-vocabulary.mjs` `SCAN_ROOTS`, i.e. actively scanned:

| Folder | Declared owner |
|---|---|
| `apps/web/src/features/fulfillment-authority` | `W2-17 (#2354)` |
| `apps/web/src/features/automation` | `W2-27 (#2364)` |
| `apps/web/src/features/returns` | `W1c-8 (#2335)` |
| `apps/web/src/features/orders` | `W2-A (#2342)` |

Any operator-facing string the F2 fix introduces (e.g. a badge label or a `title` explanation on the returns card) is scanned. The house rule stands: **if the gate rejects a string, fix the copy, never the gate** — and specifically, do not add a file to the by-file exemption list to get a string through. **Mitigation**: prefer reusing the existing copy constants (`RETURNS_ORPHAN_COPY.badge` / `.explanation` in `features/returns/lib/returns-list.copy.ts`) over authoring new strings; reused copy is already gate-clean by construction.

### W2 — Two existing CSS contract tests read the rules this plan may change

- `who-decides-styles.test.ts` asserts (a) every rendered `who-decides-*` class has a rule in `index.css`, (b) `who-decides` rules reference only declared custom properties, (c) `who-decides-row__inactive` and `__candidates` do not share a `grid-area`. A breakpoint change to the `.who-decides-row` media block touches none of the three, but the test is the natural home for the new assertion (plan Phase 3 already proposes this).
- `returns-styles.test.ts` asserts every rendered `returns-*` class has a rule. **If the F2 fix introduces a new `returns-*` class it must get a CSS rule in the same commit**, or this test fails. Reusing an existing class (or a non-`returns-`-prefixed shared class such as `StatusBadge`'s own) avoids the obligation entirely and is the lower-risk route.

Neither is a break; both are gates the work passes through and should be anticipated rather than discovered.

---

## Open questions

The plan's own Q1–Q3 are the real ones. This gate can close one and sharpen the others:

- **Q3 — closed.** R2 above: normalise `.who-decides-row` to `767.98px`, scope the change to that rule, note the pre-existing `.error-list__row` sibling in the PR. No further sweep.
- **Q1 — sharpened, still a judgement call for the human.** The plan's default (surface the orphan *badge* in the card; leave the `title`/`subtitle` plain-text summary shape alone) is consistent with `DataTable`'s documented constraint — the card renders **solely** from `cardView` with no `columns` fallback (`data-table.tsx`), so the badge really is lost at <= 767.98 px today, and that is a genuine operator-facing loss of a red attention signal rather than a cosmetic difference. Recommend proceeding with the default and stating both readings of AC-2 in the PR, exactly as the plan says.
- **Q2 — leave as the plan states.** `dispatch-risk-page.tsx`'s two-slot `cardView` should be measured and reported; fix only on evidence of a lost *actionable control*. No reuse or contract consideration bears on it.
- **New, minor**: the plan's Phase 0 allows a surface to be "audited empty". Recommend the PR state, per empty-state audit, the specific thing it cannot cover (long unbroken content — a mono id or a long connection name — is the usual real cause of overflow and is invisible in an empty state, as the plan's own section 8 Edge Cases notes).
