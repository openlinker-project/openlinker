# Epic / Task: Implement Option B Sync Architecture (Allegro + PrestaShop)
> Goal: move sync orchestration into core services, define canonical ports, and make worker handlers thin delegates. Normalize job types to be generic (not `allegro.*` / `prestashop.*`).

## 0) Preconditions
- Read and follow: `docs/architecture-overview.md` + `engineering_standards.md` (and keep them consistent with implementation).
- Keep **core domain purity**: core must not import concrete integration modules/classes.
- Maintain **backward compatibility** during transition (support old job names and old port alias until we fully migrate).

---

## 1) Create Canonical Marketplace Contract (core “SDK”)
### 1.1 Add files (new canonical location)
Create:
- `libs/core/src/integrations/domain/ports/marketplace.port.ts`
- `libs/core/src/integrations/domain/types/marketplace-cursor.types.ts`
- `libs/core/src/integrations/domain/types/marketplace-order-feed.types.ts`
- `libs/core/src/integrations/domain/types/marketplace-quantity-update.types.ts`

### 1.2 Define types (domain-only, no framework deps)
**Cursor & order feed**
- Input shape must match requirements:
  - `fromCursor: string | null`
  - `limit: number`
  - `eventTypes?: MarketplaceOrderEventType[]`
- Output must include:
  - `items: MarketplaceOrderFeedItem[]`
  - `nextCursor: string | null`

Include in feed item:
- `externalOrderId: string`
- `eventType: MarketplaceOrderEventType`
- `occurredAt: string` (ISO)
- `eventId?: string` (if marketplace provides stable IDs; used for dedupe/job-id)
- `raw?: unknown` (optional debug payload, never required)

**Offer quantity update**
- Single:
  - `offerId: string`
  - `quantity: number`
  - `idempotencyKey?: string`
- Batch:
  - `items: UpdateOfferQuantityCommand[]`
  - `idempotencyKey?: string` (batch-level)
- Batch result:
  - support partial failures (required long-term):
    - `succeeded: string[]` offerIds
    - `failed: { offerId: string; errorCode: string; message?: string }[]`

### 1.3 Define port interface
`MarketplacePort` must support:
- `listOrderFeed(input): Promise<{ items; nextCursor }>`
- `getOrder(input): Promise<UnifiedOrder>` (or existing unified order type in core)
- `updateOfferQuantity(cmd): Promise<void>`
- `updateOfferQuantitiesBatch?(cmd): Promise<BatchResult>` (optional but recommended)

> Important: Do NOT bake Allegro-specific naming into the port (`checkoutFormId`). Use generic `externalOrderId`.

---

## 2) Compatibility Layer: keep existing Listings port temporarily
We currently have:
- `libs/core/src/listings/domain/ports/marketplace-integration.port.ts`
- `libs/core/src/listings/domain/types/marketplace-integration.types.ts`

### 2.1 Deprecate & alias
- Convert `MarketplaceIntegrationPort` to a compatibility alias/re-export:
  - `export type MarketplaceIntegrationPort = MarketplacePort`
  - re-export the canonical types
- Keep existing import paths working until worker is migrated.

> End-state: remove Listings marketplace port entirely (after migration).

---

## 3) Introduce Core “Sync Use-Cases” (move orchestration out of worker)
### 3.1 Add a Core port for job scheduling (so core can enqueue generically)
Create:
- `libs/core/src/sync/domain/ports/sync-job-queue.port.ts`

Interface must support dedupe/idempotency:
- `enqueue(type, payload, { dedupeKey?, delayMs? })`
- `enqueueBulk([{ type, payload, dedupeKey? }])`

Worker will implement this port using the existing job queue (BullMQ or current queue).

### 3.2 OrderSyncService: core-owned marketplace ingestion + routing
We already have core `OrderSyncService.syncOrder(...)` (destination routing).
Extend or create a dedicated service in core (preferred: keep responsibilities explicit):
- `OrderIngestionService` OR add methods to `OrderSyncService`:
  1) `syncFromMarketplace(connectionId, { limit, eventTypes? })`
     - load cursor from `ConnectionCursorRepositoryPort`
     - resolve `MarketplacePort` via `IntegrationsService.getCapabilityAdapter(connectionId, 'Marketplace')`
     - call `marketplace.listOrderFeed({ fromCursor, limit, eventTypes })`
     - enqueue **generic** per-order sync jobs: `marketplace.order.sync`
       - payload: `{ connectionId, externalOrderId }`
       - dedupeKey MUST be deterministic:
         - prefer: `${connectionId}:${externalOrderId}:${eventId || occurredAt}`
     - commit cursor ONLY after enqueues succeed:
       - if enqueueBulk throws -> do not persist cursor
       - rely on dedupeKey to make retries safe
     - return stats for observability: `{ fetched, enqueued, nextCursor, committed }`
  2) `syncOrderFromMarketplace(connectionId, externalOrderId)`
     - resolve `MarketplacePort`
     - call `marketplace.getOrder({ externalOrderId })`
     - call existing core routing `syncOrder(unifiedOrder)` (or equivalent)

### 3.3 InventorySyncService: core-owned offer quantity updates
Create core service:
- `InventorySyncService.updateOfferQuantity(connectionId, cmd)`
- `InventorySyncService.updateOfferQuantities(connectionId, batchCmd)`
Responsibilities:
- resolve `MarketplacePort` via IntegrationsService
- decide whether to call batch or loop single:
  - if adapter implements `updateOfferQuantitiesBatch`, use it for N>=threshold
  - otherwise loop `updateOfferQuantity`
- ensure idempotency keys are generated consistently if missing:
  - e.g., `hash(connectionId, offerId, quantity, inventoryVersion?)` (use what’s available)
- return structured result (success/fail per offer)

> Note: keep “inventory.propagateToMarketplaces” decision-making in core long-term too (mapping internal inventory -> offers -> update commands), but start by centralizing the marketplace update execution path.

---

## 4) Worker Refactor: make handlers thin delegates + normalize job taxonomy
### 4.1 Introduce generic job types (new canonical names)
Add constants (prefer string unions, not TS enums):
- `marketplace.orders.poll`
- `marketplace.order.sync`
- `marketplace.offerQuantity.update`
- (later) `master.product.syncByExternalId`
- (later) `master.inventory.syncByExternalId`

### 4.2 Implement new thin handlers
Create new handlers in worker:
1) `MarketplaceOrdersPollHandler` handles `marketplace.orders.poll`
   - validate payload
   - call `OrderSyncService.syncFromMarketplace(...)`
2) `MarketplaceOrderSyncHandler` handles `marketplace.order.sync`
   - call `OrderSyncService.syncOrderFromMarketplace(...)`
3) `MarketplaceOfferQuantityUpdateHandler` handles `marketplace.offerQuantity.update`
   - call `InventorySyncService.updateOfferQuantity(...)`

### 4.3 Backward compatibility mapping (critical)
During migration:
- Keep old handlers registered OR register alias routes so:
  - `allegro.orders.poll` -> delegates to the new `marketplace.orders.poll` handler/service
  - `allegro.order.syncByCheckoutFormId` -> delegates to new `marketplace.order.sync` with mapped `externalOrderId`
  - `allegro.offerQuantity.update` -> delegates to new `marketplace.offerQuantity.update`

> This avoids breaking existing schedules and integration tests while we migrate producers.

---

## 5) Update Allegro Integration to match canonical port
### 5.1 Make Allegro marketplace adapter implement `MarketplacePort`
- Map Allegro concepts:
  - `checkoutFormId` becomes `externalOrderId` (generic)
  - order feed method maps to `listOrderFeed`
  - full order hydration maps to `getOrder({ externalOrderId })`
- Implement optional batch quantity update:
  - if Allegro API supports bulk update -> implement
  - else implement by looping single updates (still satisfies interface)

---

## 6) PrestaShop: move product/inventory master sync orchestration into core (Option B completeness)
PrestaShop currently uses:
- `ProductMasterPort`, `InventoryMasterPort` and worker handlers own orchestration.

### 6.1 Add core use-cases
Create:
- `ProductSyncService.syncFromMasterByExternalId(connectionId, externalId)`
- `InventoryMasterSyncService.syncFromMasterByExternalId(connectionId, externalId)`
These services should:
- resolve internal IDs via IdentifierMapping in core (not in worker)
- resolve ports via IntegrationsService
- map + upsert into canonical storage
- return structured result

### 6.2 Make worker handlers thin delegates + genericize job names
- Introduce `master.product.syncByExternalId` and `master.inventory.syncByExternalId`
- Keep old `prestashop.*` job names as aliases until producers migrate.

---

## 7) Tests (must be added in core + worker)
### 7.1 Core unit tests (mock ports)
Add tests for:
- `OrderSyncService.syncFromMarketplace`:
  - commits cursor only after successful enqueueBulk
  - does not commit if enqueue fails
  - uses `fromCursor`, `limit`, `eventTypes` correctly
  - creates deterministic dedupe keys
- `OrderSyncService.syncOrderFromMarketplace`:
  - calls `MarketplacePort.getOrder` then routes via existing `syncOrder(...)`
- `InventorySyncService.updateOfferQuantities`:
  - uses batch when available, falls back to single loop
  - returns partial failure results

### 7.2 Worker tests
- Handlers should be “dumb”: verify they call core services with correct payload mapping.
- Add one integration-ish test ensuring old job names still trigger new behavior (alias mapping).

---

## 8) Docs & Cleanup
### 8.1 Update `docs/architecture-overview.md`
- Update flow diagrams:
  - Worker triggers jobs, but core services own policies and flow
- Fix capability metadata mismatch (`OrderProcessorManager` for Allegro):
  - either implement it OR remove from docs (prefer docs reflect reality)

### 8.2 End-state cleanup (final PR)
- Remove Listings `MarketplaceIntegrationPort` + old types
- Remove old job names once no producers use them
- Ensure adapter registry examples match actual supported capabilities

---

## Definition of Done (Acceptance Criteria)
- Canonical `MarketplacePort` exists under `libs/core/src/integrations/domain/ports/marketplace.port.ts`
- Types are split into dedicated `*.types.ts` files under canonical path
- Core owns:
  - marketplace order ingestion (cursor + enqueue + commit safety)
  - marketplace order hydration + routing
  - offer quantity update logic (single + optional batch)
  - prestashop master sync orchestration (product/inventory) via core services
- Worker handlers are thin delegates (no cursor/dedupe/mapping policies inside handlers)
- Job types are generic (`marketplace.*`, `master.*`) with backward-compatible aliases
- Core tests cover cursor safety, dedupe, batching, partial failure handling
- Docs updated to reflect the new reality
