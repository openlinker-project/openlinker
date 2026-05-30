# Implementation Plan: Ingest PrestaShop order webhooks via the unified `marketplace.order.sync` job (#902)

**Date**: 2026-05-30
**Status**: Ready for Review
**Estimated Effort**: ~half day
**Issue**: #902 (Phase 1 of epic #900). Prerequisite #906 (lock-guarded idempotent create) is **merged**.

---

## 1. Task Summary

**Objective**: Stop dead-lettering PrestaShop order webhooks. Route `order.created` / `order.status_changed` onto the **existing** `marketplace.order.sync` job so they ingest via the same pull path the poller uses.

**Context**: The PrestaShop OL module already emits order webhooks (enabled by default); they reach `events.inbound.webhooks` and then `WebhookToJobHandler.mapToSyncJob`, which only allows `['product', 'inventory']` for `prestashop` and throws `Unsupported master objectType: order` → DLQ. `OrderIngestionService.syncOrderFromSource` (called by the `marketplace.order.sync` worker handler) already does the full hydrate→resolve→persist→route, and #906 made the destination create concurrency-safe — so webhook+poll convergence is now safe.

**Classification**: Interface (the `apps/api` webhook→job translation layer). No CORE/domain change, no new job type, no schema, no module edits.

---

## 2. Scope & Non-Goals

### In Scope
- Accept `order` from `prestashop` in `WebhookToJobHandler` and route it to the **existing** `marketplace.order.sync` job (NOT a new `master.order.*`).
- Build the order job payload in the shape `MarketplaceOrderSyncHandler` consumes (`externalOrderId`, `sourceEventId`, `eventType`, `occurredAt`) — not the generic `externalId` shape.
- Normalize the webhook event type into the poller's `OrderFeedEventType` vocabulary so push and poll speak one language.
- Unit tests on the new mapping branch + regression on the untouched `stock`/`product` paths.

### Out of Scope (later phases of #900)
- Removing `isMasterProvider` / `mapObjectType` and the dispatcher refactor → **#903** (Phase 2).
- PS order-poll reconciliation cron → **#904** (Phase 3).
- Any new job type, `OrderRef`/contract change, schema, or PS-module change.

### Constraints
- Reuse `marketplace.order.sync` — do **not** introduce `master.order.syncByExternalId` (keeps the taxonomy unified so #903 has nothing to undo, per the epic's key constraint).
- No regression to the existing `stock`/`product` routing.

---

## 3. Architecture Mapping

**Target layer**: Interface — `apps/api/src/webhooks/application/handlers/webhook-to-job.handler.ts` (one new branch + one private helper). Downstream worker handler + core service are unchanged.

**Reused (unchanged)**:
- `MarketplaceOrderSyncHandler` (`apps/worker`) — reads `payload.externalOrderId`, calls `OrderIngestionService.syncOrderFromSource(connectionId, externalOrderId, sourceEventId)`.
- `MarketplaceOrderSyncPayloadV1` (`@openlinker/core/sync`) — `{ schemaVersion, externalOrderId, sourceEventId?, eventKey?, occurredAt?, eventType?: OrderFeedEventType }`.
- `OrderFeedEventTypeValues = ['created','updated','cancelled','paid']` (`@openlinker/core/orders`).
- `marketplace.order.sync` is already in `JobTypeValues` — no edit.

**Grounded current state** (`webhook-to-job.handler.ts:343-389`): the master branch builds `master.{type}.syncByExternalId` with `payload.externalId`; `order` hits the `['product','inventory']` guard (line 359) and throws → DLQ (the bug). `InboundWebhookEvent` carries `eventType` (`'order.created'` post-prefix-strip), `objectType` (`'order'`), `externalId`, `eventId`, `occurredAt`, `connectionId`.

---

## 4. Questions & Assumptions

- **A1** *(confirmed — see §4a)*: `event.eventType` arrives as the **dotted** form `order.created` / `order.status_changed`; map → `created` / `updated`. Unknown/missing → default `updated` (safe: a re-pull). `OrderFeedEventType` has no `status_changed`, so `updated` is the correct existing token. The helper matches the dotted literals exactly.
- **A2**: Both order event types map to the **same** `marketplace.order.sync` job (both re-pull current state; idempotent on internal order id + #906 lock). No special handling for status changes in this phase.
- **A3**: `sourceEventId = event.eventId` (traceability; poller uses `eventKey` — both opaque source-event ids). Idempotency key stays the handler's existing `${provider}:${connectionId}:${eventId}`.
- **A4**: The order branch returns **before** the master-objectType guard, so `mapObjectType` / the guard / the generic master path stay untouched.

---

## 4a. Source Verification (completed 2026-05-30)

All four assumptions verified against `main` (with #906) before implementation — no surprises:

| Assumption | Confirmed from source |
|---|---|
| Payload shape | `MarketplaceOrderSyncPayloadV1` = `{ schemaVersion: 1; externalOrderId: string; sourceEventId?; eventKey?; occurredAt?; eventType?: OrderFeedEventType }` — `libs/core/src/sync/domain/types/marketplace-job-payloads.types.ts:19`. The `satisfies` will compile. |
| Worker reads `externalOrderId` | `marketplace-order-sync.handler.ts:69` hard-fails if `externalOrderId` is missing/non-string; passes `payload.externalOrderId` + `payload.sourceEventId` to `syncOrderFromSource` (`:40-44`). |
| `marketplace.order.sync` ∈ `JobTypeValues` | `libs/core/src/sync/domain/types/sync-job.types.ts:19`. |
| `OrderFeedEventType` tokens | `['created','updated','cancelled','paid']` — `libs/core/src/orders/domain/types/order-feed.types.ts:20`. No `status_changed`. |
| `eventType` literal + `objectType` | PS module emits `eventType: 'order.created'` (`openlinker.php:1277`) / `'order.status_changed'` (`:1372`), `objectType: 'order'` (`:1278`), `externalId: orderId` (`:1279`). `webhook.service.ts:117` sets `objectType` from `request.object.type` (not split from eventType), so the branch keys cleanly on `objectType === 'order'`. |

---

## 5. Proposed Implementation Plan

### Phase 1 — order routing branch
1. **`mapOrderFeedEventType(webhookEventType: string): OrderFeedEventType`** (private helper) — `'order.created' → 'created'`, `'order.status_changed' → 'updated'`, default `'updated'`. Import `type OrderFeedEventType` (+ `OrderFeedEventTypeValues` if a guard is wanted) from `@openlinker/core/orders` and `type MarketplaceOrderSyncPayloadV1` from `@openlinker/core/sync`.
2. **Early branch in `mapToSyncJob`** (before the `isMasterProvider` guard): when `canonicalObjectType.toLowerCase() === 'order'`, return
   ```ts
   {
     jobType: this.validateJobType('marketplace.order.sync'),
     connectionId: event.connectionId,
     payload: {
       schemaVersion: 1,
       externalOrderId: event.externalId,
       sourceEventId: event.eventId,
       eventType: this.mapOrderFeedEventType(event.eventType),
       occurredAt: event.occurredAt,
     } satisfies MarketplaceOrderSyncPayloadV1,
     idempotencyKey: `${event.provider}:${event.connectionId}:${event.eventId}`,
   }
   ```
   **Two code comments** to add: (a) the order job intentionally uses the poller's `externalOrderId` shape (vs the generic `externalId` master branch); (b) the branch is **provider-agnostic by design** — keyed on `objectType === 'order'`, not `provider`, so any future marketplace emitting an `order` webhook routes to the neutral `marketplace.order.sync` job (today only PrestaShop emits one). This is intentional, aligning with the neutral job name + ADR-015 direction — not an accidentally-broad match.

### Phase 2 — tests
3. `webhook-to-job.handler.spec.ts`:
   - order.created → `marketplace.order.sync`, `payload.externalOrderId === event.externalId`, `eventType === 'created'`, **and assert the idempotency key equals `${provider}:${connectionId}:${eventId}`** (so a future order-payload refactor can't silently drift the key).
   - order.status_changed → `eventType === 'updated'`.
   - regression: stock.changed → `master.inventory.syncByExternalId` with `payload.externalId` (untouched).
   - regression: an unsupported `prestashop` objectType (e.g. `category`) still throws (master guard intact).

### Phase 3 — quality gate
4. `pnpm lint && pnpm type-check && pnpm test`.

### Integration note
No int-spec added: the dead-letter→ingest path is covered at the mapping layer by unit tests; an end-to-end webhook→job→ingest int-spec would mostly exercise the (already-tested) downstream `marketplace.order.sync` path. (The webhook-ingestion int-spec harness exists if a vertical slice is later wanted.) **PR-body note**: state plainly that "no DLQ" / "order webhook ingests" is proven at the **unit-mapping** level this phase, not end-to-end — so reviewers don't read it as a full E2E guarantee.

---

## 6. Alternatives Considered

- **`master.order.syncByExternalId` + add `order` to the master allow-list** — rejected: a third order-job taxonomy the poller doesn't use; #903 would migrate off it. Reusing `marketplace.order.sync` keeps the quick win and the long-term target pointing the same way (epic key constraint).
- **Wait for #903's translator** — rejected: delays closing the live dead-letter bug; the branch is a clean delete during #903.

---

## 7. Validation & Risks

- **Field-name mismatch** (the main trap): the generic branch emits `externalId`; `MarketplaceOrderSyncHandler` needs `externalOrderId`. Mitigated by the dedicated order branch typed as `MarketplaceOrderSyncPayloadV1`; unit-asserted. **Verified resolved** (§4a): worker hard-fails on missing `externalOrderId` (`marketplace-order-sync.handler.ts:69`); the typed branch supplies it.
- **Vocabulary gap**: `OrderFeedEventType` has no `status_changed` → map to `updated`; documented + tested. **Verified** (§4a): eventType arrives dotted (`order.status_changed`), so the helper's literal match is correct.
- **Idempotency / double-ingest**: webhook + poll convergence is safe — #906 lock + PrestaShop adapter create-or-skip. (Webhook dedup gate + job idempotency key still apply per-trigger.)
- **Backward compatibility**: additive branch; product/inventory routing, payload shapes, job types, schema all unchanged.

---

## 8. Testing Strategy & Acceptance Criteria

- **Unit**: the four cases in §5.3 (mock `REDIS_CLIENT`, `JOB_ENQUEUE_TOKEN`, `WEBHOOK_DELIVERY_REPOSITORY_TOKEN` per the existing spec).
- **Acceptance**:
  - [ ] PrestaShop `order.created` / `order.status_changed` → enqueued `marketplace.order.sync` (no DLQ).
  - [ ] Payload uses `externalOrderId` + a valid `OrderFeedEventType`.
  - [ ] No new order job type; poller + webhook share `marketplace.order.sync`.
  - [ ] `stock`/`product` routing unchanged (regression green).
  - [ ] `pnpm lint && type-check && test` green.

---

## 9. Alignment Checklist
- [x] Interface-layer only; no CORE/domain/module change
- [x] Reuses existing job + payload type (no new taxonomy)
- [x] Idempotency considered (#906 lock + dedup)
- [x] Error handling (genuinely unmappable events still DLQ)
- [x] Tests + regression guards
- [x] Plan saved as markdown

---

## Related
- Epic #900; ADR-015 § Migration path (Phase 1). Unblocked by #906. Next: #903 (translator/policy), #904 (poll backstop).
