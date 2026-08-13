# Pre-Implementation Analysis: Analytics Data-Trust Reads

**Plan**: `docs/plans/implementation-plan-analytics-data-trust-reads.md`
**Issue**: #1982
**Date**: 2026-08-11

## Verdict: READY

No Critical findings. One deliberate design decision (new `SyncJobRepositoryPort` method vs. reusing `findMany`) is already justified in the plan's own § 7 "Alternatives Considered" and is reaffirmed below after the reuse audit surfaced the same question independently. One Warning (naming/placement of the API module relative to the existing `analytics` folder) is noted but the plan's stated rationale (avoid conflating PostHog config with business-analytics reads) stands.

---

## Reuse Findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `libs/core/src/analytics-trust/` bounded context | **NEW** (confirmed absent) | No such directory under `libs/core/src/` or `apps/api/src/`. |
| Any existing "trust"/"freshness"/"staleness"/"ingestion-trust" port/service | **NEW** | Grep for `freshness\|staleness\|staleThreshold\|dataTrust\|ingestionTrust` (case-insensitive) hits only unrelated concepts: inventory/product-master staleness prune (`libs/core/src/inventory/application/services/master-inventory-sync.service.ts:245,272`), marketplace stale-offer pause (`libs/core/src/listings/domain/types/stale-offer-pause.types.ts:16`), a pickup-point cache TTL (`libs/core/src/shipping/domain/ports/pickup-point-search-cache.port.ts:7`), and a local `staleThreshold` var in `apps/api/src/categories/categories-cache.service.ts:151-163` (category cache TTL, unrelated domain). None overlap with sync-ingestion trust semantics. |
| `ANALYTICS_TRUST_SERVICE_TOKEN` / `INGESTION_TRUST_*` DI tokens | **NEW** | No matches in any `*.tokens.ts` under `libs/core/src/`. |
| `SyncJobRepositoryPort.findLastSucceededByConnectionAndJobType` | **NEW, with a considered alternative** | Full existing method list confirmed verbatim from `libs/core/src/sync/domain/ports/sync-job-repository.port.ts`: `createIfNotExistsByIdempotencyKey`, `findAndLockDueJobs`, `markSucceeded`, `markFailed`, `markDead`, `requeueWithoutPenalty`, `findMany`, `findById`, `findByIdempotencyKey`, `requeueStuckJobs`, `requeueDeadJob`, `requeueDeadByIdempotencyKey`, `findRecentByConnectionId`, `findGroupedByStatus`, `requeueDeadJobsInGroup`, `heartbeat`. No existing method returns "last succeeded job for connection+jobType ordered by completion time." `findMany({connectionId, jobType, status:'succeeded'}, {limit:1, offset:0})` gets close but is documented as ordered by `createdAt DESC` (enqueue time), not `updatedAt` (completion time) — the plan's own § 7 "Alternatives Considered" already reasons about this trade-off implicitly via its choice of ordering; **this analysis makes the rejection of plain `findMany` reuse explicit**: precision on "last-successful-ingestion time" (an issue AC) requires ordering by completion time, which `findMany` cannot provide without changing its existing, currently-relied-upon `createdAt DESC` contract for other callers. Adding a narrowly-scoped new method is correct over widening `findMany`'s semantics. |
| `SyncJobRepositoryPort` implementers | **Confirmed single implementer** | Only `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts` (`SyncJobRepository`) implements the interface — no in-memory testing fake implements it directly. Adding a method is a safe, additive interface change; only this one file needs the new implementation (plan § 6 Step 5 already covers this). |
| `cron` package in `libs/core/package.json` | **NEW dependency** | Current `dependencies`: only `@openlinker/shared`. Current `devDependencies`: `@types/jest`, `@types/node`, `@typescript-eslint/*`, `eslint`, `jest`, `ts-jest`, `typescript`. No `cron` anywhere — confirmed genuinely new; must be added to `dependencies` (runtime import, not tooling-only) per `docs/engineering-standards.md § Workspace dependency declarations`. |
| `AnalyticsTrustApiModule` / `GET /analytics/trust` route | **NEW, no collision** | `apps/api/src/app.module.ts:25` imports `AnalyticsModule as CoreAnalyticsModule` from `@openlinker/core/analytics`; `apps/api/src/app.module.ts:46` imports `AnalyticsApiModule` from `./analytics/analytics.module` (class `AnalyticsApiModule`, `apps/api/src/analytics/analytics.module.ts:22`). Both are PostHog-only (#1685). No `@Controller('analytics'` route exists anywhere in `apps/api/src/**` today — the existing controller is mounted at `/posthog-settings`, not `/analytics`. The plan's proposed class name `AnalyticsTrustApiModule` in a distinct folder `apps/api/src/analytics-trust/` does not collide with `AnalyticsApiModule`. |
| `@openlinker/core/sync` export surface (`SchedulerTaskRegistryService`, `SchedulerTaskConfig`) | **EXISTS, confirmed exported** | `libs/core/src/sync/index.ts:121` (`SchedulerTaskRegistryService`), `:124` (`SchedulerTaskConfig` type). Import path is correct. |
| `@openlinker/core/integrations` export surface (`IIntegrationsService`, `INTEGRATIONS_SERVICE_TOKEN`) | **EXISTS, confirmed exported** | `libs/core/src/integrations/index.ts:12` (`IIntegrationsService`), `:122` (`export * from './integrations.tokens'`, which defines `INTEGRATIONS_SERVICE_TOKEN` at `integrations.tokens.ts:13`). Import path is correct. |

---

## Backward-Compatibility Findings

| Surface | Check | Severity | Note |
|---|---|---|---|
| `SyncJobRepositoryPort` interface | Adding `findLastSucceededByConnectionAndJobType` | **Warning** (not Critical) | Purely additive; single implementer confirmed (see above), already scheduled as plan § 6 Step 5. No existing caller breaks. |
| `check-cross-context-imports.mjs` invariant | Would importing the concrete class `SchedulerTaskRegistryService` (not a `*Port`/`I*Service`) from a sibling core context (`analytics-trust`) trip the invariant? | **Verified NOT a violation** | Read `scripts/check-cross-context-imports.mjs` directly. `DENY_PATTERNS` is a short, explicit list: `/RepositoryPort$/, /OrmEntity$/, /Adapter$/, /Dto$/`. `SchedulerTaskRegistryService` and `SchedulerTaskConfig` match none of these, and `classifyName` default-allows any name that isn't explicitly denied ("Unrecognized names are default-allowed — they're treated as domain entities / value objects / plain types"). So the actual enforced gate will pass. Flagging this only because `docs/architecture-overview.md`'s descriptive allow-list table (I*Service / *Port / is* / *Module / exceptions / UPPER_SNAKE_CASE / entities) does not literally list "plain service classes," which could look like a doc/script mismatch — it isn't a blocker for this plan, since the script is the actual CI gate, but is worth a one-line doc note in a future PR (out of scope for #1982). |
| DTO shapes | New DTOs only (`AnalyticsTrustResponseDto`) — nothing existing changes shape | **N/A** | No break. |
| Symbol tokens | Only new tokens added (`ANALYTICS_TRUST_SERVICE_TOKEN`); nothing removed/renamed | **N/A** | No break. |
| ORM schema | No entity/table change | **N/A** | No migration required — matches plan § 6 "Database Migrations: None." Confirm with `pnpm --filter @openlinker/api migration:show` after implementation, per plan. |
| `check-service-interfaces.mjs` invariant | `AnalyticsTrustService` must `implements` either an `I*Service` (with sibling `.service.interface.ts`) or a `*Port` | **Will pass** | Plan § 6 Step 6-7 defines `IAnalyticsTrustService` in a sibling `analytics-trust.service.interface.ts` and has `AnalyticsTrustService implements IAnalyticsTrustService` — satisfies the rule as written. |
| `check-workspace-dep-declarations.mjs` invariant | `libs/core/package.json` must declare `cron` since `libs/core/src/analytics-trust/domain/domain-services/ingestion-trust.domain-service.ts` will import it directly | **Must remember to add it** | Not yet present (see reuse findings) — plan § 6 Step 2 already calls this out explicitly as a required addition. |

---

## Open Questions

- None blocking. The plan's own § 5 "Open Questions" (filter parameters, FE deep-link shape) are deferred to the FE route-shell issue by design and do not block this backend-only issue.

## Summary

The plan is implementation-ready. The reuse audit confirms every proposed artifact is genuinely new (no existing port, service, token, or route collides), the one interface change (`SyncJobRepositoryPort` + one new method) has exactly one implementer to update and is purely additive, and the cross-context imports the plan proposes (`SchedulerTaskRegistryService`, `SchedulerTaskConfig`, `IIntegrationsService`, `INTEGRATIONS_SERVICE_TOKEN`, `SyncJobRepositoryPort`, `SYNC_JOB_REPOSITORY_TOKEN`) all resolve correctly from their documented barrels and pass the actual `check-cross-context-imports.mjs` gate (verified by reading the script's deny/allow logic directly, not just the descriptive doc table). No DB migration is needed. Proceed to implementation as planned.
