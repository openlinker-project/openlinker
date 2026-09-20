/**
 * Per-worker database + Redis scoping for worker integration tests (#3263)
 *
 * Runs once per jest worker process, through `setupFiles` in
 * `apps/worker/test/jest-integration.cjs`, and points this process at the
 * database and the Redis logical DB that belong to it alone.
 *
 * ## Why this file exists at all
 *
 * The api suite reaches the same scoping through `@openlinker/test-kit`'s
 * `startContainers()`, which applies it on every one of its paths including
 * the reuse ones. This suite does not: `harness.ts` starts its OWN Postgres
 * and Redis containers and never calls `startContainers()`, so nothing here
 * was ever scoped. Running it at `maxWorkers: 4` therefore put four workers
 * on one database and one Redis logical DB, where `setup-each.ts`'s
 * `reset()` - a full `TRUNCATE ... CASCADE` plus `flushDb()`, before AND
 * after every test case - wipes a peer's data mid-test.
 *
 * ## Why `setupFiles` rather than `setupFilesAfterEnv`
 *
 * `setupFiles` runs before the test framework is installed and before the
 * spec module and its imports are evaluated. `setup-each.ts` is registered
 * under `setupFilesAfterEnv` and imports `./setup` at module load, so
 * scoping from there would be a race against whatever that import graph
 * reads at evaluation time. Nothing in this repo should have to reason about
 * that ordering: the env is set before anything can read it.
 *
 * ## Why it is not merged into `harness.ts`
 *
 * `harness.ts` runs in the globalSetup realm, which is ONE process for the
 * whole run. Env it writes is inherited by every forked worker, so a value
 * computed there is by definition the same value for all of them - the exact
 * shape of the bug. `JEST_WORKER_ID` only distinguishes processes once they
 * exist, which is here.
 *
 * @see harness.ts - creates the databases this file selects between.
 * @module apps/worker/test/integration
 */
import { applyWorkerScope } from '@openlinker/test-kit';

applyWorkerScope();
