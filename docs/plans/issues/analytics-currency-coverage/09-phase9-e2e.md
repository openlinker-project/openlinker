# [MINI-EPIC] Phase 9 — E2E: state-by-state verification against the repo-committed mockup

> Parent: Epic "Analytics — display-currency picker + data-coverage remediation"
> Depends on: Phases 2-8 all merged into the epic branch (Phase 1 already merged to main before the epic branch was cut)
> Mockup: `docs/plans/mockups/analytics-display-currency-picker.html` — **every** `data-state` value, enumerated below

## Scope

One Playwright spec (`apps/e2e/`, per the existing `docs/architecture-overview.md`-adjacent E2E golden-path convention already used elsewhere in the repo) that, for every state the mockup defines, takes a screenshot of the **real, running** `/analytics` page in that state and a screenshot of the **repo-committed mockup file** in the same state, and asserts they match closely enough to catch a real behavioural drift (structural/visual diff, not pixel-perfect — copy and layout are the two things this catches; exact anti-aliasing is not the point).

**This task must not screenshot the Claude Artifact URL.** The Artifact is a live-editing surface that can change or expire independently of the repo; the baseline is `docs/plans/mockups/analytics-display-currency-picker.html`, read directly off disk (e.g. served via a short-lived local static file server, or opened via `file://`), on the exact commit under test. This is a hard requirement, not a preference — repeat it in the PR description.

## Branching

Branch `phase/2XXX-p9-e2e` off the epic branch. This is the **last** phase branch merged into the epic branch before the epic branch's own PR to `main`.

## Dependencies

- Every other epic-branch phase (2-8) merged into the epic branch first — this phase can only be written meaningfully once the real UI exists to compare against.

## The full state list (source of truth: `grep -oE 'data-goto="[^"]+"' docs/plans/mockups/analytics-display-currency-picker.html`)

| Mockup `data-state` | What it represents | Built in |
|---|---|---|
| `native` | Baseline, no currency conversion applied | Phase 6 |
| `converting` | Brief client-side wait for the response (no backend job — see Phase 1 Task 1.1) | Phase 6 |
| `converted` | Successful multi-currency conversion banner | Phase 6 |
| `unavailable` | A native currency has no resolvable rate | Phase 6 |
| `settings-open` | Analytics Settings dialog, both sections | Phase 6 |
| `all-clear` | Data Coverage panel, zero open categories | Phase 7 |
| `detail-currency` | Currency-mismatch detail modal | Phase 7 |
| `currency-in-progress` | Currency remediation running | Phase 7 |
| `currency-fixed` | Currency remediation resolved (transient closing state) | Phase 7 |
| `currency-failed` | Currency remediation failed | Phase 7 |
| `detail-tax` | Unconfirmed tax-rate (A) detail modal | Phase 7 |
| `tax-confirm` | Tax-rate inclusion setting confirmation dialog (Settings dialog, not the coverage panel) | Phase 6 |
| `detail-novat` | No tax rate (B) detail modal | Phase 7 |
| `detail-postrollout` | Pre-rollout unresolved (C) detail modal | Phase 7 |
| `detail-mapping` | Product-matching-error detail modal | Phase 7 |

(Phase 8's `.excl-note`/`GapMark` annotations are covered as embedded assertions within the `all-clear`/`detail-*` comparisons above, not as separate top-level states — they don't have their own `data-goto` entries in the mockup.)

## Acceptance Criteria (mini-epic level)

- [ ] All 15 states above are exercised against the real app and screenshotted against the repo-committed mockup file — not the Artifact URL.
- [ ] The spec seeds whatever backend fixture data is needed to force each state deterministically (currency-era mismatch fixture, each tax category fixture, a mapping-error fixture, an in-flight/failed remediation run) — no reliance on hand-curated demo-DB state that can drift.
- [ ] The spec is merge-ready on the epic branch (per the user's own standing rule that investigation/verification E2E specs are never throwaway — they land on `main`, not deleted after the PR).
- [ ] A failure in this spec names which specific `data-state` diverged and how, not just "screenshot mismatch."

---

## Task 9.1 — Fixture seeding for all 15 states

### Problem / Context

Every state needs specific, deterministic backend data: a currency-era-mismatched order, one order per tax category (A/B/C), a mapping-error order, plus an in-flight and a failed `analytics_remediation_runs` row. Hand-editing the demo DB (as was done during live diagnosis) is explicitly not repeatable enough for a CI-run E2E spec.

### Proposed Solution

A seed script/fixture module (mirrors whatever seeding convention the existing `apps/e2e` golden-path suite already uses — check `apps/e2e/` for the established pattern before inventing a new one) that creates, via real application services (not raw SQL, matching Phase 5's own "never raw SQL" rule), one order per required state. `currency-in-progress` is the **only** genuinely asynchronous state in the whole list (per Phase 1 Task 1.1's ADR, tax has no job at all) — for it, the fixture triggers the real remediation endpoint and the spec waits on the real `analytics_remediation_runs` row, rather than faking the in-progress state directly in the DB. `tax-confirm` needs no async wait: it's reached by opening the Settings dialog and clicking the toggle, which renders the confirmation dialog before anything is written — the fixture for it is just "one order in category A exists," the state itself is pure client-side UI.

### Classification

**Type**: DX (test infrastructure)
**Layer**: N/A (test fixtures)
**File(s)**: `apps/e2e/` (exact path per existing convention — locate and follow it)

### Dependencies

- Phases 2-5 (backend) must be functional for the seed script to create real fixture states via real services.

### Assumptions

- Fixture creation happens against a disposable test database/environment, not the shared demo DB (per `docs/testing-guide.md`'s Testcontainers-vs-dev-stack separation principle, applied to E2E).

### Acceptance Criteria

- [ ] Each of the 15 states can be reached deterministically from a fresh seed, re-runnable without manual cleanup.
- [ ] Tests added (the seed module itself is testable / at minimum smoke-tested).

---

## Task 9.2 — Screenshot-comparison spec

### Problem / Context

The actual comparison mechanism: for each state, render the real app in that state and the mockup file in the same state, screenshot both, and diff.

### Proposed Solution

Playwright spec that, per state:
1. Navigates the real app to `/analytics` with the seeded fixture active, drives whatever UI interaction reaches that state (e.g. click "Analytics Settings" for `settings-open`, trigger recalculate for `currency-in-progress`), and screenshots the relevant region.
2. Opens `docs/plans/mockups/analytics-display-currency-picker.html` from a **local file source** (`file://` path resolved relative to the repo root, or a short-lived `http-server`/similar started by the spec's `beforeAll` — pick whichever the existing `apps/e2e` suite already does for local static assets, for consistency) and clicks the matching `[data-goto="{state}"]` prototype-rail button to drive the mockup into the same state, then screenshots the same region.
3. Runs a structural/visual diff (e.g. `pixelmatch`/Playwright's built-in `toHaveScreenshot` in a suitably tolerant mode, or a DOM-structure diff if pixel diffing proves too brittle across the two independently-styled documents — choose based on what the existing suite already uses for similar comparisons, note the choice in the PR) and fails with the specific state name and a saved diff image on mismatch.

### Classification

**Type**: DX (E2E test)
**Layer**: N/A
**File(s)**: `apps/e2e/` (spec file, exact name/location per existing convention)

### Dependencies

- Task 9.1.

### Assumptions

- A byte-for-byte pixel match is not the bar — the mockup and the real app are two independently-implemented documents (real components vs. static HTML) that will never pixel-align perfectly. The bar is "the same information, in the same layout shape, with the same copy" — pick a diff tolerance that catches a real regression (a missing row, wrong copy, wrong state) without false-failing on font-rendering noise.

### Acceptance Criteria

- [ ] Spec covers all 15 states listed in the mini-epic table above by name.
- [ ] Spec reads the mockup exclusively via a local file path/server rooted at `docs/plans/mockups/analytics-display-currency-picker.html` — the Artifact URL string does not appear anywhere in the spec or its fixtures.
- [ ] A deliberately-introduced copy regression (e.g. temporarily reverting one string in a real component back to a raw enum value) makes the spec fail, proving it actually catches what it claims to.
- [ ] Spec lands on the epic branch as a permanent, merge-ready addition — not deleted after verification.
