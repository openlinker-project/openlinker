# Implementation Plan: ISSUE_46 — Option B Sync Architecture (Allegro + PrestaShop)

**Date**: 2026-01-17  
**Status**: Draft (Ready for Review)  
**Estimated Effort**: 6–10 dev days (phased, backward-compatible)  

---

## Design Decisions

- **Sync job enqueue abstraction**: `SyncJobQueuePort` lives in the **sync application layer** (not domain). Target location: `libs/core/src/sync/application/ports/sync-job-queue.port.ts`.
- **Marketplace order contract**: `MarketplacePort.getOrder(...)` returns an integration-facing DTO (**`IncomingOrder`**), not a core domain entity. Core application services own mapping from `IncomingOrder` → canonical write model / domain entities.

## 1. Task Summary

**Objective**: Implement “Option B” sync architecture: define a canonical marketplace plugin contract in core, move sync orchestration (cursor policy, **concurrency/locking**, dedupe, batching, scheduling) into core application services, and refactor worker handlers into thin delegates. Normalize job types to be generic (avoid `allegro.*` / `prestashop.*`) while keeping backward compatibility during migration.

**Context**:
- Current state has strong per-connection adapter resolution (`IntegrationsService`) but places significant orchestration inside worker handlers (cursor policy, idempotency keys, fan-out logic, integration-specific job names).
- `docs/architecture-overview.md` describes core-owned flows; implementation currently diverges.
- `ISSUE_46.md` captures required end-state, with explicit backward-compatibility constraints.

**Classification**: CORE + Infrastructure + App (Worker) + Integration + Testing + Documentation

---

## 2. Scope & Non-Goals

### In Scope
- Canonical core “SDK” contract for marketplace integrations:
  - `MarketplacePort` in `libs/core/src/integrations/domain/ports`
  - Split domain types in `libs/core/src/integrations/domain/types`
- Compatibility layer:
  - Keep existing Listings marketplace port import paths working temporarily via aliasing/re-exports
- Core-owned orchestration:
  - Marketplace order ingestion (cursor read/commit rules + enqueue generic order sync jobs)
  - Marketplace order hydration + routing via existing `OrderSyncService.syncOrder(...)`
  - Marketplace offer quantity updates (single + optional batch, partial failure result)
  - Master sync orchestration for PrestaShop product/inventory moved into core services
- Worker refactor:
  - Add new generic job types + thin handlers delegating into core services
  - Backward-compatible aliases from legacy job names to new flows
- Tests:
  - Core unit tests for cursor safety, dedupe/idempotency behavior, batching fallback, partial failure handling
  - Worker tests verifying delegation + legacy alias compatibility
- MarketplacePort contract tests (minimal MVP contract suite; expanded later):
  - Reusable test helper validating required invariants for adapters (cursor monotonicity, required feed fields, etc.)
- Observability parity:
  - Preserve/genericize existing marketplace offer quantity “command tracking” as a core concern via an application-level port (persist/log outcomes), not via marketplace-specific handlers.
- Docs updates:
  - Update `docs/architecture-overview.md` to match the new reality (core owns policies; workers execute)

### Out of Scope
- Replacing the underlying job persistence/runner implementation (keep existing `SyncJobRunner` + repository behavior)
- Building a full public “plugin SDK” packaging story beyond core port definitions (this plan focuses on internal monorepo plugins)
- Implementing additional marketplaces beyond Allegro
- Full removal of legacy job names and legacy Listings marketplace port in the first rollout (done only after migration completes)

### Constraints
- **Backward compatibility** during transition is mandatory (support old job names and old port alias until producers are migrated).
- **Core domain purity**: no framework dependencies in domain layer; core must not import concrete integration modules/classes.
- **Prefer existing patterns**:
  - Ports: `*.port.ts` in domain (engineering standards)
  - Types: `*.types.ts` (no enums; use `as const` unions)
- Keep tests green (`pnpm -r build`, unit/integration tests as applicable).

---

## 3. Architecture Mapping

**Target Layer**:
- CORE: `libs/core/src/`
- Integration: `libs/integrations/allegro`, `libs/integrations/prestashop`
- App: `apps/worker/src/`

**Capabilities Involved**:
- `Marketplace` (new canonical `MarketplacePort`)
- `ProductMaster`, `InventoryMaster`, `OrderSource`, `OrderProcessorManager` (existing ports)
- Cursor store: `ConnectionCursorRepositoryPort` (existing)

**Existing Services Reused**:
- `IntegrationsService` (per-connection adapter resolution + capability validation)
- `AdapterFactoryResolverService` (factory registration)
- `ConnectionCursorRepositoryPort` + TypeORM impl (cursor persistence)
- `OrderSyncService.syncOrder(...)` (destination routing)
- Existing repositories/services for canonical persistence (products/inventory/orders/listings)

**New Components Required**:
- Domain:
  - `MarketplacePort` (canonical)
  - `marketplace-*.types.ts` (cursor/feed/quantity update)
  - (Historical) Compatibility alias from `MarketplaceIntegrationPort` → `MarketplacePort` (temporary)
- Application (core):
  - Marketplace ingestion use-case/service (either extend `OrderSyncService` or introduce `OrderIngestionService`)
  - Marketplace order hydration + routing method (`syncOrderFromMarketplace`)
  - `InventorySyncService` (core-owned marketplace quantity update execution)
  - PrestaShop master sync use-cases in core (`ProductSyncService`, `InventoryMasterSyncService` or equivalent)
- Sync infra abstraction:
  - `SyncJobQueuePort` (sync application layer) for generic enqueue + bulk enqueue with dedupe keys
  - Optional `SyncLockPort` (application layer) to enforce single-flight ingestion per connectionId
- Worker:
  - New thin handlers for generic job types
  - Alias routing for legacy job types

**Core vs Integration Justification**:
- Core must own orchestration policies (cursor commit safety, **single-flight locking**, dedupe key generation, batching, retry policy) to ensure consistent behavior across plugins and enable a stable plugin ecosystem.
- Integrations remain encapsulated “plugins” implementing capability ports only; core interacts exclusively through ports.

**Reference**:
- `docs/architecture-overview.md` → “Capability Assignment (Implicit Capabilities)” and “Data Flow”
- `docs/engineering-standards.md` → naming conventions, types in `*.types.ts`, domain purity

---

## 4. External / Domain Research

### External System (if applicable)
- **Allegro**:
- Order feed is event-journal-like and cursor-based today (worker uses cursor repository and `MarketplacePort.listOrderFeed({ fromCursor, limit })`).
  - Offer quantity updates use a command pattern internally (worker persists a command status for observability).
- **PrestaShop**:
  - Acts as Product/Inventory “master” (pull) and Order “destination processor”.

### Internal Patterns
- **Per-connection adapter resolution**: `IntegrationsService.getCapabilityAdapter(connectionId, capability)` already used by worker handlers.
- **Cursor persistence**: `ConnectionCursorRepositoryPort` exists in `libs/core/src/sync/domain/ports`.
- **Handlers today**: own orchestration and are registered by jobType strings in worker.
- **Marketplace port today**: `MarketplacePort` under core integrations; supports cursor-based feed, order hydration, and offer quantity update.

### Invariants we must preserve
- **Cursor commit safety**: commit cursor only after successful enqueue of downstream work.
- **Deterministic dedupe keys**: retries must be safe and not duplicate side effects.
- **Single-flight ingestion**: at most one ingestion run per `connectionId` at a time (lock or equivalent guarantee).
- **Integration-agnostic job taxonomy**: producers/handlers should use `marketplace.*` / `master.*`, not platform-prefixed names long-term.

---

## 5. Questions & Assumptions

### Open Questions
- Should `MarketplacePort.getOrder(...)` return the existing unified order type from `@openlinker/core/orders` (likely `Order`), or introduce a new integration-facing DTO type (e.g. `IncomingOrder`) and map in core?
- What is the desired canonical “job enqueue” abstraction boundary?
  - Should core enqueue via a new `SyncJobQueuePort` implemented by worker, or by reusing `JobEnqueuePort` (currently used inside worker handlers)?
- Should order ingestion be implemented as:
  - (A) methods added to the existing `OrderSyncService`, or
  - (B) a new `OrderIngestionService` with explicit responsibility separation (recommended)?
- Concurrency policy: do we need a per-connection lock for marketplace ingestion jobs, or do we rely on existing job locking + idempotency keys for MVP?

### Decisions (locked in for this epic)
- `SyncJobQueuePort` lives in sync **application** layer: `libs/core/src/sync/application/ports/sync-job-queue.port.ts` (implemented by worker).
- `MarketplacePort.getOrder(...)` returns **`IncomingOrder`** DTO; core application maps it to canonical domain write model / entities.
- Prefer a dedicated ingestion service (`OrderIngestionService` / `MarketplaceOrderIngestionService`) rather than bloating `OrderSyncService`.
- Enforce **single-flight ingestion per connectionId** via lock key `marketplace:orders:poll:<connectionId>` (use existing locking if possible; otherwise add a small lock port).

### Assumptions
- Core application services may depend on ports with NestJS DI in application layer, but **domain ports/types remain framework-free**.
- Existing `SyncJobRunner` semantics stay as-is (retry/backoff handled at runner level).
- Backward compatibility is achieved via alias handlers (old job types delegate to new core methods).
- Adapter registry capability mismatch in docs will be resolved by updating docs to reflect reality unless a capability is actually implemented (do not claim unsupported capabilities).

### Documentation Gaps
- `docs/architecture-overview.md` describes core-owned flows, but current implementation puts them in worker handlers; doc needs update as part of this epic.

---

## 6. Proposed Implementation Plan

### Phase 1: Canonical Marketplace Contract (Core “SDK”)
**Goal**: Establish stable plugin contract under `core/integrations/domain/*` with split types.

**Steps**:
1. **Add canonical domain types**
   - **Files**:
     - `libs/core/src/integrations/domain/types/marketplace-cursor.types.ts`
     - `libs/core/src/integrations/domain/types/marketplace-order-feed.types.ts`
     - `libs/core/src/integrations/domain/types/marketplace-quantity-update.types.ts`
   - **Action**:
     - Define `MarketplaceOrderEventType` as an `as const` union (no enums).
     - Define order feed input: `{ fromCursor: string | null; limit: number; eventTypes?: MarketplaceOrderEventType[] }`
     - Define output: `{ items: MarketplaceOrderFeedItem[]; nextCursor: string | null }`
     - Define quantity update single + batch + batch result with partial failures.
   - **Acceptance**:
     - Files are domain-only and import no framework code.
     - Types follow naming conventions in `docs/engineering-standards.md`.

2. **Add canonical `MarketplacePort`**
   - **File**: `libs/core/src/integrations/domain/ports/marketplace.port.ts`
   - **Action**:
     - Add `MarketplacePort` interface:
       - `listOrderFeed(input): Promise<{ items; nextCursor }>`
       - `getOrder({ externalOrderId }): Promise<IncomingOrder>`
       - `updateOfferQuantity(cmd): Promise<void>`
       - `updateOfferQuantitiesBatch?(cmd): Promise<BatchResult>` (optional)
     - Ensure the port is generic (no `checkoutFormId` etc.).
   - **Acceptance**:
     - Port is in domain layer (`*.port.ts`), framework-free, and matches required shapes.

3. **Introduce `IncomingOrder` DTO type**
   - **File**: `libs/core/src/orders/domain/types/incoming-order.types.ts`
   - **Action**:
     - Define an integration-facing order DTO shape that `MarketplacePort` returns.
     - Keep this type stable and decoupled from persistence entities.
   - **Acceptance**:
     - Domain-only types file (`*.types.ts`), no framework deps.
     - Core application services map `IncomingOrder` → canonical domain write model.

4. **Expose canonical types/port via core public entrypoints**
   - **Files**:
     - `libs/core/src/integrations/index.ts` (or appropriate barrel exports)
     - Potentially `libs/core/src/integrations/domain/types/index.ts` if pattern exists
   - **Action**: Add exports so apps/integrations can depend on stable import paths.
   - **Acceptance**: No deep relative imports needed by consumers.

### Phase 2: Compatibility Layer for existing Listings Marketplace Port
**Goal**: Avoid breaking existing imports and worker code while moving to canonical contract.

**Steps**:
1. **Alias Listings marketplace port to canonical port**
   - **Files**:
     - `libs/core/src/listings/domain/ports/marketplace-integration.port.ts`
     - `libs/core/src/listings/domain/types/marketplace-integration.types.ts`
     - `libs/core/src/listings/index.ts` (exports)
   - **Action**:
     - (Done) Legacy `MarketplaceIntegrationPort` removed in favor of canonical `MarketplacePort`.
     - Re-export canonical types from Listings module (temporary) to preserve import stability.
   - **Acceptance**:
     - Existing worker imports from `@openlinker/core/listings` continue to compile.
     - Clear deprecation comment added (doc-only; no runtime behavior change).

### Phase 3: Core enqueue abstraction (so core can schedule sync work generically)
**Goal**: Let core orchestration enqueue sync jobs without importing worker infrastructure.

**Steps**:
1. **Create `SyncJobQueuePort`**
   - **File**: `libs/core/src/sync/application/ports/sync-job-queue.port.ts`
   - **Action**:
     - Define `enqueue(type, payload, { dedupeKey?, delayMs? })`
     - Define `enqueueBulk([{ type, payload, dedupeKey?, delayMs? }])`
   - **Acceptance**:
     - Port compiles.
     - Port lives in sync application layer (not domain).

2. **Bind port token and add minimal adapter**
   - **Files**:
     - `libs/core/src/sync/sync.tokens.ts` (new token)
     - `apps/worker/src/sync/...` (implementation using existing enqueue mechanism)
   - **Action**:
     - Implement `SyncJobQueuePort` in worker by delegating to existing job enqueue repository/service.
   - **Acceptance**:
     - Core services can enqueue without importing worker code.

### Phase 4: Core-owned marketplace order ingestion + routing
**Goal**: Move cursor policy + job fan-out into core; keep routing via existing `syncOrder`.

**Steps**:
1. **Add/extend core service for marketplace ingestion**
   - **Files**:
     - Option A: extend `libs/core/src/orders/application/services/order-sync.service.ts`
     - Option B (preferred): `libs/core/src/orders/application/services/order-ingestion.service.ts` + interface
   - **Action**:
     - Implement `syncFromMarketplace(connectionId, { limit, eventTypes? })`:
      - Acquire per-connection lock (single-flight): key `marketplace:orders:poll:<connectionId>`
       - Read cursor via `ConnectionCursorRepositoryPort`
       - Resolve `MarketplacePort` via `IntegrationsService.getCapabilityAdapter(connectionId, 'Marketplace')`
       - Call `marketplace.listOrderFeed({ fromCursor, limit, eventTypes })`
       - Enqueue generic jobs `marketplace.order.sync` using `SyncJobQueuePort.enqueueBulk`
       - Commit cursor only after successful enqueueBulk
       - Return stats `{ fetched, enqueued, nextCursor, committed }`
   - **Acceptance**:
     - Cursor safety guaranteed (no commit if enqueue fails).
     - Dedupe keys deterministic and stable (prefer eventId when present).

2. **Add core method for hydrating + routing**
   - **File**: same service as above
   - **Action**:
     - Implement `syncOrderFromMarketplace(connectionId, externalOrderId)`:
       - Resolve `MarketplacePort`
       - Call `marketplace.getOrder({ externalOrderId })`
      - Map `IncomingOrder` → canonical order model
      - Call existing `OrderSyncService.syncOrder({ order, sourceConnectionId, sourceEventId? })`
   - **Acceptance**:
     - Core owns sequencing; worker does not contain this orchestration.

### Phase 5: Core-owned marketplace offer quantity updates (InventorySyncService)
**Goal**: Centralize batching/idempotency/fallback logic in core.

**Steps**:
1. **Create `InventorySyncService` (core)**
   - **Files**:
     - `libs/core/src/inventory/application/services/inventory-sync.service.ts`
     - `libs/core/src/inventory/application/interfaces/inventory-sync.service.interface.ts`
     - `libs/core/src/inventory/inventory.tokens.ts` (token)
   - **Action**:
     - Implement:
       - `updateOfferQuantity(connectionId, cmd)`
       - `updateOfferQuantities(connectionId, batchCmd)`
     - Resolve `MarketplacePort` via IntegrationsService.
     - Prefer batch API if available and item count meets threshold; fallback to looping single updates.
     - Return structured results with partial failure support.
   - **Acceptance**:
     - Works for adapters with/without batch support.
     - Generates idempotency keys when absent (deterministic).

### Phase 6: Worker refactor (thin delegates + generic job taxonomy + backward compatibility)
**Goal**: Make workers generic executors; keep old job types working while migrating producers.

**Steps**:
1. **Add generic job type constants**
   - **Files**:
     - `libs/core/src/sync/domain/types/sync-job.types.ts` (or existing job type registry)
   - **Action**: Add `marketplace.orders.poll`, `marketplace.order.sync`, `marketplace.offerQuantity.update`, plus future `master.*` job types.
   - **Acceptance**: Types are string unions / `as const`, not enums.

2. **Create new thin handlers**
   - **Files** (worker):
     - `apps/worker/src/sync/handlers/marketplace-orders-poll.handler.ts`
     - `apps/worker/src/sync/handlers/marketplace-order-sync.handler.ts`
     - `apps/worker/src/sync/handlers/marketplace-offer-quantity-update.handler.ts`
   - **Action**:
     - Handlers validate payload, then call the appropriate core service method.
   - **Acceptance**:
     - No cursor policy, dedupe policy, or adapter-specific mapping inside handlers.

3. **Backward-compatible alias registration**
   - **File**: `apps/worker/src/sync/handlers/handler-registration.service.ts`
   - **Action**:
     - Keep old job types registered but delegate them to new generic handlers/services:
       - `marketplace.orders.poll`
       - `marketplace.order.sync`
       - `marketplace.offerQuantity.update`
       - `master.product.syncByExternalId`
       - `prestashop.inventory.syncByExternalId` → `master.inventory.syncByExternalId` (later)
   - **Acceptance**:
     - Existing schedules/tests remain functional during transition.

### Phase 7: Update Allegro integration to implement canonical MarketplacePort
**Goal**: Make Allegro adapter a first “reference plugin” for canonical contract.

**Steps**:
1. **Implement `MarketplacePort` in Allegro adapter**
   - **Files**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts` and related factory wiring
   - **Action**:
     - Map:
       - old order feed → `listOrderFeed({ fromCursor, limit, eventTypes })`
       - old `checkoutFormId` hydration → `getOrder({ externalOrderId })`
     - Keep any Allegro-specific exceptions inside integration package.
   - **Acceptance**:
     - Core imports only the port, not Allegro classes.
     - Worker no longer relies on Allegro-specific port shapes.

2. **Optional: implement batch quantity updates**
   - **Action**:
     - Implement `updateOfferQuantitiesBatch` if supported; otherwise omit (service falls back to single).
   - **Acceptance**:
     - InventorySyncService fallback path works when batch is missing.

### Phase 8: PrestaShop sync orchestration moved into core (“master.*”)
**Goal**: Option B completeness: master sync policies live in core, not worker.

**Steps**:
1. **Create core use-cases for master sync**
   - **Files**:
     - `libs/core/src/products/application/services/product-sync.service.ts` (+ interface)
     - `libs/core/src/inventory/application/services/inventory-master-sync.service.ts` (+ interface)
   - **Action**:
     - Implement “sync from master by externalId” using:
       - IdentifierMapping in core (resolve internal IDs)
       - `ProductMasterPort` / `InventoryMasterPort` via IntegrationsService
       - canonical persistence services to upsert
     - Return structured result payloads for observability.
   - **Acceptance**:
     - Worker handlers become thin delegates.

2. **Worker: new generic master handlers + alias old prestashop job names**
   - **Files**:
     - `apps/worker/src/sync/handlers/master-product-sync.handler.ts`
     - `apps/worker/src/sync/handlers/master-inventory-sync.handler.ts`
     - registration updates for aliasing
   - **Acceptance**:
     - Old `prestashop.*` names still work while producers migrate.

### Phase 9: Tests
**Goal**: Enforce cursor safety, dedupe, batching, and delegation rules.

**Steps**:
1. **Core unit tests**
   - **Files**:
     - `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` (or `order-sync.service.spec.ts` if extending)
     - `libs/core/src/inventory/application/services/__tests__/inventory-sync.service.spec.ts`
     - `libs/core/src/products/application/services/__tests__/product-sync.service.spec.ts`
   - **What to test**:
     - Cursor commit only after successful enqueueBulk
     - No commit on enqueue failure (retry-safe via dedupe keys)
     - EventType filtering behavior passed to adapter
     - Single-flight lock behavior per connectionId (at least lock key usage / lock acquisition semantics)
     - Batch vs single fallback in quantity updates
     - Partial failure output for batch/single update loops

2. **MarketplacePort contract tests (core)**
   - **Files**: `libs/core/src/integrations/application/testing/marketplace-port.contract.ts` (or similar shared test helper)
   - **Action**:
     - Provide a reusable test suite for any `MarketplacePort` implementation:
       - cursor monotonicity invariants for `listOrderFeed`
       - required fields present (`externalOrderId`, `eventType`, `occurredAt`, plus a stable `eventKey` when available)
       - minimal updateOfferQuantity behavior (success path + error surfacing)
   - **Acceptance**:
     - Can be reused by `libs/integrations/allegro` tests as the first reference plugin.

3. **Worker unit tests**
   - **Files**: `apps/worker/src/sync/handlers/__tests__/*.spec.ts`
   - **What to test**:
     - New generic handlers delegate to core services with correct payload mapping
     - Legacy job types still trigger the new behavior (alias mapping)

4. **Integration tests (targeted)**
   - Keep existing Allegro integration tests running during migration; add one “legacy job type still works” integration-ish test if gaps appear.
   - **Reference**: `docs/testing-guide.md` for integration harness patterns.

### Phase 10: Docs + Cleanup
**Goal**: Make docs match reality; remove legacy surfaces only after migration is complete.

**Steps**:
1. **Update `docs/architecture-overview.md`**
   - Clarify that workers are executors; core owns policies and flows.
   - Ensure adapter registry examples match actual capabilities.
2. **Final cleanup PR (after producers migrated)**
   - Remove Listings marketplace compatibility port/types
   - Remove legacy job names + alias routes
   - Remove any adapter-specific job payload types from core sync domain

---

## 7. Alternatives Considered

### Alternative 1: Keep orchestration in worker (Option A)
- **Description**: Maintain current pattern: handlers own cursor policy, dedupe keys, and integration-specific job types.
- **Why Rejected**: Leads to fragmented policies and weak plugin contract; hard to scale beyond 1 marketplace without duplication.
- **Trade-offs**: Faster short-term changes, but increasing long-term coupling and inconsistent behavior.

### Alternative 2: Put orchestration in integration packages
- **Description**: Each plugin owns its orchestration logic and exposes higher-level workflows.
- **Why Rejected**: Core loses control over sync consistency; difficult to guarantee behavior, observability, and contract stability across plugins.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Domain ports/types in canonical location (`core/integrations/domain/*`) with no framework deps
- ✅ Core ↔ plugin boundary enforced via ports
- ⚠️ Requires careful module wiring to avoid introducing circular dependencies between `core/sync`, `core/integrations`, and `core/orders`

**Reference**: `docs/architecture-overview.md#hexagonal-architecture-structure`

### Naming Conventions
- ✅ Ports: `*.port.ts`, `{Capability}Port`
- ✅ Types: `*.types.ts`, unions via `as const`

**Reference**: `docs/engineering-standards.md#naming-conventions`

### Risks
- **Backward compatibility drift**: old job names/producers break during transition.
  - **Mitigation**: explicit alias registration + integration-ish test covering legacy job types.
- **Cursor safety regressions**: committing cursor too early could skip events.
  - **Mitigation**: core unit tests for “commit only after enqueueBulk success”.
- **Dedupe key mistakes**: could cause duplicate downstream work or missed sync.
  - **Mitigation**: deterministic dedupe key strategy; tests validating keys.
- **Batch partial failures**: adapters differ; batch may not exist.
  - **Mitigation**: core fallback to single updates + structured partial failure reporting.
- **Service responsibility bloat**: stuffing ingestion into `OrderSyncService` can reduce clarity.
  - **Mitigation**: prefer dedicated ingestion service/use-case.
- **Plugin contract coupling to core domain entities**: returning core domain `Order` from port makes plugin contract fragile.
  - **Mitigation**: `MarketplacePort.getOrder()` returns `IncomingOrder` DTO; core maps it internally.

### Edge Cases
- Empty feed with `nextCursor=null` (should not commit cursor unnecessarily).
- Feed items without stable `eventId` (dedupe uses `occurredAt` or a composite).
- Marketplace adapter returns malformed data (validate at application boundary; throw domain exceptions).
- Retry storms during rate limits (ensure error classification remains inside adapter; runner handles backoff).

### Backward Compatibility
- ✅ Maintain current import paths (Listings marketplace port) via alias.
- ✅ Maintain legacy job types during migration via handler aliasing.
- ✅ Gradual migration of producers (schedulers/controllers/webhooks) to generic job types.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- **Core**:
  - Marketplace ingestion cursor safety + enqueue failure behavior
  - Dedupe key generation
  - Offer quantity batch-vs-single fallback + partial failure results
  - Master sync services (PrestaShop) orchestration moved from worker to core
- **Worker**:
  - Delegation-only behavior
  - Legacy alias routes still call new core services

**Reference**: `docs/testing-guide.md#unit-tests`

### Integration Tests
- Keep existing Allegro e2e/integration tests running through the transition.
- Add one targeted test verifying legacy job name triggers new generic flow (optional but recommended).

**Reference**: `docs/testing-guide.md#integration-tests`

### Mocking Strategy
- Core tests mock `MarketplacePort`, `SyncJobQueuePort`, `ConnectionCursorRepositoryPort`, and `IntegrationsService`.
- Worker tests mock the core services; do not use concrete adapters.

### Acceptance Criteria
- [ ] Canonical `MarketplacePort` exists under `libs/core/src/integrations/domain/ports/marketplace.port.ts`
- [ ] Types are split into dedicated `*.types.ts` files under canonical `core/integrations/domain/types`
- [ ] Core owns marketplace ingestion orchestration (cursor + enqueue + commit safety)
- [ ] Core owns marketplace offer quantity update orchestration (single + optional batch + partial failures)
- [ ] PrestaShop master sync orchestration is in core services; worker handlers are thin delegates
- [ ] Worker handlers contain no cursor policy, dedupe policy, or integration-specific orchestration
- [ ] Job taxonomy includes generic `marketplace.*` and `master.*` with backward-compatible aliases
- [ ] Unit tests cover cursor safety, dedupe, batching, partial failure handling
- [ ] Docs updated (`docs/architecture-overview.md`) to reflect the new architecture
- [ ] MarketplacePort contract tests exist and pass for Allegro adapter
- [ ] Marketplace ingestion enforces single-flight per connection (lock policy implemented)

---

## 10. Alignment Checklist

- [ ] Follows hexagonal architecture (interfaces → application → domain; infra implements ports)
- [ ] Respects CORE vs Integration boundaries (core never imports concrete integration classes)
- [ ] Uses existing patterns (ports in domain, types in `*.types.ts`, unions via `as const`)
- [ ] Idempotency considered (dedupe keys + cursor commit safety)
- [ ] Event-driven patterns used where applicable (jobs as orchestration mechanism)
- [ ] Rate limits & retries addressed (adapter classifies; runner retries/backoff)
- [ ] Error handling comprehensive (domain exceptions at boundaries)
- [ ] Testing strategy complete (core unit tests + worker delegation tests + targeted integration coverage)
- [ ] Naming conventions followed (per `docs/engineering-standards.md`)
- [ ] File structure matches standards (per `docs/architecture-overview.md`)
- [ ] Plan is execution-ready
- [ ] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](./architecture-overview.md)
- [Engineering Standards](./engineering-standards.md)
- [Testing Guide](./testing-guide.md)
- [Code Review Guide](./code-review-guide.md)
- [ISSUE_46](../ISSUE_46.md)

