# Implementation Plan: Split `MarketplacePort` → `OrderSourcePort` + `OfferManagerPort`

**Date**: 2026-04-22
**Status**: Ready (tech-review applied)
**Estimated Effort**: 1–2 days (one focused session + tests + review)
**Issue**: #328

---

## 1. Task Summary

**Objective**: Split `MarketplacePort` into two single-responsibility capability ports:
1. **`OrderSourcePort`** (revived) — marketplace + shop order ingestion, cursor-capable, in `libs/core/src/orders/domain/ports/`.
2. **`OfferManagerPort`** (new; renamed/re-homed `MarketplacePort`) — offer + category + seller-policy management, in `libs/core/src/listings/domain/ports/`.

**Context**: `MarketplacePort` bundles two distinct business capabilities on one port and imports `IncomingOrder` from `orders/` — violating ISP and leaking a bounded context into `integrations/`. At the same time `OrderSourcePort` is dead: registered, implemented, persisted — but no service resolves it. `OrderIngestionService` reaches for `'Marketplace'` instead.

**Classification**: **CORE** (domain port contracts, capability enum, service wiring) + **Integration** (adapter split) + **Infrastructure** (DB migration) + **Interface** (FE capability consumers) + **Documentation**.

---

## 2. Scope & Non-Goals

### In Scope
- Reshape `OrderSourcePort` contract: `listOrderFeed(input) + getOrder({externalOrderId})` — replaces the dead `getOrders(filters) + getOrder(orderId)` surface.
- Create `OfferManagerPort` with all offer-side methods from `MarketplacePort`.
- Delete `MarketplacePort`.
- Capability enum: `'Marketplace'` → `'OfferManager'`. Keep `'OrderSource'`.
- Rename `AllegroMarketplaceAdapter` → `AllegroOfferManagerAdapter`; drop the two order methods.
- New `AllegroOrderSourceAdapter` implementing the reshaped `OrderSourcePort`.
- Reshape `PrestashopOrderSourceAdapter` to the new port surface.
- Update both factory wrappers (Prestashop + Allegro), factories, and their tests.
- **Move port-contract types alongside their ports** (resolves the cross-bounded-context import that would otherwise replace the old leak):
  - Order-feed types → `libs/core/src/orders/domain/types/` (renamed: `MarketplaceOrderFeedInput/Output` → `OrderFeedInput/Output`, etc. — drop the `Marketplace` prefix, the port is platform-neutral).
  - Offer-feed / quantity-update / offer-fields-update / offer-create / category / seller-policies types → `libs/core/src/listings/domain/types/` (renamed to drop the `Marketplace` prefix where present).
  - `MarketplaceOfferCreateRejectedException` → `libs/core/src/listings/domain/exceptions/offer-create-rejected.exception.ts`.
  - `marketplace-cursor.types.ts` — stays in `integrations/domain/types/` as a generic opaque-cursor primitive (genuinely shared across ports).
- Migrate all core service consumers (8 services) to resolve the correct new capability.
- `OrderIngestionService.syncFromMarketplace` → resolves `'OrderSource'`, **renamed to `ingestOrders`**. `syncOrderFromMarketplace` → **renamed to `syncOrderFromSource`** (both methods migrate to provider-neutral framing together).
- **Rename sync-job handler**: `MarketplaceOrdersPollHandler` → `OrdersPollHandler` (class + file). The job-type *string* `'marketplace.orders.poll'` stays (see Out of Scope below).
- DB migration: rewrite `connections.enabled_capabilities` — `'Marketplace'` → `'OfferManager'`; add `'OrderSource'` to Allegro rows. With working `down()`.
- FE: update `Capability` union, form schemas, `CreateOfferWizard`, `EditConnectionForm`, `ConnectionCapabilitiesPanel`, `TriggerSyncDialog`, tests, labels.
- **Docs (full refresh; see Phase 9)**: `architecture-overview.md` end-to-end pass (Adapter Registry example, § Listings, § Identifier Mapping Service example code, architecture diagram adapter list, Data Flow diagrams) + `engineering-standards.md` (`CapabilityValues` example).
- All affected unit + integration tests.

### Out of Scope
- **Job-type string rename** (`'marketplace.orders.poll'` → `'orders.poll'`). The string is a persisted identifier in Redis streams + DB. Renaming forces a worker/stream coordination (dual-dispatch or drain-before-deploy) that is not required to meet the acceptance criteria. The handler *class* + *file* still get renamed (see In Scope); only the string constant stays. Note as follow-up.
- Further splitting `OfferManagerPort` (`CategoryDirectoryPort`, `SellerPoliciesPort`). Explicitly out-of-scope per the issue; revisit when cohesion actually strains.
- `PricingAuthorityPort` — future epic.
- Renaming `OrderProcessorManagerPort` — noted in issue as future consistency pass.
- `ProductVariant` entity-type promotion (#322) — separate issue.

### Constraints
- **Atomic single PR** (see §7 Alternatives). No `@deprecated` dual-read window: one clean cut.
- Migration must run cleanly in both Testcontainers and a seeded Postgres instance.
- No remaining references to `MarketplacePort` or `IMarketplaceIntegration` in `docs/`.

---

## 3. Architecture Mapping

**Target Layers**:
- **CORE** (`libs/core/src/`): port contracts (`OrderSourcePort`, `OfferManagerPort`), capability enum, consumer services.
- **Integration** (`libs/integrations/`): adapter split + factory wrappers.
- **Infrastructure** (`apps/api/src/migrations/`): DB migration for `enabled_capabilities`.
- **Interface** (`apps/web/src/`): FE capability type + components.
- **Docs** (`docs/`): architecture + engineering-standards refresh.

**Capabilities After Refactor**:

| Adapter | Capabilities |
|---|---|
| `prestashop.webservice.v1` | `ProductMaster`, `InventoryMaster`, `OrderSource`, `OrderProcessorManager` |
| `allegro.publicapi.v1` | `OrderSource`, `OfferManager` |

**CORE vs Integration Justification**:
- Port contracts and the capability enum live in CORE — business abstractions, platform-agnostic.
- Adapters live in Integration — they implement CORE ports against specific platforms.
- No new CORE logic is added; we are reshaping existing contracts and rewiring resolution.

**Reference**: [Architecture Overview — Capability Abstractions](../architecture-overview.md#capability-abstractions-business-roles)

---

## 4. External / Domain Research

### Internal Patterns (from codebase)

**`OrderSourcePort` is dead**: verified via research — no service imports or resolves it. `PrestashopOrderSourceAdapter.getOrders/getOrder` are called only by their own spec file and by `prestashop-adapter-factory-wrapper` (which returns them for a capability no one resolves). We can freely reshape its contract without breaking any consumer.

**Adapter factory wrapper pattern** (existing): each platform has `<platform>-adapter-factory-wrapper.ts` with a `switch(capability)` block returning a specific adapter instance from the factory's `createAdapters()` output. The Allegro wrapper currently handles only `'Marketplace'`; Prestashop handles 4 capabilities including `'OrderSource'`.

**Capability resolution** (existing): `IntegrationsService.getCapabilityAdapter<T>(connectionId, capability)` is the only call site pattern used across 8 core services. Tests mock the wrapper's resolution.

**Migration pattern** (existing): `1780000000000-add-enabled-capabilities-to-connections.ts` shows JSONB backfill with `COALESCE(adapterKey, '')` fallback and `RAISE NOTICE` for unknown rows. Follow the same style.

**Method-name idiom**: `listOrderFeed(input: MarketplaceOrderFeedInput)` already exists on `MarketplacePort` and is actively consumed. We move this method to `OrderSourcePort` unchanged.

---

## 5. Questions & Assumptions

### Assumptions
- **Single atomic PR** is acceptable for this MVP; no staged dual-read rollout needed (see §7 Alternatives).
- **Job type `'marketplace.orders.poll'` stays as a string identifier** — it points at a worker handler, not a capability. Renaming is out of scope (see §2 Out of Scope).
- **`PrestashopOrderSourceAdapter.getOrders/getOrder` can be freely reshaped** — no application code calls them today.
- **Allegro adapter factory** currently returns only `{ marketplace: AllegroMarketplaceAdapter }`. After the split it returns `{ offerManager: AllegroOfferManagerAdapter, orderSource: AllegroOrderSourceAdapter }`. The two adapters share the same Allegro HTTP client / deps (simple extraction from one class into two).
- **Allegro `AllegroMarketplaceAdapter` currently houses both offer and order-feed logic** — splitting into two class files preserves behavior. The quantity-polling / command-repository state stays on the OfferManager side.

### Open Questions
None blocking. Rollout-strategy preference (atomic vs staged) confirmed separately with the user before implementation begins.

### Documentation Gaps
- `docs/architecture-overview.md` § *Listings (Offers)* refers to `IMarketplaceIntegration`, which does not exist in code. Fix as part of this PR's docs update.

---

## 6. Proposed Implementation Plan

Execution order: **types → ports → adapters → factories → consumers → migration → FE → docs → tests**. This minimizes compilation-red-zone time: each phase leaves the tree compilable.

### Phase 1 — Move port-contract types into the right bounded context (CORE)

**Goal**: Eliminate the cross-bounded-context import that would otherwise appear when ports move but their contract types stay behind. Do this *before* touching port files so the new port files can import from the right place on day one.

Use `git mv` for every file move below to preserve Git rename detection + blame.

1. **Order-feed types → `orders/domain/types/`**
   - **Moves**:
     - `libs/core/src/integrations/domain/types/marketplace-order-feed.types.ts` → `libs/core/src/orders/domain/types/order-feed.types.ts`
   - **Renames inside the file**: `MarketplaceOrderFeedInput` → `OrderFeedInput`, `MarketplaceOrderFeedOutput` → `OrderFeedOutput`, `MarketplaceOrderEventType` → `OrderFeedEventType`. Update JSDoc to drop "marketplace" framing (the port is platform-neutral — Allegro event IDs and PrestaShop `date_upd` watermarks both flow through this shape).
   - **Acceptance**: No file outside `orders/` imports these types from the old path; all callers updated via Phase 4.

2. **Offer / category / seller-policy / command types → `listings/domain/types/`**
   - **Moves** (one per file, with `Marketplace` prefix stripped inside type names):
     - `marketplace-offer-feed.types.ts` → `listings/domain/types/offer-feed.types.ts` (`MarketplaceOfferFeedInput/Output/Item` → `OfferFeedInput/Output/Item`)
     - `marketplace-quantity-update.types.ts` → `listings/domain/types/offer-quantity-update.types.ts` (`UpdateOfferQuantityCommand`, batch, batch-result — names already port-neutral, only the file moves)
     - `marketplace-offer-update.types.ts` → `listings/domain/types/offer-fields-update.types.ts` (`UpdateOfferFieldsCommand` — name already neutral, file moves)
     - `marketplace-offer-create.types.ts` → `listings/domain/types/offer-create.types.ts` (`CreateOfferCommand`, `CreateOfferResult`, `CreateOfferResultStatus` — names already neutral, file moves)
     - `marketplace-category.types.ts` → `listings/domain/types/marketplace-category.types.ts` (keeps name — `MarketplaceCategory` describes a marketplace taxonomy node, that framing is accurate)
     - `seller-policies.types.ts` → `listings/domain/types/seller-policies.types.ts` (already neutrally named)
   - **JSDoc**: strip `MarketplacePort.*` references; point to `OfferManagerPort.*` instead.

3. **Domain exception → listings**
   - **Move**: `libs/core/src/integrations/domain/exceptions/marketplace-offer-create-rejected.exception.ts` → `libs/core/src/listings/domain/exceptions/offer-create-rejected.exception.ts`.
   - **Rename**: class `MarketplaceOfferCreateRejectedException` → `OfferCreateRejectedException`.

4. **Stays in `integrations/domain/types/`**
   - `marketplace-cursor.types.ts` — genuinely a generic opaque-cursor primitive; callers can cast to the adapter-specific shape at the edge. Not tied to any one port.
   - `adapter.types.ts` — capability + adapter-metadata types live here by design.

5. **Update public exports**
   - `libs/core/src/orders/index.ts` — export `OrderFeedInput`, `OrderFeedOutput`, `OrderFeedEventType`, `OrderSourcePort` (already there).
   - `libs/core/src/listings/index.ts` — export `OfferFeedInput/Output/Item`, `UpdateOfferQuantityCommand` (+ batch), `UpdateOfferFieldsCommand`, `CreateOfferCommand/Result/Status`, `MarketplaceCategory`, `SellerPolicy`, `SellerPolicies`, `OfferCreateRejectedException`, `OfferManagerPort` (added in Phase 2).
   - `libs/core/src/integrations/index.ts` — remove the matching exports; keep `MarketplaceCursor`, `Capability`, `AdapterFactoryPort`, etc.

**Acceptance (Phase 1)**: `pnpm type-check` passes; no file under `libs/core/src/integrations/` exports or defines a port-contract type that has moved; no file under `orders/` or `listings/` imports these types from `@openlinker/core/integrations`.

### Phase 2 — New port contracts (CORE)

**Goal**: Introduce the two new port shapes. Leave `MarketplacePort` in place for now so consumers still compile.

1. **Reshape `OrderSourcePort`**
   - **File**: `libs/core/src/orders/domain/ports/order-source.port.ts`
   - **Action**:
     - Replace the interface to expose `listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput>` and `getOrder(input: { externalOrderId: string }): Promise<IncomingOrder>`.
     - **Move the `Order`, `OrderItem`, `OrderTotals`, `Address` sub-interfaces currently defined in this file to `libs/core/src/orders/domain/types/order.types.ts`** (which already hosts `OrderFilters`). Re-export from `@openlinker/core/orders` via `libs/core/src/orders/index.ts`.
     - Port file imports `OrderFeedInput`/`OrderFeedOutput` from `../types/order-feed.types` (relative, local to the orders module) and `IncomingOrder` from `../types/incoming-order.types` (ditto).
     - JSDoc documents the cursor contract: opaque adapter-defined string; `null`/empty = no more data; non-null = call again with that cursor. Allegro adapters use event IDs, PrestaShop uses `date_upd` watermarks.
   - **Acceptance**: `tsc` passes; no file outside `orders/` defines or imports these sub-interfaces from `order-source.port.ts`; `OrderIngestionService` consumes `Order` via `@openlinker/core/orders` public export.

2. **Create `OfferManagerPort`**
   - **File** (new): `libs/core/src/listings/domain/ports/offer-manager.port.ts`
   - **Action**: Clone `MarketplacePort` contents minus `listOrderFeed` and `getOrder`. Imports come from `../types/*` (local to listings). Zero imports from `@openlinker/core/orders` or `@openlinker/core/integrations`.
   - **Acceptance**: New file's import list is confined to `./...` / `../types/...` within `listings/`.

3. **Capability enum update**
   - **File**: `libs/core/src/integrations/domain/types/adapter.types.ts`
   - **Action**: `CapabilityValues` array — remove `'Marketplace'`, add `'OfferManager'`. Keep `'OrderSource'`. Update JSDoc accordingly.
   - **Acceptance**: `Capability` union = `'ProductMaster' | 'InventoryMaster' | 'OrderProcessorManager' | 'OrderSource' | 'OfferManager'`.

### Phase 3 — Adapters (Integration)

1. **Rename + reshape `AllegroMarketplaceAdapter` → `AllegroOfferManagerAdapter`**
   - **File** (rename via `git mv`): `libs/integrations/allegro/src/infrastructure/adapters/allegro-marketplace.adapter.ts` → `allegro-offer-manager.adapter.ts`. Move first, edit second, to preserve rename detection in Git history.
   - **Action**:
     - Rename class `AllegroMarketplaceAdapter` → `AllegroOfferManagerAdapter implements OfferManagerPort`.
     - Remove `listOrderFeed`, `getOrder` methods from this class; their logic moves to the new OrderSource adapter below.
     - Update imports in all callers (registration, tests, factory).
   - **Acceptance**: Class implements only `OfferManagerPort`; the adapter has no import from `@openlinker/core/orders`.

2. **New `AllegroOrderSourceAdapter`**
   - **File** (new): `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts`
   - **Action**: Move `listOrderFeed` + `getOrder({externalOrderId})` logic out of the old MarketplaceAdapter into this class. Uses cursor key `allegro.orders.lastEventId` (unchanged — cursor key is owned by the caller `OrderIngestionService`, passed via `MarketplaceIngestionOptions.cursorKey`; verified during implementation).
   - **Dependency sharing**: both new Allegro adapters receive the same Allegro HTTP client, auth/token-refresh service, and `IdentifierMappingPort` through the factory. **One instance per connection, per call** — matching the existing per-connection factory contract. No singleton sharing across connections.
   - **Acceptance**: Class `implements OrderSourcePort`. Has a unit spec covering both methods, plus a spec assertion that the shared HTTP client is the same instance held by the sibling `AllegroOfferManagerAdapter` from the same `createAdapters()` call.

3. **Reshape `PrestashopOrderSourceAdapter` to new contract**
   - **File**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-source.adapter.ts`
   - **Action**:
     - Replace `getOrders(filters)` + `getOrder(orderId)` with `listOrderFeed(input) + getOrder({externalOrderId})`.
     - `listOrderFeed`: bind `cursor` to PrestaShop `date_upd` watermark (ISO timestamp); return items in `OrderFeedOutput` shape. `nextCursor` = max `date_upd` observed on this page, or `null` if no more pages.
     - `getOrder({externalOrderId})`: fetch by external ID, return `IncomingOrder` (the shape the port now emits) — mirror the Allegro order adapter's transformation flow.
     - Delete now-unused private helpers (`buildPrestashopFilters`) that only supported the old filter-based surface.
   - **Acceptance**: Class implements the new `OrderSourcePort`. Spec covers both methods with fixture-driven tests (no live HTTP). No production code relies on the old methods (verified by compile + consumer inventory).

4. **Update `AllegroAdapterFactory`**
   - **File**: `libs/integrations/allegro/src/application/allegro-adapter.factory.ts`
   - **Action**: `createAdapters()` now returns `{ offerManager: AllegroOfferManagerAdapter, orderSource: AllegroOrderSourceAdapter }` (was `{ marketplace }`). Both adapters receive the single HTTP client + auth + identifier-mapping instances constructed in the factory for this connection.
   - **Acceptance**: Return type + all fields present; compiles; factory unit test updated; test asserts single-HTTP-client sharing.

5. **Update Allegro factory wrapper**
   - **File**: `libs/integrations/allegro/src/infrastructure/adapters/allegro-adapter-factory-wrapper.ts`
   - **Action**: Replace `case 'Marketplace'` with `case 'OfferManager'` + `case 'OrderSource'`; update error message to `"Supported capabilities: OfferManager, OrderSource"`.
   - **Acceptance**: Wrapper spec exercises both capability branches.

6. **Update PrestaShop factory wrapper**
   - **File**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-adapter-factory-wrapper.ts`
   - **Action**: `'OrderSource'` branch already exists — re-verify it returns the reshaped adapter. Error-message capability list stays identical.
   - **Acceptance**: Existing spec still passes.

7. **`AdapterRegistryService` declared capabilities**
   - **File**: `libs/core/src/integrations/infrastructure/adapters/adapter-registry.service.ts`
   - **Action**: Update the hard-coded `supportedCapabilities` arrays:
     - `prestashop.webservice.v1` → already includes `'OrderSource'` + `'OrderProcessorManager'` + masters; no change.
     - `allegro.publicapi.v1` → `['OrderSource', 'OfferManager']` (was `['Marketplace']`). Note: the `docs/architecture-overview.md` example wrongly lists Allegro with `'OrderProcessorManager'` — that was always doc drift, not an actual registry entry. Docs refresh (Phase 9) corrects this.
   - **Acceptance**: Registry spec + integrations-service spec use the new capability arrays.

### Phase 4 — Consumer services (CORE)

For each service below: replace `getCapabilityAdapter<MarketplacePort>(connectionId, 'Marketplace')` with the correct new port + capability. Imports change: `MarketplacePort` → `OfferManagerPort` from `@openlinker/core/listings` (or `OrderSourcePort` from `@openlinker/core/orders` where applicable).

1. **`OrderIngestionService`** — `libs/core/src/orders/application/services/order-ingestion.service.ts`
   - Resolve `'OrderSource'`, type annotation `OrderSourcePort`.
   - **Method renames** (both renamed together for provider-neutral framing):
     - `syncFromMarketplace` → `ingestOrders`
     - `syncOrderFromMarketplace` → `syncOrderFromSource`
   - Update interface file `order-ingestion.service.interface.ts` to match (including the `MarketplaceIngestionOptions` / `MarketplaceIngestionResult` type names — rename to `OrderIngestionOptions` / `OrderIngestionResult` since these are now provider-neutral).
   - Update all callers: `OrdersPollHandler` (renamed below), worker handler tests, service specs.
   - File header JSDoc updated to drop "marketplace" framing.
2. **`InventorySyncService`** — resolves `'OfferManager'`, type `OfferManagerPort`.
3. **`AutoMatchVariantOffersService`** — `'OfferManager'` + `OfferManagerPort`.
4. **`SellerPoliciesService`** — `'OfferManager'` + `OfferManagerPort`.
5. **`OfferMappingSyncService`** — `'OfferManager'` + `OfferManagerPort`.
6. **`CategoryResolutionService`** — `'OfferManager'` + `OfferManagerPort`.
7. **`OfferCreationEnqueueService`** — `'OfferManager'` + `OfferManagerPort`.
8. **`OfferCreationExecutionService`** — `'OfferManager'` + `OfferManagerPort`.
9. **`CategoriesCacheService`** (apps/api) — `'OfferManager'` + `OfferManagerPort`.
10. **Handler rename: `MarketplaceOrdersPollHandler` → `OrdersPollHandler`**
    - **File** (`git mv`): `apps/worker/src/sync/handlers/marketplace-orders-poll.handler.ts` → `orders-poll.handler.ts`.
    - Rename class `MarketplaceOrdersPollHandler` → `OrdersPollHandler`.
    - Update the handler to call `orderIngestion.ingestOrders(...)`.
    - Update `handler-registration.service.ts`: import + injection + registration binding (the string key `'marketplace.orders.poll'` stays — it's the persisted job-type identifier). Comment in the registry noting the file/class name has moved ahead of the identifier, flagged as a follow-up rename.
    - Update `marketplace-orders-poll.handler.spec.ts` → `orders-poll.handler.spec.ts`.
11. **Worker handlers that call `'Marketplace'`**: `marketplace-offer-field-update.handler.ts`, `marketplace-offer-quantity-update.handler.ts`, `marketplace-offer-create.handler.ts`, `marketplace-offers-sync.handler.ts`, `marketplace-order-sync.handler.ts`, `inventory-propagate-to-marketplaces.handler.ts` — each updated to resolve the correct new capability (`OfferManager` for offer-side, `OrderSource` for `marketplace-order-sync.handler`). **File names stay** — those strings reflect the job-type identifier (e.g. `'marketplace.offer.create'`), which is out of scope.

**Acceptance (Phase 4)**:
- Repo-wide grep for `'Marketplace'` as a capability literal returns zero hits in non-test, non-migration code.
- Repo-wide grep for `MarketplacePort` returns zero hits (import, type annotation, `as MarketplacePort`, `jest.Mocked<MarketplacePort>`).
- `MarketplacePort` file can now be deleted.

### Phase 5 — Delete `MarketplacePort`

1. **Delete file**: `libs/core/src/integrations/domain/ports/marketplace.port.ts`.
2. **Remove export**: `libs/core/src/integrations/index.ts` — drop the `MarketplacePort` export.
3. Update any comments in type files (now in `listings/domain/types/`: `offer-create.types.ts`, `seller-policies.types.ts`, plus `listings/application/types/offer-builder.types.ts`, `listings/application/interfaces/offer-builder.service.interface.ts`) that reference `MarketplacePort.*` → `OfferManagerPort.*`.

**Acceptance**: `rg MarketplacePort` returns zero hits in the repo.

### Phase 6 — DB migration (Infrastructure)

1. **New migration file**: `apps/api/src/migrations/1788000000000-rename-marketplace-capability.ts`
   - `up()` — mirrors the house style from `1780000000000-add-enabled-capabilities-to-connections.ts` (whole-array replacement scoped by `adapterKey` / `platformType` fallback). Concrete SQL:
     ```sql
     -- Allegro rows: 'Marketplace' → 'OfferManager', plus add 'OrderSource'
     UPDATE "connections"
        SET "enabledCapabilities" = '["OrderSource","OfferManager"]'::jsonb
      WHERE (COALESCE("adapterKey",'') = 'allegro.publicapi.v1'
         OR ("adapterKey" IS NULL AND "platformType" = 'allegro'))
        AND "enabledCapabilities" @> '["Marketplace"]'::jsonb;

     -- Catch-all defensive: any remaining 'Marketplace' token on unknown platforms
     -- (would indicate registry drift — rewrite to OfferManager and leave a NOTICE)
     UPDATE "connections"
        SET "enabledCapabilities" = to_jsonb(
              array_replace(
                ARRAY(SELECT jsonb_array_elements_text("enabledCapabilities")),
                'Marketplace',
                'OfferManager'
              )
            )
      WHERE "enabledCapabilities" @> '["Marketplace"]'::jsonb;
     ```
     Include a `DO $$ ... RAISE NOTICE ... END$$` block mirroring the existing migration, warning if any row ends up with an empty `enabledCapabilities` array.
   - `down()` — reverse both operations:
     ```sql
     UPDATE "connections"
        SET "enabledCapabilities" = '["Marketplace"]'::jsonb
      WHERE (COALESCE("adapterKey",'') = 'allegro.publicapi.v1'
         OR ("adapterKey" IS NULL AND "platformType" = 'allegro'))
        AND "enabledCapabilities" @> '["OfferManager"]'::jsonb;

     UPDATE "connections"
        SET "enabledCapabilities" = to_jsonb(
              array_replace(
                ARRAY(SELECT jsonb_array_elements_text("enabledCapabilities")),
                'OfferManager',
                'Marketplace'
              )
            )
      WHERE "enabledCapabilities" @> '["OfferManager"]'::jsonb;
     ```
2. **Verify timestamp** > last existing (`1787000000000`). Use `1788000000000`.
3. **Verify locally**:
   ```bash
   pnpm --filter @openlinker/api migration:show
   pnpm --filter @openlinker/api migration:run
   pnpm --filter @openlinker/api migration:revert
   pnpm --filter @openlinker/api migration:run
   ```
4. **Verify in integration Testcontainers harness** — migration is picked up by the test runner automatically; integration specs should pass.

**Acceptance**: Both `up` and `down` run cleanly against a seeded connections table; reverting + re-running is idempotent.

### Phase 7 — Frontend (Interface)

1. **Capability type union**
   - **File**: `apps/web/src/features/connections/api/connections.types.ts`
   - Update FE capability union to match new BE enum: replace `'Marketplace'` with `'OfferManager'`.

2. **Setup form schema**
   - **File**: `apps/web/src/features/connections/components/prestashop-setup.schema.ts`
   - Replace hard-coded `'Marketplace'` literal; keep `'OrderSource'`.

3. **Capability labels & descriptions**
   - **File**: `apps/web/src/features/connections/components/ConnectionCapabilitiesPanel.tsx` — label `'OfferManager'` as *"Offer management"* with copy about managing marketplace offers.
   - **File**: `apps/web/src/features/connections/components/prestashop-setup-form.tsx` — same label update.

4. **Components filtering by capability**
   - **File**: `apps/web/src/features/listings/components/CreateOfferWizard.tsx` — filter `enabledCapabilities.includes('OfferManager')` (was `'Marketplace'`); update heading copy.
   - **File**: `apps/web/src/features/connections/components/EditConnectionForm.tsx` — same literal swap in the gating predicate.
   - **File**: `apps/web/src/pages/connections/connection-category-mappings-page.tsx` — filter by `'OfferManager'`; storage key name can stay (it's not user-visible) but comments updated.
   - **File**: `apps/web/src/pages/connections/connection-detail-page.tsx` — capability section gating.
   - **File**: `apps/web/src/features/sync-jobs/components/TriggerSyncDialog.tsx` — update `requiredCapability` values where they previously read `'Marketplace'`.

5. **FE tests**
   - Update every FE test fixture that hard-codes `enabledCapabilities: ['Marketplace', ...]` or `supportedCapabilities: ['Marketplace']` — swap for `'OfferManager'`. (Files enumerated in research: `TriggerSyncDialog.test.tsx`, `CreateOfferWizard.test.tsx`, `EditConnectionForm.test.tsx`, `connection-category-mappings-page.test.tsx`, `connection-detail-page.test.tsx`, `listings-list-page.test.tsx`.)

**Acceptance**: `pnpm --filter @openlinker/web lint && pnpm --filter @openlinker/web test` pass. Grep of `apps/web` for `'Marketplace'` returns zero (aside from UI copy like *"Manage offers on this **marketplace**"*, which is user-visible prose and intentional).

### Phase 8 — Tests

All tests follow automatically from the service + adapter + migration changes; this phase is a sweep to close gaps.

1. **Unit tests** — every `*.spec.ts` file that imports `MarketplacePort`, uses `jest.Mocked<MarketplacePort>`, or hard-codes the `'Marketplace'` capability (enumerated in research §4, §5, §9, §10). Update mock types to `OfferManagerPort` or `OrderSourcePort`; update capability literal expectations.
2. **New adapter specs** — `allegro-order-source.adapter.spec.ts` (new file).
3. **`prestashop-order-source.adapter.spec.ts`** — rewrite to exercise the reshaped `listOrderFeed` + `getOrder({externalOrderId})` surface.
4. **Rename with `git mv`**: `allegro-marketplace.adapter.spec.ts` → `allegro-offer-manager.adapter.spec.ts`; first commit the rename, then in the same PR apply the content edit (drop order-feed test groups, swap class name). Preserves Git rename detection + blame.
5. **Integration tests**
   - `apps/api/test/integration/connection-capabilities.int-spec.ts` — update hard-coded capability arrays.
   - `apps/worker/test/integration/allegro-order-sync-e2e.int-spec.ts` — update capability literals; verify the `'marketplace.orders.poll'` → `OrderSource` + new ingestion service plumbing still resolves end-to-end.
   - `apps/worker/test/integration/marketplace-offers-sync-e2e.int-spec.ts` — update capability checks.
   - `apps/worker/test/integration/allegro-cursor-persistence.int-spec.ts` — verify cursor semantics still hold (cursor key unchanged).
   - `apps/worker/test/integration/allegro-offer-quantity-update-e2e.int-spec.ts` — capability literal swap.
6. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`, then `pnpm test:integration` (Docker required).

**Acceptance**: All suites green.

### Phase 9 — Documentation (comprehensive refresh of `architecture-overview.md`)

Docs refresh runs *after* all code changes land so the document reflects the actual shipped state — not the pre-refactor projection. Done as the final step of the PR.

1. **`docs/architecture-overview.md` — end-to-end pass**
   - **Architecture diagram (section "Architecture Diagram", adapter list ~line 91)** — replace `AllegroMarketplaceAdapter` with `AllegroOfferManagerAdapter` + `AllegroOrderSourceAdapter`. Refresh the "Capability Ports (Interfaces)" list to include `OfferManagerPort` and `OrderSourcePort` (drop `PricingAuthorityPort (future)` if it clutters — or keep, consistent with the rest of the doc).
   - **§ Core Bounded Contexts → § 6 Listings (Offers)** (around line 163) — replace the `IMarketplaceIntegration` line with `OfferManagerPort`. Rewrite the paragraph so the capability owns offer/listing operations only, not order ingestion.
   - **§ Core Bounded Contexts → § 4 Orders** (around line 141) — extend the "Capability" line to note both `OrderSourcePort` (ingestion) and `OrderProcessorManagerPort` (lifecycle).
   - **§ Capability Abstractions (Business Roles)** — add a new `OfferManagerPort` subsection with the full interface block (mirror the existing `InventoryMasterPort` / `ProductMasterPort` presentation). Add an `OrderSourcePort` subsection reflecting the cursor-capable surface. Update the list inside the capability-ports diagram.
   - **§ Identifier Mapping Service → "Example: Allegro Order Adapter"** (around line 573) — rewrite the code example. Replace `class AllegroOrderAdapter implements IMarketplaceIntegration` with a faithful `AllegroOrderSourceAdapter implements OrderSourcePort` example that shows `listOrderFeed` + `getOrder({externalOrderId})` — not the imaginary `getOrder(orderId)` method.
   - **§ Module Organization → "Adapter Registry (Code-Level)"** (around line 1085) — Allegro entry: `supportedCapabilities: ['OrderSource', 'OfferManager']`. Drop the phantom `'OrderProcessorManager'` entry (doc drift — Allegro never had this).
   - **§ Module Organization → "Service Usage (Per-Connection)"** — update the `OrderSyncService.syncOrders` example to resolve `'OrderSource'` not `'OrderProcessorManager'` if that was ever the framing, or leave it unchanged if it's already demonstrating `OrderProcessorManager` appropriately.
   - **§ Data Flow → 1. Order Synchronization Flow** (polling + real-time) — swap `MarketplaceAdapter.getOrders(filters)` / `MarketplaceAdapter.listOrderFeed` for `OrderSourcePort.listOrderFeed(input)` and `OrderSourcePort.getOrder({externalOrderId})`. Rename the service boxes from `OrderSyncService.syncOrdersFromMarketplace()` to `OrderIngestionService.ingestOrders()` to reflect the method renames.
   - **§ Data Flow → 2. Inventory Synchronization Flow** — rename the `MarketplaceAdapter.updateOfferQuantity` box to `OfferManagerPort.updateOfferQuantity` (the abstraction, not the concrete adapter).

2. **`docs/engineering-standards.md` — targeted update**
   - **§ Union Types: `as const` Pattern** — example uses `'Marketplace'` in `CapabilityValues`. Replace with `'OfferManager'` (and the other current values) so the example tracks the actual shipped enum.

3. **CHANGELOG / release notes** — not maintained in this repo; skip.

**Acceptance**:
- `rg MarketplacePort docs/` → zero hits.
- `rg IMarketplaceIntegration docs/` → zero hits.
- `rg "AllegroMarketplaceAdapter" docs/` → zero hits.
- `rg "'Marketplace'" docs/` → only hits are natural English prose ("the marketplace API", etc.), not the capability literal.

---

## 7. Alternatives Considered

### Alternative 1 — Two-PR staged rollout (as suggested in issue)
- **Description**: PR 1 adds `OfferManager` alongside `'Marketplace'` with dual-read + `@deprecated` markers + DB backfill. PR 2 removes `'Marketplace'`.
- **Why rejected**: The risk it mitigates is BE/FE version-skew and in-flight-job coordination. Both apps ship from the same monorepo in the same PR; migration runs before API boot; a small window of dead `marketplace.orders.poll` jobs at the instant of deploy is MVP-acceptable (they can be retried via the existing bulk-retry UI). The staged path would double the review + merge overhead for no durable benefit at this project stage.
- **Trade-offs**: Simpler atomic history vs theoretically safer zero-downtime deploy. For this MVP, atomic wins.
- **Expected transient noise at deploy**: API workers boot *after* migration runs, so capability resolution starts fresh. The worker process polling Redis streams does **not** block on migration — any `marketplace.orders.poll` stream message picked up mid-deploy with a pre-refactor handler reference will fail with "capability 'Marketplace' unknown", get retried under the normal backoff, and succeed on the next attempt once the worker has restarted. Document this expected blip in the PR description so reviewers are not surprised.

### Alternative 2 — Keep `MarketplacePort` as an umbrella "facade" port
- **Description**: Leave `MarketplacePort` as an aggregate interface `extends OrderSourcePort, OfferManagerPort` for backward compatibility.
- **Why rejected**: Defeats the ISP purpose of the split; leaves the bounded-context leak in place; adds a deprecation debt that has to be cleaned up later anyway.

### Alternative 3 — Split `OfferManagerPort` further now (`CategoryDirectoryPort`, `SellerPoliciesPort`)
- **Description**: Extract categories + seller-policies into their own ports.
- **Why rejected**: Explicitly out-of-scope per the issue. `createOffer` needs all three today — further splitting introduces orchestration without a real consumer. Revisit when a non-offer-creation consumer of categories or policies appears.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ CORE ↔ Integration boundary respected: new ports live in CORE; adapters in Integration; no domain logic moves into adapters.
- ✅ Domain layer has no framework deps — the new `OfferManagerPort` is a pure TS interface.
- ✅ Orders bounded context no longer leaks into `integrations/` (`IncomingOrder` import removed).
- ✅ Services depend on port interfaces via `getCapabilityAdapter<Port>()` — no concrete adapter imports in application code.

### Naming Conventions
- ✅ `OfferManagerPort` — matches `{Capability}Port` pattern.
- ✅ `AllegroOfferManagerAdapter`, `AllegroOrderSourceAdapter`, `PrestashopOrderSourceAdapter` — match `{Platform}{Capability}Adapter` pattern.
- ✅ Capability literal `'OfferManager'` matches the port class-name root, consistent with `'OrderSource' / OrderSourcePort`.
- ℹ️ `'OrderProcessorManager'` naming (double-noun) remains awkward — out of scope, noted for future consistency pass.

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Persisted `'Marketplace'` values in `connections.enabled_capabilities` | Medium | DB migration (Phase 6); reversible `down()`; tested in Testcontainers. |
| In-flight `marketplace.orders.poll` jobs at deploy time | Low | Job type string is unchanged; handler class renamed but still bound to the same string key. Dead jobs retryable via existing UI. Worst case: a handful of transient failures during the worker restart window. |
| Allegro cursor key drift | Low | Cursor key `allegro.orders.lastEventId` is owned by the caller (`OrderIngestionService`), not the adapter. Key is unchanged. Verified during implementation by grepping `cursorKey` usages. |
| Missing a call-site (regression) | Medium | Repo-wide grep on `'Marketplace'` literal + `MarketplacePort` type in Phase 4 acceptance — zero-hit gate before Phase 5's delete step. |
| Prestashop `getOrders/getOrder` contract change breaks an unknown consumer | Low | Research confirmed no application service resolves `'OrderSource'` today; adapter methods are unreferenced outside their own spec + factory wrapper. Compile + tests will surface any surprise. |
| Type-file move breaks an import we missed | Low | Old files removed via `git mv`; any surviving import path fails compilation immediately. `pnpm type-check` gates the end of Phase 1. |
| FE/BE capability mismatch during rolling deploy | N/A | Same-PR, single deploy unit in MVP. |

### Edge Cases
- **Empty `enabledCapabilities`** after migration — the existing `RAISE NOTICE` pattern flags it; migration leaves the row untouched rather than guessing.
- **Unknown `adapterKey`** (not prestashop, not allegro) — migration's `WHERE` clauses are platform-scoped, so unknown rows are untouched. Acceptable.
- **Allegro OrderSource resolution for legacy connections** that predate this PR — migration backfills `'OrderSource'` onto Allegro rows so resolution works from first boot after deploy.

### Backward Compatibility
- **Breaking by design** — `MarketplacePort` is deleted, `'Marketplace'` capability removed. Scoped to this repo; no external SDK consumers.
- **API contract** — no REST endpoint shape changes. Job-type strings unchanged.
- **DB schema** — column unchanged (still `enabledCapabilities jsonb`); only row values rewritten.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
- New: `allegro-order-source.adapter.spec.ts` — covers `listOrderFeed` (cursor handling, event types, empty responses) and `getOrder({externalOrderId})` (success, 404 mapping).
- Rewritten: `prestashop-order-source.adapter.spec.ts` — covers the reshaped surface.
- Updated: every consumer-service spec (see research §4) — mock type swap `MarketplacePort` → `OfferManagerPort` / `OrderSourcePort`; capability literal swap.
- Updated: `allegro-marketplace.adapter.spec.ts` → rename file to `allegro-offer-manager.adapter.spec.ts`; drop the order-feed test groups (now covered in the new OrderSource spec).

### Integration Tests
- `connection-capabilities.int-spec.ts` — new capability arrays for both platforms; assertion that Allegro connections expose `['OrderSource', 'OfferManager']`.
- `allegro-order-sync-e2e.int-spec.ts` — end-to-end: Allegro event feed → `OrderSourcePort.listOrderFeed` → job enqueue → `marketplace.order.sync` job → `OrderSourcePort.getOrder` → PrestaShop order create.
- `marketplace-offers-sync-e2e.int-spec.ts` — offer sync path resolves `'OfferManager'`.
- `allegro-offer-quantity-update-e2e.int-spec.ts` — quantity update path resolves `'OfferManager'`.
- `allegro-cursor-persistence.int-spec.ts` — cursor semantics unchanged.

### Mocking Strategy
- Unit tests: mock the **port interfaces** (`OfferManagerPort`, `OrderSourcePort`), never concrete adapters.
- Integration tests: real Postgres + Redis via Testcontainers; Allegro/PrestaShop HTTP mocked at the transport layer (existing pattern).

### Acceptance Criteria
- [ ] No service resolves `'Marketplace'` capability anywhere in the codebase.
- [ ] `OrderIngestionService.ingestOrders()` resolves `'OrderSource'` and succeeds for both Allegro and PrestaShop connections.
- [ ] `OrderSourcePort` is actively consumed (no dead port).
- [ ] `OfferManagerPort` lives in `libs/core/src/listings/domain/ports/` with no import from `@openlinker/core/orders` or `@openlinker/core/integrations` (except `Capability` type if needed).
- [ ] Port-contract types live with their ports — no `@openlinker/core/integrations/domain/types/marketplace-*.types` imports remain under `orders/` or `listings/`.
- [ ] `MarketplacePort` file deleted; export removed.
- [ ] `MarketplaceOrdersPollHandler` renamed to `OrdersPollHandler`; job-type string `'marketplace.orders.poll'` unchanged.
- [ ] Migration runs cleanly in Testcontainers + on a seeded PG instance; `down()` fully reverses.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test`, `pnpm test:integration` all green.
- [ ] No remaining references to `MarketplacePort`, `IMarketplaceIntegration`, or `AllegroMarketplaceAdapter` in `docs/`.
- [ ] `docs/architecture-overview.md` refreshed: architecture diagram, § Listings, § Orders, § Capability Abstractions, § Identifier Mapping Service example, Adapter Registry code, and § Data Flow diagrams all reflect the shipped state.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (ports in CORE, adapters in Integration)
- [x] Respects CORE vs Integration boundaries (no bounded-context leak after split)
- [x] Uses existing patterns (factory-wrapper, capability registry, migration style)
- [x] Idempotency considered (cursor semantics + migration `down()`)
- [x] Event-driven patterns used where applicable (job queue unchanged)
- [x] Rate limits & retries unchanged (pre-existing adapter behavior preserved)
- [x] Error handling comprehensive (domain errors preserved; no new infra leaks)
- [x] Testing strategy complete (unit + integration; port mocks, not adapters)
- [x] Naming conventions followed (`{Capability}Port`, `{Platform}{Capability}Adapter`)
- [x] File structure matches standards (ports in `domain/ports/`, adapters in `infrastructure/adapters/`)
- [x] Plan is execution-ready
- [x] Plan is saved as markdown file

---

## Related Documentation

- [Architecture Overview](../architecture-overview.md)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- [Migrations Guide](../migrations.md)
- [Code Review Guide](../code-review-guide.md)
