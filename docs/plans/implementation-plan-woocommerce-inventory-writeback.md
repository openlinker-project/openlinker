# Implementation Plan: WooCommerce inventory write-back (#1498)

**Issue**: [#1498](https://github.com/openlinker-project/openlinker/issues/1498) - WooCommerce: propagate inventory to published products (adapter has no OfferManager/stock write-back)
**Branch**: `1498-woocommerce-inventory-writeback`
**Layers**: Integration (WooCommerce adapter) + Worker (propagation fan-out) + Interface (manifest capability, connection-service guard) + Frontend (capability gating)

---

## 1. Understand the task

### Goal

After a master-stock change (sale on another channel, master-catalogue edit), a WooCommerce-published product's `stock_quantity` must reflect the new value. Today WooCommerce is publish-only for inventory: stock is set once at publish time and never updated.

Two coordinated gaps (verified in the live repo):

1. **Adapter gap**: the WooCommerce manifest (`libs/integrations/woocommerce/src/woocommerce-plugin.ts:47-54`) declares no `OfferManager`, and no `updateOfferQuantity` implementation exists in the package.
2. **Fan-out gap**: `InventoryPropagateToMarketplacesHandler` (`apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts:89`) enumerates only `entityType='Offer'` identifier mappings. Shop publish writes a `ShopProduct` mapping (internal **variant** id -> external WC product id, `product-publish-execution.service.ts:148-153`), never an `Offer` mapping - so even a capable adapter would receive zero jobs.

### Non-goals

- No WC `/variations` handling - published WC products are standalone simple products today (variations grouping is a deferred publisher enhancement).
- No SKU-keyed write-back - the `ShopProduct` mapping (external product id) is the canonical OL<->WC link.
- No changes to the `Offer`-mapping branch semantics (stays check-free as today).
- No batch quantity updater (`OfferQuantityBatchUpdater`) - per-offer updates suffice.
- No core-domain (libs/core) contract changes - the neutral `UpdateOfferQuantityCommand` and `OfferManagerPort` are reused as-is.

---

## 2. Research findings (live-repo facts)

| Fact | Where |
|---|---|
| `OfferManagerPort.updateOfferQuantity(cmd)` is the single base-port method | `libs/core/src/listings/domain/ports/offer-manager.port.ts:30` |
| `UpdateOfferQuantityCommand = { offerId, quantity, idempotencyKey? }` | `libs/core/src/listings/domain/types/offer-quantity-update.types.ts` |
| Erli pattern: `updateOfferQuantity` = absolute-set PATCH; no special 404 handling on the quantity path | `erli-offer-manager.adapter.ts:392-411` |
| WC publisher already sends `manage_stock: true, stock_quantity` at publish; `PUT /products/{id}` with `encodeURIComponent` is the established path pattern | `woocommerce-product-publisher.adapter.ts:59,116-117` |
| `IWooCommerceHttpClient.put<T>(path, body)` exists; 404 surfaces as `WooCommerceHttpResponseException` with `statusCode` | `woocommerce-http-client.interface.ts`, `woocommerce-http-response.exception.ts` |
| `toPositiveInt(value, label)` canonical id validator throws `WooCommerceInvalidIdentifierException` on non-numeric ids | `infrastructure/utils/woocommerce-utils.ts:36` |
| ShopProduct mapping: `createMapping(CORE_ENTITY_TYPE.ShopProduct, externalProductId, connectionId, internalVariantId)` - internalId is the **variant** id | `product-publish-execution.service.ts:148-153` |
| `getExternalIds(entityType, internalId)` is cross-connection; each `ExternalIdMapping` carries `connectionId` + `externalId` | `identifier-mapping.port.ts:42` |
| Handler currently **early-returns** when zero `Offer` mappings (`return { outcome: 'ok' }`) - must not short-circuit the new ShopProduct branch | `inventory-propagate-to-marketplaces.handler.ts:91-96` |
| Idempotency key today omits the target id: `inventory:{connectionId}:{productId}:{variant}:{qty}:{token}` - reusing verbatim would dedupe Offer vs ShopProduct updates on the same connection | handler line 113 |
| Worker DI: handlers access connections via `IIntegrationsService` (`INTEGRATIONS_SERVICE_TOKEN`, provided by `IntegrationsModule` imported in `sync-worker.module.ts:51`); `listCapabilityAdapters({ capability, lazy: true })` narrows to connections that support AND enabled a capability without constructing adapters | `integrations.service.interface.ts:82-93` |
| Downstream: `marketplace.offerQuantity.update` handler -> `InventorySyncService.updateOfferQuantity` -> `getCapabilityAdapter('OfferManager')`; adapter throw becomes a failed item -> `SyncJobExecutionError` -> retry-until-dead (unless a retry classifier marks non-retryable). Nothing maps to `business_failure` here | `marketplace-offer-quantity-update.handler.ts`, `inventory-sync.service.ts:46-85` |
| `ConnectionService.create` defaults `enabledCapabilities` to the **full** manifest set; create/update validate subset-of-supported only - no combination rules exist | `connection.service.ts:223-231,398-406` |
| FE surfaces gating on manifest `supportedCapabilities.includes('OfferManager')`: `products-list-page.tsx:81`, `OfferCreationLauncher.tsx:62`, `bulk-config-step.tsx:50` (marketplace-picker-modal inherits its filtered prop); `TriggerSyncDialog.tsx` gates `marketplace.offers.sync` and `marketplace.orders.poll` on `requiredCapability: 'OfferManager'` | see files |
| Precedent: manifests already carry finer sub-capability names in `supportedCapabilities` - Allegro declares `CategoryBrowser`, `EanCategoryMatcher` (`allegro-plugin.ts:87-93`); the #1367 bulk-wizard param step gates on `supportedCapabilities.includes('CategoryBrowser')` | `allegro-plugin.ts` |
| `CoreCapabilityValues` (closed DTO set) does NOT include sub-capability names; connection create/update DTOs are `@IsIn(CoreCapabilityValues)` on `enabledCapabilities` - same accepted state as `CategoryBrowser` today | `adapter.types.ts:22-36`, `create-connection.dto.ts:114` |

---

## 3. Design

### 3.1 WooCommerce `OfferManager` adapter (Integration layer)

New `WooCommerceOfferManagerAdapter implements OfferManagerPort` - quantity write-back only (no `OfferCreator`, `OfferLister`, etc.). The `offerId` in the neutral command is the external WC product id carried by the `ShopProduct` mapping.

```
updateOfferQuantity(cmd):
  productId = toPositiveInt(cmd.offerId, 'WooCommerce product id')   // fail-closed id validation
  quantity  = validated non-negative integer                          // fail-closed on NaN/negative/fraction
  try:
    PUT products/{productId}  body { manage_stock: true, stock_quantity: quantity }
  catch WooCommerceHttpResponseException(404):
    warn + return                                                     // stale ShopProduct mapping -> clean skip
  // 401/403 (WooCommerceUnauthorizedException) and network errors propagate:
  // auth-failure classifier + runner retry own those policies.
```

Decisions:
- **Id validation**: `toPositiveInt` (existing canonical helper) rules out path traversal into other WC REST routes - the job payload is reachable via admin `POST /sync/jobs` with an arbitrary `offerId`. Belt-and-braces `encodeURIComponent` on the interpolated value, matching the publisher.
- **404 = clean skip** (AC): nothing deletes a `ShopProduct` mapping when the product is removed shop-side, so `PUT /products/{id}` could 404 forever. A skip (warn log, resolve) prevents a retry-to-dead job on every stock change. This is adapter-local policy - the neutral command has no "target gone" result channel, and `InventorySyncService` treats any throw as a failed item -> job failure.
- **`manage_stock: true` re-assertion**: per the issue, a product whose managed-stock flag was flipped off shop-side becomes managed again on the next write (documented authority model: master wins).

Registration: add `'OfferManager'` to `woocommerceAdapterManifest.supportedCapabilities` + an `OfferManager:` arm in the `dispatchCapability` table.

### 3.2 Worker fan-out: second branch over `ShopProduct` mappings

`InventoryPropagateToMarketplacesHandler` changes:

1. **New dependency**: `@Inject(INTEGRATIONS_SERVICE_TOKEN) IIntegrationsService` (already provided in worker DI).
2. **Restructure**: the zero-`Offer`-mappings early return must become branch-local so the ShopProduct branch still runs.
3. **ShopProduct branch** (runs only when `payload.variantId` is present - `ShopProduct` mappings are variant-keyed; legacy product-level rows with `variantId = null` skip the branch, acceptable since master inventory is variant-keyed since #822/#823):
   - `getExternalIds(CORE_ENTITY_TYPE.ShopProduct, variantId)`.
   - If non-empty: one `listCapabilityAdapters({ capability: 'OfferManager', lazy: true })` call builds the eligible-connection set:
     - connection has `OfferManager` enabled (per-connection `enabledCapabilities` - avoids enqueueing guaranteed-fail jobs for publish-only connections), **and**
     - connection does NOT have `InventoryMaster` enabled (**authority guard, runtime + authoritative**: the write-back must never target the inventory-master connection).
   - For each mapping whose `connectionId` is eligible, enqueue `marketplace.offerQuantity.update` with `offerId = mapping.externalId` and quantity = the same `availableQuantity`.
4. **Idempotency key**: the ShopProduct branch appends a branch discriminator + external id:
   `inventory:{connectionId}:{productId}:{variant}:{qty}:{token}:shop:{externalId}` - the current scheme omits the target id, so reusing it verbatim would dedupe an Offer update against a ShopProduct update for the same connection/variant/quantity. The Offer branch key stays byte-identical (no re-delivery churn on deploy).
5. **Policy comment update** (lines 102-109): the "capability check at enqueue time would duplicate that policy" comment stays true for the Offer branch (offers only exist on marketplace connections); the ShopProduct branch documents why it differs (most shop connections are publish-only - unconditional enqueue would produce failing jobs by default).

Offer branch behavior is unchanged (check-free, same key).

### 3.3 Connection management: default-off + mutual-exclusion guard (Interface layer)

`ConnectionService` (apps/api):

- **Write-back defaults off** (issue's recommended option): when `create()` defaults `enabledCapabilities` from the manifest, exclude `'OfferManager'` when the manifest set also contains `'InventoryMaster'`. Platform-neutral rule ("an inventory-master-capable shop must opt in to write-back"); today only WooCommerce matches. Preserves the "publish-only unless the operator asks" posture and keeps the default set self-consistent with the guard below. Marketplace manifests (Allegro, Erli - no `InventoryMaster`) are unaffected.
- **Advisory guard**: `create()` and `update()` reject an explicit `enabledCapabilities` containing BOTH `'InventoryMaster'` and `'OfferManager'` with `BadRequestException` (clear message naming the conflict). Advisory only - the runtime fan-out guard (3.2) is the source of truth. The FE capabilities panel surfaces the backend error via the existing mutation-error display (verify during implementation; add error rendering only if missing).

### 3.4 Frontend gating: keep WC out of marketplace-only offer flows

Adding `'OfferManager'` to the WC manifest would otherwise surface WooCommerce in offer-creation flows, because those gate on **manifest-level** `supportedCapabilities` (which per-connection `enabledCapabilities` does not protect). Per-surface decisions (issue AC):

| Surface | Current gate | New gate | Rationale |
|---|---|---|---|
| `products-list-page.tsx:81` (create-offers action -> MarketplacePickerModal) | `OfferManager` | `OfferCreator` | Offer creation needs `OfferCreator`; WC won't declare it |
| `OfferCreationLauncher.tsx:62` | `OfferManager` | `OfferCreator` | same |
| `bulk-config-step.tsx:50` | `OfferManager` | `OfferCreator` | same |
| `marketplace-picker-modal.tsx` | none (inherits filtered prop) | none | no change |
| `TriggerSyncDialog` - `marketplace.offers.sync` | `OfferManager` | `OfferEventReader` | Only Allegro has the offer-event journal; Erli/WC no-op via the #1096 reconciliation-first skip - removing the trigger for both kills the noise |
| `TriggerSyncDialog` - `marketplace.orders.poll` | `OfferManager` | `OrderSource` | It's an order-ingestion job; gating on `OrderSource` is the semantically correct capability. WC/PrestaShop gain a *working* manual trigger (their schedulers already run this job type), Allegro/Erli keep it |

Enabler: add `'OfferCreator'` to the Allegro and Erli manifests and `'OfferEventReader'` to the Allegro manifest. This follows the established precedent (Allegro already declares `CategoryBrowser` / `EanCategoryMatcher`; the #1367 bulk-wizard gate consumes them the same way). Side effects considered:
- New Allegro/Erli connections get these names in default `enabledCapabilities` - harmless: nothing dispatches `getCapabilityAdapter('OfferCreator')` (call sites resolve `OfferManager` and narrow via the `isOfferCreator` guard), identical to `CategoryBrowser` today.
- `CoreCapabilityValues` DTO strictness: unchanged state - `CategoryBrowser` already lives outside the closed set without breaking connection updates.

Backend schedulers are NOT at risk (verified in issue: core `CORE_CAPABILITY_TASKS` has no `OfferManager` task; Allegro's offer-sync tasks are platformType-scoped).

### 3.5 Authority model (documented, not new code)

Master inventory wins, last-write-wins. Shop-side stock edits or sales on a published WC product are overwritten on the next master change. The layered guard: (a) runtime fan-out skip of `InventoryMaster`-enabled connections (authoritative), (b) create/update rejection of the capability combo (advisory), (c) FE surfaces the backend error (not enforcement).

---

## 4. Step-by-step implementation plan

### Step 1 - WooCommerce OfferManager adapter
**Files**:
- `libs/integrations/woocommerce/src/infrastructure/adapters/offer-manager/woocommerce-offer-manager.adapter.ts` (new)
- `libs/integrations/woocommerce/src/infrastructure/adapters/offer-manager/__tests__/woocommerce-offer-manager.adapter.spec.ts` (new)

**Acceptance**:
- Implements `OfferManagerPort` only; ctor `(httpClient: IWooCommerceHttpClient, connection: Connection)` matching sibling adapters.
- `updateOfferQuantity` sends `PUT products/{id}` with `{ manage_stock: true, stock_quantity }`; id validated via `toPositiveInt` + `encodeURIComponent`; quantity validated as a non-negative integer (fail closed).
- 404 (`WooCommerceHttpResponseException.statusCode === 404`) -> warn log + resolve (clean skip). 401/403 and network exceptions propagate untouched.
- Specs: happy-path body/path, `manage_stock` flag, non-numeric id throws before any HTTP call, negative/NaN quantity throws, 404 resolves without throw, 500 propagates, unauthorized propagates.

### Step 2 - Manifest + dispatch registration
**Files**:
- `libs/integrations/woocommerce/src/woocommerce-plugin.ts`
- `libs/integrations/woocommerce/src/__tests__/woocommerce-plugin.spec.ts`

**Acceptance**: manifest `supportedCapabilities` includes `'OfferManager'`; `dispatchCapability` table gains an `OfferManager:` arm returning the new adapter; plugin spec asserts both.

### Step 3 - Worker dual fan-out
**Files**:
- `apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts`
- `apps/worker/src/sync/handlers/__tests__/inventory-propagate-to-marketplaces.handler.spec.ts`

**Acceptance**:
- Injects `INTEGRATIONS_SERVICE_TOKEN`; module wiring already provides it (verify the handler's provider registration needs no module change).
- Offer branch byte-identical behavior (same key, no checks).
- ShopProduct branch: variant-keyed only; skips when `variantId` null; enqueues per eligible mapping with `:shop:{externalId}`-suffixed idempotency key; skips connections without `OfferManager` enabled; skips connections with `InventoryMaster` enabled regardless of `OfferManager`.
- Policy comment updated.
- Specs: Offer-only, ShopProduct-only, both (distinct keys on same connection), neither, capability-disabled skip, InventoryMaster-enabled skip, null-variant skips ShopProduct branch, `listCapabilityAdapters` not called when zero ShopProduct mappings.

### Step 4 - ConnectionService default-off + guard
**Files**:
- `apps/api/src/integrations/application/services/connection.service.ts`
- its spec file

**Acceptance**:
- Defaulted `enabledCapabilities` excludes `'OfferManager'` when manifest also declares `'InventoryMaster'`.
- Explicit create/update with both -> `BadRequestException` naming the conflict.
- Existing behavior for marketplace manifests unchanged (regression specs).

### Step 5 - FE gating
**Files**:
- `libs/integrations/allegro/src/allegro-plugin.ts` (+ spec) - add `'OfferCreator'`, `'OfferEventReader'`
- `libs/integrations/erli/src/erli-plugin.ts` (+ spec) - add `'OfferCreator'`
- `apps/web/src/pages/products/products-list-page.tsx`
- `apps/web/src/features/listings/components/OfferCreationLauncher.tsx`
- `apps/web/src/features/listings/components/bulk/bulk-config-step.tsx`
- `apps/web/src/features/sync-jobs/components/TriggerSyncDialog.tsx`
- affected FE tests

**Acceptance**: per the table in 3.4; existing Allegro/Erli behavior in those surfaces unchanged; a WC connection (even with `OfferManager` enabled) never appears in offer-creation pickers; TriggerSyncDialog on a WC connection shows `marketplace.orders.poll` but NOT `marketplace.offers.sync`.

### Step 6 - Docs
**Files**:
- `docs/architecture-overview.md` (OfferManagerPort "Current Implementations" + WooCommerce quantity-only note)
- `docs/capabilities.md` (if it inventories per-adapter support)

### Step 7 - Quality gate + E2E note
- `pnpm lint && pnpm type-check && pnpm test` (scoped runs first per resource constraints, full gate before PR).
- Live E2E (AC "verified end-to-end") requires the demo stack + a published WC product - executed post-merge or on request; the PR documents the manual verification path (enable `OfferManager` on the WC connection, disable `InventoryMaster`, change master stock, observe `stock_quantity`).

---

## 5. Validation

- **Architecture**: neutral `UpdateOfferQuantityCommand` only; no WooCommerce vocabulary in core; no core -> integration imports; adapter in `infrastructure/adapters/`; capability strings open at the registry boundary (#576).
- **Naming**: `WooCommerceOfferManagerAdapter` = `{Platform}{Capability}Adapter`; file `woocommerce-offer-manager.adapter.ts`.
- **Security**: `toPositiveInt` + `encodeURIComponent` close the path-traversal AC; no credentials logged.
- **Testing**: unit specs per package (adapter, plugin, handler, connection service, FE); no integration-test schema changes; no migration (no ORM change).
- **Risks**:
  - `listCapabilityAdapters(lazy)` semantics (skips disabled connections?) - verify in implementation; the eligible-set filter must not throw on a disabled connection.
  - FE tests may pin the old `OfferManager` gate strings - update alongside.
  - The `marketplace.orders.poll` re-gate widens the trigger to PrestaShop/WC connections - verify the generic poll handler accepts those connections (their schedulers already enqueue this job type).
