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
 * Resolve the integration-suite worker count from `OL_TEST_MAX_WORKERS`.
 *
 * Defaults to 1, so an integration run with no env var set behaves exactly as
 * it did before this seam existed. A non-numeric, non-finite or sub-1 value
 * also resolves to 1 rather than throwing: a mistyped env var must not take
 * the suite down.
 */
function resolveTestWorkers() {
  const raw = Number(process.env.OL_TEST_MAX_WORKERS ?? '1');
  if (!Number.isFinite(raw) || raw < 1) {
    return 1;
  }
  return Math.min(Math.floor(raw), MAX_TEST_WORKERS);
}

module.exports = { MAX_TEST_WORKERS, resolveTestWorkers };
