# Pre-implementation Analysis — #2278 concurrency lanes

**Plan**: `docs/plans/implementation-plan-2278-concurrency-lanes.md`
**Gate run**: 2026-08-21 (deep pass, worktree at `6a335fddd`)
**Verdict**: **READY** (with three plan corrections, all reuse-side — no contract break)

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `SyncJobLane` union / `sync-job-lane.types.ts` | NEW (confirmed absent) | zero matches for `SyncJobLane` / `sync-job-lane` / `'lane'` in `libs/core/src` + `apps/worker/src` |
| `resolveJobScope` | NEW (confirmed absent) | zero matches for `resolveJobScope` / `JobScope` in core |
| `findAndLockDueJobsForLane` | NEW (additive beside existing method) | port at `sync-job-repository.port.ts:74`, impl at `sync-job.repository.ts:126` |
| `OL_LANE_*` env vars | NEW (no collision) | zero matches in libs/apps |
| Lane-carrying registry | PARTIAL (extend `SyncJobHandlerRegistry`) | `apps/worker/src/sync/handlers/sync-job-handler.registry.ts` |
| Runner concurrency spec | **PARTIAL — the plan is wrong here** | `apps/worker/src/sync/__tests__/sync-job.runner.spec.ts` **exists** (~1060 lines; the plan's "no runner spec exists" came from globbing `*.spec.ts` beside the source instead of `__tests__/`). Registry spec also exists: `handlers/__tests__/sync-job-handler.registry.spec.ts` |

## Plan corrections (fold in before implementing)

1. **Extend, don't create, the runner spec.** `__tests__/sync-job.runner.spec.ts` already covers the
   failure ladder, rate-limit requeue, heartbeat, and loop lifecycle with a real classifier registry.
   The concurrency rewrite must keep every existing scenario green (they pin the per-job machinery the
   plan promises is unchanged) and the five new AC scenarios are added there — same for the registry
   spec's new lane reads.
2. **The old `findAndLockDueJobs` is NOT consumer-free — retain it, drop the "remove iff unused"
   clause.** Live consumers besides the runner: `apps/worker/test/integration/job-intake-execution.int-spec.ts`
   (calls it directly, twice) and api-side mock objects (`connection.controller.spec.ts:94`,
   `sync.controller.spec.ts:52`). Keeping it also keeps the int-spec meaningful as a claim-semantics
   regression test.
3. **Registry `register` gaining a required lane param breaks exactly two test files** — the registry
   spec (~8 two-arg calls) and nothing else: the `.register(` hits in
   `woocommerce-offer-manager-test-harness.helper.ts` are `adapterRegistry.register` (different
   registry), and the two boot int-specs reference `SyncJobHandlerRegistry` without calling
   `register`. Both files to update are enumerated in the same PR. **Caveat from the regression
   ledger**: worker int-specs are compile-checked only at int-test runtime (`pnpm lint`/`type-check`
   exclude `apps/worker/test`), so the targeted int-spec run in the quality gate is load-bearing, not
   optional.

## Backward-compatibility findings

- **No Critical.** The port method is additive; existing mocks use partial-object
  `as unknown as jest.Mocked<...>` casts, so an added interface method does not break their
  compilation — only the reworked runner spec must mock the new method because the code under test
  now calls it. No barrel symbol is removed (`libs/core/src/sync/index.ts` uses explicit named
  exports — the new lane types need explicit export lines added, an addition). No DTO, no Symbol
  token, no ORM schema change (no migration; `migration:show` run for safety).
- **Warning — `check-service-interfaces`**: not applicable (no new core application service; the
  lane types file uses the documented pure-rule exception for `resolveJobScope`).
- **Warning — cross-context imports**: none introduced (worker already imports
  `@openlinker/core/sync` barrel symbols; lane types export through the same barrel).

## Open questions (non-blocking)

1. Claim-ordering within a lane stays `ORDER BY "nextRunAt" ASC` — unchanged semantics, worth a
   sentence in the port JSDoc.
2. The `excludedScopes` SQL arm (`"connectionId" != ALL($4)`) must handle the empty-array case by
   omission (Postgres `!= ALL('{}')` is vacuously true, but parameter-count bookkeeping is simpler
   with a conditional clause) — implementation detail, noted so the spec covers both branches.

## Verdict rationale

No contract breaks, no reuse collision that survives the three corrections above; the substantive
risk (first concurrent handler execution) is a design property the existing runner spec's
preserved scenarios plus the five new ones bound. **READY.**
