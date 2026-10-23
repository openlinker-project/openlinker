/**
 * Unit-suite worker count — one resolver, five readers.
 *
 * The sibling of `jest.test-workers.cjs` (#3263), deliberately a SECOND file
 * rather than a shared one: the two tiers are bounded by different things. The
 * integration count is capped at 15 because Redis ships 16 logical databases
 * and each worker takes one; the unit count has no such ceiling and is bounded
 * only by the container's CPU and memory. Folding them together would make one
 * number carry two unrelated constraints, and the next person raising it for
 * one tier would silently move the other.
 *
 * This file is the single source of the unit worker count. It is required by
 * `libs/core`, `apps/api`, `apps/worker`, `apps/web/vite.config.ts` and
 * `jest.ci-stability.mjs` (which is itself read by
 * `libs/integrations/prestashop` and `libs/integrations/allegro`), so every
 * package that declares a cap declares the same one - vitest included, which
 * is the point: `apps/web` is the one package that is not jest, and leaving it
 * with its own number is how the tier drifts.
 *
 * `apps/web` applies the CI gate at ITS call site rather than taking this
 * file's local value, and that is deliberate: off CI it keeps vitest's own
 * `cores - 1` default, because `.husky/pre-commit` does not run it.
 *
 * CJS, and at the repo root, mirroring `jest.esm-deps.cjs` and
 * `jest.test-workers.cjs` — a jest config is CJS and cannot import from the
 * TypeScript source of a workspace package.
 *
 * @module jest
 */

/**
 * The worker count each unit package runs at ON CI.
 *
 * A literal, not an env var, for the reason `jest.test-workers.cjs` states: a
 * count carried by the workflow file is invisible at the place that reads it
 * and unset everywhere else, so a local run or a second workflow silently
 * falls back to something else while looking configured.
 *
 * 2, and the reason it is not 6 is the difference between the two tiers rather
 * than a disagreement with #3263.
 *
 * Start from the fact #3263 established, which is the single most
 * misunderstood thing about this runner: THE RUNNER IS NOT THE HOST.
 * `bd-build-server` has 64 cores and 251 GiB, and a CI job sees none of it -
 * each job runs inside a container capped at 8 CPUs and 24 GiB. #3263 measured
 * that container at 24GiB/24GiB and 800% of its 800% CPU at 8 workers, after
 * which the kernel killed processes inside its own cgroup. That is why no
 * host-level OOM ever appeared in any log, and it is the real mechanism behind
 * this branch's three reverted 8-worker attempts.
 *
 * What follows from that fact is a budget of ~8 concurrent processes, and the
 * two tiers spend it differently. The integration job runs ONE package at a
 * time, so 6 workers is 6 processes and two CPUs are left over - which is
 * exactly what #3263's comment says it is buying. This job runs FOUR packages
 * at once under `--workspace-concurrency=4`, so the same 6 is 24 processes
 * against 8 CPUs.
 *
 * That was measured here rather than assumed, and it lost twice over:
 *
 *   2 workers (4 x 2 = 8 procs)   3m59s, 4m07s, 4m21s   green
 *   4 workers (4 x 4 = 16 procs)  4m48s                 green
 *   6 workers (4 x 6 = 24 procs)  5m04s                 RED
 *   8 workers (4 x 8 = 32 procs)  13m01s, 17m12s, 18m45s  RED, one runner died
 *
 * The 6-worker failure is worth naming because it is not a flaky test: on the
 * FASTEST runner, `apps/worker`'s `job-intake.consumer.spec.ts` spent 157.9 s
 * and then blew its 10 s `afterAll` teardown, while an `apps/api` controller
 * unit spec that has no business taking more than a second PASSED in 110.8 s.
 * Nothing was broken; everything was just waiting for a CPU.
 *
 * So the product is what the container bounds, not the per-package count, and
 * `packages x workers` wants to land near 8. If this job is ever changed to run
 * one package at a time, 6 becomes the right number here too - the two values
 * are the same rule applied to two different fan-outs.
 */
const DEFAULT_UNIT_TEST_WORKERS = 2;

/**
 * The worker count OFF CI.
 *
 * Unlike the integration tier — which only ever runs against Docker on a
 * machine that opted into it — these configs are reached by
 * `.husky/pre-commit` -> `pnpm smart-test`, which falls back to a bare
 * `pnpm test` on a contributor's own laptop. A laptop does not have eight
 * cores to hand to one package, so the CI number must not leak into it. This
 * is the one place this file deliberately DIVERGES from
 * `jest.test-workers.cjs`.
 */
const LOCAL_UNIT_TEST_WORKERS = 2;

/**
 * Hard ceiling on worker count.
 *
 * Not a Redis-shaped limit like the integration tier's, just a guard against a
 * mistyped override handing jest a number the container cannot host. The
 * container has 8 CPUs; past that, workers queue for CPU rather than work —
 * which is exactly what #3263 measured when 6 came out no slower than 8
 * (190 s vs 193 s).
 */
const MAX_UNIT_TEST_WORKERS = 8;

/**
 * Resolve the unit-suite worker count.
 *
 * `measuredCiDefault` exists for the ONE case where a caller has measured a
 * different number for itself and that measurement is still standing. It is
 * not a convenience: omitting it is what every package should do, and the
 * argument is there so that a package which departs from the shared value has
 * to say so at its own call site, with its figures, rather than quietly
 * keeping a private constant - which is the drift this file exists to stop.
 * `jest.ci-stability.mjs` (prestashop, allegro) and `apps/web` pass it
 * today; both run under a different fan-out from the backend job, and both say
 * so with their figures.
 *
 * `OL_UNIT_TEST_MAX_WORKERS` is an OVERRIDE, for bisecting a
 * parallelism-sensitive failure (`OL_UNIT_TEST_MAX_WORKERS=1` serialises a
 * package) — never the source of the default. A non-numeric, non-finite or
 * sub-1 value resolves to the default rather than throwing: a mistyped
 * override must not take the suite down, and must not silently serialise it
 * either.
 */
function resolveUnitTestWorkers(measuredCiDefault = DEFAULT_UNIT_TEST_WORKERS) {
  const fallback = process.env.CI ? measuredCiDefault : LOCAL_UNIT_TEST_WORKERS;
  const raw = Number(process.env.OL_UNIT_TEST_MAX_WORKERS ?? fallback);
  if (!Number.isFinite(raw) || raw < 1) {
    return fallback;
  }
  return Math.min(Math.floor(raw), MAX_UNIT_TEST_WORKERS);
}

module.exports = {
  DEFAULT_UNIT_TEST_WORKERS,
  LOCAL_UNIT_TEST_WORKERS,
  MAX_UNIT_TEST_WORKERS,
  resolveUnitTestWorkers,
};
