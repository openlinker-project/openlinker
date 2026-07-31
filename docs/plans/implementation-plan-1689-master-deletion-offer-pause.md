# Implementation Plan: Consume `master.deletion` → pause live marketplace offers (oversell protection)

**Issue**: [#1689](https://github.com/openlinker-project/openlinker/issues/1689)
**Date**: 2026-07-27
**Status**: Ready for Review
**Estimated Effort**: 4–5 days (Phases 0–3 ≈ 2.5 d backend; Phases 4–5 ≈ 1.5 d BE+FE slice; Phase 6 ≈ 0.5 d docs/tests)

---

## 1. Task Summary

**Objective**: Close the fail-open marketplace side of master-side deletion. When a
product or variant is deleted at its master, every live marketplace offer mapped to
the affected variants must stop selling — automatically, and with a guarantee that
survives a lost event.

**Context**: #1599 (PR #1676) delivered the *detection* half: `product_variants.isStale`
is soft-marked, the master-sync job returns `business_failure` instead of retrying a
permanent condition, and a `master.variant.stale` / `master.product.stale` event is
published to the `events.master.deletion` Redis stream. Per that issue's scope,
consumers were explicitly deferred — "this issue only guarantees the event exists".

The consequence, raised as review item #4 on PR #1676: from the master deletion until
an operator manually notices, a mapped Allegro/Erli offer stays live at its last-known
quantity and buyers can purchase a product that no longer exists (oversell). The
*new-offer* path already fails safe (`getAvailabilityByVariantIds` excludes stale
inventory rows, so the bulk wizard won't newly list a deleted variant); **live offers
are unprotected**. The part-C order guard from #1599 makes this worse for the buyer, not
better: each oversold, already-paid order now hits `StaleOrderItemError` at ingestion,
never creates the destination order, and sits unfulfillable.

This plan also folds in the related review hardening the PR author tracked onto this
issue: bulk offer-creation fan-out must filter `isStale` siblings (review #7), the
🟢 event suggestions (consistent event-type derivation, shared correlation id, stream
`MAXLEN`), and the frontend half of the deletion lifecycle (a distinct **Source deleted**
order state, and a jobs-list label that distinguishes a deletion-caused
`business_failure` from other business failures).

**Classification**: CORE (listings + products + orders application services) ·
Infrastructure (one Redis-stream consumer, two migrations) · Interface (worker handlers,
API DTOs) · Frontend.

---

## 2. Scope & Non-Goals

### In Scope

1. **Contract hardening** on the existing `master.deletion` event: shared `correlationId`,
   `externalId` in the payload, consistent product-vs-variant event-type derivation across
   both prune paths, `warn`-on-any-prune logging, stream `MAXLEN` trim.
2. **Trigger** — a Redis-stream consumer of `events.master.deletion` that enqueues an
   offer-pause job.
3. **Guarantee** — an hourly per-connection reconcile sweep derived from the authoritative
   `product_variants.isStale` flag.
4. **Core pause service** (`StaleOfferPauseService`, listings) that resolves offer mappings
   for stale variants and enqueues `marketplace.offerQuantity.update` with `quantity: 0`.
5. **Race closure** — a stale-variant guard on the `inventory.propagateToMarketplaces`
   offer fan-out so a concurrent propagate cannot re-raise a paused offer.
6. **Review #7** — `BulkListingSubmitService` variant expansion filters `isStale` siblings.
7. **Order lifecycle honesty** — a distinct `source_deleted` order record status + a
   persisted `mappingFailureReason`, surfaced through the orders API and rendered as a
   **Source deleted** health bucket in the FE.
8. **Jobs-list honesty** — a persisted `outcomeReason` on `sync_jobs`, set to a stable
   `master_deleted` code by the master-product-sync handler, rendered as a distinct label.

### Out of Scope (explicit non-goals)

- **A real `OfferDeactivator` sub-capability.** No adapter in the repo can end/unpublish an
  offer today (`OfferManagerPort` has one base write, `updateOfferQuantity`; everything
  publication-status-related is read-only). Quantity → 0 stops the offer selling on both
  shipped marketplaces. A first-class deactivation capability is a follow-up.
- **Transactional outbox for domain events.** The at-most-once gap is closed *for this
  consumer* by the sweep, not by changing the publisher contract. See §7 Alternatives Considered.
- **#1688** — inventory-sync full-deletion handling (`listInventory` 404 → `business_failure`).
  Separate tracked issue; this plan does not touch adapter 404 translation.
- **Review #5** (concurrency race in upsert-then-prune), **#8** (`product`-type order refs
  bypass the guard), **#11** (routing a stale order item to a terminal needs-review outcome
  and partial-order fulfilment — #1032 territory). Deferred by the PR author with reasoning.
- **Un-stale / reappearance event.** The self-heal already works through ordinary inventory
  propagation; emitting a "restored" event has no consumer yet.
- **Dashboard banner / proactive notification** from the UX proposal. Out of scope; the
  order and jobs surfaces are the honest-labelling minimum.
- **Exposing `isStale` on the products/listings read DTOs** (the "1 deleted at source"
  variant-table treatment in the UX proposal). Nice-to-have; not required for oversell
  protection. Flagged as a follow-up.

### Constraints

- Must not regress the existing master-sync paths — both are on the hot ingestion path for
  every ProductMaster/InventoryMaster connection.
- Backward compatible: no existing consumer of the event, no breaking API change; the two
  new columns are nullable/defaulted.
- Migrations must use the synthetic sequential prefix convention (current tail:
  `1829000000000`) — see `docs/migrations.md` § Timestamp uniqueness invariant.
- The FE job-type list at `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts:52` is a
  hand-maintained mirror of `JobTypeValues` and must move in lockstep.

---

## 3. Architecture Mapping

**Target layers**:

| Layer | What lands there |
|---|---|
| CORE — `libs/core/src/products` | event payload/type-derivation hardening; a `findStaleVariantsByIds` read |
| CORE — `libs/core/src/inventory` | event emission parity (emit on `markedCount > 0`, derive type) |
| CORE — `libs/core/src/listings` | `StaleOfferPauseService` + its interface, types, tokens; the sweep query on `OfferMappingRepositoryPort`; bulk-expansion stale filter |
| CORE — `libs/core/src/orders` | `source_deleted` record status, `mappingFailureReason`, resolution-failure discriminator |
| CORE — `libs/core/src/sync` | two new `JobType` values, two payload types, `outcomeReason` on `SyncJobHandlerResult` |
| Infrastructure — `libs/core/src/events` | per-stream `MAXLEN` trim in `RedisStreamsEventPublisher` |
| App — `apps/worker` | stream consumer + two thin job handlers + registrations |
| App — `apps/api` | scheduler descriptor; two migrations; DTO fields |
| Frontend — `apps/web` | order health bucket + jobs-list outcome label |

**Capabilities involved**: `OfferManagerPort.updateOfferQuantity` (base port — no capability
gate needed, every adapter implements it). The sweep's scheduler descriptor gates on the
`OfferManager` capability so connections that own no offers are skipped.

**Existing services reused (no new abstraction where one exists)**:

- `marketplace.offerQuantity.update` job + `InventorySyncService.updateOfferQuantity` —
  already handles adapter resolution, deterministic idempotency-key derivation, batch-vs-single
  dispatch, and per-offer failure isolation (it never throws for a single-offer failure).
- `IIdentifierMappingService.getExternalIds(CORE_ENTITY_TYPE.Offer, variantId)` — the
  fan-out lookup used by `InventoryPropagateToMarketplacesHandler`.
- `OfferMappingRepositoryPort` — connection-scoped mapping reads for the sweep.
- `SchedulerTaskRegistryService` + the `CORE_CAPABILITY_TASKS` descriptor table in
  `apps/api/src/sync/application/services/scheduler.service.ts` — adding a cron task is one
  array entry.
- `SyncJobQueuePort` (core services) / `JobEnqueuePort` (worker handlers) — the two existing
  enqueue idioms; use each where its precedent uses it.
- `WebhookToJobHandler` — the canonical stream-consumer skeleton, copied structurally.
- `OfferStockRestoreService` + `marketplace-offer-stock-restore.handler.ts` (ADR-028) — the
  canonical "core service owns the policy, worker handler is a thin delegate" shape.

**New components**:

- `StaleOfferPauseService` (+ `IStaleOfferPauseService`, types, token) — listings context.
- `MasterDeletionToJobHandler` — the stream consumer, `apps/worker/src/events/`.
- `MarketplaceOfferPauseStaleHandler`, `MarketplaceOfferPauseStaleSweepHandler` — worker.
- Two migrations.

**CORE vs Integration justification**: everything here is CORE. No integration package is
touched. The pause is expressed through the base `OfferManagerPort` method every adapter
already implements, so no plugin needs a change and no platform string enters core. The
deletion→pause policy (which variants, which offers, when to re-assert) is marketplace-
agnostic orchestration and belongs in a core application service, per
`CLAUDE.md` ("Sync orchestration policies live in core application services, not in worker
handlers"). Worker handlers stay thin delegates.

**Cross-context edges introduced**: `listings → products` (already exists in the dependency
map) and `listings → identifier-mapping` (already exists). No new edge, no new cycle.

---

## 4. External / Domain Research

### Marketplace behaviour on quantity 0

| Marketplace | Effect of `updateOfferQuantity(0)` | Caveat |
|---|---|---|
| Allegro | `PUT /sale/offer-quantity-change-commands/{commandId}` with `changeType: 'FIXED', value: 0`. The offer stops selling; publication status moves to inactive/ended on Allegro's side. | Asynchronous — the adapter persists an `AllegroQuantityCommand` and polls its status. A pause is therefore *eventually* applied, not instantly. Requires `cmd.idempotencyKey` (the adapter throws without one); `InventorySyncService` derives one when absent. |
| Erli | `PATCH /products/{id} { stock: 0 }`. Offer stays visible at 0 stock. | **Silently skipped** when the connection has seller-frozen stock (`isStockFrozenCached`) — documented existing adapter behaviour. The pause is a no-op on such a connection; this is a known residual gap (see §8 Risks). |
| WooCommerce | `PUT /wp-json/wc/v3/products/{id} { manage_stock: true, stock_quantity: 0 }`; 404 → warn + clean skip. | WooCommerce is reached through `ShopProduct` mappings, not `Offer` mappings, so it is **not** in this fan-out. Noted as a scope boundary. |

No adapter exposes a deactivation/publication write — exhaustive search for `endOffer`,
`deactivate`, `unpublish`, `archiveOffer`, `OfferPublicationWriter` returns zero write-side
hits. `OfferStatusReader` / `offer_status_snapshots` are read-only.

### Internal patterns confirmed by codebase search

- **Fan-out handler**: `apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts`
  — enqueued with `SYSTEM_CONNECTION_ID = '00000000-0000-0000-0000-000000000000'`, resolves
  `getExternalIds(CORE_ENTITY_TYPE.Offer, variantId)`, `Promise.all`s the per-mapping enqueue,
  wraps everything in one `SyncJobExecutionError`. Its idempotency key deliberately embeds a
  write-event token so a 5→6→5 oscillation isn't suppressed — the same reasoning drives our
  `staleAt`-keyed dedupe.
- **Thin handler + core service**: `marketplace-offer-stock-restore.handler.ts` (76 lines) +
  `OfferStockRestoreService`. Capability-first resolution, `CapabilityNotSupportedException`
  → debug-log no-op (never dead-letter a routine absence), absolute-set semantics.
- **Stream consumer**: `webhook-to-job.handler.ts` — `OnModuleInit`/`OnModuleDestroy`,
  dedicated blocking Redis client token, `xGroupCreate(..., '$', { MKSTREAM: true })`
  swallowing `BUSYGROUP`, `xReadGroup` with `BLOCK`/`COUNT`, ACK only after a successful
  enqueue, permanent faults dead-lettered to a `.dead` stream and ACKed.
- **Handler registration is two edits**: a provider in `apps/worker/src/sync/sync-worker.module.ts`
  **and** a `handlerRegistry.register(jobType, handler)` call in
  `apps/worker/src/sync/handlers/handler-registration.service.ts`.
- **`recordStatus` is a plain `VARCHAR`** (`1783000000000-add-order-record-status.ts`) with an
  index and no check constraint — adding a third value needs **no DDL**.
- **`markSucceeded` nulls `lastError`** (`sync-job.repository.ts:173-181`), which is exactly
  why a `business_failure` job carries no reason today.

---

## 5. Questions & Assumptions

### Open Questions

1. **Should the pause also target `ShopProduct` mappings (WooCommerce write-back)?** The
   `inventory.propagateToMarketplaces` handler has a second fan-out branch for shop products.
   *Assumption: no for this issue* — the issue is scoped to marketplace offers, and the WC
   write-back branch already excludes connections that are themselves an `InventoryMaster`.
   Revisit if a WC-as-destination oversell is reported.
2. **Sweep recency window.** Should the sweep consider *all* stale variants forever, or only
   those staled within N days? *Assumption: a configurable window (`OL_STALE_OFFER_PAUSE_WINDOW_DAYS`,
   default 30) plus a page limit*, so the hourly query stays bounded on a large catalogue. A
   variant stale for longer than the window has either been remediated or its offer has long
   since been paused by an earlier sweep (the pause is absolute and permanent until un-stale).
3. **Does an operator need a manual "pause now" action?** Not proposed here. The
   `POST /listings/.../refresh-status` precedent exists if one is wanted later.
4. **`source_deleted` and the retry loop.** Review #11 (route the stale case to a terminal
   needs-review outcome, fulfil the resolvable lines) is out of scope. *Assumption: the order
   still throws and retries as today* — Phase 4 only makes the record **read honestly**. Call
   this out in the PR body so it isn't mistaken for a full fix.

### Assumptions

- No consumer of `events.master.deletion` exists anywhere (verified by repo-wide grep), so the
  payload may gain required fields and the schema version may bump to `'2'` without a
  compatibility surface. The new consumer still tolerates a v1 message left on the stream.
- Re-asserting `quantity: 0` on an already-zero offer is harmless on every adapter. Allegro's
  quantity command is a `FIXED` absolute set; Erli's is an absolute `stock` patch. The deterministic
  idempotency key collapses repeats at the adapter layer anyway.
- The `staleAt` timestamp is stable for the duration of a stale period (it is set once by
  `markVariantsStaleExcept`, which has an `AND isStale = false` predicate), so it is a safe
  dedupe-key component.

### Documentation Gaps

- `docs/architecture-overview.md` § Webhook Ingestion Flow lists only `events.inbound.webhooks`.
  The `events.master.deletion` stream (added by #1599) is undocumented there. Phase 6 fixes this.
- No doc describes the "delete-then-recreate leaves rows stale forever" remediation path
  (review 🟢). Phase 6 adds one paragraph.

---

## 6. Proposed Implementation Plan

> Phases 0–2 are the buyer-protection core and are the minimum shippable unit. Phase 3 is
> independent hardening. Phases 4–5 are a separable BE+FE vertical slice and could ship as a
> second PR if the first needs to land fast.

### Phase 0 — Event-contract hardening (no behaviour change)

**Goal**: Make the event carry enough to correlate and classify, and bound the stream — before
anything consumes it.

1. **Extend the event payload**
   - **File**: `libs/core/src/products/domain/types/master-deletion-events.types.ts`
   - **Action**: Add `correlationId: string` and `externalId: string` to
     `MasterDeletionEventPayload`. Bump `MASTER_DELETION_EVENT_SCHEMA_VERSION` to `'2'`. Update
     the file header: the event is now *also* a trigger, and document that
     `product_variants.isStale` remains authoritative and the sweep (§6 Phase 2) is what makes
     delivery losses survivable.
   - **Acceptance**: `pnpm type-check` fails at both publish sites until they are updated (that
     is the point). No consumer exists to break.

2. **Consistent event-type derivation + correlation id — products path**
   - **File**: `libs/core/src/products/application/services/master-product-sync.service.ts`
   - **Action**: Generate one `correlationId` (`randomUUID()`) per sync run; include it in the
     log line, the event payload, and (Phase 4) the job payload. Pass a `wholeProduct: boolean`
     into `publishDeletionEvent` and derive the event type from it —
     `wholeProduct ? MASTER_PRODUCT_STALE_EVENT : MASTER_VARIANT_STALE_EVENT` — rather than
     hard-coding per call site. `handleMasterDeletion` passes `true` (empty keep-set); the
     post-pull prune passes `false`. Include `externalId`. Upgrade the completion log to `warn`
     whenever `markedStale.length > 0` (today only the 404 branch warns).
   - **Acceptance**: existing specs in `__tests__/master-product-sync.service.spec.ts` still
     pass with updated payload assertions; a new case asserts the derived type for each branch.

3. **Same treatment — inventory path**
   - **File**: `libs/core/src/inventory/application/services/master-inventory-sync.service.ts`
   - **Action**: Emit when `pruneResult.markedCount > 0` (not `variantIds.length > 0` — a
     product-level `NULL`-variant row currently emits nothing). Derive the type the same way:
     `currentVariantIds.length === 0` ⇒ whole product. Add `correlationId` + `externalId`.
     Rename the log field so `markedStale` means the same thing on both paths (`markedRows` here,
     `markedVariants` there) and emit at `warn` when non-zero. Extract the envelope builder to
     match the products-side `publishDeletionEvent` shape so the two cannot drift.
   - **Acceptance**: `__tests__/master-inventory-sync.service.spec.ts` gains a case for the
     product-level-row-only prune (previously silent).

4. **Bound the stream**
   - **File**: `libs/core/src/events/infrastructure/adapters/redis-streams-event-publisher.ts`
   - **Action**: Add a module-private `STREAM_MAXLEN: Record<string, number>` map and, when the
     stream has an entry, pass
     `{ TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold } }` to `xAdd`. Seed it with
     `'events.master.deletion': 10_000`. Keeps `EventPublisherPort` unchanged (no port churn for
     an infrastructure retention policy).
   - **Acceptance**: unit test asserts the `TRIM` option is passed for a mapped stream and
     omitted for an unmapped one.

### Phase 1 — Trigger: consumer + core pause service + handler

**Goal**: A master deletion pauses mapped live offers within seconds.

5. **Job types + payloads**
   - **Files**: `libs/core/src/sync/domain/types/sync-job.types.ts`,
     `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts`
   - **Action**: Add `'marketplace.offer.pauseStale'` and `'marketplace.offer.pauseStaleSweep'`
     to `JobTypeValues`. Add `MarketplaceOfferPauseStalePayloadV1
     { schemaVersion: 1; internalProductId: string; variantIds: string[]; correlationId: string }`
     and `MarketplaceOfferPauseStaleSweepPayloadV1 { schemaVersion: 1; limit: number }`.
   - **Mirror**: add both strings to `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts:52`.
   - **Acceptance**: `pnpm type-check` green; the FE job-type filter dropdown lists both.

6. **Listings types + token + service interface**
   - **Files**: `libs/core/src/listings/domain/types/stale-offer-pause.types.ts`,
     `libs/core/src/listings/application/services/stale-offer-pause.service.interface.ts`,
     `libs/core/src/listings/listings.tokens.ts`, `libs/core/src/listings/index.ts`
   - **Action**:
     ```ts
     export interface StaleOfferPauseResult {
       variantsConsidered: number;
       variantsStillStale: number;
       offersPaused: number;   // enqueued quantity-0 jobs
       offersSkipped: number;  // deduped by idempotency key
     }
     export interface IStaleOfferPauseService {
       pauseOffersForVariants(input: {
         variantIds: readonly string[];
         correlationId: string;
       }): Promise<StaleOfferPauseResult>;
       sweepConnection(
         connectionId: string,
         options: { limit: number }
       ): Promise<StaleOfferPauseResult>;
     }
     ```
     Add `STALE_OFFER_PAUSE_SERVICE_TOKEN = Symbol('IStaleOfferPauseService')` to
     `listings.tokens.ts` (token-only file; the sub-barrel already `export *`s it).
   - **Acceptance**: `pnpm lint` (`check:invariants`) passes the service-interface and
     token-convention guards.

7. **`StaleOfferPauseService`**
   - **File**: `libs/core/src/listings/application/services/stale-offer-pause.service.ts`
   - **Action**: Implements `IStaleOfferPauseService`. Injects `IProductsService`,
     `IIdentifierMappingService`, `OfferMappingRepositoryPort`, `SyncJobQueuePort`.
     `pauseOffersForVariants`:
     1. **Re-read staleness** — `productsService.getVariant(id)` per variant (or a batched
        `findStaleVariantsByIds`); drop any variant whose `isStale` is no longer `true`. This is
        the load-bearing safety check: an event that races a reappearance must never zero a live
        offer. Log the drop at `debug`.
     2. For each still-stale variant, `identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Offer, variantId)`.
     3. For each mapping, enqueue `marketplace.offerQuantity.update` with
        `connectionId: mapping.connectionId`, payload
        `{ schemaVersion: 1, offerId: mapping.externalId, quantity: 0 }`, and
        `dedupeKey: 'stale-pause:{connectionId}:{externalId}:{variant.staleAt.toISOString()}'`.
        Deliberately **omit** the inner adapter `idempotencyKey` so `InventorySyncService` derives
        its usual `inv:{sha256(conn,offer,0)}` — a deletion-driven 0 and an inventory-driven 0
        collapse to the same marketplace command, which is the desired behaviour.
     4. Never `Promise.all`-fail the whole run on one enqueue error: collect per-mapping failures,
        log them at `error` with the correlation id, and return counts. The sweep re-asserts.
     - `sweepConnection` pages `OfferMappingRepositoryPort.findStaleMappedVariants(connectionId, { limit, staleSince })`
       (Step 8) and funnels its variant ids through the same private `enqueuePause` path.
     - Log hygiene: follow `OfferStockRestoreService` — never log an order id at `info`; do log
       `correlationId`, `connectionId`, and counts.
   - **Acceptance**: unit spec covers — variant no longer stale ⇒ zero enqueues; two mappings on
     two connections ⇒ two jobs with the right `connectionId`; one enqueue throwing ⇒ the other
     still enqueued and the result reports the failure.

8. **Sweep query on the offer-mapping repository**
   - **Files**: `libs/core/src/listings/domain/ports/offer-mapping-repository.port.ts`,
     `libs/core/src/listings/infrastructure/persistence/repositories/offer-mapping.repository.ts`
   - **Action**: Add
     `findStaleMappedVariants(connectionId: string, options: { limit: number; staleSince: Date }): Promise<readonly StaleMappedVariant[]>`
     returning `{ variantId, externalOfferId, staleAt }`. Implemented as a query-builder join of
     `identifier_mappings` (`entityType = 'Offer'`, `connectionId`) to `product_variants` on
     `internalId = product_variants.id`, filtered `"isStale" = true AND "staleAt" >= :staleSince`,
     ordered by `staleAt DESC`, limited. This is a cross-context read-model join by table name —
     sanctioned by [ADR-036](../architecture/adrs/036-cross-context-read-model-joins.md); note the
     ADR reference in the method's JSDoc. Parameterised throughout; quote camelCase columns.
   - **Acceptance**: covered by the Phase 6 integration spec against real Postgres (a mocked unit
     test cannot validate the join or the quoting — this is precisely the class of bug review #1
     on PR #1676 was arguing about).

9. **Worker handler for the trigger job**
   - **File**: `apps/worker/src/sync/handlers/marketplace-offer-pause-stale.handler.ts`
   - **Action**: Thin delegate modelled on `marketplace-offer-stock-restore.handler.ts`. Validate
     the payload (`variantIds` non-empty array of strings, `correlationId` string) → throw
     `SyncJobExecutionError` on a malformed payload. Call
     `staleOfferPause.pauseOffersForVariants(...)`. Log the result counts. Return
     `{ outcome: 'ok' }` — the pause enqueuing successfully *is* the business success; the
     individual quantity-update jobs carry their own outcomes.
   - **Register**: provider in `apps/worker/src/sync/sync-worker.module.ts`; binding in
     `apps/worker/src/sync/handlers/handler-registration.service.ts`.
   - **Acceptance**: handler spec covers the happy path, the malformed-payload throw, and the
     service-throws-⇒-`SyncJobExecutionError` wrap.

10. **The stream consumer**
    - **File**: `apps/worker/src/events/master-deletion-to-job.handler.ts` (+ a
      `apps/worker/src/events/events-consumer.module.ts` if the worker has no home for it)
    - **Action**: Structurally copy `WebhookToJobHandler`:
      - `STREAM_NAME = MASTER_DELETION_EVENT_STREAM`,
        `DLQ_STREAM_NAME = 'events.master.deletion.dead'`,
        `CONSUMER_GROUP = 'master-deletion-offer-pause'`,
        `CONSUMER_NAME = \`master-deletion-offer-pause-${process.pid}\``, `BLOCK_MS = 5000`,
        `COUNT = 10`.
      - `onModuleInit` → `xGroupCreate(stream, group, '$', { MKSTREAM: true })` swallowing
        `BUSYGROUP` → start the loop. `onModuleDestroy` → abort + drain.
      - Per message: parse the envelope, `JSON.parse` the payload, tolerate a v1 payload
        (`correlationId ?? envelope.eventId`, `externalId ?? null`), then enqueue
        `marketplace.offer.pauseStale` with `connectionId: SYSTEM_CONNECTION_ID` (the deletion is
        detected on the *master* connection but the offers live on other connections — the same
        reason `inventory.propagateToMarketplaces` uses the sentinel) and
        `dedupeKey: 'stale-pause:{internalProductId}:{eventId}'`. **ACK only after a successful
        enqueue.**
      - Malformed/unparseable payload ⇒ DLQ + ACK. Transient error ⇒ no ACK (redelivery).
      - Gate the loop behind `OL_MASTER_DELETION_CONSUMER_ENABLED` (default on), mirroring the
        `WORKER_INTAKE_ENABLED` kill-switch on `JobIntakeConsumer`.
    - **Redis client**: reuse the worker's shared `'REDIS_CLIENT'` token only if it is not the
      same connection `JobIntakeConsumer` blocks on — a blocking `XREADGROUP` monopolises a
      client. Follow the `REDIS_CLIENT_BLOCKING_TOKEN` `useFactory` precedent in
      `apps/api/src/webhooks/webhooks.module.ts` and provide a **dedicated** client.
    - **Acceptance**: unit spec with a fake Redis client covers group-create `BUSYGROUP` tolerance,
      enqueue-then-ACK ordering, DLQ-on-malformed, and no-ACK-on-transient.

### Phase 2 — Guarantee: reconcile sweep + race closure

11. **Sweep handler**
    - **File**: `apps/worker/src/sync/handlers/marketplace-offer-pause-stale-sweep.handler.ts`
    - **Action**: Thin delegate → `staleOfferPause.sweepConnection(job.connectionId, { limit })`.
      Register in both places as in Step 9.
    - **Acceptance**: handler spec mirrors Step 9's.

12. **Scheduler descriptor**
    - **File**: `apps/api/src/sync/application/services/scheduler.service.ts`
    - **Action**: One entry appended to `CORE_CAPABILITY_TASKS`:
      ```ts
      {
        taskId: 'stale-offer-pause-sweep',
        jobType: 'marketplace.offer.pauseStaleSweep',
        capability: 'OfferManager',
        enabledEnvVar: 'OL_STALE_OFFER_PAUSE_ENABLED',
        cronEnvVar: 'OL_STALE_OFFER_PAUSE_CRON',
        defaultCron: '17 * * * *',
        idempotencyKey: (connectionId, timestamp) =>
          `marketplace:${connectionId}:offer:pauseStaleSweep:${timestamp}`,
        extraPayload: { limit: STALE_OFFER_PAUSE_DEFAULT_LIMIT },
      }
      ```
      Default **enabled** (unlike `offline-resubmit`): the failure mode of running it is a
      redundant absolute-set to 0 on an offer whose variant is genuinely deleted; the failure mode
      of *not* running it is oversell. Offset minute `17` so it doesn't pile onto the `*/15` and
      `*/20` master syncs.
    - **Acceptance**: `scheduler.service.spec.ts` asserts the task registers and respects its env
      gate.

13. **Close the re-raise race**
    - **File**: `apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts`
    - **Action**: In the **offer** fan-out branch only, skip when the target variant is stale.
      Resolve the variant once (`productsService.getVariant(payload.variantId)`) and, if
      `isStale`, log at `warn` with the variant id and `return { outcome: 'ok' }` without
      enqueuing. Leave the `ShopProduct` branch untouched (out of scope, §2).
      This closes the window where a concurrent inventory propagate re-raises a just-paused
      offer's quantity. Note in a comment that the sweep is the backstop if the race still lands
      (e.g. an in-flight job enqueued before the stale-mark).
    - **Acceptance**: handler spec gains "should not enqueue an offer-quantity update when the
      variant is stale".

### Phase 3 — Review #7: bulk fan-out filters stale siblings

14. **Filter stale variants out of bulk expansion**
    - **File**: `libs/core/src/listings/application/services/bulk-listing-submit.service.ts`
    - **Action**: In `expandVariantJobs`, treat `isStale` like the existing barcode-less-sibling
      gate: skip the sibling with a `warn` naming the variant, the product, and the reason. Apply
      it to the directly-selected variant too — a stale explicit selection must not silently
      become a live offer. Because the `siblings.length <= 1` and unknown-variant passthrough
      branches also enqueue, add the check at the single point where a job is pushed (extract a
      small `shouldSkipStale(variant)` predicate) so no branch is missed.
      `getVariantsByProductId` already hydrates `isStale`, so this needs no extra query.
    - **Acceptance**: unit spec — a two-variant product with one stale sibling expands to one job;
      a single stale selected variant expands to zero jobs and logs a warning.
    - **Note**: surfacing the skipped count in the wizard UI (alongside the existing
      already-listed/excluded affordances) is a deliberate follow-up, not part of this issue.

### Phase 4 — Backend plumbing for the operator surfaces

15. **Migration — `sync_jobs.outcomeReason`**
    - **File**: `apps/api/src/migrations/1830000000000-add-sync-job-outcome-reason.ts`
    - **Action**: `ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "outcomeReason" VARCHAR(64)`
      (nullable). Reversible `down()`. Re-prefix check: current tail on `main` is
      `1829000000000`, so `1830000000000` satisfies the strictly-greater ordering rule; class
      suffix must repeat the prefix (`docs/migrations.md`).
    - **Acceptance**: `pnpm lint` migration-timestamp invariant green;
      `pnpm --filter @openlinker/api migration:show` lists it.

16. **Carry an outcome reason through the job pipeline**
    - **Files**: `libs/core/src/sync/domain/types/sync-job.types.ts`,
      `libs/core/src/sync/domain/ports/sync-job-repository.port.ts`,
      `libs/core/src/sync/infrastructure/persistence/entities/sync-job.orm-entity.ts`,
      `libs/core/src/sync/infrastructure/persistence/repositories/sync-job.repository.ts`,
      `apps/worker/src/sync/sync-job.runner.ts`
    - **Action**: Add `JobOutcomeReasonValues = ['master_deleted'] as const` + the derived type
      (extensible — other `business_failure` producers can add codes later). Add
      `outcomeReason?: JobOutcomeReason` to `SyncJobHandlerResult` and `outcomeReason` to
      `SyncJob`. Widen `markSucceeded(id, outcome, outcomeReason?)` and persist it; keep the
      existing `lastError: null` reset (the reason column is the succeeded-path channel). The
      runner passes `result.outcomeReason` through.
    - **Acceptance**: repository unit spec asserts the column is written; runner spec asserts
      pass-through.

17. **Master-product-sync handler stamps the reason**
    - **File**: `apps/worker/src/sync/handlers/master-product-sync.handler.ts`
    - **Action**: On the `result.masterDeleted` branch return
      `{ outcome: 'business_failure', outcomeReason: 'master_deleted' }`.
    - **Acceptance**: handler spec updated.

18. **Migration — `order_records.mappingFailureReason`**
    - **File**: `apps/api/src/migrations/1830000000001-add-order-record-mapping-failure-reason.ts`
    - **Action**: `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "mappingFailureReason" TEXT`
      (nullable). **No DDL is needed for the new `recordStatus` value** — the column is a plain
      `VARCHAR` with an index and no check constraint.
    - **Acceptance**: as Step 15.

19. **Discriminate the resolution failure**
    - **Files**: `libs/core/src/orders/application/services/order-item-ref-resolver.types.ts`,
      `.../order-item-ref-resolver.service.ts`,
      `.../interfaces/order-item-ref-resolver.service.interface.ts`
    - **Action**: Add `kind: 'missing_mapping' | 'source_deleted'` to the unresolved branch of
      `ItemResolutionResult`. `tryResolve` sets it from which error it caught — the distinction
      already exists at the throw site (`StaleOrderItemError` vs `MissingOrderItemMappingError`)
      and is currently discarded at this exact seam.
    - **Acceptance**: resolver spec asserts the kind for both error types across the `offer`,
      `variant`, and `sku` branches.

20. **Persist the honest record state**
    - **Files**: `libs/core/src/orders/domain/types/*` (`OrderRecordStatusValues`),
      `libs/core/src/orders/domain/entities/order-record.entity.ts`,
      `.../infrastructure/persistence/entities/order-record.orm-entity.ts`,
      `.../repositories/order-record.repository.ts`,
      `.../application/services/order-record.service.ts` (+ interface),
      `.../application/services/order-ingestion.service.ts`
    - **Action**:
      - Add `'source_deleted'` to `OrderRecordStatusValues`; add `mappingFailureReason: string | null`
        to the domain entity, ORM entity, and both mapping directions.
      - New `IOrderRecordService.markItemResolutionFailure(internalOrderId, { status, reason })`.
      - In `OrderIngestionService` Step 4, before throwing: if any unresolved ref has
        `kind === 'source_deleted'`, call it with `status: 'source_deleted'` and the first stale
        reason; otherwise persist the reason with `status: 'awaiting_mapping'` (a free improvement —
        today the rich reason dies in the worker log). The throw behaviour is unchanged (review
        #11 is out of scope).
      - Extend the health projection in `order-record.repository.ts`: a `source_deleted` branch in
        the precedence CTE (above `awaiting_mapping`), in `countByHealth`, and in
        `applyHealthFilter`.
    - **Acceptance**: ingestion spec asserts the record reads `source_deleted` after a stale item;
      repository spec asserts the new health bucket counts and filters.

21. **Expose it over HTTP**
    - **Files**: `apps/api/src/orders/http/dto/order-record-response.dto.ts`,
      `.../dto/list-orders-query.dto.ts`, `.../dto/order-health-summary-response.dto.ts`,
      `apps/api/src/sync/http/dto/sync-job-response.dto.ts`,
      `apps/api/src/sync/http/dto/list-sync-jobs-query.dto.ts`
    - **Action**: `mappingFailureReason` on the order DTO; `source_deleted` in the `recordStatus`
      and `health` enums + filter; `sourceDeleted` count on the health summary; `outcomeReason` on
      the sync-job DTO (and optionally as a filter).
    - **Acceptance**: Swagger renders the new enum values; a controller spec covers the new filter.

### Phase 5 — Frontend

22. **Order "Source deleted" state**
    - **Files**: `apps/web/src/features/orders/api/orders.types.ts`,
      `apps/web/src/features/orders/lib/order-health.ts`,
      `apps/web/src/pages/orders/orders-list-page.tsx`,
      `apps/web/src/features/orders/components/order-activity-timeline.tsx`,
      `apps/web/src/features/orders/lib/dispatch-input.ts`
    - **Action**:
      - Types: extend `OrderRecordStatusValues` and `OrderHealthValues` with `source_deleted`; add
        `sourceDeleted` to `OrderHealthSummary`; add `mappingFailureReason?: string | null` to
        `OrderRecord`; extend `OrderFilters`.
      - `ORDER_HEALTH_META`: `source_deleted: { label: 'Source deleted', tone: 'error' }`. Add a
        `deriveOrderHealth` branch **above** `awaiting_mapping` and populate
        `reason` from `mappingFailureReason` (the field already exists on `OrderHealthView` and is
        already rendered as the badge subtitle — no cell change needed).
      - `HEALTH_SEGMENTS`: a distinct segment keyed `source_deleted` / `sourceDeleted`.
      - Timeline: a third branch narrating the deletion honestly, e.g.
        *"Item deleted at the source — this order references a product that was removed at the
        master. It cannot be fulfilled until the product reappears or the line is cancelled."*
      - `dispatch-input.ts`: a `source_deleted` blocker label so bulk dispatch doesn't say
        "Awaiting mapping".
      - The list page already suppresses Retry for `awaiting_mapping`; extend that guard to
        `source_deleted` (retrying a deleted product is pointless).
    - **Acceptance**: `order-health.test.ts` covers the new derivation precedence; a list-page test
      renders the new badge and segment.
    - **Note (deliberate deviation from the UX proposal)**: the proposal's "Cancel this order line"
      / "Fulfil the other 1 item" actions need partial-order fulfilment (review #11 / #1032) and are
      **not** in scope. Ship the honest label and reason; do not ship buttons that don't work.

23. **Jobs-list outcome label**
    - **Files**: `apps/web/src/features/sync-jobs/api/sync-jobs.types.ts`,
      `apps/web/src/features/sync-jobs/components/SyncJobStatusBadge.tsx`,
      `apps/web/src/pages/sync-jobs/sync-job-detail-page.tsx`
    - **Action**: Add `outcomeReason?: string | null` to `SyncJob`. In `SyncJobStatusBadge`, when
      `status === 'succeeded' && outcome === 'business_failure'`, resolve the label from a small
      `OUTCOME_REASON_LABEL` map (`master_deleted → 'source deleted'`) and fall back to
      `'business failure'` for an unknown/absent code — today the label is always the literal
      `succeeded`, which is what makes a deletion indistinguishable from an offer-creation
      rejection. Show the code on the detail page's KeyValue rows.
    - **Acceptance**: component test covers all three cases (ok / business_failure with a known
      reason / business_failure with no reason).

### Phase 6 — Tests, docs, invariants

24. **Integration spec (real Postgres + Redis)**
    - **File**: `apps/api/test/integration/stale-offer-pause.int-spec.ts`
    - **Action**: Seed a product + two variants + `Offer` identifier mappings on a synthetic
      marketplace connection; mark one variant stale; assert
      `findStaleMappedVariants` returns exactly that variant with a correct `staleAt` (this is the
      only place the cross-context join and its camelCase quoting are actually exercised); run
      `sweepConnection` and assert one `marketplace.offerQuantity.update` job with `quantity: 0` on
      the right connection; un-stale the variant and assert the next sweep enqueues nothing.
    - **Also**: add both new mapper entries to `apps/worker/test/jest-integration.cjs` **only if**
      a new `@openlinker/*` package enters the worker's `plugins.ts` (it does not here — noted so
      the `check-jest-integration-mappers` guard isn't a surprise).

25. **Docs**
    - `docs/architecture-overview.md`: document `events.master.deletion` alongside
      `events.inbound.webhooks` (§ Data Flow / Event-Driven Flow); add a short subsection under
      **Listings** describing the stale-offer pause (trigger + sweep, quantity-0-not-deactivation,
      the Erli frozen-stock gap, and the trigger-vs-sweep rationale from this plan's §7 Alternatives
      Considered); add the two new job types to any job-type listing. This is a routine feature
      addition without cross-cutting architectural impact (single context, no new plugin contract,
      no cross-package migration) — it doesn't meet the ADR bar in `docs/engineering-standards.md`
      § Architecture Decision Records, so the rationale lives in this plan and the overview doc,
      not a separate numbered ADR.
    - Add the delete-then-recreate remediation note (review 🟢): a recreated product usually gets a
      new external→internal id, so the old rows stay stale forever; the offer stays paused, and the
      remediation is to re-map or delete the orphaned mapping.
    - `docs/lessons.md`: only if implementation surfaces a repeatable gotcha.

26. **Quality gate**
    - `pnpm lint` (incl. `check:invariants` — migration timestamps, service interfaces, token
      convention, cross-context imports, design tokens, jest mappers), `pnpm type-check`,
      `pnpm test`, `pnpm test:integration`, and
      `pnpm --filter @openlinker/api migration:show`.
    - Rebuild `libs` dist before type-check if `main` was merged in (`docs/lessons.md`).

---

## 7. Alternatives Considered

1. **Stream consumer only, no sweep.** Simplest reading of the issue text. Rejected: the event is
   documented at-most-once (published post-commit, never re-emitted because the rows are already
   stale), so a lost publish leaves an offer selling a deleted product forever — the exact failure
   this issue exists to prevent. A buyer-protection control cannot be best-effort.
2. **Sweep only, no consumer.** Fully safe and cheaper. Rejected: leaves up to one cron interval of
   oversell exposure and leaves the #1599 stream with no consumer, which was the seam's whole point.
3. **Enqueue the pause directly from the prune path** (the ADR-028 `marketplace.offer.stockRestore`
   idiom, no stream). Rejected as the sole mechanism — a post-commit enqueue is as losable as a
   post-commit publish — and it re-couples `products`/`inventory` to `listings`.
4. **Transactional outbox for the deletion event.** The principled fix for at-most-once. Rejected as
   scope: it changes the publisher contract for every core event; the sweep gives the same end-state
   guarantee for this consumer at a fraction of the cost.
5. **New `OfferDeactivator` sub-capability** instead of quantity 0. Rejected for this issue: no
   adapter has any publication write today, quantity 0 already stops the sale on both shipped
   marketplaces, and gating buyer safety behind an optional capability would leave whichever
   marketplace implements it last unprotected. Tracked as a follow-up.
6. **Reuse `OfferStockRestorer`.** Rejected: wrong semantics ("restore after cancellation"),
   Erli-only implementation, and it is an optional capability — Allegro would be unprotected.

---

## 8. Validation & Risks

### Architecture compliance

- ✅ Hexagonal: policy in a core application service; worker handlers are thin delegates; the
  repository join lives in the listings infrastructure layer behind a port method.
- ✅ CORE/Integration boundary: **zero** integration-package changes. The pause rides the base
  `OfferManagerPort` method every adapter implements. No `platformType` string enters core.
- ✅ Cross-context contract: `listings → products` and `listings → identifier-mapping` are existing
  edges; only `I*Service` interfaces, Symbol tokens, and domain entities cross.
- ✅ ADR-036 governs the `identifier_mappings ⋈ product_variants` read-model join.
- ✅ ADR-007: the pause job returns `ok`; the *reason* channel added in Phase 4 sits on the
  succeeded path alongside `outcome`, matching the existing status-vs-outcome split.
- ✅ Naming: `*.service.ts` + `*.service.interface.ts`, `*.types.ts`, `<ctx>.tokens.ts`,
  `{CONTEXT}_{INTERFACE}_TOKEN`, `*.handler.ts`, kebab-case FE components.
- ⚠️ **Deviation to note in review**: `EventPublisherPort` is left unchanged and the `MAXLEN`
  policy lives as a private map inside the Redis adapter. Justified — retention is an
  infrastructure concern and putting it on the port would force every future publisher
  implementation to model it.

### Risks

| Risk | Mitigation |
|---|---|
| **Event races a reappearance and zeroes a live offer.** | The service re-reads `isStale` per variant immediately before enqueuing and drops non-stale ones. The event carries ids, never authority. |
| **A concurrent `inventory.propagateToMarketplaces` re-raises a paused quantity.** | Phase 2 Step 13 adds a stale guard to that handler's offer branch; the hourly sweep re-asserts if an in-flight job still lands. |
| **Erli seller-frozen stock silently skips the write** — pause is a no-op, oversell window stays open. | Cannot be fixed here (it is deliberate adapter behaviour: a seller who froze stock owns it). Document as a residual gap in the architecture overview; consider an operator warning as a follow-up. |
| **Allegro's quantity change is asynchronous** (command + poll), so the pause is eventually applied. | Acceptable — seconds-to-minutes, versus unbounded today. The sweep re-asserts if the command fails. |
| **Sweep cost on a large catalogue.** | Bounded by `limit` (default 200) per connection per tick plus a `staleAt >= now - 30d` window; the query is index-assisted on `product_variants."isStale"` — **add a partial index if the int-spec shows a seq scan** (`CREATE INDEX … ON product_variants ("staleAt") WHERE "isStale" = true`). |
| **Second blocking `XREADGROUP` in the worker process** could starve `JobIntakeConsumer` if it shares a Redis client. | Provide a dedicated client via a `useFactory` token, following the `REDIS_CLIENT_BLOCKING_TOKEN` precedent. |
| **New job types drift from the FE mirror list.** | Both edits are called out in Step 5; the FE filter dropdown is the visible symptom. |
| **`source_deleted` order status is a new value in a plain `VARCHAR` column.** | No constraint to widen, but every reader must handle it: the FE union types, the repository health CTE, the DTO enums, and `failed-orders-page.tsx`'s hard-coded `awaiting_mapping` filter. Enumerated in Steps 20–22. |
| **Migration ordering.** | Tail on `main` is `1829000000000`; use `1830000000000` / `…001` and re-prefix if `main` advances before merge (`docs/migrations.md`, `docs/lessons.md`). |

### Edge cases

- **Variant stale but no offer mapping** → zero enqueues, counted as `variantsConsidered` only.
- **Same variant mapped to offers on several marketplaces** → one quantity-0 job per connection.
- **Multiple stale events for one product** (both prune paths fire on a full deletion — the
  documented double emission) → the consumer's `{internalProductId}:{eventId}` dedupe key differs
  per event, but the downstream `stale-pause:{conn}:{offer}:{staleAt}` key collapses them.
- **Event arrives for a variant that was already paused** → dedupe key identical (same `staleAt`) ⇒
  no new job.
- **Un-stale → re-stale** → new `staleAt` ⇒ new dedupe key ⇒ the pause fires again. Correct.
- **Product-level (`NULL`-variant) inventory rows only** → today emits nothing; Phase 0 Step 3 fixes
  the emission, and the pause finds no variant-keyed offers, which is correct.
- **`variantIds: []`** in a malformed event → handler rejects the payload → DLQ.

### Backward compatibility

- ✅ No consumer of the event exists, so the payload change and schema bump to `'2'` break nothing;
  the consumer still tolerates a v1 message already on the stream.
- ✅ Both columns are nullable; existing rows read `null`.
- ✅ `markSucceeded`'s third parameter is optional — existing call sites compile unchanged.
- ✅ `'source_deleted'` is additive; every existing order keeps its current status.
- ⚠️ A pre-existing paused-but-not-stale offer does not exist (nothing pauses offers today), so
  there is no backfill concern. Offers currently live for already-stale variants **are** picked up
  by the first sweep — that is intended, and worth calling out in the PR body as a one-time
  catch-up that may enqueue a burst of quantity-0 jobs on the first run after deploy.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests (`*.spec.ts`, `pnpm test`)

| File | Covers |
|---|---|
| `libs/core/src/listings/application/services/__tests__/stale-offer-pause.service.spec.ts` | re-read drops a no-longer-stale variant; multi-connection fan-out; per-mapping enqueue failure isolation; dedupe-key composition; sweep delegates to the same path |
| `libs/core/src/products/application/services/__tests__/master-product-sync.service.spec.ts` | event-type derivation per branch; `correlationId` + `externalId` in the payload; `warn` on any prune |
| `libs/core/src/inventory/application/services/__tests__/master-inventory-sync.service.spec.ts` | emission on `markedCount > 0` with only product-level rows; derived type |
| `libs/core/src/events/.../__tests__/redis-streams-event-publisher.spec.ts` | `TRIM` passed for a mapped stream, omitted otherwise |
| `libs/core/src/listings/.../__tests__/bulk-listing-submit.service.spec.ts` | stale sibling skipped; stale selected variant skipped |
| `libs/core/src/orders/.../__tests__/order-item-ref-resolver.service.spec.ts` | `kind` discriminator for both errors × three ref types |
| `libs/core/src/orders/.../__tests__/order-ingestion.service.spec.ts` | record marked `source_deleted` with a reason; still throws |
| `apps/worker/src/events/__tests__/master-deletion-to-job.handler.spec.ts` | BUSYGROUP tolerance; enqueue-then-ACK ordering; DLQ on malformed; no-ACK on transient; v1-payload tolerance |
| `apps/worker/src/sync/handlers/__tests__/marketplace-offer-pause-stale{,-sweep}.handler.spec.ts` | happy path; payload validation; `SyncJobExecutionError` wrap |
| `apps/worker/src/sync/handlers/__tests__/inventory-propagate-to-marketplaces.handler.spec.ts` | no offer enqueue when the variant is stale |
| `apps/worker/src/sync/__tests__/sync-job.runner.spec.ts` | `outcomeReason` pass-through to `markSucceeded` |
| `apps/web/src/features/orders/lib/order-health.test.ts` | `source_deleted` derivation precedence + reason |
| `apps/web/src/features/sync-jobs/components/SyncJobStatusBadge.test.tsx` | three label cases |

**Mocking strategy**: mock ports and `I*Service` interfaces, never concrete adapters. Use the
published in-memory fakes where they exist (`@openlinker/core/identifier-mapping/testing`,
`@openlinker/core/events/testing`) rather than hand-rolling.

### Integration tests (`*.int-spec.ts`, `pnpm test:integration`, Docker)

- `apps/api/test/integration/stale-offer-pause.int-spec.ts` — see Phase 6 Step 24. **The join query
  must be covered here, not only by mocked unit tests**: PR #1676's blocker #1 was a multi-comment
  argument about `RETURNING` quoting that only real Postgres could settle.
- Extend `apps/api/test/integration/product-variant-stale-prune.int-spec.ts` to assert the new
  payload fields land on the stream.

### Acceptance criteria

- [ ] Deleting a product at a PrestaShop/WooCommerce master causes every mapped Allegro/Erli offer
      for its variants to receive a `quantity: 0` update within one master-sync cycle, without any
      operator action.
- [ ] The same end state is reached within one sweep interval when the `master.deletion` event is
      dropped entirely (verifiable by disabling `OL_MASTER_DELETION_CONSUMER_ENABLED`).
- [ ] A variant that reappears at the master is un-staled, is no longer selected by the sweep, and
      has its real quantity restored by ordinary inventory propagation.
- [ ] Re-running the sweep enqueues no duplicate work for an unchanged stale set.
- [ ] An event that arrives after the variant reappeared pauses nothing.
- [ ] The bulk offer wizard never creates an offer for a stale variant.
- [ ] An order referencing a deleted item reads **Source deleted** (not "Awaiting mapping") in the
      orders list, its own health segment, and the detail timeline, with the resolver's reason shown.
- [ ] A master-deletion job reads **source deleted** in the jobs list, distinct from an
      offer-creation business failure.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm test:integration` all green;
      `migration:show` lists both new migrations with no gap.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (policy in core services, thin worker delegates, port-backed
      persistence)
- [x] Respects CORE vs Integration boundaries — zero integration-package changes
- [x] Uses existing patterns; introduces one new service and one new consumer, both modelled on
      named in-repo precedents
- [x] Idempotency considered — absolute-set semantics, `staleAt`-keyed dedupe, re-runnable sweep
- [x] Event-driven patterns used where applicable (stream consumer + consumer group + DLQ + MAXLEN)
- [x] Rate limits & retries addressed — reuses the existing quantity-update job's retry/backoff and
      per-offer isolation; sweep is page-bounded and cron-offset
- [x] Error handling comprehensive — DLQ for permanent faults, no-ACK for transient, per-mapping
      failure isolation, `SyncJobExecutionError` wrapping in handlers
- [x] Testing strategy complete (unit + integration, with the join explicitly int-tested)
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Non-trivial decision documented in this plan's §7 Alternatives Considered (not ADR-worthy — single context, no plugin-contract or cross-package change)
- [x] Plan is execution-ready and self-contained

---

## Follow-ups this plan deliberately does not do

| Follow-up | Why deferred |
|---|---|
| `OfferDeactivator` sub-capability (Allegro `ENDED` / Erli archive) | New adapter surface on every marketplace; quantity 0 already stops the sale |
| Transactional outbox for core domain events | Changes the publisher contract globally; the sweep closes this consumer's gap |
| Erli frozen-stock operator warning when a pause is skipped | Needs a new operator-notification surface |
| Expose `isStale` / `staleAt` on product & listing read DTOs (the UX proposal's struck-through variant rows and "1 deleted at source" header) | Presentation, not safety |
| Partial-order fulfilment + terminal needs-review outcome for a stale line (review #11) | Order-lifecycle work, #1032 territory |
| Surface the bulk-wizard stale-skip count in the UI | Wizard UX, not oversell safety |
| Dashboard banner for recent deletions | New surface |
| #1688 — inventory-sync full-deletion handling | Separate tracked issue |

---

## Related Documentation

- [ADR-028 — Order-cancellation-observe hook → marketplace stock-restore](../architecture/adrs/028-order-cancellation-stock-restore.md)
- [ADR-007 — SyncJob status vs outcome split](../architecture/adrs/007-syncjob-status-vs-outcome-split.md)
- [ADR-036 — Cross-context read-model joins](../architecture/adrs/036-cross-context-read-model-joins.md)
- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Database Migrations](../migrations.md)
- [#1599 implementation plan](./implementation-plan-master-deletion-propagation.md)
