# Implementation Plan: Periodic Allegro Offer-Status Sync → Persisted OL Offer Status (#816)

## 1. Task Summary

Add a **periodic sync** that reads the live publication status of mapped marketplace offers via the existing `OfferStatusReader.getOfferStatus` capability and **persists** it into a new, listings-owned `offer_status_snapshots` table, keyed to `(connectionId, externalOfferId)` with `internalVariantId` for reverse-nav, a `lastStatusSyncedAt` watermark, and transition logging. Operators (and future FE/filters/alerts) can then see which offers went `ended` / `inactive` / `inactivating` without opening each listing.

Reuses the existing Allegro `getOfferStatus` impl (no new adapter method) and mirrors the existing `marketplace.offers.sync` job end-to-end (job type → worker handler → core service → Allegro scheduler task).

## 2. Scope & Non-Goals

### In Scope
- New core sync job type `marketplace.offer.statusSync` + V1 payload.
- New listings domain entity `OfferStatusSnapshot` + repository port + ORM entity + repository impl + **migration**.
- New core application service `OfferStatusSyncService` implementing `IOfferStatusSyncService`.
- New worker handler `MarketplaceOfferStatusSyncHandler` + registration + module wiring.
- New Allegro scheduler task `allegro-offer-status-sync` (env-gated).
- Unit + integration tests.
- Update the "publication status is never persisted" note in `offer-status-read.types.ts`.

### Out of Scope (follow-ups)
- **FE surfacing** — status badges/filters on the listings list/detail (`docs/frontend-architecture.md`). This issue only delivers the persisted field + sync.
- **Domain-event emission** on transition (e.g. for inventory reactions / alerts). v1 persists + logs; event wiring is a deliberate follow-up.
- **Acting on status** — no auto-relist / auto-deactivate on `ended`/`inactive`.
- Marketplaces other than Allegro (capability-gated; any future `OfferStatusReader` adapter inherits the flow for free).

### Constraints
- Allegro has **no bulk status endpoint** → status reads are N× `GET /sale/product-offers/{id}`. Each run is bounded by a page `limit` and paced by the cron cadence (no aggressive follow-up drain).
- Hexagonal boundaries: core service depends only on ports (capability port + repository port + `IIntegrationsService`); no concrete adapters/repositories. Plugin (Allegro) contributes only the scheduler task.
- Migrations are the source of truth (`docs/migrations.md`); no `synchronize`.

## 3. Architecture Mapping

| Layer | Component | Location |
|---|---|---|
| Domain (listings) | `OfferStatusSnapshot` entity; `OfferStatusSnapshotRepositoryPort`; snapshot types (reuse `OfferPublicationStatus`) | `libs/core/src/listings/domain/{entities,ports,types}/` |
| Application (listings) | `IOfferStatusSyncService` + `OfferStatusSyncService` | `libs/core/src/listings/application/services/` |
| Infrastructure (listings) | `OfferStatusSnapshotOrmEntity`; `OfferStatusSnapshotRepository` | `libs/core/src/listings/infrastructure/persistence/{entities,repositories}/` |
| Domain (sync) | job type `marketplace.offer.statusSync`; `MarketplaceOfferStatusSyncPayloadV1` | `libs/core/src/sync/domain/types/` |
| Interface (worker) | `MarketplaceOfferStatusSyncHandler` | `apps/worker/src/sync/handlers/` |
| Integration (Allegro) | `allegro-offer-status-sync` scheduler task | `libs/integrations/allegro/src/infrastructure/scheduler/allegro-scheduler-tasks.ts` |
| Persistence | `offer_status_snapshots` migration | `apps/api/src/migrations/` |

**Data flow:** Allegro scheduler task (cron) → enqueue `marketplace.offer.statusSync` per active connection → `MarketplaceOfferStatusSyncHandler.execute` (reads/advances scan-offset cursor) → `OfferStatusSyncService.sync(connectionId, {limit, offset})` → enumerate the next page of offer mappings via `OfferMappingRepositoryPort.findMany` → guard `isOfferStatusReader` → per offer `getOfferStatus` → upsert `OfferStatusSnapshot` (log on transition) → return `{ scanned, updated, transitioned, notFound, nextOffset }`.

## 4. External / Domain Research

### External (Allegro)
- `getOfferStatus(externalOfferId)` → `OfferStatusReadResult { publicationStatus, validationErrors }`, where `publicationStatus ∈ {active, activating, inactivating, inactive, ended}` (`offer-status-read.types.ts`). Backed by `GET /sale/product-offers/{offerId}`; throws `OfferNotFoundOnMarketplaceException` on 404 (`offer-not-found-on-marketplace.exception.ts`). Other transport errors propagate (runner transient-retry absorbs).

### Internal patterns reused
- **Enumeration seam:** `OfferMappingRepository.findMany({connectionId},{offset,limit})` → `PaginatedOfferMappings { items: IdentifierMapping[], total }` — each row carries `externalId` (offer) + `internalId` (variant). Already scoped to `entityType='Offer'` and in-context (listings).
- **Job/handler/scheduler:** mirror `marketplace.offers.sync` — `JobTypeValues` (`sync-job.types.ts`), payload in `marketplace-job-payloads.types.ts` (re-exported from `libs/core/src/sync/index.ts`), `MarketplaceOffersSyncHandler` + `handler-registration.service.ts` + `sync-worker.module.ts`, `SchedulerTaskConfig` in `allegro-scheduler-tasks.ts`.
- **Cursor:** `ConnectionCursorRepositoryPort` (`CONNECTION_CURSOR_REPOSITORY_TOKEN`) — used to persist the numeric scan-offset (`allegro.offerStatus.scanOffset`).
- **Capability guard:** `isOfferStatusReader(adapter)`.
- **Status-vs-outcome:** handler returns `SyncJobHandlerResult` (`{ outcome: 'ok' }`).

## 5. Questions & Assumptions

### Open Questions (resolved here; confirm at the pause)
1. **Persistence shape → NEW `offer_status_snapshots` table** (not `identifier_mappings.context` JSONB). Rationale in §7.
2. **Enumeration → "rolling scan-offset" over our own offer mappings**, bounded per tick (no marketplace cursor, no aggressive follow-up enqueue). Eventual-consistency tradeoff accepted for a periodic refresher (§7 / §8).
3. **Poller interaction → disjoint** (different table, job type, cursor key, schedule). No coordination needed.
4. **Reconciliation → persist + structured log on transition** in v1; domain event deferred.

### Assumptions
- v1 records observed status only; `OfferNotFoundOnMarketplaceException` (404) is logged + counted (`notFound`), snapshot left unchanged — we do not fabricate a status (the publication union has no `removed`).
- Only **mapped** offers (those with an `Offer` identifier-mapping row) are synced.
- Scheduler task default cadence hourly, page limit 100, **env-gated** (`OL_ALLEGRO_OFFER_STATUS_SYNC_*`). Default-enabled to match sibling Allegro tasks — *flagged for confirmation* (a brand-new always-on API-cost loop).

### Documentation Gaps
- `docs/architecture-overview.md` Listings section should gain a one-line note that offer publication status is now persisted via `offer_status_snapshots` (steady-state), distinct from `OfferCreationRecord` (creation lifecycle).

## 6. Proposed Implementation Plan

### Phase 1: Core sync contract
- **`libs/core/src/sync/domain/types/sync-job.types.ts`** — add `'marketplace.offer.statusSync'` to `JobTypeValues`. *AC: `JobType` includes the new literal; type-check passes.*
- **`libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts`** — add `MarketplaceOfferStatusSyncPayloadV1 { schemaVersion: 1; limit: number; cursorKey?: string }`. *AC: exported.*
- **`libs/core/src/sync/index.ts`** — add the payload to the re-export list. *AC: importable from `@openlinker/core/sync`.*

### Phase 2: Listings domain + persistence
- **`domain/types/offer-status-snapshot.types.ts`** — `OfferStatusSnapshotProps`, reuse `OfferPublicationStatus`; `OfferStatusSyncResult`. *AC: types only.*
- **`domain/entities/offer-status-snapshot.entity.ts`** — pure domain entity `{ id, connectionId, externalOfferId, internalVariantId, publicationStatus, statusDetails?, lastStatusSyncedAt, createdAt, updatedAt }`, no framework deps. *AC: no `@nestjs`/`typeorm` imports.*
- **`domain/ports/offer-status-snapshot-repository.port.ts`** — `OfferStatusSnapshotRepositoryPort` with `findByConnectionAndExternalOfferId(connectionId, externalOfferId)`, `upsert(snapshot)`, and (for observability/future) `countByConnectionAndStatus(connectionId)`. Minimal; no TypeORM API leakage. *AC: interface only.*
- **`infrastructure/persistence/entities/offer-status-snapshot.orm-entity.ts`** — `@Entity('offer_status_snapshots')`; columns + unique index `(externalOfferId, connectionId)`, index `(internalVariantId)`, index `(lastStatusSyncedAt)`, index `(connectionId, publicationStatus)`. *AC: mirrors `offer-creation-record.orm-entity.ts` conventions.*
- **`infrastructure/persistence/repositories/offer-status-snapshot.repository.ts`** — implements the port; private `toDomain`/`toOrm`; `upsert` via insert-or-update on the unique key; converts unique-violation races to a benign retry/no-op. *AC: returns domain entities only.*

### Phase 3: Core application service
- **`application/services/offer-status-sync.service.interface.ts`** — `IOfferStatusSyncService`, `OfferStatusSyncOptions { limit; offset?: number }`, `OfferStatusSyncResult { scanned; updated; transitioned; notFound; nextOffset; total }`.
- **`application/services/offer-status-sync.service.ts`** — `OfferStatusSyncService implements IOfferStatusSyncService`. Injects `INTEGRATIONS_SERVICE_TOKEN`, `OFFER_MAPPING_REPOSITORY_TOKEN`, `OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN`. Resolve `OfferManagerPort`; if `!isOfferStatusReader` → return zeroed result (skip, no error). Page offer mappings (`findMany({connectionId},{offset,limit})`); per offer call `getOfferStatus`, catch `OfferNotFoundOnMarketplaceException` (count `notFound`), upsert snapshot, compare to prior snapshot → log transition. Compute `nextOffset` (`offset+limit`, wrap to 0 when `>= total`). *AC: depends only on ports; transition + skip + not-found paths covered.*

### Phase 4: Listings wiring
- **`listings.tokens.ts`** — add `OFFER_STATUS_SYNC_SERVICE_TOKEN`, `OFFER_STATUS_SNAPSHOT_REPOSITORY_TOKEN`.
- **`listings.module.ts`** (services sub-barrel module) — `TypeOrmModule.forFeature([... OfferStatusSnapshotOrmEntity])`; add `OfferStatusSyncService`, `OfferStatusSnapshotRepository` providers; bind tokens (`useExisting`); export the service token (consumed by worker).
- **`listings/index.ts`** — export the entity, snapshot types, repo port, and service interface (tokens flow via `export * from './listings.tokens'`). *AC: `@openlinker/core/listings` exposes the new contracts; `@openlinker/core/listings/orm-entities` exposes the ORM entity if a host needs it.*

### Phase 5: Migration
- `pnpm --filter @openlinker/api migration:generate -- src/migrations/CreateOfferStatusSnapshots` → review, ensure entity registered in the data-source glob, `migration:run` + `migration:show` clean. Follow `docs/migrations.md`. *AC: up creates table+indexes; down drops; no pending migrations.*

### Phase 6: Worker handler
- **`apps/worker/src/sync/handlers/marketplace-offer-status-sync.handler.ts`** — `implements SyncJobHandler`; inject `OFFER_STATUS_SYNC_SERVICE_TOKEN`, `CONNECTION_CURSOR_REPOSITORY_TOKEN`. Read scan-offset from cursor (`payload.cursorKey ?? 'allegro.offerStatus.scanOffset'`), call `sync`, persist `nextOffset` to cursor, return `{ outcome: 'ok' }`; wrap failures in `SyncJobExecutionError`. *AC: mirrors `MarketplaceOffersSyncHandler`.*
- **`handler-registration.service.ts`** — import + constructor-inject + `register('marketplace.offer.statusSync', …)`.
- **`sync-worker.module.ts`** — add handler to providers.

### Phase 7: Allegro scheduler task
- **`allegro-scheduler-tasks.ts`** — push `allegro-offer-status-sync` task gated by `OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED`, `OL_ALLEGRO_OFFER_STATUS_SYNC_INTERVAL_CRON` (default `0 * * * *`), `OL_ALLEGRO_OFFER_STATUS_SYNC_PAGE_LIMIT` (default 100); `jobType: 'marketplace.offer.statusSync'`; payload `{ schemaVersion:1, limit, cursorKey:'allegro.offerStatus.scanOffset' }`; idempotency `marketplace:${connection.id}:offer:status:sync:${timestamp}`. *AC: task registers for allegro connections.*

### Phase 8: Tests
- `offer-status-sync.service.spec.ts`, `marketplace-offer-status-sync.handler.spec.ts`, `offer-status-snapshot.repository` int-spec (+ optional e2e mirroring `marketplace-offers-sync-e2e.int-spec.ts`).

### Implementation Details
- **Transition detection:** `prior?.publicationStatus !== next.publicationStatus` → `logger.log` with `{connectionId, externalOfferId, from, to}`; always update `lastStatusSyncedAt`.
- **Rate-friendliness:** sequential per-offer reads within a page; cadence paces total load; no follow-up enqueue.

## 7. Alternatives Considered

### Alternative 1: persist in `identifier_mappings.context` JSONB
Zero migration, single-row write. **Rejected:** bleeds listings-domain status into the cross-cutting identifier-mapping spine (depended on by 5+ contexts); "stale/ended" queries require JSONB extraction; clutters a generic identity row with offer-specific fields.

### Alternative 2: reuse `offer_creation_records`
**Rejected:** semantic mismatch (creation lifecycle ≠ steady-state status); not keyed to live status; the poller (#447) owns its writes.

### Alternative 3: marketplace event-cursor enumeration (like offers.sync)
**Rejected for v1:** the offer-events feed carries no status; we'd still N× fetch detail. Enumerating our own mappings is simpler and needs no second marketplace call to discover work. (Future optimization: order by `lastStatusSyncedAt` via a denormalized column / keyset pagination instead of offset.)

## 8. Validation & Risks

### Architecture Compliance
Core service → ports only; ORM↔domain mapping private in repository; domain entity framework-free; plugin contributes only a scheduler task; new tokens in `listings.tokens.ts` per the Symbol convention.

### Naming Conventions
`*.entity.ts`, `*.orm-entity.ts`, `*-repository.port.ts`, `*.service.interface.ts` + `*.service.ts`, `*.handler.ts`, `OfferStatusSnapshot`, `OfferStatusSyncService`/`IOfferStatusSyncService`.

### Risks
- **API cost / rate limits** (N× detail GET). Mitigation: bounded page limit + cron cadence + env gate; sequential reads.
- **Offset drift** under catalog churn (offers added/removed between ticks may be skipped/repeated within a cycle). Acceptable for an eventually-consistent refresher; documented; future keyset/`lastStatusSyncedAt` ordering.
- **Reverses documented design** ("publication status never persisted"). Mitigation: update the `offer-status-read.types.ts` note; consider a short ADR (the JSONB-vs-table decision qualifies).

### Edge Cases
No-capability adapter → skip; 404 → log+count, no fabricated status; empty catalog → `scanned=0`; unique-violation on concurrent upsert → benign.

### Backward Compatibility
Purely additive: new job type, new table, new task. Existing jobs/handlers untouched. New scheduler task env-gated.

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- Service: maps each `publicationStatus`; logs on transition; skips no-capability adapter; counts `notFound` on 404; advances + wraps `nextOffset`; upserts per offer.
- Handler: parses payload; reads/sets scan-offset cursor; returns `{ outcome: 'ok' }`; wraps errors.

### Integration Tests
- Repository upsert/read against real Postgres (Testcontainers); optional worker e2e enqueue→handle→snapshot persisted (mirror `marketplace-offers-sync-e2e.int-spec.ts`).

### Mocking Strategy
Mock `OfferManagerPort`(+`OfferStatusReader`), `IIntegrationsService`, repository ports per the ports-not-adapters rule.

### Acceptance Criteria
Mirrors issue #816 AC: periodic job reads status via reused `getOfferStatus` (no new adapter method); status + `lastStatusSyncedAt` persisted; transitions observable (persisted+logged); no-capability connections skipped; correct `SyncJobHandlerResult`; no race with #447; ports-only deps; tests added; the "never persisted" note updated; migration clean.

## 10. Alignment Checklist
- [ ] Hexagonal boundaries respected (core↔integration)
- [ ] Ports/interfaces only in the service
- [ ] Symbol tokens in `listings.tokens.ts`
- [ ] Migration follows `docs/migrations.md`
- [ ] No `any`, no `console.log`, structured `Logger`
- [ ] `pnpm lint` / `type-check` / `test` green
- [ ] Tests for service + handler + repository

## Related Documentation
- `docs/architecture-overview.md` (Listings, Sync Manager, OfferManagerPort sub-capabilities)
- `docs/engineering-standards.md` (ports, tokens, ORM mapping, `as const`)
- `docs/migrations.md`

## Success Definition
A scheduled job refreshes persisted Allegro offer publication status for mapped offers per connection, transitions are observable, the slice is fully tested and green, and the change is additive/back-compatible — unblocking a future FE/filters/alerts follow-up.
