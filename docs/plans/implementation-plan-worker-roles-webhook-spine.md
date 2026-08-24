# Implementation Plan — Durable webhook spine (Wave 5, #2280) + worker roles (Wave 4, #2279)

**Issues**: #2280 (ADR-049 decision 1, webhook path) + #2279 (ADR-051) — bundled on one branch, **Wave 5 implemented first** so Wave 4's webhook-consumer item shrinks from a relocation to a deletion.
**Branch**: `2279-2280-worker-roles-webhook-spine` · two stacked conventional commits (spine, then topology) · one PR closing both.
**Layers**: CORE (`sync`, `webhooks` seams) · Interface/Infrastructure (`apps/api/src/webhooks`) · Worker composition root · DX/docs.

---

## Part A — Wave 5: durable work-row spine on the webhook path (#2280)

### A.1 Goal

The `sync_jobs` work row is written **in the same Postgres transaction** as the `webhook_deliveries` gate row, at HTTP ingress. Routing (translate → route) moves to ingress so the jobType/payload/idempotencyKey are known inside the gate transaction. Redis stops being part of the durable path for webhooks: no `jobdedup:*` write, no `events.inbound.webhooks` publish for routed events.

### A.2 Facts the design rests on (verified)

- **The runner is not stream-driven.** `SyncJobRunner` polls `findAndLockDueJobs` every 1 s (`sync-job.runner.ts:34,209`); `JobIntakeConsumer` only converts `jobs.sync` entries into `sync_jobs` rows. A committed row executes within ≤1 s with zero Redis involvement. **Decision: no wake-up hint at all** — the issue offers "hint or 1 s poll; correctness must not depend on the hint"; a hint whose only consumer would re-insert an already-committed row buys ~1 s at the cost of a code path that must be allowed to fail. Rely on the poll.
- **`InboundRoutingPolicyService.route()` is the single webhook-path producer of `jobs.sync`** (`inbound-routing-policy.service.ts:108`); the other 18 `enqueueJob` call sites are non-webhook and stay on the stream path untouched. `RedisStreamsJobEnqueueService` + `jobdedup:*` stay live for them.
- **`WebhookService.processWebhook` already owns the ADR-005 gate** (`webhook.service.ts:157-176` `insertIfNew`; failure path L234-262 delete-and-rethrow so a source retry re-enters).
- **`createIfNotExistsByIdempotencyKey` is NOT transaction-safe** — it dedups by catching `QueryFailedError` after a failed INSERT (`sync-job.repository.ts:97-122`), which aborts a surrounding Postgres transaction. The gate needs a real `INSERT … ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`, falling back to a SELECT inside the same tx.
- **`WebhookEventPublisher.publishInboundWebhook` has exactly one caller** (WebhookService) and `WebhookToJobHandler` is the only consumer of `events.inbound.webhooks`. Post-Wave-5 both stream and consumer are dead for the routed flow.
- Idempotency key stays `buildInboundJobIdempotencyKey` = `{platformType}:{connectionId}:{sourceEventId}` (ADR-049 decision 4 — derived, stable across retries).

### A.3 Design

**1. Routing decision split from enqueue (core `sync`).** `IInboundRoutingPolicyService` gains `resolve(canonical, connection, supportedCapabilities, sourceEventId): InboundRouteResolution` — the pure decision (`{ status: 'resolved', job: SyncJobRequest } | { status: 'ungated', reason }`), extracted from today's `route()`. `route()` becomes `resolve()` + `enqueueJob()` (kept for any residual caller during the transition; deleted with the legacy drain if none remain). New type in `inbound-routing-policy.types.ts`.

**2. Ingress translate+route (apps/api).** The translate→resolve step is extracted into a small api-local collaborator (`InboundWebhookRoutingService`, `apps/api/src/webhooks/application/services/` — tech-review suggestion adopted, keeping `WebhookService`'s five pinned spec blocks readable); `WebhookService` calls it after envelope extraction, using the same seams the handler used: `IIntegrationsService.getAdapter` (adapterKey + capabilities), `WebhookEventTranslatorRegistryService.get(adapterKey)`, `routingPolicy.resolve(...)`. Outcome mapping (all previously async DLQ branches become durable rows, no Redis DLQ):

| Outcome | Row written | Job row | HTTP |
|---|---|---|---|
| routed | `status: 'job_enqueued'`, `downstreamJobId`/`downstreamJobType` | yes (same tx) | 202 |
| `test.*` ping | `status: 'received'` | no | 202 |
| no translator / undecodable / ungated / connection-unavailable (deterministic) | `status: 'deadlettered'` + `dlqReason` | no | 202 |
| transient throw (translator error, DB down) | existing delete-row + rethrow (#711) → source retries | — | 5xx |

`downstreamJobId` becomes the `sync_jobs.id` UUID (previously a stream message id / idempotency key) — strictly better for the #1366 correlation, noted as an observable change.

**3. The transactional gate (apps/api infrastructure — where the issue places it, honoring ADR-049 D5).** New api-local seam: `IWebhookJobGateService` (`apps/api/src/webhooks/application/interfaces/`) + `WebhookJobGateRepository` (`apps/api/src/webhooks/infrastructure/persistence/`), injecting the api `DataSource`. One transaction, raw parameterized SQL (the core webhook repo's own raw-SQL precedent, #1511):

1. `INSERT INTO webhook_deliveries (…, status, downstreamJobId, downstreamJobType, dedupResult) VALUES (…) ON CONFLICT ("provider","connectionId","eventId") DO NOTHING RETURNING id` — empty ⇒ `{ isNew: false }`, tx ends (idempotent 202, same as today's `insertIfNew` conflict).
2. When routed and new: `INSERT INTO sync_jobs (id, jobType, connectionId, payload, idempotencyKey, status, attempts, maxAttempts, nextRunAt, createdAt, updatedAt) VALUES (…, 'queued', 0, 10, now(), …) ON CONFLICT ("idempotencyKey") DO NOTHING RETURNING id`; empty ⇒ `SELECT id FROM sync_jobs WHERE "idempotencyKey" = $1` (covers the post-commit-failure/legacy-row replay). The job UUID is minted first so the delivery row can carry it in the same statement pass; column values mirror `createIfNotExistsByIdempotencyKey` defaults, pinned by the int-spec (the runner must execute the inserted row).

**Gate finding — timestamp columns**: `createdAt`/`updatedAt` on BOTH tables come from TypeORM decorators (app-side), not guaranteed DB defaults — the raw SQL sets them explicitly (`now()`). `sync_jobs.attempts/maxAttempts/nextRunAt` DO have DB defaults and may be omitted; set explicitly anyway for auditability. Verified against migrations at implementation.

No `EntityManager` touches any core `*Port` (D5): the composition lives entirely in the api host's infrastructure layer. Both tables are on the single api `DataSource`. No core cross-context write is introduced.

**4. What gets deleted / retired.**
- `WebhookToJobHandler`'s always-on loop, the api's `REDIS_CLIENT_BLOCKING_TOKEN` provider, `WebhookEventPublisher` — the routed flow no longer touches Redis.
- **Upgrade hazard handled, not hand-waved**: entries already in `events.inbound.webhooks` (incl. PEL) at deploy time would otherwise be stranded — and the source's redelivery would bounce off the Postgres gate (`published` row exists) *without ever creating a job*: silent loss. The handler is therefore replaced by a **one-shot startup drain** (`LegacyInboundWebhookDrain`, same file lineage): on api boot it consumes the group's pending + unread backlog, logs counts, and exits — no infinite loop. **Tech-review: the drain is a DIFFERENT composition from the primary gate.** The primary gate's delivery insert is `ON CONFLICT DO NOTHING` — for a pre-upgrade row stuck at `published` that returns `isNew: false` and creates no job, the exact silent-loss shape the drain exists to prevent. The drain therefore composes: `resolve()` → the gate's **job** insert statement (`ON CONFLICT ("idempotencyKey") DO NOTHING`) → the **existing core rank-guarded `upsert`** advancing the row to `job_enqueued` + `downstreamJobId`. A non-transactional two-step is acceptable *here and only here*: the delivery row is already durable, and both steps are idempotent — stated so nobody "fixes" it into the primary path's transaction or vice versa. **Tech-review: the drain uses plain non-blocking reads** (`XPENDING`/`XRANGE`) — the api's dedicated `REDIS_CLIENT_BLOCKING_TOKEN` provider is deleted with the loop. Drain removal is a follow-up release; noted in `docs/operations/redis-stream-retention.md`.
- `REDIS_STREAM_NAMES.inboundWebhooks` / `.inboundWebhooksDead` stay registered while the drain exists (the drain reads them); flagged for removal with the drain.
- The `webhook:*` Redis dedup service (markProcessing/markDone) is retained but **becomes best-effort non-fatal (tech-review)**: today a `markProcessing` THROW (Redis down, not merely flushed) reaches the outer catch, deletes the delivery row and 500s — which would keep Redis in the webhook failure path after the whole point of this wave is removing it. The restructured `processWebhook` wraps both calls in try/catch (warn + continue), and the int-spec adds a **Redis-fully-down ingress** case alongside the AC's flush case. Removal of the service entirely is a separate cleanup.
- The `#1916` status-ladder rank guard stays: `published` becomes unreachable for new webhook rows (received → job_enqueued in one statement) but the guard still protects legacy rows and the drain's upserts.

**5. Post-commit restructure of `processWebhook` — the #711 compensating delete RETIRES on this path (gate finding)**: with the transactional gate, a pre-commit failure rolls back both rows (nothing to delete; the source retry re-enters cleanly), and after commit a failure (e.g. `markDone`) must NOT delete the delivery row (that would orphan the committed job and eat the source's retry). `webhook.service.spec.ts` block 4 (delete-on-publish-failure) is rewritten to pin the new invariant, not preserved; `deleteByEventKey` stays on the port (its production caller count drops to zero — flagged in a comment, not removed).

**6. `route()` is retained** (gate finding): no typed mock of `IInboundRoutingPolicyService` exists anywhere, so adding `resolve()` breaks nothing at compile time; the one typed consumer, `erli-orders-vertical-slice.int-spec.ts` S1, calls `route()` via the token and keeps working unchanged.

### A.4 Tests (Wave 5)

- Unit: `InboundRoutingPolicyService.resolve` (existing route specs re-shaped); `WebhookService` spec rework (routed/ping/deadlettered/transient branches, gate interaction, post-commit no-delete); gate repository spec (SQL branches mocked at DataSource level).
- Int-spec (`apps/api/test/integration/`, extending the existing webhook specs): (1) POST webhook → `webhook_deliveries` row `job_enqueued` + committed `sync_jobs` row, **no** `jobs.sync` entry, **no** `jobdedup:*` key; (2) `FLUSHALL` Redis after ingress → job still visible/executable (the AC's "kill the hint" test); (3) same-event redelivery → no second job (ADR-005 extended); (4) legacy drain: seed a pre-upgrade stream entry, boot, assert row upgraded + job created.

---

## Part B — Wave 4: worker roles (#2279)

### B.1 Goal

`OL_WORKER_ROLE` (default `all`) selects **conditional module imports** on the worker artifact; the scheduler moves out of the api into a lease-enforced singleton role; stuck-job recovery moves under a `maintenance` lease; boot asserts coverage; both `.env.example` files document the flags. Wave 5 already removed the api's webhook consumer, so ADR-051 item 4 is complete by deletion.

### B.2 Facts the design rests on (verified)

- Worker boots statically (`app.module.ts`, no dynamic form); precedents for env-read-at-construction dynamic modules exist (`PluginRegistryModule.forRoot`, `AiIntegrationModule.register`), and the per-host mirror pattern (`WorkerContentModule`) is the documented shape for relocating a service across processes.
- **The scheduler task registry already populates identically in the worker**: all 12 plugin task registrations are unconditional in `register(host)`, and `apiPlugins` ≡ `workerPlugins` (same 12 entries). Moving `SchedulerService` needs **no plugin changes**. Its six DI deps resolve in the worker except `SchedulerRegistry` (needs `ScheduleModule.forRoot()` in the scheduler role) and the `@openlinker/core/listings` value imports (role module imports `ListingsModule`).
- `SchedulerService` is a bare provider in `apps/api/src/sync/sync.module.ts` — nothing injects it; a clean cut.
- **The only `@Cron` in the entire repo is `demo-account-cleanup.service.ts:49`** — the sole other consumer of the api's `ScheduleModule`.
- `SyncLockPort` is `acquire(key, ttlMs)`/`release(key, token)` — **no extend**; `RedisSyncLockService.release` is already a token-checked Lua compare-and-delete, so a token-checked `extend` (compare-and-`PEXPIRE`) is the symmetric addition ADR-051 explicitly allows.
- `SyncJobRunner.onModuleInit` couples `startRunner()` + `startStuckJobRecovery()` — the maintenance split separates these.
- Coverage-assertion precedent: `CurrencyModule.onApplicationBootstrap` (every `onModuleInit` runs before the first bootstrap hook — exactly the ordering the handler-registry check needs).

### B.3 Design

**1. Role vocabulary** — `apps/worker/src/roles/worker-role.types.ts`: `WorkerRoleValues = ['jobs','events','scheduler','maintenance'] as const` + `resolveWorkerRoles(raw): Set<WorkerRole>` (pure-rule exception): unset/`all` → all four; comma-separated list accepted; **an unknown role name throws at boot naming the value** (decision 6's spirit — misconfiguration must be loud).

**2. Conditional composition** — `AppModule` becomes `static forRoles(roles): DynamicModule`; `main.ts` resolves roles from `process.env.OL_WORKER_ROLE` before `NestFactory`. Base imports (every role): Config/Database/Redis/Cache/IdentifierMapping/CoreIntegrations/worker-IntegrationsModule (plugins)/core SyncModule + `WorkerHeartbeatService` (health must beat in every role). Role-gated:
- `jobs` → `SyncWorkerModule` (runner + 34 handlers + `JobIntakeConsumer` — the issue assigns intake to `jobs`), minus stuck-job recovery (extracted below). Existing `WORKER_INTAKE_ENABLED`/`WORKER_RUNNER_ENABLED` gates retained inside the role (subsumed, not broken).
- `events` → `EventsConsumerModule` (master-deletion consumer; `OL_MASTER_DELETION_CONSUMER_ENABLED` retained).
- `scheduler` → new `WorkerSchedulerModule` (mirror-module pattern): `ScheduleModule.forRoot()`, `ListingsModule`, the **moved** `SchedulerService` (file + `CORE_CAPABILITY_TASKS` + spec relocate from `apps/api/src/sync/application/services/` to `apps/worker/src/scheduler/`), refactored so cron registration lives in explicit `start()`/`stop()` instead of `OnApplicationBootstrap`.
- `maintenance` → new `MaintenanceModule`: `StuckJobRecoveryService` (the `setInterval` + `requeueStuckJobs(15)` loop extracted verbatim from `SyncJobRunner`). Gate note: `sync-job.runner.spec.ts` carries a whole `describe('startStuckJobRecovery')` block (:1076-1169) that relocates with the extraction — a named work item and the main Wave-3 rebase-conflict surface.

**3. Singleton leases** — `SyncLockPort` gains `extend(key, token, ttlMs): Promise<boolean>` (+ Lua compare-and-PEXPIRE in `RedisSyncLockService`, which has **no existing spec** — the spec is a new file). **Gate-enumerated blast radius: exactly 7 spec files** with structurally-typed bare-literal mocks needing a one-line `extend: jest.fn()`: `order-sync.service.spec.ts:111`, `shipment-dispatch.service.spec.ts:125`, `fiscal-registration.service.spec.ts:91`, `woocommerce-order-processor.fulfillment-status.spec.ts:59`, `woocommerce-order-processor.adapter.spec.ts:85`, `woocommerce-address-provisioner.spec.ts:43`, `woocommerce-customer-provisioner.spec.ts:27`. The 7 cast-through mocks are unaffected; no testing-sub-barrel fake exists. A small worker-local `SingletonRoleLease` helper (acquire-or-park loop, extend at TTL/3, `onAcquired`/`onLost` callbacks, `.unref()`d timers) drives both:
- `scheduler` lease: key `singleton:scheduler`, `OL_SCHEDULER_LEASE_TTL_MS` default 60 000 clamp [15 000, 600 000] (the `order-create-lock.ts` config pattern). On acquire → `schedulerService.start()`; on loss → `stop()` + re-park. A second scheduler process parks (AC). **Test-infrastructure gate finding**: all 16 worker int-specs boot the full `AppModule` through `WorkerIntegrationTestHarness` (`test/integration/setup.ts:39` — the only test call site; `main.ts:21` is the only production one). Under `forRoles(all)` the scheduler role would start cron inside integration tests — the documented Jest event-loop-hang hazard (`apps/api/test/integration/setup.ts:163-172`). The lease coordinator therefore carries a runtime gate `OL_SCHEDULER_ENABLED` (default on — the same retained-gate shape as `WORKER_RUNNER_ENABLED` inside the `jobs` role), worker int setup sets it `'false'`, and every lease/interval timer is `.unref()`d and stopped in `onModuleDestroy`. `invoicing-auto-issue-boot.int-spec.ts` + `regulatory-status-reconcile-di.int-spec.ts` are the DI-shape hard gates that `forRoles('all')` must reproduce today's provider graph.
- `maintenance` lease: key `singleton:maintenance`, same TTL shape, driving `StuckJobRecoveryService`.
- **Lease-handover double-tick is absorbed, and that claim is pinned (tech-review)**: when a lease is lost (Redis restart, missed extend), a second process can acquire before the first's `stop()` completes — a bounded overlap ≤ TTL where both tick. That is safe *because* `enqueueJobForConnection` mints minute-rounded idempotency keys, which is ADR-051's own justification. Stated in the lease docblock and pinned by the `SingletonRoleLease` spec (`onLost` stops callbacks) plus a note in the scheduler lease spec, so a future idempotency-key change cannot silently reopen double-ticking.
- **`SchedulerService.start()`/`stop()` are idempotent and re-entrant (tech-review)**: the coordinator may call `start → stop → start` across lease loss/re-acquire; `SchedulerRegistry.addCronJob` throws on a duplicate taskId, so `start()` carries a started-flag guard and `stop()` leaves the service restartable. One spec case each.

**4. The api sheds scheduling entirely** — `SchedulerService` provider removed from `apps/api/src/sync/sync.module.ts`; **`ScheduleModule.forRoot()` removed from the api** — enabled by converting `demo-account-cleanup` from `@Cron` to an `.unref()`d hourly `setInterval` that takes a **per-tick** `SyncLockPort` acquire (`singleton:demo-cleanup`, short TTL) — the "takes the lease in place" option the issue offers; it stays in the api because it is auth-domain work whose deps (`DemoModeService`, user repos) the worker does not import. Cron thereby leaves the request-serving process completely (ADR-051 decision 3), and the `SchedulerService.onModuleDestroy` delete-all-registry caveat becomes moot (the worker scheduler role is its process's only `ScheduleModule` user).

**Gate findings folded in:**
- **`AuthModule` cannot resolve `SYNC_LOCK_TOKEN` today** (it imports no core `SyncModule`, and core `SyncModule` is not `@Global`) — `auth.module.ts` gains a core `SyncModule` import; no cycle (core sync has no auth edge).
- **Package manifests**: `apps/worker/package.json` gains `@nestjs/schedule@4.0.0` + `cron@3.1.3` (matching api pins); **apps/api drops both** — post-move their only api consumers are the three files moved/converted.
- The move is self-contained: `CORE_CAPABILITY_TASKS`/`CoreCapabilityTaskDescriptor` are file-local and unexported; relocate 3 files (service, spec, and the spec's relative import), delete one `sync.module.ts` import. `ScheduleModule` removal from the api is verified safe (zero api test references; the `OL_*_SCHEDULER_ENABLED: 'false'` block in api int setup becomes a no-op — comment updated — and removes a documented Jest-hang hazard).

**5. Coverage assertion** — `RoleCoverageAssertionService` (worker root, `OnApplicationBootstrap`, the CurrencyModule precedent): (a) when `jobs` is enabled, diff `JobTypeValues` against `SyncJobHandlerRegistry` keys and **throw naming uncovered jobTypes**; (b) log, structured, which roles/consumer groups this process claims and which it deliberately does not — a single process cannot see the deployment's union (peers), so the runtime half asserts what is knowable per-process and the repo-static half stays with #2169, stated explicitly rather than implied.

**6. Env + docs** — `OL_WORKER_ROLE` + `OL_MASTER_DELETION_CONSUMER_ENABLED` (+ the undocumented `WORKER_HEARTBEAT_ENABLED`, while there) documented in **both** `.env.example` files — the `OL_WORKER_ROLE` entry spelling out that a split deployment must cover all four roles across its processes, `all` being the safe default (role misconfiguration is ADR-051's named new failure class); scheduler cron/env vars noted as worker-side now (api `.env.example` section annotated, worker section added); `apps/worker/src/plugins.ts:21-23` + `scheduler-task-registry.service.ts:6-7` header claims rewritten; `docs/architecture-overview.md` (§ Data Flow 4 for Wave 5, § Sync Manager/Module Organization for Wave 4), `docs/operations/redis-stream-retention.md`, `docs/dev-environment.md` worker section; ADR-049 append-only amendment (poison-entry gap retired for the webhook path); Dockerfile untouched (one artifact, env-driven).

### B.4 Tests (Wave 4)

- Unit: `resolveWorkerRoles` (all/list/unknown-throws); `SingletonRoleLease` (acquire, park, extend-failure → onLost, jittered re-acquire); `RedisSyncLockService.extend` (token match / mismatch / expired); `StuckJobRecoveryService` (interval + lease gating); `RoleCoverageAssertionService` (uncovered jobType throws with names); `SchedulerService` spec relocated and adjusted for `start()`/`stop()`; runner spec updated (no recovery in `onModuleInit`); demo-cleanup spec updated (interval + lock).
- Int: worker boot spec per role — `scheduler` role instantiates zero job handlers (module-graph assertion, the AC); `all` role boots identically (existing worker int-specs unchanged = the behavioural-identity assertion); two-scheduler lease contention spec (second acquire parks).

---

## C. Sequencing, risks, open decisions taken

1. **Wave 5 lands first in the branch** (commit 1), Wave 4 second (commit 2) — item 4 becomes deletion; the PR closes both.
2. **No wake-up hint** (A.2) — worst case +1 s webhook-to-execution latency; stated in docs.
3. **Legacy drain instead of silent stream abandonment** (A.3.4) — the one genuinely new invention in this plan; without it the upgrade loses in-flight webhooks *and* their retries.
4. **Demo cleanup stays api-side with a per-tick lock** — moving it would drag `AuthModule` into the worker for one hourly job.
5. **Per-process coverage assertion scope** honestly stated: union-across-peers is unknowable from one process; #2169 owns the static half.
6. **Wave 3 conflict risk accepted**: the parallel #2278 session edits `sync-job.runner.ts` (lanes); we extract `startStuckJobRecovery` from the same file — a rebase at PR time is expected and confined to that file.
7. **No migration**: no ORM entity changes anywhere (both inserts target existing tables; raw SQL mirrors existing column sets, pinned by int-specs).
8. `isExisting`/`downstreamJobId` semantic change (stream id → `sync_jobs` UUID) is an improvement; FE webhook-delivery detail renders it opaquely — verified at implementation.
