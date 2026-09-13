/**
 * Per-test isolation for worker integration tests (#2999)
 *
 * Registers a root-level `beforeEach` + `afterEach` calling
 * `resetTestHarness()` for EVERY int-spec. Wired in through
 * `setupFilesAfterEnv` in `apps/worker/test/jest-integration.cjs`, so it
 * applies by omission rather than by each new spec's author remembering to
 * call it. This is the worker-side twin of `apps/api/test/integration/setup-
 * each.ts` (#2986 / PR #2996), registered on `perf-programme-2840` and not
 * yet on `main` at the time this file was written — this port stands on its
 * own regardless of when that lands.
 *
 * ## What was wrong
 *
 * Of the 27 int-specs in this directory, 21 reset in `afterEach` (a handful
 * also in `beforeEach`) and SIX reset nowhere at all:
 * `automation-dispatch-boot`, `automation-emission-boot`,
 * `fulfillment-no-injection-boot`, `fulfillment-router-binding-boot`,
 * `invoicing-auto-issue-boot`, `oms-module-boot`. `jest-integration.cjs`
 * declared no `setupFilesAfterEnv` at all, so there was no place a root-level
 * hook could be registered without adding one — `apps/worker/jest.config.js`
 * has one, but that is the UNIT config and does not apply to this run.
 *
 * An `afterEach`-only reset is a courtesy to the NEXT file; it is not
 * isolation for THIS one, and six files had neither. `jest-integration.cjs`
 * declares `maxWorkers: 1` against one shared Postgres + Redis and no
 * `testSequencer`, so which file runs immediately before another is not
 * stable between runs. The evidence this matters is on the api side (PR
 * #2957): 41 assertions in `paginated-total-split.int-spec.ts` were passing
 * only because of accidental row state left by whichever spec ran
 * immediately before it — they were not true in isolation.
 *
 * ## Why the worker fix is NOT a copy of the api one (this is the audit)
 *
 * `apps/worker`'s `reset()` (`setup.ts`) is materially more destructive than
 * the api's: alongside the table truncation it calls `redisClient.flushDb()`
 * — ALL of Redis, not just the harness's own keys. The worker harness also
 * boots real background stream consumers (`WORKER_RUNNER_ENABLED` and
 * `WORKER_INTAKE_ENABLED` are forced off by `harness.ts`'s `startHarness()`
 * for exactly this reason, but `OL_MASTER_DELETION_CONSUMER_ENABLED` is NOT
 * — `MasterDeletionToJobHandler` runs a live consume loop against
 * `events.master.deletion` / the `master-deletion-offer-pause` group in
 * every worker int-spec, boot specs included). A `flushDb()` between every
 * test case could in principle destroy a consumer group, a Pending Entries
 * List, a `jobdedup:*` key or a `SyncLockPort`-shaped lock a `beforeAll` set
 * up and a LATER test case in the same file still depends on — and the
 * failure would look like a consumer bug, not a harness one.
 *
 * So, per spec, per #2999's audit:
 *
 * - **`stream-consumer-recovery.int-spec.ts`** and **`stream-retention.int-
 *   spec.ts`** are the two files that create Redis Stream consumer groups
 *   directly. Both mint a FRESH, uniquely-named stream (`randomUUID()`) —
 *   and therefore a fresh consumer group — inside EACH `it()` via a
 *   `freshStream()`/equivalent helper called from the test body itself, never
 *   from `beforeAll`. Nothing here spans two test cases, so a `flushDb()`
 *   between cases removes only state the NEXT case is about to recreate from
 *   scratch. Both already call `resetTestHarness()` in their own `afterEach`
 *   today, so this global hook changes nothing about what they tolerate —
 *   only how uniformly it is applied.
 * - **`job-intake-execution.int-spec.ts`** writes one entry to the
 *   `jobs.sync` stream inside a single `it()` and never reads it back from
 *   Redis in a later case (the assertions that follow read Postgres via
 *   `jobRepository`). No cross-case Redis dependency.
 * - **`master-inventory-deletion-e2e.int-spec.ts`** reads
 *   `harness.getRedisClient()` inside its OWN test bodies (not `beforeAll`)
 *   to inspect the `events.master.deletion` stream produced by the sync
 *   under test in that same case; each case starts from the reset harness
 *   and produces its own event. No cross-case dependency.
 * - **No other file** touches `xGroupCreate`, `jobdedup:*`, or a
 *   `SyncLockPort`-shaped key directly — every remaining Redis-adjacent
 *   file (`allegro-*`, `master-*`, `product-sync-e2e`,
 *   `marketplace-offers-sync-e2e`, `inventory-*`,
 *   `woocommerce-shop-product-inventory-writeback`,
 *   `connection-reauth-flagging`, `regulatory-status-reconcile-di`) drives
 *   its assertions through Postgres / mocked adapters and already calls
 *   `resetTestHarness()` in its own `afterEach` — i.e. it is ALREADY
 *   tolerant of a `flushDb()` immediately after each of its own cases.
 * - **The six never-reset "boot" specs** (`automation-dispatch-boot`,
 *   `automation-emission-boot`, `fulfillment-no-injection-boot`,
 *   `fulfillment-router-binding-boot`, `invoicing-auto-issue-boot`,
 *   `oms-module-boot`) resolve providers from the already-booted container
 *   and assert DI wiring; none creates a database row or a Redis key in
 *   `beforeAll` that a later `it()` in the same file reads back. They were
 *   not deliberately exempted — none carries a comment claiming it needs
 *   inherited state — they simply predate any reset convention existing for
 *   this directory at all.
 * - **`MasterDeletionToJobHandler`'s live consume loop** (see above) already
 *   runs against a `flushDb()`'d Redis in every one of the 21
 *   already-resetting specs today. An earlier revision of this audit added
 *   that "this change doesn't alter that exposure, only extends the same
 *   reset uniformly" — **that was wrong** (#3126 review), and wrong precisely
 *   in the six files this change exists for. `initializeConsumerGroup()` runs
 *   ONCE, at `onModuleInit`, with `MKSTREAM: true`; `consumeLoop()` catches
 *   every read error, logs at **error** level, sleeps 1 s and retries — it
 *   never recreates the group. So the first `flushDb()` destroys
 *   `events.master.deletion` and the `master-deletion-offer-pause` group for
 *   the rest of that file's run, and the six boot specs, which previously
 *   flushed NEVER, would emit an error-level line per second — in exactly the
 *   specs whose purpose is diagnosing boot wiring.
 *
 *   No assertion breaks (`master-inventory-deletion-e2e.int-spec.ts` reads
 *   the stream via `xRange`, not through the consumer group), so this is
 *   diagnosability rather than correctness — which is why it needed catching
 *   by a reviewer rather than by a red test. `reset()` now recreates the
 *   stream and group immediately after the flush
 *   (`restoreMasterDeletionConsumerGroup`, `setup.ts`), best-effort, so the
 *   loop's next read succeeds. #2164's stream-consumer-recovery primitives
 *   (`resolveConsumerName`, `readOwnPending`, `reclaimOrphans`) are what make
 *   a wiped-then-recreated group and PEL survivable for a real consumer; this
 *   harness does not re-verify that property, `stream-consumer-recovery.int-
 *   spec.ts` does.
 *
 * Conclusion: **shape 1** from the issue's ordered candidate list (a root-
 * level `beforeEach`/`afterEach`, the api shape) is safe here — no spec
 * depends on Redis state surviving between its OWN test cases. There is no
 * finding that would justify shape 2 (Postgres-only global reset with Redis
 * left to per-file opt-in) or shape 3 (per-file hooks in the six).
 *
 * ## Why both halves
 *
 * `beforeEach` is the load-bearing one: it is what makes a spec's assertions
 * true in isolation whatever ran before it, and the only half that protects
 * a spec reading a table/stream it never writes — exactly the six boot specs,
 * whose provider-resolution assertions have nothing to do with a neighbour's
 * leftover connection row.
 *
 * `afterEach` preserves the invariant the 21 already-resetting specs already
 * rely on — every file leaves Postgres and Redis clean — so a spec that ever
 * has cause to opt OUT of the `beforeEach` still cannot poison its
 * neighbours, and a run inspected afterwards is not showing the last file's
 * leftovers.
 *
 * **The load-bearing half was, until #3126's review, guarded by nothing.**
 * `harness-isolation.int-spec.ts` originally could not tell the two hooks
 * apart, so deleting ONLY the `beforeEach` line left it green — and that is
 * the plausible edit, because `afterEach` looks sufficient. It now carries a
 * case that distinguishes them: a row written in `beforeAll` is asserted gone
 * in the FIRST `it()`, which no `afterEach` can have removed (nothing has
 * finished yet). Removing either half turns that file red.
 *
 * ## The 21 specs' own `resetTestHarness()` calls are deliberately kept
 *
 * They are idempotent and, since `reset()` probes first, nearly free once
 * this hook has already run — so removing them is cosmetic, touches 21 files,
 * and would make every one of them conflict with anything else in flight.
 * They are redundant, not required: a new spec needs no reset call of its
 * own, and `docs/testing-guide.md` says so for the worker suite. Deleting
 * them is a follow-up worth doing on its own, not a prerequisite for this.
 *
 * ## Why here rather than in `setup.ts`
 *
 * Same two reasons as the api precedent. `setup.ts` is an ordinary module
 * imported from `globalSetup`/`globalTeardown` realms where Jest globals
 * (`beforeEach`) are undefined, so calling them at its top level would break
 * those realms. And hooks placed in `setup.ts` would reach only the specs
 * that happen to import it — the exact "remember to wire it up" failure this
 * exists to remove. `setupFilesAfterEnv` is Jest's mechanism for a hook that
 * cannot be skipped by omission.
 *
 * ## Cost
 *
 * `reset()` (`setup.ts`) now probes before truncating and before flushing
 * Redis (`DBSIZE`, an O(1) server-side counter). The probe is `truncateTables`
 * from `@openlinker/test-kit/harness` ITSELF, not a copy of it (#3126 review)
 * — a copy dropped the helper's `pg_constraint` CASCADE-closure expansion,
 * which is the one mechanism that makes probe-then-truncate equivalent to the
 * unconditional truncate it replaces. A reset immediately following
 * another reset (the common case once this hook runs `beforeEach` AND
 * `afterEach` back to back) now costs two cheap probe round-trips and no
 * `TRUNCATE`/`flushDb()` at all, rather than 7 unconditional `TRUNCATE`
 * statements plus an unconditional whole-database flush. `resetTestHarness()`
 * is additionally a no-op when the harness was never booted.
 *
 * @see harness-isolation.int-spec.ts - the regression guard that fails if
 *   this file stops being registered.
 * @module apps/worker/test/integration
 */
import { resetTestHarness } from './setup';

// Both hooks are the same idempotent call, so their order relative to a
// spec's own hooks does not matter - only that one of them runs before the
// first assertion of every test.
beforeEach(async () => {
  await resetTestHarness();
});

afterEach(async () => {
  await resetTestHarness();
});
