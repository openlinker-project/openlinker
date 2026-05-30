# Implementation Plan — Restore the worker integration suite to green (#910)

## 1. Goal & scope

**Issue #910** reported that `allegro-order-sync-e2e.int-spec.ts` fails to compile because it
calls `SyncJobRepositoryPort.markSucceeded(id)` one-arg, against the two-arg
`markSucceeded(id, outcome)` contract from the #400 status/outcome split. The issue's "Notes"
asked for an audit of other stale callers.

The audit revealed the breakage was broader: the entire worker integration suite had not been
run for some time (it is not yet in CI — see **#786**) and had accumulated several independent
forms of rot. Scope was expanded (with sign-off) to **restore the full worker integration suite
to green**.

**Layer:** DX / Testing. Test files + the worker integration jest config only. No production
code, no schema, no migration, no CORE/Integration boundary changes.

## 2. What was fixed

**A. `markSucceeded` two-arg contract (the #910 core)** — appended `'ok'` (`JobOutcome`) to all
**12** one-arg call sites across 5 specs (`allegro-order-sync-e2e`, `allegro-cursor-persistence`,
`product-sync-e2e`, `allegro-offer-quantity-update-e2e`, `job-intake-execution`). All are
success-path completions; `'ok'` matches the existing repo unit-test usage.

**B. Compile blockers**
- `helpers/mock-adapters.helper.ts` — `Product` literal missing the required `currency` field
  (added `currency: null`), fallout from #895. Blocked `product-sync-e2e` compile.
- `connection-reauth-flagging.int-spec.ts` — `runFailure`'s `cause` typed `unknown` but passed to
  `SyncJobExecutionError(cause?: Error)` (both call sites pass Allegro exception instances →
  `cause: Error`); and `ormJob.jobType` (`string`) passed to `SyncJob(jobType: JobType)` →
  `ormJob.jobType as JobType`.

**C. Boot/module-resolution blockers** — `test/jest-integration.cjs` `moduleNameMapper` was
missing two workspace packages reached through the worker module graph (every other workspace
lib is mapped to its `src`; these were simply omitted). Added `@openlinker/plugin-sdk` (#593) and
`@openlinker/integrations-ai` (#737).

**D. Behavioral fixture drift** (specs predated contract evolution)
- `allegro-order-sync-e2e` — `OrderItemRefResolver` now maps an `offer` ref to an internal
  *variant* id then loads that variant; the spec seeded only an identifier mapping. Now seeds a
  real `Product` + `ProductVariant` and maps `offer-1 → variant.id`. Also: order routing resolves
  destinations via `IntegrationsService.listCapabilityAdapters` (not `getCapabilityAdapter`), so
  the spec now stubs `listCapabilityAdapters` to return one `OrderProcessorManager` destination
  distinct from the Allegro source.
- `master-inventory-sync-all-e2e` — handler now returns a `SyncJobHandlerResult` (#400); assertion
  changed from `.resolves.toBeUndefined()` to `.resolves.toEqual({ outcome: 'ok' })`.
- `job-intake-execution` — `getAllSyncJobs` required `SyncJobOrmEntity` from the main `@openlinker/core/sync`
  barrel (undefined → `EntityMetadataNotFoundError`); ORM entities live on the
  `@openlinker/core/sync/orm-entities` host-only sub-barrel (#594) — corrected the `require`.

## 3. Verification

- `pnpm lint` + `check:invariants` — clean (cross-context walker covers `apps/worker/test`).
- `pnpm type-check` — clean across all packages; a throwaway `src + test` tsconfig confirms every
  worker int-spec type-checks.
- `pnpm test` — all unit suites pass (core 965, api 445, worker 154, allegro 497, …).
- `pnpm --filter @openlinker/worker test:integration` — **9/9 suites, 23/23 tests pass** (was
  uncompilable on `main`).

## 4. Out of scope

Wiring the worker integration suite into CI (**#786**) — this PR makes it green locally; running
it in CI is that issue's job.
