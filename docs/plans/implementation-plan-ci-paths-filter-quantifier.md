# Implementation plan — CI paths-filter negations need `predicate-quantifier: 'every'` (#2296)

## 1. Understand the task

**Goal.** Make `ci.yml`'s `changes` job actually skip the heavy jobs on a docs-only PR, which is what it was written to do and has never done.

**Layer.** DX / Infrastructure (CI). No application layer is touched — `.github/workflows/ci.yml` only. No CORE, no Integration, no Interface, no Frontend. No migration, no ORM entity, no port, no DTO, no Symbol token, no barrel.

**Non-goals** (explicit):

- Changing *which* jobs are gated. The five gated jobs and the deliberately-ungated `Type Check` / `PHP Unit Tests` stay exactly as they are.
- Changing the filter's pattern list. The four patterns are correct; only their combining rule is wrong.
- Fixing the Lint failure seen on run `32520492989` — the issue states, and this plan accepts, that it was a separate runner-side flake.
- Touching `concurrency`, runner labels, or the draft-PR condition.

## 2. Research — findings that shape the change

### 2.1 The symptom is reproduced

Run `32520492989` (PR #2281, branch `docs/oms-authority-model-design`, a pure-docs change) ran `Lint`, `Test`, `Integration Tests`, `Build` **and** `Docker Build Smoke Test`. `Detect changed paths` reported `code == 'true'`.

### 2.2 The mechanism, from the action's source (not inferred)

`dorny/paths-filter@v3`, `src/filter.ts`:

```ts
const MatchOptions = { dot: true }
…
if (this.filterConfig?.predicateQuantifier === 'every') {
  return patterns.every(aPredicate)
} else {
  return patterns.some(aPredicate)   // default
}
```

Under the default `some`, a changed file matches the `code` rule if it matches **any** listed pattern. Every file matches `'**'`, so the three `!` negations subtract nothing and `code` is `true` whenever the PR changes at least one file of any kind. The gate has been inert since it was added.

**The evidence is tag-relative.** The workflow pins `dorny/paths-filter@v3`, a moving major tag, so the two behaviours above describe `v3` as it stands today, not a fixed commit. Pinning to a SHA would make them permanent, but every other action here (`actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v2`) uses the same moving-tag convention — changing it for this one action alone would be inconsistent, so pinning belongs to its own repo-wide decision rather than this fix.

### 2.3 `dot: true` — consequence for verification

Because picomatch is configured with `dot: true`, `'**'` matches dotfile paths including `.github/**`. Therefore a PR that changes only `.github/workflows/ci.yml` is still `code: true` and runs every job.

This is both **correct behaviour** (a CI change should exercise CI) and **useful**: the PR implementing this plan verifies AC2 on itself, with no contrived second change needed.

### 2.4 Consumers of `outputs.code` — exhaustive

`grep -n "needs.changes.outputs" .github/workflows/ci.yml` yields exactly five, all the same expression:

| Line | Job | `runs-on` |
|---|---|---|
| 58 | `lint` | self-hosted |
| 117 | `test` | self-hosted |
| 149 | `test-integration` | self-hosted |
| 337 | `build` | self-hosted |
| 362 | `docker-build-smoke` | ubuntu-latest |

Ungated: `type-check` (self-hosted, the only required check), `test-php` (ubuntu-latest), `changes` itself (ubuntu-latest).

The issue's assumption "no job other than the five gated ones reads `outputs.code`" is **confirmed**.

### 2.5 The existing comment's arithmetic is correct — do not "correct" it

The comment says *"a docs-only or draft PR then spends 1 self-hosted slot instead of 5"* and names *"the four non-required heavy jobs (lint/test/integration/build)"*.

Both are right, and the reason is non-obvious enough to be worth recording: there are **five** gated jobs but only **four self-hosted** ones — `docker-build-smoke` is gated *and* GitHub-hosted, so it does not enter the self-hosted-slot arithmetic. Five self-hosted jobs exist in total; gating four away leaves `type-check` = 1.

A reviewer counting gated jobs will get 5 and may try to "fix" the 4. The revised comment should make the two counts distinguishable.

**Superseded in part by the pre-implement gate.** The conclusion above is right about the *slot arithmetic* and must not be read as validating the whole comment. The same block also asserts `Type Check` is *"the only required check"*, which `GOVERNANCE.md:53-55` contradicts (it documents the intended required set as `lint`, `type-check`, `test`, and integration-test workflows). Branch-protection settings are not readable from the tree, so neither claim can be settled here. Step 2 therefore **drops the required-check parenthetical** rather than restating it — see `docs/plans/analysis/ANALYSIS-ci-paths-filter-quantifier.md` § Warning.

## 3. Design

One key, one comment. No new file, no new pattern.

```yaml
- uses: dorny/paths-filter@v3
  id: filter
  with:
    predicate-quantifier: 'every'
    filters: |
      code:
        - '**'
        - '!docs/**'
        - '!**/*.md'
        - '!docker-compose.yml'
```

**Semantics after the change.** A changed file counts toward `code` only if it satisfies *all four* predicates: matches `'**'` AND is not under `docs/` AND is not `*.md` AND is not `docker-compose.yml`. The rule is per-file; `code` is `true` if **any** changed file qualifies, which is what makes a mixed docs+code PR run everything (AC3).

**Worked cases:**

| Changed file | `**` | `!docs/**` | `!**/*.md` | `!docker-compose.yml` | `code` |
|---|---|---|---|---|---|
| `libs/core/src/x.ts` | ✓ | ✓ | ✓ | ✓ | **true** |
| `docs/adr/052.md` | ✓ | ✗ | ✗ | ✓ | false |
| `README.md` | ✓ | ✓ | ✗ | ✓ | false |
| `docs/img/diagram.png` | ✓ | ✗ | ✓ | ✓ | false |
| `docker-compose.yml` | ✓ | ✓ | ✓ | ✗ | false |
| `Dockerfile` | ✓ | ✓ | ✓ | ✓ | **true** |
| `.github/workflows/ci.yml` | ✓ (`dot: true`) | ✓ | ✓ | ✓ | **true** |

`Dockerfile` staying `true` matches the existing comment's stated intent ("deliberately NOT ignored: it feeds the future image build once CD is enabled").

## 4. Steps

### Step 1 — add the quantifier

**File**: `.github/workflows/ci.yml` (`changes` job, `paths-filter` step).

Add `predicate-quantifier: 'every'` as a sibling of `filters:` under `with:`.

**Acceptance**: the key is present; YAML still parses; no other key in the step changes.

### Step 2 — record why the quantifier is load-bearing

**File**: `.github/workflows/ci.yml` (comment block above `changes`).

The comment must state:

1. that the pattern list is combined with **AND**, not OR, because of the quantifier;
2. the refactor trap that follows — adding a pattern intending *"also match X"* silently **narrows** the filter to near-nothing rather than widening it, and adding it without the quantifier restores the original inert-gate bug;
3. the 5-gated / 4-self-hosted distinction from §2.5, so the slot arithmetic reads as deliberate.

**Acceptance**: a reader who has never seen `predicate-quantifier` can tell from the comment alone why it is there and what breaks without it.

## 5. Validation

**Architecture compliance**: n/a — no application code. No hexagonal boundary, port, adapter, DI token, barrel, ORM entity or migration is involved.

**`check:invariants`**: unaffected. No script in the chain reads `.github/**`.

**Testing strategy**: this change has no unit-testable surface — the behaviour under change belongs to a third-party action evaluated by GitHub. It is verified by observation, and the observation has a trap that must be avoided.

**The gating condition is a conjunction, and only one conjunct is under test.** Every gated job reads:

```yaml
if: ${{ github.event_name == 'push' || (github.event.pull_request.draft == false && needs.changes.outputs.code == 'true') }}
```

`draft == false` is **ANDed** with the path gate, so a **draft** PR skips all five heavy jobs *regardless of paths* — the same observable outcome AC1 predicts. Verifying AC1 with a draft PR is therefore a **false pass**: the jobs skip for the wrong reason. Likewise the `push` arm means everything runs on `main` regardless, so AC1 is a statement about **pull requests only**.

Verification, in two observations, **both on non-draft PRs**:

- **AC2 (non-docs PR runs everything)** — verified by *this PR*, which touches only `.github/workflows/ci.yml` and, per §2.3, must show all jobs running. This is also the control: it proves the skip in AC1 is caused by the path filter and not by a broken `changes` job.
- **AC1 (docs-only PR skips the heavy jobs)** — cannot be observed from this PR, which is not docs-only. Verified by a throwaway docs-only PR opened against this branch — **marked ready for review, never draft** — whose job list is recorded in the PR before it is closed.
- **AC3 (mixed PR runs everything)** — follows from the per-file rule in §3: the filter evaluates per changed file and `code` is `true` if *any* file qualifies, which is the identical mechanism AC2 exercises. No separate run is needed, but the reasoning is recorded on the issue when the checkbox is ticked rather than left to look untested.

**Security**: none. No secret, credential, permission or runner-label change. `predicate-quantifier` is an input to an already-trusted action at the same major version.

**Risk**: low, but **not one-directional** — the plausible failure is precisely "jobs wrongly skipped", and it is silent.

`dorny/paths-filter` validates `predicate-quantifier` and **fails the step** on an unrecognised value. All five gated jobs declare `needs: changes` and **none** carries `always()`, so a failed `changes` job causes GitHub to *skip* every dependent job. On a code PR that means `Lint`, `Test`, `Integration Tests`, `Build` and `Docker Build Smoke Test` all skip — and because `type-check` and `test-php` carry no `needs: changes`, they still run and go green. The PR then shows two green checks plus five skips: indistinguishable at a glance from a healthy docs-only PR.

What actually bounds the damage is not the direction of the failure but the fact that **`Type Check` stays ungated** — it runs on every PR whatever the filter says or does. That is the safety property worth preserving; the quantifier's own failure mode deserves no benefit of the doubt.

## 6. Open questions

None blocking. One decision recorded for the reviewer: AC1's verification is by observation on a throwaway PR rather than by an automated assertion, because there is no mechanism in this repo to unit-test a GitHub Actions path filter.
