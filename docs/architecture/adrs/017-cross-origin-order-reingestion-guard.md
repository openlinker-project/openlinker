# ADR-017: Skip re-ingestion of orders re-read from a destination connection

- **Status**: Accepted
- **Date**: 2026-06-01
- **Authors**: @piotrswierzy

## Context

OpenLinker ingests orders through a single core choke point, `OrderIngestionService.syncOrderFromSource(connectionId, externalOrderId)`, shared by both the webhook path and the poll path (#904/#906/#909). It hydrates the order from the connection's `OrderSourcePort`, resolves an internal order id via `IdentifierMappingService.getOrCreateInternalId(Order, externalOrderId, connectionId)`, and **upserts** the `OrderRecord` (snapshot + `sourceConnectionId` + `sourceEventId`, with `syncStatus`/`syncAttempts` reset).

PrestaShop is both an `OrderSource` *and* an `OrderProcessorManager` destination. When an order that originated on Allegro is synced into PrestaShop, OpenLinker creates a PrestaShop order (id e.g. `7`) and records a destination identifier mapping `(Order, "7", PS-conn) → ol_order_X`. The `prestashop-orders-poll` reconciliation backstop (#904) then re-reads PrestaShop order `7`. Because the destination mapping already exists, `getOrCreateInternalId` resolves to the *same* `ol_order_X`, and the upsert **overwrites the order's source attribution** (Allegro → PrestaShop), `sourceEventId`, and snapshot, and resets `syncStatus`/`syncAttempts` to empty.

Confirmed in #940 against live data: the affected order carried two mappings — its Allegro identity and the PS destination identity — to one internal id, with `sourceConnectionId` flipped to PrestaShop and `syncStatus = []`. The UI then shows Channel = PrestaShop (with an Allegro buyer email), "No sync destinations configured", and only an "Order received" activity event. Every Allegro→PrestaShop order loses its provenance on the next poll cycle.

Resetting `syncStatus` to `[]` is a second, quieter failure: `marketplace.fulfillment.statusSync` locates destination orders by `syncStatus[].destinationConnectionId` (`fulfillment-status-sync.service.ts`), so a cleared `syncStatus` also drops the order out of destination-side fulfillment reconciliation.

## Decision

In `OrderIngestionService.syncOrderFromSource`, after the internal order id is resolved and **before** any persist, load the existing record and **skip re-ingestion (return no sync results) when the order already exists and originated from a *different* connection**:

```ts
const existing = await this.orderRecordService.getOrderRecord(internalOrderId);
if (existing && existing.sourceConnectionId !== connectionId) {
  // Destination echo: this external id on `connectionId` maps to an order that
  // originated elsewhere and was pushed here as a sync destination. Re-ingesting
  // would clobber its true source/event id/snapshot and reset sync history.
  return [];
}
```

The guard lives in the **core application orchestrator** — orchestration policy belongs in core application services, not handlers or adapters (architecture-overview § Sync Manager). It reuses the existing `IOrderRecordService.getOrderRecord` port method: **no new port, type, DTO, entity, or migration.**

## Why a blanket skip (not a scoped reconcile) is correct

- `OrderRecord` has no `status` column; order status lives only inside the JSONB `orderSnapshot`. For an Allegro-origin order, **Allegro is authoritative** for content and status, and its own source path (`syncOrderFromSource(allegroConn, …)`) reconciles the snapshot normally because `source === connectionId` (the guard does not fire).
- Destination-side fulfillment/shipment changes reach OpenLinker through dedicated jobs — `marketplace.fulfillment.statusSync` (reads PrestaShop → writes the `Shipment` table) and `marketplace.shipment.statusSync` (carrier → `Shipment`). Both key on `destinationConnectionId` and are independent of `sourceConnectionId`; neither writes `OrderRecord` status. The guard does not affect them — and by preserving `syncStatus` it *restores* fulfillment sync's ability to find the order.
- The PrestaShop poll echo is the only writer of PrestaShop's *projected* view onto the record. That view is non-authoritative for a marketplace-origin order, so writing it is wrong, not a feature being lost.

## Alternatives considered

- **Scoped reconcile (update fulfillment/status only, keep source):** rejected — there is no `OrderRecord` status field to update, and destination fulfillment is already owned by the status-sync jobs. A scoped reconcile would add machinery for data nothing consumes from this path.
- **Feed-level filter / origin marker on destination create** (issue option 2): stamp OL-created PrestaShop orders and exclude them from `listOrderFeed`. Cleaner long-term (also avoids the wasted `getOrder` hydration) but platform-specific and larger. Deferred; the core guard is platform-agnostic and sufficient for correctness.
- **Make `persistOrder` refuse to change `sourceConnectionId`** (issue option 3): a defensive backstop in the persistence service. The guard short-circuits before persist, so this is redundant for the echo; retained as a possible future hardening.
- **Reverse identifier-mapping lookup** (`getExternalIds` → any mapping under a different connection) as the discriminator: more robust (immune to an already-clobbered `source` field, would also flag corrupted rows) but heavier. The record-field comparison is correct for all *new* orders, which is the prevention scope here.

## Consequences

**Pros**
- Marketplace-origin orders keep their true `sourceConnectionId`, `sourceEventId`, snapshot, and `syncStatus` across PrestaShop poll cycles.
- Repairs a second latent bug: fulfillment status sync no longer loses cross-origin orders to a wiped `syncStatus`.
- Converts a previously-throwing path (`NoOrderDestinationsAvailableException`, source filtered out → zero destinations) into a clean no-op (`[]`), removing dead/retried jobs for these orders.
- No schema/contract change; confined to one core service.

**Cons / trade-offs**
- **Directional assumption.** Encodes today's topology (marketplace → shop; only shops are `OrderProcessorManager` destinations). If shop→marketplace order push is ever added, this guard would skip legitimate updates — a future implementer must revisit it (this ADR is the breadcrumb).
- **Preventive, not curative.** Already-corrupted rows (whose `sourceConnectionId` is already the PrestaShop connection) won't trip the guard; their repair is a separate #940 follow-up.
- **One wasted source hydration per echo.** The guard sits after `getOrder()`, so an echo still costs one PrestaShop API round-trip before skipping (bounded by the `date_upd` watermark window). Option 2 would remove it.
- **One extra record read per ingestion.** The `getOrderRecord` lookup runs on *every* ingestion (webhook and poll, every order), not just echoes — a wasted indexed PK read on the common new-order / same-source path. Negligible, but it's a per-order cost, not echo-only. Option 2 would remove it too.

The `marketplace.order.sync` handler returns `{ outcome: 'ok' }` on any non-throwing `syncOrderFromSource` return, so the `[]` skip is recorded as a succeeded job (verified in `marketplace-order-sync.handler.ts`) — replacing the prior `NoOrderDestinationsAvailableException` → failed/retried job for these echoes.
