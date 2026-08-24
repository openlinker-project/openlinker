# Pre-implementation Analysis — ADR-050 + ADR-051 (#2167, #2168)

**Plan**: `docs/plans/implementation-plan-adr-050-051-lanes-worker-topology.md`
**Gate run**: 2026-08-21 (deep pass)
**Verdict**: **READY**

The plan is documentation-only: two new ADR files plus README index rows. It creates no port,
service, DI token, ORM entity, DTO, or barrel export, so the reuse and backward-compat audits
reduce to (a) ADR-number collisions, (b) in-flight work touching the same files, (c) invariant
scripts that walk `docs/`, and (d) — the substantive risk for an ADR — factual accuracy of every
code claim it will assert (README authoring rule 4).

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `docs/architecture/adrs/050-workload-isolation-concurrency-lanes.md` | NEW (confirmed absent) | no `05x` file on `origin/main`; number reserved for #2167 in `README.md` reservation note |
| `docs/architecture/adrs/051-worker-topology-one-artifact-roles.md` | NEW (confirmed absent) | same note reserves 051 for #2168 |
| README index rows + reservation-note amendment | PARTIAL (edit existing) | `docs/architecture/adrs/README.md:139-144`; note explicitly instructs "write the file as 050-/051- and add only your own index row" |
| In-flight collisions | NONE | no remote branch matches `2167|2168|adr-05[01]`; no open PR touches `docs/architecture/adrs/` |

## Backward-compatibility findings

No Critical items — no contract surface is touched. Warnings checked and clear:

- **`check-repo-urls.mjs`** walks `docs/` and bans full GitHub URLs — the ADRs must use bare
  `#NNN` and relative ADR links (plan already states this; template enforces the same).
- **No invariant script parses ADR content** today (`check-architecture-gates.mjs` is #2169's
  future work), so marking gates `(countable)`/`(prose-only)` is free-form prose — no format to
  conform to yet, but the markings should be lexically greppable so #2169 can key on them.
- ADRs are append-only; both new files are `Proposed`, no supersession of any existing ADR.
  ADR-048/-049 are referenced, not edited.

## Factual-claim verification (deep pass)

Every load-bearing claim the ADRs will assert was re-verified against the worktree at
`origin/main` (3598ff65a), independently of the plan's research notes:

| Claim | Verified value | Evidence |
|---|---|---|
| Registered job types | **34** (issues say ~30) | 34 `handlerRegistry.register(` in `apps/worker/src/sync/handlers/handler-registration.service.ts` |
| Runner is sequential, batch 10, poll 1 s | confirmed | `sync-job.runner.ts:33-34`, `:228-232` ("For MVP, process sequentially") |
| `findAndLockDueJobs(limit, workerId)` — no jobType/priority | confirmed | `sync-job-repository.port.ts:74` |
| All handlers run `priority: 'background'` | confirmed | `sync-job.runner.ts:298-301` |
| Limiter admits background starvation | confirmed | `libs/shared/src/rate-limit/rate-limiter.ts:8-10` |
| Rate-limit requeue +30 s, attempts not incremented | confirmed | `sync-job.runner.ts:38` + `handleJobFailure` |
| `EXPANDED_OFFER_CEILING = 1000` | confirmed | `bulk-listing-submit.service.ts:94` |
| `ScheduleModule.forRoot()` api-only | confirmed | `apps/api/src/app.module.ts:59`; zero hits in `apps/worker` |
| Scheduler task descriptors | **23** = 11 host (`scheduler.service.ts` taskIds, incl. bespoke `destination-taxonomy-sync`) + 12 plugin (allegro 4, prestashop 2, woocommerce 2, erli 2, inpost 1, dpd 1) | grep `taskId: '` both scopes |
| `SyncLockPort` key families | **6** (issues say five): orders poll, order create, invoice issue, shipment dispatch, taxonomy sync, WooCommerce customer provisioning | lock helper files under `libs/core/src/{orders,invoicing,shipping,listings}` + `libs/integrations/woocommerce/.../provisioners` |
| Runner DB-lock identity is PID-based while stream identity is `OL_WORKER_ID` | confirmed | `sync-job.runner.ts:32` vs `libs/shared/src/redis/stream-consumer.ts:85,159` |
| Dockerfile `FROM production AS worker`, CMD-only difference | confirmed | `Dockerfile:140,150,159` |
| No worker service in base compose; worker only in demo; no `replicas:` | confirmed | `docker-compose.yml` (no match), `docker-compose.demo.yml:93` |
| `OL_MASTER_DELETION_CONSUMER_ENABLED` in no `.env.example` | confirmed | grep both files: only `WORKER_INTAKE_ENABLED`, `OL_WORKER_ID` present |
| Consumer split: webhook-handler in api ("MVP" comment), master-deletion + job-intake in worker | confirmed | `webhook-to-job.handler.ts:6`, `apps/worker/src/events/`, `apps/worker/src/sync/job-intake.consumer.ts` |

## Open questions (non-blocking)

1. **Dual-profile lane assignment** — the plan resolves it with the "cost of starvation" rule;
   the ADR must state the rule explicitly or the 34-row mapping will look arbitrary at the seams
   (invoicing sweeps, `orders.poll`).
2. **Webhook-consumer target placement** — plan records `events` role as target with migration
   deferred to Wave 4; keep it a stated decision, not an implied one.
3. **Cap values** — must be explicitly illustrative (gated on #1134 observability), or the ADR
   will be read as normative and #2169 will try to count against fictional numbers.

## Verdict rationale

No Critical, no Warning with substance, no reuse collision. **READY** — proceed to authoring.
