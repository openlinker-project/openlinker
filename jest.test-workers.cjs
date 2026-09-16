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
 * 8 rather than the host's core count: the self-hosted runner shares one box
 * with five siblings, so sizing to `os.cpus()` would have each concurrent job
 * claim the whole machine.
 */
const DEFAULT_TEST_WORKERS = 8;

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
