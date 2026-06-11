# Implementation Plan: Make the migration-ordering guard actually fire in CI (PR #1015 review remediation)

**Date**: 2026-06-11
**Status**: Ready for Review
**Estimated Effort**: 1–2 hours

---

## 1. Task Summary

**Objective**: Address @piotrswierzy's IMPORTANT review finding on PR #1015: the new migration-ordering invariant (#1013, rule 4 in `scripts/check-migration-timestamps.mjs`) silently skips in CI on `pull_request` builds — the only place it can usefully fire — because the lint job's checkout never creates the `refs/remotes/origin/main` tracking ref.

**Context**: `validateOrdering` derives its baseline from `git ls-tree -r --name-only origin/main`. `loadBaselineFilenames` returns `null` (→ check skipped with a one-line notice) whenever that ref is unavailable. The CI `lint` job (`.github/workflows/ci.yml:16`) uses `actions/checkout@v4` with default options — a shallow fetch of only the triggering ref — so on PR builds `origin/main` does not exist and the guard skips. On `push: [main]` builds the ref exists but the migration is already merged and counts as baseline, so it can never flag there either. Net: the prevention pillar of PR #1015 never runs on the pre-merge path that would have caught #881. Both the script header ("CI always has the ref") and `docs/migrations.md` rule 3 ("CI always has it") assert the opposite of reality and must be aligned.

**Classification**: Infrastructure / DX (CI workflow + invariant script) + Documentation

---

## 2. Scope & Non-Goals

### In Scope
- Make `origin/main` available to the CI `lint` job so the ordering check runs on PR builds.
- Harden the script so a *future* regression of this availability fails loudly in CI instead of silently skipping (the "confirm it prints `checked`, not `skipped`" ask, made self-enforcing).
- Align the three places that claim "CI always has the ref": script header comment, `loadBaselineFilenames` doc comment, `docs/migrations.md` rule 3.
- Update the PR #1015 description to reflect the corrected prevention story.
- Verify on the live PR build that the lint log prints `ordering vs origin/main: checked`.

### Out of Scope
- The fix migration itself (`1802000000000-add-shipment-carrier.ts`) — reviewer confirmed it correct; untouched.
- Other CI jobs (`type-check`, `test`, `build`, …) — only `lint` runs `pnpm lint` → `check:invariants`.
- Local developer behaviour — the graceful skip for exotic local setups (no remote) stays; pre-commit already works because developers have `origin/main`.

### Constraints
- Self-hosted runner: checkout workspaces may be **reused** between runs, so the fetch step must tolerate a pre-existing (possibly stale) `origin/main` ref.
- Keep the lint job fast — avoid full-history fetch if a targeted fetch suffices.

---

## 3. Architecture Mapping

**Target Layer**: Repo tooling (`scripts/`), CI workflow (`.github/workflows/`), docs. No CORE / Integration / runtime code touched.

**Capabilities Involved**: None (no ports).

**Existing Services Reused**: `scripts/check-migration-timestamps.mjs` invariant-script pattern (pure validators + `--self-check` fixtures); `check:invariants` chain into `pnpm lint`.

**New Components Required**: None — one new workflow step, one small branch in the script's `runAgainstTree`, doc edits.

**Core vs Integration Justification**: N/A — build/CI infrastructure only.

---

## 4. External / Domain Research

### `actions/checkout@v4` behaviour (the root cause)
- Default `fetch-depth: 1` fetches **only the triggering ref** (`refs/pull/N/merge` on `pull_request` events) into a detached HEAD. No `refs/remotes/origin/main` tracking ref is created → `git ls-tree origin/main` throws → `loadBaselineFilenames` returns `null` → skip.
- `fetch-depth: 0` would fetch full history + all branches — works, but pays full-clone cost on every lint run and fetches far more than needed (`git ls-tree` only needs the **tree of the main tip**, not its history).
- A targeted post-checkout fetch is the precise tool:
  ```bash
  git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main
  ```
  - `--depth=1`: the tip commit's tree is all `ls-tree` needs.
  - `+` (force) refspec: on a **reused self-hosted workspace** the ref may already exist from a previous run; shallow histories can defeat fast-forward detection, so a non-forced refspec can fail spuriously. `main` is never force-pushed, so forcing the tracking ref is safe.
  - `--no-tags`: keeps the fetch minimal.

### Why `push: [main]` builds are inherently blind (accepted, documented)
After merge, the just-merged migration **is** the baseline max — `validateOrdering` finds no entry off-baseline, so it passes vacuously. This is fine: the guard's job is pre-merge. The docs wording must say "enforced on PR builds", not "CI always has it".

### Internal Patterns
- **Skip-vs-fail precedent**: the script already distinguishes environments implicitly (graceful skip for local). Making the skip a **hard failure when `CI=true`** mirrors how `allegro-prestashop-carrier-mapping.int-spec.ts` gates on `process.env.CI` (documented in `docs/testing-guide.md`) — `CI=true` is already a recognized environment signal in this repo. GitHub Actions sets `CI=true` automatically.
- **Self-check style**: pure validators driven by inline fixtures. The CI-fail branch is I/O-adjacent (env + process exit), so it gets a tiny pure helper + fixtures, same as `validatePluginMigrationDirsDrift`.

---

## 5. Questions & Assumptions

### Open Questions
- None blocking. (If the team prefers `fetch-depth: 0` for simplicity over the explicit fetch step, the swap is one line — see Alternatives.)

### Assumptions
- `CI=true` is set on all GitHub Actions runners including the self-hosted one (GitHub sets it unconditionally; no workflow override exists in this repo). Safe default: the hard-fail branch keys on `process.env.CI === 'true'`, exactly the gate shape already used in the integration-test suite.
- The self-hosted runner's reused workspace may carry a stale `origin/main`; the `+`-refspec fetch refreshes it every run, so staleness cannot produce a wrong baseline.
- PR #1015's description is editable by the author (`gh pr edit`).

### Documentation Gaps
- `docs/migrations.md` rule 3's parenthetical "(CI always has it)" is factually wrong today — fixed by this plan, not just softened.

---

## 6. Proposed Implementation Plan

### Phase 1: Make the ref available in CI

**Goal**: `git ls-tree origin/main` succeeds in the lint job on `pull_request` and `push` builds.

**Steps**:

1. **Add a targeted fetch step to the `lint` job**
   - **File**: `.github/workflows/ci.yml`
   - **Action**: After `actions/checkout@v4` (before `pnpm lint` is sufficient; right after checkout is clearest), insert:
     ```yaml
     - name: Fetch origin/main (baseline for migration-ordering invariant)
       run: git fetch --no-tags --depth=1 origin +refs/heads/main:refs/remotes/origin/main
     ```
   - **Acceptance**: On a PR build, `git rev-parse --verify origin/main` succeeds in the lint job; lint log prints `ordering vs origin/main: checked`.
   - **Dependencies**: None.

### Phase 2: Make the skip impossible to regress silently in CI

**Goal**: If the ref ever becomes unavailable in CI again (e.g. someone later "simplifies" the workflow), `pnpm lint` fails loudly instead of printing a skip notice nobody reads.

**Steps**:

2. **Add a pure mode-resolution helper + hard-fail branch**
   - **File**: `scripts/check-migration-timestamps.mjs`
   - **Action**: Add a small exported pure function, e.g.:
     ```js
     export function resolveMissingBaselineAction({ isCi }) {
       return isCi ? 'fail' : 'skip';
     }
     ```
     In `runAgainstTree`, replace the `baselineFilenames === null` branch:
     - `skip` (local): current behaviour — notice line, ordering check skipped.
     - `fail` (CI): push a violation such as
       `ordering vs origin/main: ref unavailable in CI — the lint job must fetch origin/main (see .github/workflows/ci.yml); refusing to skip the #1013 ordering invariant`
       and exit non-zero through the existing violations path.
     Key on `process.env.CI === 'true'` at the single call site; the helper itself stays env-free (pure).
   - **Acceptance**: With `CI=true` and `origin/main` removed locally (`git update-ref -d refs/remotes/origin/main` in a scratch clone), `node scripts/check-migration-timestamps.mjs` exits 1 with the actionable message; without `CI`, it still prints the skip notice and exits 0.
   - **Dependencies**: None (independent of step 1, but together they form the belt-and-suspenders).

3. **Extend `--self-check` fixtures**
   - **File**: `scripts/check-migration-timestamps.mjs` (bottom, `runSelfCheck`)
   - **Action**: Two fixtures for `resolveMissingBaselineAction`: `{ isCi: true } → 'fail'`, `{ isCi: false } → 'skip'`. Same pass/fail harness style as the existing ordering fixtures.
   - **Acceptance**: `node scripts/check-migration-timestamps.mjs --self-check` prints `self-check OK`.
   - **Dependencies**: Step 2.

### Phase 3: Align the wording everywhere the false claim lives

**Steps**:

4. **Fix the script's two comments**
   - **File**: `scripts/check-migration-timestamps.mjs`
   - **Action**:
     - Header (invariant 4 bullet, ~line 25): replace "Skipped with a one-line notice when the `origin/main` ref is unavailable" with the new two-mode truth: skipped locally, **hard failure in CI** (`CI=true`), and note the lint job's explicit fetch step provides the ref.
     - `loadBaselineFilenames` doc comment (~line 157): drop "CI always has the ref, so the skip only relaxes exotic local setups"; state that CI guarantees the ref via the workflow fetch step and refuses to skip.
   - **Acceptance**: No remaining `CI always has` claim in the file (`grep -n "CI always" scripts/check-migration-timestamps.mjs` empty).

5. **Fix `docs/migrations.md` rule 3 wording**
   - **File**: `docs/migrations.md` (~line 64, Timestamp uniqueness invariant)
   - **Action**: Replace "is skipped with a notice when that ref is unavailable (CI always has it)" with: skipped with a notice **locally** when the ref is unavailable; in CI (`CI=true`) a missing ref is a hard lint failure, and the `lint` workflow job explicitly fetches `origin/main` after checkout so the check runs on every PR build. Optionally note the `push`-to-main vacuous-pass property (the guard is a pre-merge gate).
   - **Acceptance**: `grep -n "CI always has it" docs/migrations.md` empty; the new wording matches the shipped behaviour.

6. **Add a `docs/lessons.md` entry**
   - **File**: `docs/lessons.md`
   - **Action**: One entry per the file's format: *git-ref-dependent lint guards silently skip under shallow `actions/checkout` defaults — any `check:invariants` script that shells out to `git … origin/main` must (a) be paired with an explicit ref fetch in the CI job and (b) hard-fail rather than skip when `CI=true`.* Root cause: reviewer-caught on PR #1015.
   - **Acceptance**: Entry present, follows the documented format at the top of the file.

### Phase 4: Verify on the live PR + update the PR description

**Steps**:

7. **Run the quality gate locally**
   - **Action**: `pnpm lint` (includes `check:invariants` → the modified script against the real tree, which has `origin/main` → mode `checked`), plus `node scripts/check-migration-timestamps.mjs --self-check`.
   - **Acceptance**: Both green. No type-check/test impact expected (no TS/runtime code touched), but run `pnpm type-check` for the hook anyway.

8. **Commit, push, confirm CI log**
   - **Action**: Commit on the PR branch (`1013-fix-migration-ordering`) with DCO sign-off; push. Open the PR's `Lint` job log and confirm it prints `migration-timestamps: OK (… ; ordering vs origin/main: checked)` — **not** `skipped`.
   - **Acceptance**: The literal `checked` line in the PR-build lint log (this is the reviewer's explicit verification ask).

9. **Update the PR #1015 description + reply to the review comment**
   - **Action**: `gh pr edit 1015` — amend the Prevention paragraph: the graceful-skip claim becomes "skips locally / hard-fails in CI; lint job fetches `origin/main` explicitly". Reply to @piotrswierzy's comment summarizing the remediation (fetch step + CI hard-fail + doc alignment) with a link to the green lint log line.
   - **Acceptance**: Description matches shipped behaviour; reviewer comment answered.

### Implementation Details

**Configuration Changes**: one new step in `.github/workflows/ci.yml` `lint` job. No env vars, no migrations, no events.

**Error Handling**: the CI hard-fail message names the workflow file and the exact fix, matching the script's existing actionable-message style.

---

## 7. Alternatives Considered

### Alternative 1: `fetch-depth: 0` on the lint job's checkout
- **Description**: One-line change to `actions/checkout@v4` (`with: fetch-depth: 0`) — full clone, all refs, `origin/main` guaranteed.
- **Why Rejected**: Fetches full history on every lint run; on the self-hosted runner this is wasted I/O for a check that needs only the tip tree of one branch. The explicit fetch is equally one step, cheaper, and self-documenting (the step name says *why* the ref is needed).
- **Trade-offs**: `fetch-depth: 0` is more idiomatic and resilient if other ref-dependent checks appear later. If a second consumer of git history shows up in the lint job, switch to it then.

### Alternative 2: Soften the docs only (reviewer's stated fallback)
- **Description**: Keep CI as-is; reword docs/PR to say the guard is pre-commit-only.
- **Why Rejected**: Leaves the #1013 prevention pillar unenforced on exactly the path that let #881 through — pre-commit can be bypassed (`--no-verify`) and contributors' local setups vary. The CI fix is two small steps; there's no reason to accept the weaker posture.
- **Trade-offs**: None meaningful given the fix's size.

### Alternative 3: Fetch inside the script (script self-heals by running `git fetch`)
- **Description**: `loadBaselineFilenames` falls back to fetching the ref itself before `ls-tree`.
- **Why Rejected**: A lint invariant script mutating repo refs as a side effect is surprising (pre-commit runs would hit the network); violates the script's current read-only contract and its pure-validator design. CI environment setup belongs in the workflow.
- **Trade-offs**: Would cover *all* CI configs without workflow edits, but at the cost of network I/O in every local `pnpm lint`.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No layer boundaries involved; follows the established `check:invariants` script pattern (pure validators + self-check fixtures).

### Naming Conventions
- ✅ New helper `resolveMissingBaselineAction` is camelCase, exported for self-check, side-effect-free — matches `validateOrdering` / `validatePluginMigrationDirsDrift` precedent.

### Existing Patterns
- ✅ `CI=true` gating mirrors the integration-test precedent; workflow step style matches the existing named steps.

### Risks
- **Self-hosted reused workspace with stale/odd ref state**: mitigated by the `+`-forced refspec and `--depth=1` re-fetch every run.
- **`CI=true` set in a non-GitHub context without the ref (e.g. a future external CI)**: the hard fail is then a *correct* loud signal — the message tells the operator to fetch the ref. Local developers without `CI` are unaffected.
- **PR branch protection re-runs**: the new fetch step adds ~1s to the lint job; no timeout risk (job budget 30 min).

### Edge Cases
- **First-ever migration repo state (empty baseline)**: unchanged — `validateOrdering` accepts anything on an empty baseline; the fetch still succeeds.
- **`push` to `main` builds**: fetch succeeds, check runs, passes vacuously (migration already in baseline) — documented, expected.
- **Forked-repo PRs**: `origin` points at the base repo on `pull_request` checkouts, so `refs/heads/main` is fetchable without fork credentials.

### Backward Compatibility
- ✅ No runtime, schema, or API changes. Local `pnpm lint` behaviour unchanged for developers (skip notice preserved when `CI` unset).

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- `--self-check` fixtures for `resolveMissingBaselineAction` (both modes) — the script's established in-file test harness; no Jest spec needed for an `.mjs` invariant script (matches existing precedent: none of the `check-*.mjs` scripts have Jest specs).

### Integration Tests
- None — the end-to-end verification is the live PR lint-job log (step 8), which exercises the real workflow + script path.

### Mocking Strategy
- N/A (pure fixtures only).

### Acceptance Criteria
- [ ] PR-build lint log prints `ordering vs origin/main: checked` (not `skipped`).
- [ ] With `CI=true` and no `origin/main` ref, the script exits 1 with an actionable message naming the workflow file.
- [ ] Without `CI`, missing ref still produces the skip notice and exit 0.
- [ ] `--self-check` green; `pnpm lint` + `pnpm type-check` green.
- [ ] No "CI always has it/the ref" claim remains in `scripts/check-migration-timestamps.mjs`, `docs/migrations.md`, or the PR #1015 description.
- [ ] `docs/lessons.md` entry added; reviewer comment answered on the PR.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (N/A — tooling only; no boundaries crossed)
- [x] Respects CORE vs Integration boundaries (untouched)
- [x] Uses existing patterns (invariant-script + self-check + `CI=true` gate precedents)
- [x] Idempotency considered (fetch step is idempotent per run; forced refspec handles reused workspaces)
- [x] Event-driven patterns used where applicable (N/A)
- [x] Rate limits & retries addressed (N/A — single local git fetch)
- [x] Error handling comprehensive (actionable hard-fail message in CI; graceful local skip preserved)
- [x] Testing strategy complete (self-check fixtures + live-CI verification)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready

---

## Related Documentation

- [Database Migrations](./migrations.md) — Timestamp uniqueness invariant (rule 3)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md) — `CI=true` gating precedent
- PR #1015 review thread (piotrswierzy, 2026-06-11) — the finding this plan remediates
- Issue #1013 — original migration-ordering bug
