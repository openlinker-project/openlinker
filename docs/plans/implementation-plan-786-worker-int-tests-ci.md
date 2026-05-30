# Implementation Plan — Run worker integration tests in CI (#786)

## 1. Understand the task

**Goal:** Extend the CI `test-integration` job so it also runs the worker Testcontainers
integration suite (`pnpm --filter @openlinker/worker test:integration`), closing the gap that
let worker `AppModule` DI regressions ship twice (#737, #744) — CI only ran the API suite.

**Layer:** DX / CI infrastructure. No application code.

**Why now:** The worker integration suite was uncompilable on `main` until #913 (last session)
restored it to green (9/9 suites, 23/23 tests). With the suite passing, #786 is unblocked.

**Non-goals:**
- No change to the worker harness, specs, or any app/lib code.
- Not chasing CI-specific flakes inline — per AC, if the first CI run flakes, file a separate
  stabilization issue rather than blocking the PR.
- Not touching the self-hosted-runner debate (#557/#662) — orthogonal.

## 2. Research (findings)

`.github/workflows/ci.yml` `test-integration` job (lines 69–101):
- `runs-on: self-hosted`, `needs: [test]`, `timeout-minutes: 30`, job-level
  `env.OL_PII_HASH_SALT`.
- Steps: checkout → pnpm/action-setup@v2 (v9) → setup-node@20 (pnpm cache) →
  `pnpm install --frozen-lockfile` → `pnpm -r --filter "./libs/**" build` → verify core dist →
  `pnpm --filter @openlinker/api test:integration` (`timeout-minutes: 15`).

The worker suite (`apps/worker/test/jest-integration.cjs`) resolves workspace deps via
`moduleNameMapper` to source (ts-jest), uses its own ephemeral Testcontainers (Postgres + Redis,
random ports), and inherits the job-level `OL_PII_HASH_SALT`. Docker is available on the runner
(the API suite already uses it). Running both suites sequentially in one job is safe (separate,
torn-down containers).

## 3. Design

Add **one step** to the existing `test-integration` job, immediately after the API integration
step. It reuses the same `pnpm install`; the libs build is already present for the API step —
the worker suite itself resolves workspace deps via `moduleNameMapper`→source (ts-jest), so it
does **not** depend on the dist build. The step is a real gate that fails the build on a worker
DI regression.

```yaml
- name: Run worker integration tests
  if: ${{ !cancelled() }}          # report worker regressions independently of the API suite
  run: pnpm --filter @openlinker/worker test:integration
  timeout-minutes: 10              # ~80s locally; cap guards a hung container boot
```

Budget: the job-level `timeout-minutes` is raised `30 → 45` so two sequential suites (API 15 +
worker 10, both run under `!cancelled`) plus install + libs build can't trip an opaque job-level
timeout.

`if: ${{ !cancelled() }}` makes the worker suite run even when the API suite fails — #786 is
specifically about catching *worker* `AppModule` DI regressions, so the two suites must report
independently rather than the worker step being skipped behind an API failure.

Rejected alternative: a separate parallel job — it would duplicate install + libs build
(expensive on the self-hosted runner) for no real gain; the issue explicitly proposes a step in
the existing job.

## 4. Step-by-step

1. `.github/workflows/ci.yml` — append the worker integration step to `test-integration` after
   the API step (line ~101).

**Acceptance criteria** (from #786):
- `ci.yml` runs `pnpm --filter @openlinker/worker test:integration` in `test-integration`.
- First green CI run on the PR branch confirms the worker harness boots in the runner.
- (Local proxy for the above, since GH Actions can't run locally) `pnpm --filter
  @openlinker/worker test:integration` passes on this branch.

## 5. Validate

- **Architecture:** CI-only; no boundary impact.
- **Testing:** local re-run of the worker int suite is the pre-merge proxy; the authoritative
  check is the PR's own CI run.
- **Security:** none. No secrets added (`OL_PII_HASH_SALT` already set at job level).
