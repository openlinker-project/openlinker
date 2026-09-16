/**
 * Integration-suite worker count — one resolver, three readers.
 *
 * The integration tiers ran `maxWorkers: 1` because the whole run shared ONE
 * Postgres database and ONE Redis logical DB, while the harness resets state
 * between tests with `TRUNCATE ... CASCADE` + `flushDb()` — so a second worker
 * would wipe a peer's data mid-test. `libs/test-kit`'s `startContainers()` now
 * gives every worker its own database (`openlinker_test_<JEST_WORKER_ID>`) and
 * its own Redis logical DB, which is what makes a worker count above 1 safe.
 *
 * This file is the single source of that number. It is required by BOTH
 * integration jest configs (to size `maxWorkers`) and by `containers.ts` (to
 * decide how many databases to create), because the two must agree: a worker
 * whose database was never created fails with a raw "database does not exist",
 * which reads like a broken test rather than a mis-set env var.
 *
 * CJS, and at the repo root, mirroring `jest.esm-deps.cjs` — a jest config is
 * CJS and cannot import from the TypeScript source of `libs/test-kit`.
 *
 * @module jest
 */

/**
 * Hard ceiling on worker count.
 *
 * Redis ships 16 logical databases (0-15) and `JEST_WORKER_ID` is 1-indexed,
 * so worker 16 would have no logical DB of its own to take. Raising this
 * requires giving each worker its own Redis INSTANCE, not just its own
 * index — a different change with a different cost.
 */
const MAX_TEST_WORKERS = 15;

/**
 * The worker count the integration suites run at.
 *
 * A literal, not an env var. The count was briefly carried by
 * `OL_TEST_MAX_WORKERS` set in `ci.yml`, which made the single most important
 * number in this change invisible at the place that reads it and unset
 * everywhere else - so a local run, a `workflow_dispatch` that forgot the
 * env, or any second workflow silently fell back to serial while looking
 * configured.
 *
 * 6, lowered from 8 (#3263). The runner is not the host: each CI job runs
 * inside a container capped at 24 GiB and 8 CPUs, and the host's 251 GiB is
 * not available to it. At 8 workers that container was measured sitting at
 * 24GiB/24GiB and 800% of its 800% CPU, and the kernel then killed processes
 * inside its cgroup - which is what the `exit=137` on Postgres and Redis was,
 * and why no host-level OOM ever appeared in any log.
 *
 * 8 was green before the transform change and stopped being green after it,
 * with neither change wrong on its own: transpile-only removed an 11.9 s
 * per-file stall, so the same peak demand now arrives in a quarter of the
 * time instead of being spread out by the compiler.
 *
 * 6 leaves two of the eight CPUs for the Postgres, Redis and PrestaShop
 * containers that share the same cap, which 8 did not.
 */
const DEFAULT_TEST_WORKERS = 6;

/**
 * Resolve the integration-suite worker count.
 *
 * `OL_TEST_MAX_WORKERS` survives as an OVERRIDE, for bisecting a
 * parallelism-sensitive failure (`OL_TEST_MAX_WORKERS=1` restores the old
 * serial behaviour) - never as the source of the default. A non-numeric,
 * non-finite or sub-1 value resolves to the default rather than throwing: a
 * mistyped override must not take the suite down, and must not silently
 * serialise it either.
 */
function resolveTestWorkers() {
  const raw = Number(process.env.OL_TEST_MAX_WORKERS ?? DEFAULT_TEST_WORKERS);
  if (!Number.isFinite(raw) || raw < 1) {
    return DEFAULT_TEST_WORKERS;
  }
  return Math.min(Math.floor(raw), MAX_TEST_WORKERS);
}

module.exports = { DEFAULT_TEST_WORKERS, MAX_TEST_WORKERS, resolveTestWorkers };
