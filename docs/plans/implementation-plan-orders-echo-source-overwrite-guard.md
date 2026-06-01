# Implementation Plan — Echo guard: stop the PrestaShop poll from overwriting Allegro order provenance (#940)

## 1. Understand the task

**Goal.** When the PrestaShop reconciliation poll (`prestashop-orders-poll`, #904) re-reads an order that OpenLinker itself created in PrestaShop as a *sync destination* (originating on Allegro), it must **not** re-ingest it as a PrestaShop-sourced order. Today re-ingestion resolves to the same internal order (via the destination identifier mapping) and then **overwrites** its `sourceConnectionId`, `sourceEventId`, and snapshot, and **resets** `syncStatus` / `syncAttempts` to empty — destroying the order's Allegro provenance and sync history.

**Layer.** CORE — application-layer orchestration policy (`OrderIngestionService`). No new ports, no schema change.

**Non-goals (deferred).**
- Feed-level filtering of OL-created PS orders / origin marker on destination create (issue option 2) — platform-specific; not needed for correctness.
- Making `persistOrder` defensively source-preserving (issue option 3) — superseded by short-circuiting before persist; can be a later backstop.
- Data repair of already-corrupted rows — tracked as a separate follow-up in #940.

## 2. Research (findings)

- `OrderIngestionService.syncOrderFromSource(connectionId, externalOrderId, sourceEventId?)` is the single choke point for both webhook and poll ingestion (`libs/core/src/orders/application/services/order-ingestion.service.ts:178`). It:
  1. `getOrder()` hydrates the incoming order,
  2. `getOrCreateInternalId(Order, incoming.externalOrderId, connectionId)` — for an echo this **resolves the existing** destination mapping (no new mapping),
  3. `persistIncomingSnapshot(...)` then `persistOrder(...)` **upsert** the record, overwriting source + resetting `syncStatus`/`syncAttempts` (`order-record.service.ts:99-113,155-169`).
- `IOrderRecordService.getOrderRecord(internalOrderId): Promise<OrderRecord | null>` already exists (`order-record.service.interface.ts:80`); `OrderRecord` carries `sourceConnectionId`. → cheap PK lookup, no new method.
- `syncOrderFromSource` returns `OrderSyncResult[]` (`syncOrder` return). An empty array `[]` is a valid no-op result.
- Existing unit spec (`__tests__/order-ingestion.service.spec.ts`) already mocks `getOrderRecord` returning `undefined` → guard is inert for all current tests (backward compatible).

## 3. Design

Add an **echo guard** in `syncOrderFromSource`, after `internalOrderId` is resolved and **before** `persistIncomingSnapshot` / customer resolution:

```ts
const existing = await this.orderRecordService.getOrderRecord(internalOrderId);
if (existing && existing.sourceConnectionId !== connectionId) {
  // Destination echo: this external id on `connectionId` maps to an order that
  // originated elsewhere and was pushed here as a sync destination. Re-ingesting
  // would clobber its true source + sync history. Skip; the real source stays
  // authoritative, and destination status flows via the status-sync jobs.
  this.logger.debug(`Skipping destination echo for ${internalOrderId} …`);
  return [];
}
```

**Correctness across scenarios:**
| Scenario | `getOrderRecord` | guard fires? | outcome |
|---|---|---|---|
| New order (any source), 1st ingest | `null` | no | normal create |
| Genuine PS-direct order re-polled | record, `source==PS==conn` | no | normal reconcile |
| Allegro order re-ingested from Allegro | record, `source==Allegro==conn` | no | normal reconcile (authoritative) |
| **Allegro order re-read by PS poll (echo)** | record, `source==Allegro≠PS` | **yes** | **skip — provenance preserved** |

Idempotent: on a skip the record keeps its original source, so subsequent echoes are detected identically.

## 4. Implementation steps

1. **`libs/core/src/orders/application/services/order-ingestion.service.ts`** — insert the guard between `getOrCreateInternalId` (~line 195) and `resolveCustomerId` (~line 197). Acceptance: echo input returns `[]`; `persistIncomingSnapshot`/`persistOrder`/`syncOrder` not called.
2. **`__tests__/order-ingestion.service.spec.ts`** — add a `describe('destination echo guard (#940)')` block:
   - skips (returns `[]`, no persist/sync) when existing record's `sourceConnectionId !== connectionId`;
   - proceeds normally when `getOrderRecord` returns `null`;
   - proceeds normally when existing record's `sourceConnectionId === connectionId` (genuine same-source reconcile).

## 5. Validation

- Architecture: orchestration policy stays in the core application service; no boundary crossed; no new dependency. ✅
- Naming/standards: no new types; reuses existing port method. ✅
- Testing: unit-level (mock ports). Quality gate `pnpm lint && pnpm type-check && pnpm test`. ✅
- Security: none. No schema change → no migration.

## Tech-review resolution (item 1 — "is the skip safe?")

Verified against the code. **The blanket skip is safe and strictly more correct:**

- `OrderRecord` has **no `status` column** (`order-record.orm-entity.ts`) — order status lives only inside the JSONB `orderSnapshot`. The authoritative source for an Allegro-origin order's content/status is **Allegro**; its own source path (`syncOrderFromSource(allegroConn, …)`) reconciles the snapshot normally because `source === connectionId` (guard doesn't fire).
- Destination-side fulfillment/shipment changes flow via dedicated jobs — `marketplace.fulfillment.statusSync` (reads PrestaShop → writes the **Shipment** table; `fulfillment-status-sync.service.ts`) and `marketplace.shipment.statusSync` (carrier → Shipment). Both key on `destinationConnectionId` and are **independent of `sourceConnectionId`**, so the guard doesn't affect them. Neither writes `OrderRecord` status today.
- The PS poll echo is the *only* writer of PrestaShop's projected view onto the record — and it writes non-authoritative data while resetting `syncStatus`/`syncAttempts` to `[]`. That reset additionally **breaks fulfillment sync**, which locates the order by its `syncStatus[].destinationConnectionId`. Skipping the echo therefore *repairs* a second latent bug.

**Decision:** keep the simple `return []`; no scoped reconcile is warranted. Captured in [ADR-017](../architecture/adrs/017-cross-origin-order-reingestion-guard.md).

## Risks / open questions

- **Wasted `getOrder()` hydration per echo.** The guard sits after `getOrder()`, so an echo still costs one source API round-trip before skipping. Bounded (an OL-created order only re-enters the feed while inside the `date_upd` watermark window), acceptable for the core fix; option-2 feed filtering would eliminate it later.
- **One extra `getOrderRecord` read per ingestion.** The guard's record lookup runs on every ingestion (webhook and poll, every order), not just echoes — an indexed PK read wasted on the common new-order / same-source path. Negligible but per-order; option-2 would remove it.
- Placing the guard after `getOrder` (not before) avoids assuming the `externalOrderId` param equals `incoming.externalOrderId`; correctness over micro-optimization.
- **Directional assumption.** The guard encodes today's topology (marketplace → shop; only shops are `OrderProcessorManager` destinations). If a shop→marketplace order push is ever added, this guard would skip legitimate updates — documented in ADR-017 so a future implementer finds it.
- **Preventive, not curative.** The field comparison won't fire for already-corrupted rows (their `source` is already the PS connection). Data repair of existing rows is a separate #940 follow-up.
