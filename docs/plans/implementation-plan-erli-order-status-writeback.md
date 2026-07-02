# Implementation Plan: Erli `OrderStatusWriteback` — cancelled event → absolute stock restore

**Date**: 2026-06-25
**Status**: Ready for Review
**Estimated Effort**: 1–1.5 days
**Issue**: #1198
**ADRs**: ADR-027 (lifecycle relay), ADR-025 §4a (deferred Erli stock restore)
**Supersedes**: #1146 framing (OfferStockRestorer path was the pre-ADR-027 approach)

---

## 1. Task Summary

**Objective**: Implement `OrderStatusWriteback` for the Erli marketplace adapter so that a source-cancelled order triggers an absolute stock-restore on all Erli offers that were part of the order. The restore uses master-authoritative inventory quantities (no read-modify-write from Erli).

**Context**: ADR-027 (accepted 2026-06-22, shipped #1157–#1161 / #1171) introduced a platform-neutral lifecycle-relay (`OrderLifecycleRelayService`) that propagates a `{ type: 'cancelled' }` event to every order participant implementing `OrderStatusWriteback`. `OrderIngestionService.handleSourceCancellation` already calls the relay on every inbound source cancellation.

The relay reaches a participant by resolving it via `getCapabilityAdapter` for `'OrderProcessorManager'` or `'OrderSource'`, then narrowing via the `isOrderStatusWriteback` guard. `ErliOrderSourceAdapter` already declares `implements OrderStatusWriteback` (added alongside #993) but its `write({ type: 'cancelled' })` returns `'unsupported'` with a note pointing to the pre-ADR-027 `OfferStockRestorer` compensating path (#1146).

This task closes ADR-025 §4a: Erli auto-decrements stock on purchase but has no automatic stock-restore on cancellation. The relay is the correct ADR-027 path; the `write()` implementation just needs to perform the restore instead of returning `'unsupported'`.

**Classification**: Integration (Erli plugin) + Infrastructure (adapter, factory, module wiring)

---

## 2. Scope & Non-Goals

### In Scope
- Update `ErliOrderSourceAdapter.write({ type: 'cancelled' })` to restore stock via absolute `updateOfferQuantity` calls for every line item in the cancelled order.
- Inject `IInventoryQueryService` as a plugin-specific dep via a custom `ErliIntegrationModule` (switching from `createNestAdapterModule`).
- Update `ErliAdapterFactory.createAdapters()` to accept `inventoryQuery` and share the constructed `ErliOfferManagerAdapter` reference with `ErliOrderSourceAdapter` (so the restore inherits the frozen-stock cache logic).
- Unit tests for all `write('cancelled')` scenarios.
- No changes to CORE (`libs/core/src/`).

### Out of Scope
- Implementing `write({ type: 'dispatched' })` — already gated on `OL_ERLI_DISPATCH_WRITEBACK_ENABLED` (#992, separate issue).
- Removing or altering the existing `OfferStockRestorer` / `restoreStockOnCancellation` path on `ErliOfferManagerAdapter` — it remains as-is; this plan adds a second (relay-driven) path that supersedes it for relay-triggered cancellations, but the existing path is not broken.
- Adding `IInventoryQueryService` to `HostServices` in `@openlinker/plugin-sdk` (would widen the SDK contract; kept lean per ADR-003 §host-bag).
- Multi-location inventory aggregation changes — `getAvailabilityByVariantIds` already sums across all locations.

### Constraints
- **No CORE changes**: do not extend `OrderProcessorManagerPort`, do not add Erli-specific calls in core relay or ingestion code.
- **No read-modify-write**: the restore is a pure absolute set from master inventory. Never read Erli stock and add/subtract.
- **Idempotent**: re-running `write('cancelled')` on the same order must be safe (absolute set is naturally idempotent; frozen-stock skip is also idempotent).
- **No silent drops**: non-`applied` results must be returned to the relay — never log-and-return-`applied`.
- Depends on #993 (`ErliOrderSourceAdapter`) being merged (it is, per codebase state).

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/erli/src/`)

**Capabilities Involved**:
- `OrderStatusWriteback` (port: `libs/core/src/orders/domain/ports/capabilities/order-status-writeback.capability.ts`) — already declared on `ErliOrderSourceAdapter`; `write()` body needs implementation.
- `OfferManagerPort.updateOfferQuantity` — the existing absolute-set path reused for the restore.
- `IInventoryQueryService.getAvailabilityByVariantIds` — master-authoritative stock lookup; provided by `@openlinker/core/inventory`.

**Existing Services / Patterns Reused**:
- `ErliOrderSourceAdapter.write()` skeleton and `'dispatched'` branch — already exists.
- `ErliOfferManagerAdapter.updateOfferQuantity()` — handles frozen-stock cache check + PATCH `/products/{id} { stock }`. **Reused via shared reference**: the factory passes the constructed offer manager to the order source so `write('cancelled')` delegates through it.
- `ErliOrderItem.externalId` — the seller-keyed product ID set by OL on offer creation. Because Erli uses `ol_variant_*` IDs as product IDs, `externalId` is simultaneously the Erli offer ID (for `updateOfferQuantity`) and the OL variant ID (for `getAvailabilityByVariantIds`). No identifier mapping step needed.
- `ErliAdapterFactory.createAdapters()` — already constructs both adapters sharing one HTTP client. Extended to also share the offer manager reference and pass `inventoryQuery`.
- Custom NestJS module pattern from `AllegroIntegrationModule` / `PrestashopIntegrationModule` — adopted for `ErliIntegrationModule` to inject `INVENTORY_QUERY_SERVICE_TOKEN`.

**New Components Required**:
- None at the CORE or port level.
- Module boilerplate for custom `ErliIntegrationModule` (small — ~35 LOC).
- Extended factory signature and `ErliOrderSourceAdapter` constructor params.

**Core vs Integration Justification**:
This is purely an Erli-specific mapping of the neutral `{ type: 'cancelled' }` event onto Erli's stock-PATCH API. The relay itself (`OrderLifecycleRelayService`) and the trigger (`OrderIngestionService.handleSourceCancellation`) are already in CORE and require no changes. Adding anything to CORE would violate the "zero platform-type branching" rule of ADR-027.

---

## 4. External / Domain Research

### Erli Order Wire Shape
- `GET /orders/{externalOrderId}` → `ErliOrder` (already used by `getOrder()` in `ErliOrderSourceAdapter`).
- `ErliOrder.items: ErliOrderItem[]` where `item.externalId: string` = the seller-keyed product ID OL set on offer creation. For Erli, offer IDs follow `ol_variant_{32-hex}` — the OL internal variant ID.
- This dual-purpose ID means: `item.externalId` → use directly as both `offerId` (for `updateOfferQuantity`) and `variantId` (for `getAvailabilityByVariantIds`). No extra identifier mapping call.

### Frozen-Stock Interaction (ADR-025 §4b / #1066)
- `ErliOfferManagerAdapter.updateOfferQuantity()` already checks the per-offer frozen-stock cache. If the offer's stock is seller-frozen, it skips the PATCH and logs a warning.
- By delegating through `offerManager.updateOfferQuantity()`, `write('cancelled')` automatically inherits this behavior: frozen-stock offers are skipped silently (not an error — the relay should receive `applied` for the order, with a logged warning per frozen offer).

### Master Inventory (`IInventoryQueryService`)
- `getAvailabilityByVariantIds(variantIds: readonly string[]): Promise<readonly VariantAvailability[]>`
- Zero-fills variants with no inventory rows (`totalAvailable: 0`) — this is the right behavior for stock restore: if OL has no record of stock, set Erli to 0.
- Already wired in `@openlinker/core/inventory` (`InventoryModule` exports `INVENTORY_QUERY_SERVICE_TOKEN`).

### Internal Patterns
- **Reference**: `AllegroIntegrationModule` / `PrestashopIntegrationModule` for custom module pattern with plugin-specific deps.
- **Reference**: `OfferStockRestoreService` (`libs/core/src/listings/application/services/offer-stock-restore.service.ts`) for the same `getAvailabilityByVariantIds` + `updateOfferQuantity` pattern (though it operates at the core service layer, the logic is the same).
- **Reference**: `prestashop-order-processor-manager.adapter.ts` for the `write()` result-return pattern (never throw; return `OrderWritebackResult`).

---

## 5. Questions & Assumptions

### Open Questions
- **Q1**: Does `ErliOrder.items` include cancelled/returned item lines, or only active items? Assumption: all items (no filtering by item status) — restoring all to master inventory is correct regardless.
- **Q2**: If the Erli order is not found (404) when `write('cancelled')` fires — should this be `rejected` or `applied`? Assumption: `rejected` with detail. The relay will surface it to the operator.
- **Q3**: `InventoryModule` is currently imported transitively in the API app. Is it safe to import directly in `ErliIntegrationModule`? Assumption: yes — `InventoryModule` is the standard NestJS module for the inventory bounded context; all feature modules that need it import it.

### Assumptions
- `#993` is fully merged and `ErliOrderSourceAdapter.write()` skeleton is in main (confirmed by codebase state).
- `ErliOrder.items[].externalId` is non-empty for all purchasable products (OL always sets it on offer creation). Items with empty/absent `externalId` are skipped with a debug log (defensive).
- `IInventoryQueryService.getAvailabilityByVariantIds` with unknown variant IDs returns zero-filled rows — this is the documented behavior.
- The `InventoryModule` from `@openlinker/core/inventory` is importable by `ErliIntegrationModule` (NestJS module cross-context imports are allowed; confirmed by architecture overview §Cross-context deps).
- No migration is needed (no schema changes).

### Documentation Gaps
- ADR-025 §4a deferred the stock-restore mechanism but didn't specify the ADR-027 relay path would supersede it. The plan closes that gap as the new canonical approach.

---

## 6. Proposed Implementation Plan

### Phase 1: Factory and Adapter Wiring

**Goal**: Thread `IInventoryQueryService` and the shared offer manager reference into `ErliOrderSourceAdapter` without touching CORE or the plugin-sdk.

---

#### Step 1.1 — Update `IErliAdapterFactory` interface

**File**: `libs/integrations/erli/src/application/interfaces/erli-adapter.factory.interface.ts`

**Action**: Add `inventoryQuery: IInventoryQueryService` as a new parameter to `createAdapters()`. Import `IInventoryQueryService` from `@openlinker/core/inventory`.

```typescript
import type { IInventoryQueryService } from '@openlinker/core/inventory';

export interface IErliAdapterFactory {
  createAdapters(
    connection: Connection,
    identifierMapping: IdentifierMappingPort,
    credentialsResolver: CredentialsResolverPort,
    cache?: CachePort,
    inventoryQuery?: IInventoryQueryService,
  ): Promise<ErliAdapters>;
  // ...
}
```

`inventoryQuery` is optional (`?`) so that existing tests and the connection-tester path (which calls `createHttpClient`, not `createAdapters`) don't break. The order-source adapter handles `undefined` inventoryQuery by returning `'unsupported'` for `'cancelled'` (see Step 1.3).

**Acceptance**: `pnpm type-check` passes. Interface file compiles.

---

#### Step 1.2 — Update `ErliAdapterFactory.createAdapters()`

**File**: `libs/integrations/erli/src/application/erli-adapter.factory.ts`

**Action**: Accept the new `inventoryQuery` param. Construct `ErliOfferManagerAdapter` first (unchanged), then pass it and `inventoryQuery` to `ErliOrderSourceAdapter`.

```typescript
async createAdapters(
  connection: Connection,
  _identifierMapping: IdentifierMappingPort,
  credentialsResolver: CredentialsResolverPort,
  cache?: CachePort,
  inventoryQuery?: IInventoryQueryService,
): Promise<ErliAdapters> {
  const httpClient = await this.createHttpClient(connection, credentialsResolver);
  const config = (connection.config ?? {}) as ErliConnectionConfig;
  const offerManager = new ErliOfferManagerAdapter(
    connection.id,
    ERLI_ADAPTER_KEY,
    httpClient,
    config.defaultDispatchTime,
    cache,
  );
  return {
    offerManager,
    orderSource: new ErliOrderSourceAdapter(
      connection.id,
      httpClient,
      offerManager,      // shared reference so write() inherits frozen-stock logic
      inventoryQuery,
    ),
  };
}
```

**Key**: `offerManager` is constructed before `orderSource` so the shared reference is safe. Both close over the same `IErliHttpClient` instance (unchanged from current behavior).

**Acceptance**: Factory tests still pass; the new `orderSource` constructor accepts the additional params.

---

#### Step 1.3 — Update `ErliOrderSourceAdapter` constructor and `write('cancelled')`

**File**: `libs/integrations/erli/src/infrastructure/adapters/erli-order-source.adapter.ts`

**Action**:

1. Add constructor parameters:
   ```typescript
   constructor(
     private readonly connectionId: string,
     private readonly httpClient: IErliHttpClient,
     private readonly offerManager: OfferManagerPort,
     private readonly inventoryQuery?: IInventoryQueryService,
   ) {}
   ```
   Import `OfferManagerPort` from `@openlinker/core/listings` and `IInventoryQueryService` + `INVENTORY_QUERY_SERVICE_TOKEN` from `@openlinker/core/inventory`.

2. Replace the `write({ type: 'cancelled' })` branch:

   ```typescript
   if (event.type === 'cancelled') {
     return this.restockOnCancellation(event.externalOrderId);
   }
   ```

3. Add private `restockOnCancellation(externalOrderId: string): Promise<OrderWritebackResult>`:

   ```typescript
   private async restockOnCancellation(externalOrderId: string): Promise<OrderWritebackResult> {
     if (!this.inventoryQuery) {
       return {
         outcome: 'unsupported',
         detail: 'Erli stock-restore requires inventoryQuery wiring (not available in this context).',
       };
     }

     let order: ErliOrder;
     try {
       const response = await this.httpClient.get<ErliOrder>(`/orders/${externalOrderId}`);
       order = validateErliOrder(response.data); // reuse existing validator
     } catch (error) {
       const detail = error instanceof Error ? error.message : String(error);
       this.logger.warn(`OrderStatusWriteback 'cancelled': failed to fetch Erli order (connection: ${this.connectionId}): ${detail}`);
       return { outcome: 'rejected', detail: `could not fetch Erli order: ${detail}` };
     }

     const offerIds = order.items
       .map((item) => item.externalId)
       .filter((id): id is string => typeof id === 'string' && ERLI_PRODUCT_ID_PATTERN.test(id));

     if (offerIds.length === 0) {
       this.logger.debug(`OrderStatusWriteback 'cancelled': Erli order has no restorable items (connection: ${this.connectionId})`);
       return { outcome: 'applied' };
     }

     // externalId doubles as OL variant ID (Erli uses ol_variant_* as product IDs)
     const availabilities = await this.inventoryQuery.getAvailabilityByVariantIds(offerIds);
     const stockByOfferId = new Map(
       offerIds.map((id, i) => [id, availabilities[i]?.totalAvailable ?? 0]),
     );

     const errors: string[] = [];
     for (const offerId of offerIds) {
       try {
         await this.offerManager.updateOfferQuantity({
           offerId,
           quantity: stockByOfferId.get(offerId) ?? 0,
         });
       } catch (error) {
         const detail = error instanceof Error ? error.message : String(error);
         this.logger.warn(`OrderStatusWriteback 'cancelled': stock-restore failed for offer ${offerId} (connection: ${this.connectionId}): ${detail}`);
         errors.push(`${offerId}: ${detail}`);
       }
     }

     if (errors.length > 0) {
       return {
         outcome: 'rejected',
         detail: `stock-restore failed for ${errors.length}/${offerIds.length} offer(s): ${errors.slice(0, 3).join('; ')}`,
       };
     }
     return { outcome: 'applied' };
   }
   ```

**Design notes**:
- `ERLI_PRODUCT_ID_PATTERN` is already defined in `erli-offer-manager.adapter.ts`. Extracted to a shared constants file or imported from there (see Step 1.4).
- `validateErliOrder` is reused from the existing `getOrder()` path in `erli-order-source.adapter.ts`.
- Partial failures: if ANY offer fails to restore, return `rejected` so the relay surfaces it to the operator. The relay's "one participant's failure never blocks the others" guarantee only applies across participants, not within one participant's own multi-offer restore.
- Frozen-stock: `offerManager.updateOfferQuantity()` handles the frozen check internally; frozen offers emit a warn log and return void (not an error), so `errors` stays clean for them.
- No PII logged: only `connectionId` and `offerId` (which is an internal OL ID, not buyer info).

**Acceptance**: `write({ type: 'cancelled', externalOrderId: '...' })` no longer returns `'unsupported'`. Unit tests pass (see Phase 3).

---

#### Step 1.4 — Extract `ERLI_PRODUCT_ID_PATTERN` to shared constants (if needed)

**File**: `libs/integrations/erli/src/erli.constants.ts` (or wherever `ERLI_ADAPTER_KEY` lives)

**Action**: Move (or re-export) `ERLI_PRODUCT_ID_PATTERN` from `erli-offer-manager.adapter.ts` to the shared constants file so both `erli-order-source.adapter.ts` and `erli-offer-manager.adapter.ts` can import it without a cross-file relative dep.

If the pattern is already in a shared location (check `erli.constants.ts`), skip this step.

**Acceptance**: No duplicate regex definitions. Both adapter files import from the same source.

---

### Phase 2: Module Wiring

**Goal**: Convert `ErliIntegrationModule` from `createNestAdapterModule` (no custom DI) to a custom NestJS module that injects `INVENTORY_QUERY_SERVICE_TOKEN` and passes it to `createErliPlugin`.

---

#### Step 2.1 — Update `erli-plugin.ts` to accept `inventoryQuery` dep

**File**: `libs/integrations/erli/src/erli-plugin.ts`

**Action**:

1. Add `inventoryQuery: IInventoryQueryService` to the `ErliPluginDeps` type (or the equivalent deps interface). Import from `@openlinker/core/inventory`.

2. In `createCapabilityAdapter`, thread it to the factory:
   ```typescript
   createCapabilityAdapter: async (connection, capability, host) => {
     const factory = new ErliAdapterFactory();
     const adapters = await factory.createAdapters(
       connection,
       host.identifierMapping,
       host.credentialsResolver,
       host.cache,
       deps.inventoryQuery,  // ← new
     );
     return dispatchCapability(capability, { OfferManager: () => adapters.offerManager, OrderSource: () => adapters.orderSource }, 'Erli');
   },
   ```

**Acceptance**: `createErliPlugin({ ..., inventoryQuery })` typechecks. Plugin descriptor carries the dep via closure.

---

#### Step 2.2 — Convert `ErliIntegrationModule` to a custom module

**File**: `libs/integrations/erli/src/erli-integration.module.ts`

**Action**: Replace `createNestAdapterModule(plugin)` with a full custom `@Module` implementing `OnModuleInit`. Model after `AllegroIntegrationModule`.

```typescript
@Module({
  imports: [InventoryModule, ErliWebhookProvisioningModule],
})
export class ErliIntegrationModule implements OnModuleInit {
  private readonly logger = new Logger(ErliIntegrationModule.name);

  constructor(
    @Inject(ADAPTER_REGISTRY_TOKEN) private readonly adapterRegistry: IAdapterRegistryService,
    @Inject(FACTORY_RESOLVER_TOKEN) private readonly factoryResolver: AdapterFactoryResolverService,
    @Inject(INTEGRATIONS_SERVICE_TOKEN) private readonly integrationsService: IIntegrationsService,
    @Inject(IDENTIFIER_MAPPING_SERVICE_TOKEN) private readonly identifierMapping: IIdentifierMappingService,
    @Inject(CREDENTIALS_RESOLVER_TOKEN) private readonly credentialsResolver: CredentialsResolverPort,
    @Inject(INVENTORY_QUERY_SERVICE_TOKEN) private readonly inventoryQuery: IInventoryQueryService,
    // other HostServices fields needed for host bag:
    @Inject(CONNECTION_TESTER_REGISTRY_TOKEN) private readonly connectionTesterRegistry: ...,
    // etc — mirror the fields used in AllegroIntegrationModule.onModuleInit
  ) {}

  onModuleInit(): void {
    const plugin = createErliPlugin({
      inventoryQuery: this.inventoryQuery,
    });
    const host: HostServices = {
      logger: new Logger('Erli'),
      adapterRegistry: this.adapterRegistry,
      factoryResolver: this.factoryResolver,
      identifierMapping: this.identifierMapping,
      credentialsResolver: this.credentialsResolver,
      // ... other host services from @Inject'd fields
    };
    host.adapterRegistry.register(plugin.manifest);
    host.factoryResolver.registerFactory(plugin.manifest.adapterKey, {
      createAdapter: (connection, capability) =>
        plugin.createCapabilityAdapter(connection, capability, host),
    });
    plugin.register?.(host);
  }
}
```

Key imports:
- `InventoryModule` from `@openlinker/core/inventory` (NestJS module — allowed cross-context import for `imports: [...]`).
- `INVENTORY_QUERY_SERVICE_TOKEN`, `IInventoryQueryService` from `@openlinker/core/inventory`.
- All `HOST_*_TOKEN` symbols from their respective barrels (already imported for the webhook provisioning module pattern).

**Note**: The `ErliWebhookProvisioningModule` already injects `@Inject()`'d fields (webhookProvisioningRegistry, connectionPort, etc.). The new custom `ErliIntegrationModule` wraps the full plugin registration in `onModuleInit`, and `ErliWebhookProvisioningModule` can remain as a sub-module handling its own `onModuleInit` registration, OR its logic can be folded into this module. Prefer keeping it separate (matching the current structure — less change surface).

**Acceptance**: `ErliIntegrationModule` compiles; `pnpm start:dev:api` boots without errors; Erli connection creation still works end-to-end.

---

### Phase 3: Tests

**Goal**: Cover all meaningful `write('cancelled')` scenarios with unit tests.

---

#### Step 3.1 — Add `write('cancelled')` unit tests

**File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order-source.adapter.spec.ts`

**Test cases** (test name pattern: `should [expected behaviour] when [condition]`):

1. **`should return applied and restore stock for each line item when order is found`**
   - Mock `httpClient.get('/orders/ord-1')` → `ErliOrder` with 2 items (`externalId: 'ol_variant_aaa...'`, `'ol_variant_bbb...'`)
   - Mock `inventoryQuery.getAvailabilityByVariantIds(['ol_variant_aaa...', 'ol_variant_bbb...'])` → `[{ totalAvailable: 10 }, { totalAvailable: 5 }]`
   - Assert `offerManager.updateOfferQuantity` called twice with correct quantities
   - Assert result: `{ outcome: 'applied' }`

2. **`should return applied with no-op when order has no restorable items`**
   - Order has items with `externalId` in non-`ol_variant_*` format (or absent)
   - Assert `updateOfferQuantity` not called
   - Assert result: `{ outcome: 'applied' }`

3. **`should return rejected when Erli order fetch fails`**
   - Mock `httpClient.get` throws `ErliApiException`
   - Assert result: `{ outcome: 'rejected', detail: expect.stringContaining('could not fetch') }`
   - Assert `updateOfferQuantity` not called

4. **`should return rejected when one offer stock restore fails`**
   - Order with 2 items; second `updateOfferQuantity` throws
   - Assert result: `{ outcome: 'rejected', detail: expect.stringContaining('1/2') }`

5. **`should return unsupported when inventoryQuery is not wired`**
   - Construct `ErliOrderSourceAdapter` without `inventoryQuery` (pass `undefined`)
   - Assert result: `{ outcome: 'unsupported' }`

6. **`should return applied with zero stock when variant has no inventory row`**
   - `getAvailabilityByVariantIds` returns `{ totalAvailable: 0 }` for all variants
   - Assert `updateOfferQuantity` called with `quantity: 0`
   - Assert result: `{ outcome: 'applied' }`

7. **`should not call updateOfferQuantity for items with frozen stock (frozen behavior via mock)`**
   - Mock `offerManager.updateOfferQuantity` to succeed (frozen-stock logic is internal to `ErliOfferManagerAdapter`; at this unit test layer, the mock just returns void — no failure)
   - This is tested at the integration level via `ErliOfferManagerAdapter` tests for frozen-stock. Unit test just verifies the flow.

**Mocking strategy**: Use `jest.Mocked<OfferManagerPort>` for `offerManager` (mock `updateOfferQuantity`). Use `jest.Mocked<IInventoryQueryService>` for `inventoryQuery`. Use `jest.Mocked<IErliHttpClient>` for `httpClient`. No real HTTP or DB.

**Acceptance**: `pnpm test --filter @openlinker/integrations-erli` passes. All new test cases green.

---

### Phase 4: Quality Gate

**Goal**: Ensure the change passes the full repo quality gate before commit.

#### Step 4.1 — Run quality gate

```bash
pnpm lint        # ESLint + check:invariants (cross-context import check)
pnpm type-check  # TypeScript strict check
pnpm test        # All unit tests
```

All three must pass with zero errors before committing.

---

### Implementation Details

**New Components**:
- None at the domain/port level.
- Module boilerplate: `ErliIntegrationModule` converted to custom NestJS module (~40 LOC delta).

**Configuration Changes**:
- No new environment variables.
- No new flags (the `inventoryQuery` dep is always wired when the module boots).

**Database Migrations**: None — no schema changes.

**Events**: No new events. The relay already emits the `OrderLifecycleEvent` via existing `handleSourceCancellation` path.

**Error Handling**:
- Order fetch failure → `rejected` (relay surfaces to operator).
- `updateOfferQuantity` failure for one or more offers → `rejected` with count/detail.
- Missing `inventoryQuery` wiring → `unsupported` (graceful degradation for tests or future plugin contexts that don't provide inventory).
- Frozen stock → `updateOfferQuantity` returns void (handled internally by offer manager); stock restore silently skips frozen offers, returns `applied`.

**Retry behavior**: `updateOfferQuantity` issues a PATCH and retries per the HTTP client's retry config. The relay itself can re-fire on retry (idempotent absolute set — always safe). No additional dedup needed.

---

## 7. Alternatives Considered

### Alternative 1: Add `IInventoryQueryService` to `HostServices` (plugin-sdk)
- **Description**: Extend the `HostServices` bag with `inventoryQuery?: IInventoryQueryService` so all plugins can access it without a custom module.
- **Why Rejected**: ADR-003 explicitly states "Plugin-specific cross-package ports are passed into the descriptor's constructor closure — intentionally not in the host bag, to keep the contract surface lean." Stock-query is currently Erli-specific; widening the host bag for one plugin's use case contradicts this. If multiple plugins later need it, promote it at that point.
- **Trade-off**: Less module boilerplate (skip Step 2.2), but prematurely widens the plugin SDK contract.

### Alternative 2: Keep `write('cancelled')` as `'unsupported'`, rely on `OfferStockRestorer` exclusively
- **Description**: Leave the current `'unsupported'` return as-is. The `OfferStockRestorer` path (#1146 / `restoreStockOnCancellation`) already performs the stock restore on cancellation.
- **Why Rejected**: ADR-027 explicitly rejects method/capability-per-event patterns and mandates the relay path. Having two paths for the same outcome (OfferStockRestorer and relay) risks double-restores and complicates reasoning. The relay is the canonical post-ADR-027 path; the `OfferStockRestorer` path is pre-ADR-027 and this issue is specifically to wire the relay path.
- **Trade-off**: Zero code change. But violates ADR-027's design principle and leaves the relay silently bypassed for Erli (non-`applied` is surfaced as a warn, which is noise without remedy).

### Alternative 3: Add `OrderStatusWriteback` to `ErliOfferManagerAdapter`
- **Description**: Implement `write()` on `ErliOfferManagerAdapter` instead of `ErliOrderSourceAdapter`.
- **Why Rejected**: The relay resolves participants via `OrderProcessorManager` or `OrderSource` capabilities. `ErliOfferManagerAdapter` is resolved as `OfferManager` — the relay never reaches it. This approach requires either adding a new resolution capability to the relay (CORE change) or making `ErliOfferManagerAdapter` also act as `OrderSource` (architectural confusion). Not viable without CORE changes.

### Alternative 4: Implement the full order-item resolution in a dedicated `ErliOrderStatusWritebackAdapter`
- **Description**: Create a new adapter class solely for `OrderStatusWriteback` that combines order fetching, inventory lookup, and stock patching.
- **Why Rejected**: Overkill. `ErliOrderSourceAdapter` already has the order fetch infrastructure (`getOrder`, `httpClient`, validated wire types). Adding two constructor params and one private method is far simpler and keeps the offer-ID-to-variant-ID dual-use intact without a new file.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ No CORE changes (`libs/core/src/` untouched).
- ✅ `OrderStatusWriteback` port already in CORE; this plan only implements it in the integration layer.
- ✅ Cross-context imports: `@openlinker/core/inventory` (barrel) for `InventoryModule`, `IInventoryQueryService`, `INVENTORY_QUERY_SERVICE_TOKEN`; `@openlinker/core/listings` (barrel) for `OfferManagerPort`. Both are barrel-only, allowed by the cross-context rule.
- ✅ `InventoryModule` imported in `ErliIntegrationModule` for `imports: [...]` — NestJS module class cross-context import is explicitly allowed by the architecture overview.

### Naming Conventions
- ✅ New private method: `restockOnCancellation` (camelCase, action-noun pattern).
- ✅ No new files; existing file naming unchanged.

### Existing Patterns
- ✅ `write()` return pattern: matches `PrestashopOrderProcessorManagerAdapter.write()` (never throw; always return `OrderWritebackResult`).
- ✅ Factory param threading: matches how `cache?: CachePort` is already threaded through `createAdapters()`.
- ✅ Custom module pattern: matches `AllegroIntegrationModule` / `PrestashopIntegrationModule`.

### Risks
- **Double restore**: If `OfferStockRestorer` path (#1146) is still active and the relay path fires on the same cancellation, stock may be restored twice in quick succession. Both are absolute sets, so the second is a no-op at the API level (idempotent). Risk: low. Mitigation: document in code; eventual cleanup of the OfferStockRestorer path is a separate issue.
- **Partial restore / partial failure**: If `updateOfferQuantity` fails for one offer in a multi-item order, the relay receives `rejected`. The relay surfaces this to the operator (logs warn). There is no per-offer retry granularity in the relay. Mitigation: individual offer PATCH failures are already retried by the HTTP client's retry budget. Persistent failures leave Erli under-stocked, which is visible via `erli-offer-status-sync`.
- **Module conversion surface**: Switching `ErliIntegrationModule` from `createNestAdapterModule` to a custom module touches module wiring and could regress adapter registration (connection tester, webhook provisioner, etc.). Mitigation: follow `AllegroIntegrationModule` as exact template; run `pnpm test:integration` against the Erli plugin suites.
- **`inventoryQuery` unavailable in worker**: `InventoryModule` must be imported in the Worker app's module graph (via `ErliIntegrationModule`) as well. Verify `apps/worker/src/plugins.ts` includes `ErliIntegrationModule` and that `InventoryModule` is compatible with the Worker's `AppModule`. If not, the order source will get `undefined` inventory query and return `'unsupported'` (graceful degradation per Step 1.3).

### Edge Cases
- **Order with zero items** (empty `items` array): `offerIds` = `[]`; `updateOfferQuantity` not called; return `applied`. Handled.
- **All items have non-OL `externalId`** (e.g. seller set custom IDs): filtered out by `ERLI_PRODUCT_ID_PATTERN` test; `offerIds` = `[]`; return `applied`. Handled.
- **Partial externalId validity** (some items valid, some not): only valid `ol_variant_*` IDs are restored; others silently skipped. Acceptable — non-OL offers are outside OL's inventory management scope.
- **`getAvailabilityByVariantIds` returns fewer rows than requested** (should not happen per docs — zero-fills): Map lookup falls back to `?? 0`; safe.
- **Relay fires twice for the same cancellation** (at-least-once relay delivery): absolute set is idempotent; second fire is a no-op at Erli. Safe.

### Backward Compatibility
- ✅ No change to the CORE relay or ingestion logic.
- ✅ No change to `ErliOfferManagerAdapter` public API.
- ✅ `createAdapters()` signature change is backward-compatible (`inventoryQuery` is optional).
- ✅ `ErliOrderSourceAdapter` constructor change is internal to the factory — no external callers.
- ⚠️ `ErliIntegrationModule` module conversion: external API is unchanged (same module class name, same `forRoot()` if applicable). The internal wiring changes. Integration tests should verify adapter registration still works.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit Tests
**File**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order-source.adapter.spec.ts`

Scenarios (see Phase 3 for full detail):
- `write('cancelled')` happy path: fetches order, restores stock for all `ol_variant_*` items → `applied`
- `write('cancelled')` no restorable items → `applied` (no-op)
- `write('cancelled')` order fetch fails → `rejected`
- `write('cancelled')` one offer stock patch fails → `rejected` with count detail
- `write('cancelled')` `inventoryQuery` not wired → `unsupported`
- `write('cancelled')` zero master stock → `updateOfferQuantity` called with `quantity: 0` → `applied`

Existing tests for `write('dispatched')` must remain green (no regression).

### Integration Tests
No new integration tests required — the unit tests cover the critical paths. The existing Erli integration test suite (if any for `ErliIntegrationModule` boot) should be run to verify module wiring.

### Mocking Strategy
- `OfferManagerPort` mocked via `jest.Mocked<OfferManagerPort>` (not `ErliOfferManagerAdapter` concrete class — always mock ports, not implementations).
- `IInventoryQueryService` mocked via `jest.Mocked<IInventoryQueryService>`.
- `IErliHttpClient` mocked via existing pattern in `erli-order-source.adapter.spec.ts`.

### Acceptance Criteria
- [ ] `ErliOrderSourceAdapter.write({ type: 'cancelled', externalOrderId: '...' })` performs absolute stock set for all `ol_variant_*` line items in the order and returns `{ outcome: 'applied' }` on success.
- [ ] `write('cancelled')` returns `{ outcome: 'rejected' }` when the Erli order is not found or when any offer stock PATCH fails; the relay surfaces this to the operator.
- [ ] `write('cancelled')` returns `{ outcome: 'unsupported' }` when `inventoryQuery` is not wired (graceful degradation).
- [ ] Frozen-stock offers are skipped without triggering a `rejected` outcome (handled internally by `updateOfferQuantity`).
- [ ] `write('dispatched')` branch is unchanged and still functions as before.
- [ ] No core files (`libs/core/src/`) are modified.
- [ ] `pnpm lint` passes with zero errors.
- [ ] `pnpm type-check` passes with zero errors.
- [ ] `pnpm test` passes with all new and existing tests green.
- [ ] `ErliIntegrationModule` boots successfully in the API and Worker apps (manual smoke-test or integration test).

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture — implementation is in the integration layer; CORE relay and ports unchanged.
- [x] Respects CORE vs Integration boundaries — no CORE modifications; `@openlinker/core/*` barrel imports only.
- [x] Uses existing patterns — factory threading pattern (`cache?` → `inventoryQuery?`); custom module pattern (Allegro/PrestaShop reference); `write()` never-throw return pattern.
- [x] Idempotency considered — absolute stock set is idempotent by construction; double-relay is safe.
- [x] Event-driven patterns — the relay path is used; `write()` is the ADR-027 event-as-data dispatch target.
- [x] Rate limits & retries — `updateOfferQuantity` goes through `ErliHttpClient` which has retry config; PATCH calls are idempotent so retries are safe.
- [x] Error handling comprehensive — order fetch failure → `rejected`; partial offer failure → `rejected`; frozen stock → silent skip (no error); missing dep → `unsupported`.
- [x] Testing strategy complete — unit tests for all `write('cancelled')` scenarios defined in Phase 3.
- [x] Naming conventions followed — `restockOnCancellation` (private method); no new exported names.
- [x] File structure matches standards — changes localized to `libs/integrations/erli/src/`; no new files except possibly constants extraction.
- [x] Plan is execution-ready — all file paths, method signatures, and test cases specified; no open blockers.
- [x] No migration needed — no schema changes.

---

## Related Documentation

- [ADR-027: Order status writeback capability & lifecycle relay](../architecture/adrs/027-order-status-writeback-capability-and-relay.md)
- [ADR-025: Erli marketplace adapter](../architecture/adrs/025-erli-marketplace-adapter.md) — §4a deferred stock restore, §4b frozen-stock
- [Architecture Overview — OfferManagerPort sub-capabilities](../architecture-overview.md#offerManagerPort)
- [Architecture Overview — Cross-context dependencies](../architecture-overview.md#cross-context-dependencies-in-core)
- [Engineering Standards](../engineering-standards.md)
- [Testing Guide](../testing-guide.md)
- **Reference implementation**: `libs/core/src/listings/application/services/offer-stock-restore.service.ts` (same `getAvailabilityByVariantIds` + `updateOfferQuantity` pattern)
- **Reference implementation**: `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-order-processor-manager.adapter.ts` (`write()` result-return pattern)
- **Related issues**: #1146 (OfferStockRestorer, pre-ADR-027 path), #993 (ErliOrderSourceAdapter), #1157–#1161 / #1171 (relay shipped)
