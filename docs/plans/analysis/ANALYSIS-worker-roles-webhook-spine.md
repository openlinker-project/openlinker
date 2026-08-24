# Pre-implement Analysis — Durable webhook spine + worker roles (#2280 + #2279)

**Plan**: `docs/plans/implementation-plan-worker-roles-webhook-spine.md`
**Gate run**: 2026-08-21 (deep pass, 2 audit agents + 2 prior research agents, all findings file:line-grounded)

## Verdict: NEEDS-REVISION

No reuse collision anywhere — every proposed name is confirmed NEW. But the gate found **one unresolvable-DI break the plan would hit at boot**, one missing dependency declaration, one test-infrastructure hazard, and several smaller corrections. All are plan-level fixes.

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `InboundRouteResolution`, `resolve()` on routing interface, `IWebhookJobGateService`, `WebhookJobGateRepository`, `LegacyInboundWebhookDrain`, `WEBHOOK_JOB_GATE_*` | **NEW** | zero hits; existing sibling type is `RoutingOutcome` |
| `WorkerRole(Values)`, `resolveWorkerRoles`, `SingletonRoleLease`, `RoleCoverageAssertionService`, `StuckJobRecoveryService`, `WorkerSchedulerModule`, `MaintenanceModule`, `OL_WORKER_ROLE`, `OL_SCHEDULER_LEASE_TTL_MS`, `singleton:` key prefix | **NEW** | only mentioned in plan/ADR docs; no code/env/manifest hit |
| `SyncLockPort.extend` | **NEW method** on the sole implementer (`RedisSyncLockService`, which has **no existing spec** — the plan's spec is a new file); no in-memory testing fake exists |
| Transactional gate | **NEW** — no existing service writes `sync_jobs` + another table in one tx; `insertIfNew`/`deleteByEventKey` have exactly one production caller (`WebhookService`) |
| `CORE_CAPABILITY_TASKS` / `CoreCapabilityTaskDescriptor` | file-local, unexported — the SchedulerService move is self-contained (3 files + one `sync.module.ts` import deletion) |

## Backward-compat findings

**Critical (would break at boot or compile):**

1. **`AuthModule` cannot resolve `SYNC_LOCK_TOKEN` today** — `apps/api/src/auth/auth.module.ts` imports `UsersModule`/`UsersApiModule`/`CoreMailerModule`/Passport/Jwt only, and core `SyncModule` is not `@Global`. The demo-cleanup per-tick lock therefore fails DI at boot as planned. **Fix**: `auth.module.ts` imports core `SyncModule` (`@openlinker/core/sync`) — it exports `SYNC_LOCK_TOKEN`; no cycle (core SyncModule has no auth edge).
2. **`apps/worker/package.json` declares neither `@nestjs/schedule` nor `cron`** — both required by the moved SchedulerService + `ScheduleModule.forRoot()`. Add worker-side (`@nestjs/schedule@4.0.0`, `cron@3.1.3`, matching api pins); **api can then drop both** — post-move, the only api consumers are the three files being moved/converted.
3. **`SyncLockPort.extend` blast radius = exactly 7 spec files** with structurally-typed bare-literal mocks that fail compile on a required method: `order-sync.service.spec.ts:111`, `shipment-dispatch.service.spec.ts:125`, `fiscal-registration.service.spec.ts:91`, and four WooCommerce specs (`woocommerce-order-processor.fulfillment-status.spec.ts:59`, `woocommerce-order-processor.adapter.spec.ts:85`, `woocommerce-address-provisioner.spec.ts:43`, `woocommerce-customer-provisioner.spec.ts:27`). Seven cast-through mocks are safe. One-line `extend` addition each.

**Warnings / required plan additions:**

4. **Worker int-test harness hazard**: all 16 worker int-specs boot the full `AppModule` via `WorkerIntegrationTestHarness` (`test/integration/setup.ts:39`) — under `forRoles(all)` the scheduler role would newly start `ScheduleModule` + cron **inside integration tests**, the exact Jest event-loop-hang hazard the api setup documents (`apps/api/test/integration/setup.ts:163-172`). Fix: the lease coordinator carries a runtime gate (`OL_SCHEDULER_ENABLED`, default on — same shape as the retained `WORKER_RUNNER_ENABLED` gates inside roles), worker int setup sets it `false`, and every lease/cron timer is `.unref()`d + stopped on module destroy. `invoicing-auto-issue-boot.int-spec.ts` ("HARD GATE" DI assertion) + `regulatory-status-reconcile-di.int-spec.ts` are the sharpest guards that `forRoles('all')` reproduces today's provider graph.
5. **Raw SQL must set `createdAt`/`updatedAt` explicitly** — both tables' timestamps come from TypeORM decorators (app-side), not guaranteed DB defaults; `sync_jobs.attempts/maxAttempts/nextRunAt` DO have DB defaults and may be omitted. Verify against the migration during implementation; safest is explicit `now()`.
6. **The #711 compensating delete retires on this path** — with the transactional gate, a pre-commit failure rolls back both rows (no delete needed) and a post-commit failure must NOT delete. `webhook.service.spec.ts` block 4 (delete-on-publish-failure) is rewritten, not preserved; `deleteByEventKey` stays on the port (unused in production after this — flagged, not removed).
7. **`webhook-delivery-status-monotonic.int-spec.ts` must keep passing** — the #1916 rank guard is retained (plan already says so); the gate insert writes `job_enqueued` directly, which the ladder permits.
8. **Routing mocks**: no `jest.Mocked<IInboundRoutingPolicyService>` exists anywhere — adding `resolve()` breaks no typed mock. The one typed consumer is `erli-orders-vertical-slice.int-spec.ts` S1, which calls `route()` via the token — **`route()` must be retained** (plan already keeps it) or S1 reworked; retained is cheaper and keeps the S2-S7 slices meaningful.
9. **Runner spec surgery**: `sync-job.runner.spec.ts` has a whole `describe('startStuckJobRecovery')` block (:1076-1169) that relocates with the extraction — not a silent breakage, but a named work item (and a rebase-conflict surface with Wave 3).
10. **`webhook-ingestion.int-spec.ts` is the heaviest rework**: its publish/drain/dedup assertions describe the retired pipeline; the plan's four new int-assertions replace them. Sibling provider specs (erli/infakt/inpost webhook ingestion) assert endpoint→job outcomes and mostly survive with assertion-target changes (job row instead of stream).
11. `ScheduleModule` removal from api is **safe**: zero api int-spec references; the `OL_*_SCHEDULER_ENABLED: 'false'` env block in api setup becomes a no-op (comment updated) and removes a known Jest-hang hazard.
12. Worker `AppModule` dynamic conversion touches exactly **two** call sites: `main.ts:21` and `test/integration/setup.ts:39`. No `Test.createTestingModule({imports:[AppModule]})` usage exists.

## Open questions

None blocking. All resolved into plan revisions below.

## Required plan revisions

- Add: AuthModule imports core `SyncModule`; worker package.json gains `@nestjs/schedule`+`cron`, api drops both; the 7-file `extend` mock list; harness role/env strategy (`OL_SCHEDULER_ENABLED` gate + unref'd timers); explicit timestamps in raw SQL; #711-delete retirement statement; runner-spec relocation; the two `AppModule` call sites.

---

## Wave 4 implementation audit (second gate pass)

**Run**: 2026-08-21, against the live Wave 4 diff (the scheduler move, roles, lease,
maintenance extraction) after Wave 5 landed green. Verdict for Wave 4 as
implemented: **READY** — every finding below was applied in the same pass.

All twelve plan-level findings above verified as applied. Six further findings
came only from running the audit against real code rather than the plan:

**A. The moved spec drove a method that no longer exists.**
`apps/worker/src/scheduler/__tests__/scheduler.service.spec.ts` called
`service.onApplicationBootstrap()` in 29 places; the lease refactor renamed it
to `start()`. `git mv` preserves relative imports, so this compiles-and-fails at
*runtime*, not at type-check — the failure mode a move like this hides best.
Rewritten to `start()`, with the stale `@module apps/api/...` docblock corrected.

**B. `stop()`'s idempotency guard was wrong in the dangerous direction.**
Guarding teardown on `!started` meant a `stop()` that ran without a preceding
`start()` left cron jobs registered. Three existing teardown tests assert
otherwise, and the real case is sharper: a lease lost (or a shutdown) *before*
the first start. Cleanup is inherently idempotent — clearing an empty registry
is a no-op — so `stop()` is now unconditional and only `start()` carries the
guard.

**C. Operator-facing break: the scheduler's env vars moved processes silently.**
Every `OL_*_SYNC_ENABLED` / `OL_*_CRON` / `*_SCHEDULER_ENABLED` variable is
documented in `apps/api/.env.example` and is now read by the **worker**. An
operator setting `OL_PRODUCT_SYNC_CRON` in the api's environment after this
change gets no error and no sync-cadence change — the worst shape of
regression. Closed with a banner over the whole scheduler block in
`apps/api/.env.example` (kept documented in place, since that is where the full
task inventory lives) plus a pointer from `apps/worker/.env.example`. A
deployment sharing one `.env` between api and worker is unaffected.

**D. api integration setup described a scheduler the api no longer has.** Its
comment instructed a future author to re-invoke
`SchedulerService.onApplicationBootstrap()`. Corrected, and the
`OL_*_SCHEDULER_ENABLED: 'false'` block is now explicitly documented as
belt-and-braces (kept: a plugin still reads its own gate at registration time,
and the block is the one place the full task inventory is enumerated for api
tests).

**E. Role-coverage assertion is safe to ship as a hard boot failure.** Verified
by diffing `JobTypeValues` (35 entries) against every
`handlerRegistry.register(...)` call in `HandlerRegistrationService`, including
the multi-line calls a naive grep misses: **full coverage, zero uncovered
types**. A fresh `jobs`-role boot therefore passes rather than failing on a
pre-existing gap.

**F. No config or tooling change was needed for the new directories.** The
worker's jest unit config is `rootDir: 'src'` + `testRegex: '.*\.spec\.ts$'`, so
`src/scheduler/__tests__` and `src/roles/__tests__` are picked up as-is;
`@nestjs/schedule` + `cron` resolve under `apps/worker/node_modules` after
install, and no remaining `apps/api` source imports either (only prose in
docblocks). Exactly two `AppModule` call sites needed the `forRoles()`
conversion (`main.ts`, worker int-test setup) — confirmed no
`Test.createTestingModule({ imports: [AppModule] })` usage exists.

**G. Test-only hazard found while writing the lease spec.** Jest's fake timers
also fake `setImmediate`, so a fake-timer test cannot flush the lease's async
tick body; the spec pins `jest.useFakeTimers({ doNotFake: ['setImmediate'] })`.
Worth recording because the same trap will bite the next timer-driven service
spec.
