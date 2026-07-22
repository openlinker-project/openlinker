# Implementation Plan: Reconcile stale terminal offer status against live Allegro publication (#1760)

**Date**: 2026-07-22
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days

---

## 1. Task Summary

**Objective**: Make an OL-created offer's operator-facing status reflect the live marketplace publication status, so an offer that Allegro activates minutes after creation stops showing a stale "Draft" (szkic) in OL.

**Context**: Spun out of #1520. An Allegro offer created with `publishImmediately: true` is not published synchronously: Allegro holds it `ACTIVATING` while its validator runs, then flips it to `ACTIVE`. The creation poller (#447) has a bounded budget (~9 min); when validation runs longer, it terminalises the `OfferCreationRecord` as `draft`, and that terminal record is never revised. The steady-state `offer_status_snapshots` table (#816) captures the eventual `active`, but it is write-only today (no HTTP read surface) and does not feed back into any operator-facing view.

Live-data evidence (demo Allegro Sandbox): of 12 terminal-`draft` creation records created with `publishImmediately=true` and no validation errors, **11 are live `active` on Allegro** per the steady-state snapshot while OL still reads `draft`.

**Classification**: Integration / Application (listings status read + reconciliation) + Interface (HTTP endpoint + FE status surface).

---

## 2. Scope & Non-Goals

### In Scope
- Expose `offer_status_snapshots` via an authenticated read: a core read service + repository read method + `GET` endpoint returning neutral `OfferPublicationStatus` per product's variants.
- A manual force-refresh action (`POST`) that reads the live status for one offer, upserts the snapshot, and returns it.
- Post-terminal freshness: when the creation poller terminalises a record to `draft` or `failed(POLL_TIMEOUT)`, enqueue a bounded, delayed one-shot snapshot refresh so a late activation is reflected in minutes, not up to the hourly cron.
- FE: surface live publication status + last-synced + manual refresh on the product surface, reusing the `StatusBadge` primitive.

### Out of Scope
- Mutating the terminal `OfferCreationRecord` (ADR-009 keeps creation-record and snapshot tables disjoint; the creation record stays the record of the create *attempt*).
- Changing default publish behaviour (decided in #1520: single-offer defaults to draft, bulk to publish).
- Non-Allegro marketplaces (`OfferStatusReader` is Allegro-only today; the code stays capability-driven, so a future reader is picked up for free).
- Extending the live-status surface to the products-list coverage pills and product-detail hero (documented follow-up; keeps this PR reviewable).

### Constraints
- No schema change (a partial index on `internalVariantId` already exists: `IDX_offer_status_snapshots_variant`).
- Capability-neutral: no `platformType`/Allegro branching in core; resolve via `getCapabilityAdapter` + `isOfferStatusReader`.

---

## 3. Architecture Mapping

**Target Layer**: CORE (`libs/core/src/listings`) for the read service, repo method, reconcile scheduling; App/Interface (`apps/api`, `apps/worker`) for the endpoint + handler; Frontend (`apps/web`).

**Capabilities Involved**: `OfferManagerPort` + `OfferStatusReader` sub-capability (existing).

**Existing Services Reused**:
- `OfferStatusSyncService` / `IOfferStatusSyncService` (#816) — extended with `refreshOne`.
- `OfferStatusPollService` (#447) — extended to schedule the post-terminal reconcile.
- `OfferStatusSnapshotRepositoryPort` — extended with a by-variant read.
- `ISyncJobsService.schedule` — delayed job enqueue (already used by the poller).
- `StatusBadge`, `TimeDisplay`, `Button` FE primitives; the `.sync-freshness` pattern.

**New Components Required**:
- Core: `IOfferStatusReadService` + `OfferStatusReadService` + `OFFER_STATUS_READ_SERVICE_TOKEN`; repo method `findByVariantIds`; sync-service method `refreshOne`; reconcile job payload + scheduling.
- Sync context: `MarketplaceOfferRefreshSnapshotPayloadV1` + `'marketplace.offer.refreshSnapshot'` job type.
- Worker: `MarketplaceOfferRefreshSnapshotHandler` + registration.
- API: `offer-publication-status-response.dto.ts` + 2 controller methods.
- FE: `OfferPublicationStatusBadge`, a query hook + api method + query key, and a per-product status surface.

**Core vs Integration Justification**: All reconciliation/read logic is marketplace-neutral and belongs in CORE listings; the only marketplace-specific piece (status mapping) already lives in the Allegro adapter behind `OfferStatusReader`. No integration package changes.

---

## 4. External / Domain Research

Covered by #1520 investigation and live-DB confirmation. Neutral status union (`OfferPublicationStatusValues`): `active | activating | inactivating | inactive | ended`. Allegro create with `publication.status: ACTIVE` → async `ACTIVATING` → `ACTIVE`; the creation poller maps `ACTIVATING → validating`, `ACTIVE → active`, clean `INACTIVE → draft`, `INACTIVE + validationErrors → failed`.

### Internal Patterns
- Poll service scheduling via `ISyncJobsService.schedule({ jobType, connectionId, payload, idempotencyKey, maxAttempts, runAfter })` (`offer-status-poll.service.ts`).
- Steady-state handler + rolling scan-offset cursor (`marketplace-offer-status-sync.handler.ts`); Allegro scheduler registers the hourly `marketplace.offer.statusSync`.
- API read endpoint + response DTO pattern (`listings.controller.ts` `getOfferCreationStatus` + `offer-creation-status-response.dto.ts`, `@ApiProperty({ enum })` from core union).
- FE query hook + query-key + api-method pattern (`use-offer-creation-status-query.ts`, `listings.query-keys.ts`, `listings.api.ts`); badge pattern (`OfferCreationStatusBadge.tsx`); `.sync-freshness` + `isFetching ? 'Refreshing…' : 'Refresh'`.

---

## 5. Questions & Assumptions

### Assumptions
- The read is **product-scoped**: the endpoint takes a product id, resolves its variants via the products context (already a listings dependency), and returns snapshots for offers mapped to those variants across the product's OfferManager connections. (Alternative considered: variant-id list from the FE — rejected as leakier.)
- The manual refresh performs one synchronous live read (like a connection-test) — acceptable latency for an operator-triggered action.
- Reconcile bound: 3 delayed attempts at ~2 min / ~8 min / ~20 min after the terminal state (covers the "few minutes" case well beyond the ~9-min poll budget); the hourly sync remains the durable backstop.

### Documentation Gaps
- ADR-009 gains a short amendment noting the snapshot is now an operator-facing read + the post-terminal reconcile path. Not a new ADR (extends an existing decision).

---

## 6. Proposed Implementation Plan

### Phase 1 — Core read surface

1. **Repo read method** — `libs/core/src/listings/domain/ports/offer-status-snapshot-repository.port.ts` + `.../infrastructure/persistence/repositories/offer-status-snapshot.repository.ts`
   - Add `findByVariantIds(internalVariantIds: string[], connectionId?: string): Promise<OfferStatusSnapshot[]>` (query builder `WHERE internalVariantId IN (:...ids)` + optional `connectionId`). Empty input → `[]` (no query).
   - **Acceptance**: unit test returns snapshots for the given variants; empty-array short-circuit.

2. **Read service** — `libs/core/src/listings/application/services/offer-status-read.service.ts` (+ `.service.interface.ts`) + token `OFFER_STATUS_READ_SERVICE_TOKEN` in `listings.tokens.ts`
   - `getPublicationStatusForProduct(productId, connectionId?)`: resolve variants via `IProductsService` (barrel), call `findByVariantIds`, return a neutral view-model list `{ connectionId, externalOfferId, internalVariantId, publicationStatus, validationMessages, lastStatusSyncedAt }`.
   - Bind in `libs/core/src/listings/listings.module.ts`; **add `OFFER_STATUS_READ_SERVICE_TOKEN` to the module `exports`** (the snapshot repo token is intentionally not exported — the service is the seam). Export interface + token from the barrel.
   - **Acceptance**: unit test with mocked products service + repo.

### Phase 2 — Freshness (post-terminal reconcile)

3. **Job payload + type** — `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts`
   - Add `MarketplaceOfferRefreshSnapshotPayloadV1 { schemaVersion: 1; externalOfferId: string; internalVariantId: string; attempt: number }`; export from the sync barrel.

4. **Refresh execution** — extend `IOfferStatusSyncService` + `OfferStatusSyncService` with `refreshOne(connectionId, { externalOfferId, internalVariantId }): Promise<OfferPublicationStatus | null>` (resolve adapter, `isOfferStatusReader` guard → `null` if unsupported, `getOfferStatus`, `upsert`, return status; `OfferNotFoundOnMarketplaceException` → `null`).
   - **Acceptance**: unit test upserts and returns the live status; unsupported/not-found → null.

5. **Reconcile scheduling** — `libs/core/src/listings/application/services/offer-status-poll.service.ts`
   - Private `scheduleSnapshotReconcile(connectionId, externalOfferId, internalVariantId, attempt=1)` → `syncJobs.schedule({ jobType: 'marketplace.offer.refreshSnapshot', runAfter: now + delay(attempt), idempotencyKey: 'refreshSnapshot:{externalOfferId}:{attempt}', maxAttempts: 3, payload })`.
   - Call it on the terminal-`draft` branch and the two POLL_TIMEOUT sites (read `internalVariantId` from the already-loaded `record`). Never on `failed(validation)` / not-found / unsupported.
   - **Acceptance**: unit test asserts a delayed `refreshSnapshot` job is scheduled on draft + POLL_TIMEOUT, and not on validation-failure.

6. **Worker handler** — `apps/worker/src/sync/handlers/marketplace-offer-refresh-snapshot.handler.ts` + register in `handler-registration.service.ts` + map in `jest-integration.cjs` if needed.
   - Call `offerStatusSync.refreshOne(...)`; if result is not `active`/`ended` (i.e. still `inactive`/`activating`) and `attempt < MAX_ATTEMPTS (3)`, re-schedule `attempt+1` with the next delay; else stop. Returns `{ outcome: 'ok' }`.
   - **Acceptance**: handler unit test — active → no reschedule; inactive + attempt<3 → reschedule; attempt=3 → stop.

### Phase 3 — API

7. **Response DTO** — `apps/api/src/listings/http/dto/offer-publication-status-response.dto.ts`
   - `publicationStatus!: OfferPublicationStatus` with `@ApiProperty({ enum: OfferPublicationStatusValues })`, `externalOfferId`, `internalVariantId`, `connectionId`, `lastStatusSyncedAt`, optional `validationMessages`.

8. **Controller** — `apps/api/src/listings/http/listings.controller.ts`
   - `@Get('products/:productId/offer-status')` `@Roles('admin','operator','viewer')` → `readService.getPublicationStatusForProduct(...)`.
   - `@Post('connections/:connectionId/offers/:externalOfferId/refresh-status')` `@Roles('admin','operator')` → `offerStatusSync.refreshOne(...)`; needs `internalVariantId` — accept it in a small body DTO or resolve via the offer mapping. Returns the refreshed DTO (404 if unsupported/not-found).
   - Inject `OFFER_STATUS_READ_SERVICE_TOKEN` + `OFFER_STATUS_SYNC_SERVICE_TOKEN`.
   - **Acceptance**: controller unit test (mock services) for both routes + not-found mapping.

### Phase 4 — Frontend

9. **Badge** — `apps/web/src/features/listings/components/OfferPublicationStatusBadge.tsx`
   - `Record<OfferPublicationStatus, {tone,label}>`: `active→success "Active"`, `activating→warning "Activating" (pulse)`, `inactivating→warning "Deactivating"`, `inactive→review "Inactive"`, `ended→neutral "Ended"`. Reuses `StatusBadge`.

10. **Data layer** — add `offerPublicationStatus` query-key, `getOfferPublicationStatus(productId)` + `refreshOfferPublicationStatus(...)` to `ListingsApi` + impl, and a `use-offer-publication-status-query.ts` hook (`staleTime` 30s, no auto-poll).

11. **Surface** — render per-connection/per-variant live status + `TimeDisplay` last-synced + an `isFetching ? 'Refreshing…' : 'Refresh'` button (calls the refresh endpoint then refetches) in `product-row-detail.tsx` (`ProductVariantRow`, alongside the existing coverage/CTA). Loading/empty/error states per FE conventions.
    - **Acceptance**: component test renders each status; refresh button triggers refetch.

### Phase 5 — Docs

12. Amend ADR-009 (snapshot is now operator-facing + post-terminal reconcile path); update the listings section of `architecture-overview.md`.

---

## 7. Alternatives Considered

- **Mutate the terminal creation record from the snapshot** — rejected: breaks ADR-009's disjoint-tables invariant and risks the two pollers racing on one row.
- **Only extend the creation-poll budget (env)** — rejected as the fix: any fixed budget can be exceeded by a slow validator; kept as an optional mitigation, not the mechanism.
- **Variant-id-list endpoint (FE passes ids)** — rejected: leaks OL variant identifiers into the query surface; product-scoped is cleaner and matches existing endpoints.

---

## 8. Validation & Risks

- **Architecture**: ✅ core stays capability-driven; snapshot repo token stays unexported (service is the seam); domain untouched by framework.
- **Naming**: ✅ `I*Service` + `*.service.interface.ts`, `*_TOKEN` Symbols, `*ResponseDto`.
- **Risks**:
  - *Reschedule storm* — bounded by `MAX_ATTEMPTS=3` + per-attempt idempotency key.
  - *Synchronous refresh latency* — operator-triggered only; same shape as existing live marketplace reads.
  - *No snapshot yet for a never-synced offer* — endpoint returns an empty list for that variant; FE shows "not yet synced" rather than a wrong status.
- **Backward compatibility**: ✅ additive — new endpoint, new job type, new service; no change to existing payloads/tables.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- Repo `findByVariantIds` (incl. empty-array short-circuit).
- `OfferStatusReadService.getPublicationStatusForProduct`.
- `OfferStatusSyncService.refreshOne` (active / not-found / unsupported).
- `OfferStatusPollService` reconcile scheduling (draft + POLL_TIMEOUT yes; validation-failure no).
- Refresh-snapshot handler reschedule logic.
- Controller (both routes + not-found).
- FE badge + hook/refresh render tests.

### Integration Test
- `apps/api` int-spec: seed a snapshot, `GET /listings/products/:productId/offer-status` returns it; `POST .../refresh-status` with a stubbed `OfferStatusReader` adapter upserts + returns `active`.

### Acceptance Criteria (from #1760)
- [ ] A terminal `draft`/`failed(POLL_TIMEOUT)` offer that Allegro later activates is reflected as `active` in the operator-facing live status within one post-terminal reconcile cycle (not just the hourly cron).
- [ ] Live publication status is readable via an authenticated HTTP endpoint returning neutral status values; the snapshot is no longer write-only.
- [ ] Reconciliation/read is capability/adapter-neutral (no Allegro branching in core).
- [ ] FE shows live publication status + last-synced per product offer, reusing the status-badge vocabulary; a manual refresh action is available.
- [ ] Tests: terminal-draft → snapshot later `active` → operator-facing status resolves to `active`; endpoint contract test; FE render/refresh test.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (no unnecessary abstractions)
- [x] Idempotency considered (per-attempt reconcile key)
- [x] Event-driven / job patterns used (delayed sync job)
- [x] Rate limits & retries addressed (bounded reconcile attempts)
- [x] Error handling comprehensive (not-found / unsupported → null / 404)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready
