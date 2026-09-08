/**
 * Per-test isolation for API integration tests (#2986)
 *
 * Registers a root-level `beforeEach` + `afterEach` calling
 * `resetTestHarness()` for EVERY int-spec. Wired in through
 * `setupFilesAfterEnv` in `apps/api/test/jest-integration.cjs`, so it applies
 * by omission rather than by each new spec's author remembering to call it.
 *
 * ## What was wrong
 *
 * Of the 127 int-specs in this directory before this change, 118 reset in
 * `afterEach` ONLY and six reset nowhere at all (`api-versioning`,
 * `automation-dispatch-gate`, `bootstrap-admin-disabled`,
 * `fulfillment-work-migration-parity`, `listings-offer-status-snapshot`,
 * `oms-connection-never-seeded`).
 *
 * An `afterEach`-only reset is a courtesy to the NEXT file; it is not
 * isolation for THIS one. A file's first test case reads whatever the previous
 * file left behind, and this config runs `maxWorkers: 1` against one shared
 * Postgres and declares no `testSequencer`, so which file that is can change
 * between runs. PR #2957 measured the consequence rather than theorising it:
 * 41 assertions in `paginated-total-split.int-spec.ts` were passing only
 * because of accidental row state left by whichever spec ran immediately
 * before it. They were not true in isolation.
 *
 * ## Why both halves
 *
 * `beforeEach` is the load-bearing one: it is what makes a spec's assertions
 * true in isolation whatever ran before it, and it is the only half that
 * protects a spec reading a table it never writes. `bootstrap-admin-disabled`
 * asserts zero `admin` users, so a neighbour's leaked login row fails it for a
 * reason that has nothing to do with what it tests.
 *
 * `afterEach` preserves the invariant this suite already relies on - every
 * file leaves the database clean - so that a spec which ever has cause to opt
 * OUT of the `beforeEach` still cannot poison its neighbours, and so a run
 * inspected afterwards is not showing the last file's leftovers.
 *
 * ## Why here rather than in `setup.ts`
 *
 * Two reasons. `setup.ts` is an ordinary module, and calling Jest globals at
 * its top level would make it unimportable from any realm where `beforeEach`
 * is undefined - this config has two such realms already (`globalSetup` /
 * `globalTeardown`), and `teardown.ts` carries a standing rule about what it
 * may import from there, for its own separate reason. More importantly, hooks
 * placed in `setup.ts` would reach only the specs that happen to import it,
 * which is the same "remember to wire it up" failure one level down.
 * `setupFilesAfterEnv` is Jest's own mechanism for a hook that cannot be
 * skipped by omission, and `apps/worker/jest.config.js` already uses it.
 *
 * The import below is deliberately static rather than a lazy `import()`:
 * `module: Node16` does not reliably downlevel a dynamic import to `require`,
 * and every int-spec already imports this module at its own top level, so
 * requiring it here resolves the SAME singleton from the same per-file module
 * registry and changes no evaluation order that matters (the harness applies
 * its `env` block lazily inside `setup()`, not at construction).
 *
 * ## Cost
 *
 * Read off `truncateTables` in `libs/test-kit/src/harness.ts` rather than
 * guessed: it probes first (one `UNION ALL ... WHERE EXISTS` round-trip) and
 * issues `TRUNCATE` only for tables that actually hold a row, so a reset
 * immediately following another one costs ONE round-trip and truncates
 * nothing. `resetTestHarness()` is additionally a no-op when the harness was
 * never booted. The added cost is therefore at most two probe round-trips per
 * test case (1010 cases at the time of the audit) and never an extra
 * `TRUNCATE`.
 *
 * ## The opt-out audit (#2986's second ask): nobody needs one
 *
 * - NO int-spec seeds database rows in `beforeAll` - checked across all 127,
 *   twice, the second time with a wide net that also catches HTTP seeding and
 *   helpers whose names do not contain "seed". So the global `beforeEach`
 *   cannot destroy a suite-scoped fixture. The only `beforeAll` bodies that
 *   touch the database at all are the two migration-chain specs'
 *   `DROP`/`CREATE DATABASE`, and two specs that register an in-memory
 *   adapter, neither of which a `TRUNCATE` can reach.
 * - `fulfillment-work-migration-parity` and `oms-connection-never-seeded`
 *   build the real migration chain in a SECOND database and assert against
 *   that database plus `information_schema` / `pg_catalog`. Truncation cannot
 *   cross a database boundary in Postgres and changes no catalogue row, so the
 *   reset is invisible to every assertion they make. Note the corollary: if
 *   either were ever "simplified" to query the harness DataSource instead,
 *   this reset would make its zero-row assertion trivially true, which is the
 *   "check that cannot fail" both of those docblocks exist to warn about.
 * - No `afterEach` or `afterAll` hook anywhere in the suite reads or asserts
 *   database state, so the added `afterEach` cannot pull state out from under
 *   a teardown hook.
 *
 * The six files are deliberately left unedited: adding six calls to a function
 * the global hook already calls would reinstate the per-file remembering this
 * exists to remove.
 *
 * @see harness-isolation.int-spec.ts - the regression guard that fails if this
 *   file stops being registered.
 * @module apps/api/test/integration
 */
import { resetTestHarness } from './setup';

// Both hooks are the same idempotent call, so their order relative to a spec's
// own hooks does not matter - only that one of them runs before the first
// assertion of every test.
beforeEach(async () => {
  await resetTestHarness();
});

afterEach(async () => {
  await resetTestHarness();
});
