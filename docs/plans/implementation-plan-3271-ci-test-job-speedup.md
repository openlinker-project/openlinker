# Implementation plan - #3271 CI `Test` job speedup

**Layer:** DX / CI. No CORE, Integration, Interface or Frontend code changes.
**Goal:** cut the `Test` job from 14m54s to roughly 6 minutes by fixing two independent causes.
**Non-goals:** touching test *content*, changing `--workspace-concurrency`, migrating the transform (`isolatedModules` / swc), splitting monolithic spec files, fixing the pre-existing handle leak.

---

## 1. Understand the task

Two causes, measured separately on the real runner (`bd-build-server`, 64-core EPYC 7502, 251 GB RAM), whole job `pnpm -r test`, 19 packages, every run green:

| | cold cache | warm cache |
|---|---|---|
| **2 workers** (today) | 753.9 s | 490.3 s |
| **8 workers** | 538.1 s | **256.8 s** |

### Cause A - the jest cache never hits

The runner containers are long-lived; `/tmp/jest_rt` holds 33 GB across ~2M files and is written to daily but never read back. `actions/checkout` rewrites every file on every run, so mtimes are always fresh.

`libs/integrations/prestashop`, 2 workers, content byte-identical throughout:

| state | wall |
|---|---|
| cold (`--clearCache`) | 248.3 s |
| warm, stable mtimes | 73-82 s (10 samples) |
| after `touch` of `libs/core/**/*.ts` | 168.7 / 169.1 / 169.1 / 169.7 s |
| after restoring the same mtimes | 74.9 s |

`pnpm install --frozen-lockfile` (82.5 s) and `pnpm -r build` (78.6 s) do not invalidate it. Only mtime does.

### Cause B - `maxWorkers: 2` is sized for a machine we do not have

#976 capped every package to 2 after OOM kills, when each of 19 packages used jest's default `cores-1` under a full-suite fan-out. On this runner `cores-1` is **63**. Measured whole-job peak RSS at 8 workers: 32.4 GB of 251 GB.

---

## 2. Research - what already exists

- `jest.ci-stability.mjs` - shared `ciStabilityConfig` (`maxWorkers`, `workerIdleMemoryLimit`), imported by exactly two packages: `libs/integrations/prestashop` and `libs/integrations/allegro`.
- `libs/core/jest.config.js`, `apps/api/jest.config.js`, `apps/worker/jest.config.js` - each sets `maxWorkers: 2` inline, none sets `workerIdleMemoryLimit`.
- 14 further packages set no `maxWorkers` at all (pre-existing, out of scope).
- `.github/workflows/ci.yml` - the `test` job has no cache step; `test-integration` already persists `.jest-cache` via `actions/cache@v4`.
- `.husky/pre-commit` runs `pnpm smart-test --no-integration`; `scripts/smart-test.mjs:254` falls back to a bare `pnpm test` with no concurrency bound.

---

## 3. Design

### Step 1 - restore stable mtimes in CI

A repo-local script invoked from the `test` job right after `actions/checkout`, before `pnpm install`. It derives each tracked file's mtime from the commit that last touched it, in **one** `git log` pass rather than one call per file, so a changed file still gets a new stamp and cache keys stay honest.

Deliberately not a blanket fixed timestamp: that works in a lab but stops distinguishing versions across branches.

### Step 2 - CI-gated worker cap

`maxWorkers: process.env.CI ? 8 : 2` in the four config files. CI-gated because `maxWorkers` lives in `jest.config.*`, not in a CI-only overlay, and the pre-commit hook reaches the same files on contributors' machines.

### Step 3 - memory ceiling where it is missing

`workerIdleMemoryLimit: '512MB'` for `libs/core`, `apps/api`, `apps/worker` - the three packages taking 4x the workers with no recycling. Belt-and-braces given the measured 32.4 GB peak, not a necessity.

### Step 4 - documentation truth

Seven comment/doc sites state the old values or reasoning and become wrong. `docs/testing-guide.md:857-858` needs its sentence rewritten, not just its number swapped.

---

## 4. Steps

| # | File | Change | Acceptance |
|---|---|---|---|
| 1 | `scripts/restore-mtimes.mjs` | new; one `git log` pass, sets mtime per tracked file | idempotent; unchanged file keeps its stamp across runs |
| 2 | `.github/workflows/ci.yml` | call it in the `test` job after checkout | step present before `pnpm install` |
| 3 | `jest.ci-stability.mjs` | `maxWorkers: process.env.CI ? 8 : 2` | `CI` unset -> 2 |
| 4 | `libs/core/jest.config.js` | same + `workerIdleMemoryLimit` | as above |
| 5 | `apps/api/jest.config.js` | same + `workerIdleMemoryLimit` | as above |
| 6 | `apps/worker/jest.config.js` | same + `workerIdleMemoryLimit` | as above |
| 7 | comments + `docs/testing-guide.md`, `docs/lessons.md` | correct the stale claims | no doc asserts a value the code contradicts |

---

## 5. Validate

- **Architecture:** none touched. No port, service, entity, DTO or migration.
- **Invariants:** no `check-*.mjs` script reads `maxWorkers`, `workerIdleMemoryLimit` or `workspace-concurrency`.
- **Correctness:** verified directly - a syntax error introduced while rolling mtime back to an identical stamp still failed 21 suites. Jest keys the transform cache on content; mtime only decides whether it re-checks a file.
- **Risk:** flakiness at 8 workers. Five whole-job runs at 8 workers were green, with per-package suite and test counts byte-identical to the 2-worker runs. A static audit found no hard-coded ports, listeners, shared temp files or repo-tree writes in the affected specs; the 12 specs that mutate `process.env` all restore it, and jest workers are separate processes.
- **Known cost:** `worker failed to exit gracefully` warnings scale with worker count (2 -> 4 -> 6). Pre-existing in `libs/core` and `libs/integrations/ksef` at every setting, never escalating to a failure. Tracked as a follow-up.

## Explicitly rejected

- `--workspace-concurrency=4` - pnpm's own default, so it removes the #976 bound rather than loosening it. Measured cost of keeping the bound: 2-11%.
- `diagnostics: false` - 139.3 s -> 145.2 s, within noise.
- `isolatedModules` - `TS5110` across 14 ESM packages, plus 521 errors in `libs/core`, 288 of them decorator-metadata sites NestJS DI depends on.
- `@swc/jest` - same checker-free limitation, same prerequisite migration.
- Splitting `allegro-offer-manager.adapter.spec.ts` as a speed fix - 13.9 s alone against 66.0 s for the package at 8 workers. Not the critical path.
