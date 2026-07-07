# Implementation Plan: Webhook delivery "Downstream job" link → resolve the concrete SyncJob (#1366)

**Date**: 2026-07-07
**Status**: Implemented (pending quality gate)
**Estimated Effort**: ~0.5 day
**Issue**: #1366

---

## 1. Task Summary

**Objective**: Make the "Downstream job" link on the webhook delivery detail page navigate to the **correct** persisted `SyncJob`, instead of the broken `/jobs-logs/${downstreamJobId}` that 404'd every time.

**Why**: `downstreamJobId` recorded on a `webhook_deliveries` row is the Redis Stream `XADD` entry ID (`<epoch-ms>-<seq>`) returned by `JobEnqueuePort.enqueueJob` — **not** the persisted `SyncJob.id` (a Postgres UUID). The `/jobs-logs/:id` route is UUID-only (`ParseUUIDPipe`), so the link always hit the error state. These are two unrelated ID spaces with no shared value between them.

**Revision note**: The original issue proposed *removing* the link (render plain text). That was superseded — we make the redirect work rather than deleting it. The one durable cross-reference between a delivery and the job it produced is the **idempotency key** (`{platformType}:{connectionId}:{sourceEventId}`), built by `InboundRoutingPolicyService` and stored on the `SyncJob` row.

**Classification**: CORE (new repository-port read method) + Interface (new lookup endpoint) + Frontend (api method, query hook, page wiring, tests). **No schema change, no migration** — the `idempotencyKey` column already exists and is unique.

---

## 2. Scope & Non-Goals

### In Scope
1. `buildInboundJobIdempotencyKey(platformType, connectionId, sourceEventId)` — a single core-owned pure helper for the key format, used by `InboundRoutingPolicyService` (replaces its inline template) and the lookup endpoint. Exported from `@openlinker/core/sync`.
2. `SyncJobRepositoryPort.findByIdempotencyKey(key)` + TypeORM impl (`findOne({ where: { idempotencyKey } })`).
3. `GET /sync/jobs/lookup?platformType=&connectionId=&eventId=` on `SyncController` → assembles the key **server-side** via the shared helper, returns the `SyncJob` DTO, `400` on any missing/blank component, `404` when no row exists yet.
4. FE `syncJobs.lookupJobForWebhookEvent({ platformType, connectionId, eventId })` api method + `useSyncJobLookupQuery` hook (`retry: false`). The FE passes raw components — it never encodes the key format.
5. Webhook delivery detail page: resolve connection → pass `{ platformType, connectionId, eventId }` → resolve exact job → link to `/jobs-logs/:uuid`, with a filtered-list fallback.
6. Tests: helper usage (routing-policy spec output unchanged), controller (found / missing-component / not-found), page (exact link + fallback).

### Out of Scope
- Persisting the resolved `SyncJob.id` back onto the `webhook_deliveries` row — the enqueue precedes row creation, so there is nothing to persist at record time.
- Changing what `downstreamJobId` stores (still the enqueue ID; it remains visible as the link text).
- Any change to `InboundRoutingPolicyService` or the enqueue path.

---

## 3. Architecture & Placement Decisions

- **Correlation key, not enqueue ID.** Resolution reconstructs the idempotency key rather than parsing `downstreamJobId`, so it works regardless of whether the enqueue returned the `XADD` id or (on an idempotent hit) the key itself. `RedisStreamsJobEnqueueService` returns different values on those two branches; neither is the DB UUID.
- **Key format** (`{platformType}:{connectionId}:{sourceEventId}`) is owned by `InboundRoutingPolicyService`. `sourceEventId` = `event.eventId`, which is exactly what the delivery persists as `eventId`. `platformType` comes from the resolved **connection** — the delivery's free-form `provider` (a URL path param) is not a reliable substitute.
- **Lookup lives at the interface layer** as a repository-port read exposed via a thin controller endpoint — no orchestration, no new service. Route declared **before** `jobs/:id` so `ParseUUIDPipe` on `:id` can't swallow `lookup`.
- **Never-dead link.** The worker creates the `SyncJob` row asynchronously, so a lookup can transiently 404. Until/unless the exact job resolves, the link falls back to the Jobs & Logs list pre-filtered by `connectionId` + `jobType` (both read from the URL by `SyncJobsPage`).

---

## 4. Implementation Plan

### Phase A — core `sync`: shared key builder + port + repository
- `libs/core/src/sync/application/services/inbound-job-idempotency-key.ts` — new `buildInboundJobIdempotencyKey` pure helper; exported from `libs/core/src/sync/index.ts`.
- `libs/core/src/sync/application/services/inbound-routing-policy.service.ts` — use the helper in `route()` (output byte-identical, existing spec still green).
- `libs/core/src/sync/domain/ports/sync-job-repository.port.ts` — add `findByIdempotencyKey(idempotencyKey: string): Promise<SyncJob | null>` with JSDoc.
- `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts` — implement (mirrors `findById`).

### Phase B — interface (apps/api)
- `apps/api/src/sync/http/sync.controller.ts` — `@Get('jobs/lookup')` (before `jobs/:id`); `@Query` `platformType` / `connectionId` / `eventId` with a blank guard → `BadRequestException`; assemble the key via `buildInboundJobIdempotencyKey`; `NotFoundException` when the repo returns null; reuse `toDto`.
- `apps/api/src/sync/http/sync.controller.spec.ts` — add `findByIdempotencyKey` to the typed repo mock; 3 tests (found / missing-component / not-found), asserting the server-assembled key.

### Phase C — frontend
- `apps/web/src/features/sync-jobs/api/sync.api.ts` — `lookupJobForWebhookEvent({ platformType, connectionId, eventId })` + `WebhookJobLookupInput` type.
- `apps/web/src/features/sync-jobs/api/sync.query-keys.ts` — `webhookJobLookup(platformType, connectionId, eventId)` key.
- `apps/web/src/features/sync-jobs/hooks/use-sync-job-lookup-query.ts` — new hook, self-disables until all components present, `retry: false` (a 404 = "not created yet", don't hammer).
- `apps/web/src/pages/webhook-deliveries/webhook-delivery-detail-page.tsx` — `buildDownstreamJobHref` helper; call `useConnectionQuery` + `useSyncJobLookupQuery` before the loading/error guards (matches `SyncJobDetailPage` precedent); pass raw components; link exact-job-or-fallback.
- `apps/web/src/test/test-utils.tsx` — default `syncJobs.lookupJobForWebhookEvent` mock.
- `apps/web/src/pages/webhook-deliveries/webhook-delivery-detail-page.test.tsx` — exact-link + fallback tests.

### Phase D — quality gate
- `pnpm lint && pnpm type-check && pnpm test` (web + api). No migration to show.

---

## 5. Risks & Follow-ups

- **Cross-layer key-format coupling** (tech-review IMPORTANT): **resolved.** The key format now lives in exactly one place — `buildInboundJobIdempotencyKey` in core — used by the routing policy and the lookup endpoint. The endpoint takes the raw `(platformType, connectionId, eventId)` components and assembles the key server-side, so the FE never re-encodes the format and it can evolve in core without silent drift (the `docs/lessons.md` #1318 failure mode no longer applies).
- **Lookup endpoint validation**: uses raw `@Query` params + a manual guard rather than a class-validator DTO like the sibling list endpoints. Correct and injection-safe (TypeORM parameterizes), but a small DTO would be more idiomatic. **Optional.**

---

## 6. Acceptance Criteria

- [x] "Downstream job" links to the exact `SyncJob` detail (`/jobs-logs/:uuid`) resolved via idempotency key when the job exists.
- [x] When not yet resolvable (worker hasn't created the row), the link falls back to the pre-filtered Jobs & Logs list — never a broken `/jobs-logs/<streamId>`.
- [x] New `findByIdempotencyKey` port method + `GET /sync/jobs/lookup` endpoint, with controller tests.
- [x] `webhook-delivery-detail-page.test.tsx` asserts both the exact-job link and the fallback.
- [x] No CORE ↔ Integration boundary violations; key format stays owned by core.

---

## Related

- Enqueue ID vs UUID origin: `RedisStreamsJobEnqueueService`, `InboundRoutingPolicyService`, `WebhookToJobHandler`.
- Fallback target: `SyncJobsPage` URL filters (`connectionId`, `jobType`).
- Issue #1366 comment thread documents the revised approach.
