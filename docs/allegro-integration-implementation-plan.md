# Implementation Plan: Allegro MVP Integration (Orders via Event Journal + Inventory Quantity Commands)

## 1. Task Summary

Deliver an MVP Allegro integration aligned to OpenLinker's hexagonal architecture:
- **Pull Allegro orders** incrementally using `/order/events` (cursor-based) and fetch full details via `/order/checkout-forms/{id}`.
- **Push inventory updates** to Allegro offer quantities via `/sale/offer-quantity-change-commands/{commandId}` with observable failures.
- Ensure **per-connection adapter resolution** and **internal ID mapping** via `IdentifierMappingService`.

## 2. Scope & Non-Goals

### In Scope
- Audit and implement a **single marketplace abstraction** that covers MVP needs (orders feed + `updateOfferQuantity`) without duplicating Listings/Marketplace concepts.
- Create `libs/integrations/allegro` package with adapter factory registration (mirrors `libs/integrations/prestashop` pattern).
- Implement OAuth connect flow (sandbox/prod) and store credentials in resolvable backend via `credentialsRef`.
- Implement polling job + cursor persistence (`lastEventId`) per connection and route orders into order processing destination.
- Implement Allegro offer quantity updates (commands + status).
- Add minimal Offer↔Product mapping to support stock sync.
- Unit + integration tests + documentation.

### Non-Goals (MVP)
- Full Allegro surface area (offers CRUD, pricing rules, advanced order lifecycle).
- Full-blown secrets management (Vault/KMS). MVP can use DB-backed credential store with clear upgrade path.
- Webhook-based Allegro ingestion (we'll do polling as requested).

## 3. Architecture Mapping

### Target Layers

- **CORE (libs/core)**
  - **Audit & unify marketplace abstraction** so we do not ship overlapping ports. Architecture places offer operations under **Listings** (marketplace integration concept), and inventory flow calls `updateOfferQuantity(offerId, quantity)`.
  - Implement the **Marketplace** capability port contract in the appropriate bounded context (prefer `libs/core/src/listings/domain/ports/`), named as an integration-facing port (e.g., `marketplace-integration.port.ts`) and exposing:
    - order event feed (MVP)
    - `updateOfferQuantity` (MVP)
  - Add missing `OrderProcessorManagerPort` (capability exists, port does not yet).
  - Add cursor persistence abstraction (prefer generic "connection cursor" table/port).
  - Add OrderSync pipeline (service + types) that routes from source → processor.
  - Fix `IntegrationsService.listCapabilityAdapters` to use **factories** when available (currently returns registry placeholders).

- **Integration / Adapter (libs/integrations/allegro)**
  - `AllegroMarketplaceAdapter` implements the unified marketplace port (orders + `updateOfferQuantity`), keeping Allegro's async command pattern internal.
  - HTTP client wrapper (headers, retries, rate-limit behavior, trace-id logging).
  - Adapter factory + `AllegroIntegrationModule` registering factory via `AdapterFactoryResolverService` (mirrors PrestaShop).

- **App (apps/api)**
  - Connection config schema for Allegro (env + OAuth parameters) using existing connections API.
  - OAuth controller endpoints (connect + callback), storing tokens into credential store and writing `credentialsRef`.
  - Scheduler (Nest `ScheduleModule` is already enabled in `apps/api/src/app.module.ts`) to enqueue polling jobs.
  - API endpoints for Offer↔Product mapping + operational visibility (command status, lastEventId).

- **Worker (apps/worker)**
  - Job handlers for:
    - Polling Allegro events per connection (cursor-aware).
    - Syncing a single Allegro order (fetch checkout form → map → route).
    - Updating Allegro offer quantity (command submission + follow-up status).

### Core vs Integration Justification

- **CORE changes are required** because ports (`Marketplace`, `OrderProcessorManager`) and orchestration concerns (cursor persistence, OrderSync) must be platform-agnostic and shared across integrations.
- **Integration changes** implement Allegro-specific behavior behind those ports, registered via adapter factory (no core↔plugin boundary violations).

## 4. External / Domain Research

### Allegro APIs (MVP Focus)

- **Orders**
  - `/order/events`: Incremental event journal; requires stable cursor semantics (`lastEventId`).
  - `/order/checkout-forms/{id}`: Full order details for mapping into unified schema.

- **Inventory**
  - `/sale/offer-quantity-change-commands/{commandId}`: Async command model; must track command status and expose failures.

### OpenLinker Existing Internal Patterns to Reuse

- Adapter factory registration pattern: `libs/integrations/prestashop/src/prestashop-integration.module.ts`.
- Credential resolution pattern: `CredentialsResolverPort` + current env-based implementation (`libs/core/src/integrations/infrastructure/credentials/credentials-resolver.service.ts`).
- Job ingestion/execution: Redis stream `jobs.sync` → DB `sync_jobs` → worker runner/handlers (`apps/worker/src/sync/*`).
- Connection entity is already present with `config` (JSONB) and `credentialsRef` (`libs/core/src/identifier-mapping/.../connection.orm-entity.ts`).

## 5. Questions & Assumptions

### Open Questions

- **Credentials storage**: Do we accept a DB-backed credential store for OAuth tokens (encrypted-at-rest) as MVP, or is there an existing secrets backend planned?
- **Order destination**: Which `OrderProcessorManager` is the MVP sink? (Likely PrestaShop, but PrestaShop currently only implements `OrderSource`, not order write/lifecycle.)
- **Offer↔Product mapping key**: Is the primary Allegro identifier for stock updates `offerId` only, or can we safely derive from SKU/EAN for MVP auto-mapping?
- **Polling cadence**: Desired interval and backfill behavior (e.g., on new connection: start from "now" vs "from beginning").

### Assumptions (Safe Defaults)

- **A1**: Allegro polling is scheduled in API and executed in worker via sync jobs (matches existing orchestration).
- **A2**: OAuth tokens are stored in a new DB table keyed by `credentialsRef` (still keeps `credentialsRef` indirection).
- **A3**: MVP order routing uses a single configured `OrderProcessorManager` destination connection (explicit config) until multi-destination routing exists.
- **A4**: Offer↔Product mapping is manual-first via API endpoints; auto-derivation can be added later.

## 6. Proposed Implementation Plan

### Phase 0: Audit & unify marketplace abstraction (prevent duplicate ports)

- Audit current marketplace-related abstractions:
  - Architecture docs refer to Listings owning marketplace offer operations (and a marketplace integration abstraction).
  - Code reality check: `libs/core/src/listings/domain/ports/` is currently empty, while `CapabilityValues` already includes `Marketplace`.
- Choose and implement **one** MVP abstraction, and explicitly avoid introducing a parallel port:
  - Prefer: create the marketplace integration port in `libs/core/src/listings/domain/ports/` (single place to live, aligned with Listings bounded context).
  - Ensure capability name remains `Marketplace` (already in `CapabilityValues`) so adapter resolution stays consistent.

### Phase 1: Core Capability Contracts (Marketplace + OrderProcessorManager) + Fix Adapter Listing Behavior

- **Add the unified marketplace integration port** (new file under core, prefer `libs/core/src/listings/domain/ports/marketplace-integration.port.ts`)
  - Methods (MVP):
    - `getOrders(params: { cursor?: string; limit?: number; })` → `{ items: { eventId: string; checkoutFormId: string }[]; nextCursor: string }`
      - Note: adapter may implement this using Allegro `/order/events` internally; `cursor` maps to Allegro `from`/event id semantics.
    - `getOrderByCheckoutFormId(checkoutFormId: string)` → unified `Order` with internal IDs.
    - `updateOfferQuantity(params: { offerId: string; quantity: number; idempotencyKey: string })` → `{ commandId: string; status: 'queued' | 'accepted' | 'rejected' }` (status union MVP; can be expanded).
    - Optional follow-up method (only if required by orchestration/observability): `getOfferQuantityUpdateStatus(commandId: string)` → `{ status, errors? }`.
  - Add types in `*.types.ts` (`as const` unions for statuses).

- **Add `OrderProcessorManagerPort`** (new file under `libs/core/src/orders/domain/ports/`)
  - MVP methods needed for acceptance: `createOrder(order: OrderCreate): Promise<OrderRef>` (and minimal types).

- **Fix `IntegrationsService.listCapabilityAdapters`** to return factory-created adapters (mirrors `getCapabilityAdapter` logic). Today it returns registry placeholders even when factories exist, which will block worker execution.

- **Update/verify adapter metadata**
  - Ensure `AdapterRegistryService` declares `allegro.publicapi.v1` supports **only** `Marketplace` for MVP.
  - Only add `OrderProcessorManager` to Allegro metadata if/when an Allegro order-write adapter actually exists.

### Phase 2: Cursor Persistence (Per Connection) + New Allegro Polling Job Types

- **Add generic connection cursor store**
  - New core module slice (recommended under `libs/core/src/sync/` or `libs/core/src/integrations/`) with:
    - Domain port: `ConnectionCursorRepositoryPort` (`get(connectionId, cursorKey)`, `set(connectionId, cursorKey, value)`).
    - ORM entity: `connection_cursors` table with unique `(connectionId, cursorKey)`.
  - Add migration in `apps/api/src/migrations/` to create the table.

- **Define job types**
  - Extend `JobTypeValues` in `libs/core/src/sync/domain/types/sync-job.types.ts`:
    - `marketplace.orders.poll`
    - `marketplace.order.sync`
    - `marketplace.offerQuantity.update`
    - (optional) `allegro.offerQuantity.refreshStatus`

- **Job payload shapes** (types in `*.types.ts`)
  - Poll job: `{ cursorKey: 'allegro.orders.lastEventId'; pageSize?: number }`
  - Sync order job: `{ checkoutFormId: string; eventId: string }`
  - Offer update job: `{ offerId: string; quantity: number; correlationId?: string }`

### Phase 3: `libs/integrations/allegro` Package Skeleton + Factory Registration

- Create `libs/integrations/allegro` with the same pattern as PrestaShop:
  - `AllegroIntegrationModule` registers `AllegroAdapterFactoryWrapper` via `AdapterFactoryResolverService.registerFactory('allegro.publicapi.v1', factory)`.
  - `AllegroAdapterFactory`:
    - Validates connection config (sandbox/prod base URL, timeouts, etc.).
    - Resolves OAuth credentials via `CredentialsResolverPort.get<AllegroCredentials>(connection.credentialsRef)`.
    - Constructs `AllegroHttpClient`.
    - Returns capability adapters (`MarketplacePort` now; others later).

- Add `apps/api/src/integrations/integrations.module.ts` import for `AllegroIntegrationModule` (mirrors `PrestashopIntegrationModule` import).

### Phase 4: API OAuth Connect Flow + Credential Store Backend

- **Credential store** (DB-backed)
  - Add `integration_credentials` table keyed by `credentialsRef` with JSON payload (and optional encryption fields).
  - Implement a new `CredentialsResolverPort` backend that can resolve `db:{ref}` and read from this table.
  - Wire it in core `IntegrationsModule` so both API and worker can resolve DB-backed credentials (or override token in both apps explicitly).

- **OAuth endpoints** (new controller under `apps/api/src/integrations/http/`)
  - `GET /integrations/allegro/connect?connectionId=...` → redirect to Allegro authorize URL (env-specific).
  - `GET /integrations/allegro/callback?...` → exchange code, store token set into credential store, set/update connection `credentialsRef`.
  - `POST /integrations/allegro/validate` → makes a lightweight Allegro call with token to validate.

- **Connection config**
  - Reuse existing Connection API (`CreateConnectionDto`/`UpdateConnectionDto`) storing Allegro config in `connection.config`:
    - `env: 'sandbox' | 'prod'`
    - `clientId`, `redirectUri`, `scopes` (or reference keys)
    - (avoid storing secrets here)

- **Operational status**
  - Set connection `status` to `active` on success, `error` on failure (existing `Connection.status` supports this).

### Phase 5: Allegro HTTP Client Wrapper + Marketplace Adapter Implementation (Orders + Quantity Commands)

- **HTTP client wrapper** (`AllegroHttpClient`)
  - Attaches `Authorization: Bearer …`.
  - Retries with backoff on 429/5xx, respects `Retry-After`.
  - Logs trace/correlation id using `@openlinker/shared/logging`.
  - Handles token expiry by surfacing a typed error for "needs refresh" (refresh handled via stored refresh token or re-auth flow; decide MVP behavior).

- **`AllegroMarketplaceAdapter` implements the unified marketplace integration port**
  - Orders:
    - `getOrders` calls `/order/events` with cursor and returns `{ eventId, checkoutFormId }[]` + `nextCursor`.
    - `getOrderByCheckoutFormId` calls `/order/checkout-forms/{id}` and maps to unified `Order`.
    - Uses `IdentifierMappingPort.getOrCreateInternalId` (entity types: `Order`, `Product`, `Customer` as needed) with `connectionId`.
  - Inventory:
    - `updateOfferQuantity` issues Allegro command under the hood (deterministic `commandId` derived from idempotency key, or passed through) and returns a normalized response.
    - `getOfferQuantityUpdateStatus` (optional) queries status endpoint(s) and returns normalized status for observability.

### Phase 6: Worker Handlers (Poll → Enqueue Order Sync → Route into OrderProcessorManager)

- **Add handlers in `apps/worker/src/sync/handlers/`**
  - `MarketplaceOrdersPollHandler` handles `marketplace.orders.poll`
    - Resolves Allegro `MarketplacePort` adapter using `IntegrationsService.getCapabilityAdapter(connectionId, 'Marketplace')`.
    - Loads cursor (`allegro.orders.lastEventId`) from cursor store.
    - Calls `listOrderFeed`; for each feed item enqueue `marketplace.order.sync` with dedupe key `marketplace:{connectionId}:order:{eventKey}`.
    - Updates cursor only after enqueue succeeds (cursor safety).
  - `MarketplaceOrderSyncHandler` handles `marketplace.order.sync`
    - Fetches unified order via `MarketplacePort.getOrderByCheckoutFormId`.
    - Passes order into new core `OrderSyncService` to route to a destination processor.

- **Register handlers**
  - Extend `HandlerRegistrationService` to register these job types (mirrors existing PrestaShop handler registration).

### Phase 7: CORE OrderSync Pipeline + Minimal PrestaShop OrderProcessorManager (To Satisfy Routing Acceptance)

- **Implement `OrderSyncService` in `libs/core/src/orders/application/services/`**
  - Interface in `application/interfaces/`.
  - Inputs: unified `Order` (internal IDs), plus source connection metadata.
  - Resolves destination `OrderProcessorManagerPort` connection(s) (MVP: single configured destination connectionId in env/config).
  - Calls processor `createOrder` (or equivalent) and records a minimal "synced" outcome (even if persistence is minimal MVP).

- **Implement destination processor**
  - Option A (preferred): Extend `libs/integrations/prestashop` with `PrestashopOrderProcessorManagerAdapter` using existing PrestaShop client, plus a mapper from unified Order → PrestaShop order-create payload.
  - Option B (fallback MVP): Implement a `StubOrderProcessorManagerAdapter` in core for routing validation only (logs + persists "received order" to DB). Only use if PrestaShop order creation is too large for MVP timeline.

- **Update PrestaShop adapter metadata/factory wrapper**
  - Add support for `OrderProcessorManager` capability if implemented.

### Phase 8: Offer↔Product Mapping + Inventory Sync to Allegro

- **Mapping storage**
  - Standardize on `identifier_mappings` for offer mapping:
    - `entityType = 'Offer'`
    - `externalId = offerId`
    - `internalId = internalProductId` (canonical “sellable item” id)
    - Scoped by `(platformType, connectionId)`
  - Ensure DB correctness/perf:
    - **UNIQUE** `(entityType, platformType, connectionId, externalId)`
    - **INDEX** `(entityType, platformType, connectionId, internalId)` for reverse lookup

- **API endpoints**
  - (Optional) CRUD endpoints for creating mappings should create `identifier_mappings` entries with `entityType='Offer'`.

- **Inventory update flow**
  - Either:
    - Extend existing inventory sync handler(s) to enqueue `marketplace.offerQuantity.update` for mapped offers, or
    - Create a dedicated worker handler that consumes an inventory job type and issues Allegro commands.
  - Track command status and persist last error for observability.

### Phase 9: Observability + Operational Endpoints

- **Persist status**
  - Table for `allegro_quantity_commands` (commandId, offerId, quantity, status, error, timestamps, connectionId).

- **API endpoints**
  - Query last cursor, recent commands, failed commands per connection.

- **Logging**
  - Ensure all Allegro requests log trace id + connectionId + correlation ids.

### Phase 10: Tests + Docs

- **Unit tests**
  - `AllegroMarketplaceAdapter` mapping: checkout form → unified order (including ID mapping calls mocked).
  - Cursor update logic in poll handler (idempotency key behavior).
  - Offer quantity command submission + status normalization.

- **Integration tests (Testcontainers)**
  - End-to-end: enqueue poll job → worker persists jobs → executes handlers → routes order to a mocked/stubbed `OrderProcessorManagerPort`.
  - Offer quantity update job results in persisted command status.

- **Docs**
  - Setup: OAuth, env vars, credential store, sandbox vs prod.
  - Runbook: reset cursor, diagnose rate limiting, view failed commands, mapping setup steps.

## 7. Alternatives Considered

### Alternative A: Model Allegro Orders as `OrderSource` Capability Instead of `Marketplace`

- **Pros**: Aligns with existing `OrderSourcePort` used by PrestaShop.
- **Cons**: Allegro event journal semantics (cursor + eventId) don't fit `getOrders(filters)` cleanly; still need inventory command operations elsewhere.
- **Decision**: Implement requested `MarketplacePort` for Allegro MVP, keep `OrderSourcePort` for other sources.

### Alternative B: Run Polling Entirely Inside API (No Worker Jobs)

- **Pros**: Fewer moving parts.
- **Cons**: Breaks existing job/worker pattern and reduces retry/observability leverage already built around `sync_jobs`.
- **Decision**: Use API scheduler to enqueue, worker to execute.

## 8. Validation & Risks

### Validation Against Repo Patterns

- Adapter factories and module registration follow existing PrestaShop pattern.
- Job execution uses existing Redis stream → DB → worker handler runner.
- ID mapping uses `IdentifierMappingPort` (connection-scoped platform derivation is already implemented).

### Key Risks

- **Credential storage**: Adding DB-backed credentials requires careful migration + security posture; ensure `credentialsRef` indirection remains.
- **Capability mismatch**: Core capabilities already list `Marketplace` and `OrderProcessorManager` but ports/adapters are incomplete—plan explicitly fills gaps.
- **`listCapabilityAdapters` factory gap**: Must be fixed or workers may get placeholder adapters.
- **Order destination complexity**: PrestaShop order creation may be non-trivial; have a fallback stub to satisfy routing acceptance if needed.
- **Rate limiting**: Allegro 429 behavior must be handled in HTTP wrapper and polling cadence.

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests

- Mapper correctness (checkout form → unified order).
- Cursor update and idempotency key rules (`allegro:{connectionId}:{eventId}`).
- Command submission/status parsing.

### Integration Tests

- Poll job → order sync job → routed to processor (mock or real minimal implementation).
- Offer quantity update job persists status and exposes failures.

### Acceptance Criteria (from `ISSUE.md`)

- [ ] Allegro connection can be created and validated (prod + sandbox).
- [ ] Orders ingested via `/order/events` and mapped to unified schema (internal IDs).
- [ ] OrderSync pipeline routes orders to at least one `OrderProcessorManager` adapter.
- [ ] Inventory updates trigger Allegro quantity commands and failures are observable (persisted status + queryable).
- [ ] Cursor (`lastEventId`) is persisted per connection and advances safely (idempotent under retries).
- [ ] All tests pass.
- [ ] Code follows Engineering Standards.
- [ ] Documentation updated.

## 10. Alignment Checklist

- [x] CORE vs Integration boundaries respected (ports in core, Allegro specifics in plugin).
- [x] No unnecessary abstractions introduced (only: Marketplace port + cursor store + missing order processor port).
- [x] Idempotency considered (job idempotency keys + cursor update rules).
- [x] Event-driven/job-driven patterns used where applicable (API scheduler → worker jobs).
- [x] Rate limits & retries addressed in Allegro HTTP client.
- [x] Plan is GitHub-issue-ready (phases map to the checklist in `ISSUE.md`).

## Definition of Done (DoD)

- [ ] All new source files include required **file header comments** (per `docs/engineering-standards.md`).

