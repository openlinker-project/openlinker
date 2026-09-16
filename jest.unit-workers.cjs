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
 * 6, matching the integration tier (#3263/#3271). The number comes from the
 * same measured fact, which is the single most misunderstood thing about this
 * runner: THE RUNNER IS NOT THE HOST. `bd-build-server` has 64 cores and
 * 251 GiB, and a CI job sees none of that — each job runs inside a container
 * capped at 8 CPUs and 24 GiB. #3263 measured that container sitting at
 * 24GiB/24GiB and 800% of its 800% CPU at 8 workers, after which the kernel
 * killed processes inside its own cgroup. That is why no host-level OOM ever
 * appeared in any log, and it is the real mechanism behind this branch's three
 * reverted 8-worker attempts.
 *
 * 6 leaves two of the eight CPUs for everything that is not a test worker.
 */
const DEFAULT_UNIT_TEST_WORKERS = 6;

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
 * `OL_UNIT_TEST_MAX_WORKERS` is an OVERRIDE, for bisecting a
 * parallelism-sensitive failure (`OL_UNIT_TEST_MAX_WORKERS=1` serialises a
 * package) — never the source of the default. A non-numeric, non-finite or
 * sub-1 value resolves to the default rather than throwing: a mistyped
 * override must not take the suite down, and must not silently serialise it
 * either.
 */
function resolveUnitTestWorkers() {
  const fallback = process.env.CI ? DEFAULT_UNIT_TEST_WORKERS : LOCAL_UNIT_TEST_WORKERS;
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
