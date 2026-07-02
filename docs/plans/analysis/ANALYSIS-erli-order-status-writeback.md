# Pre-implement Analysis: Erli `OrderStatusWriteback` — cancelled event → absolute stock restore

**Plan**: `docs/plans/implementation-plan-erli-order-status-writeback.md`
**Issue**: #1198
**Analysed**: 2026-06-25
**Verdict**: ✅ READY

All referenced contracts exist and are confirmed in the live tree. No new ports, tokens, schema changes, or SDK extensions required. Two important code-level corrections needed during implementation (see below) — neither blocks starting.

---

## Phase B — Reuse Audit

| Plan Artifact | Status | File Path |
|---|---|---|
| `OrderStatusWriteback` capability port | **ALREADY EXISTS** | `libs/core/src/orders/domain/ports/capabilities/order-status-writeback.capability.ts` |
| `isOrderStatusWriteback` type guard | **ALREADY EXISTS** | same file; exported from `libs/core/src/orders/index.ts:35` |
| `OrderWritebackResult` / `OrderWritebackOutcome` | **ALREADY EXISTS** | `libs/core/src/orders/domain/types/order-lifecycle-event.types.ts` (outcome values: `applied \| unsupported \| rejected`) |
| `OrderLifecycleRelayService.relay()` | **ALREADY EXISTS** | `libs/core/src/orders/application/services/order-lifecycle-relay.service.ts` |
| `OrderIngestionService.handleSourceCancellation` → calls relay | **ALREADY EXISTS** | `libs/core/src/orders/application/services/order-ingestion.service.ts` |
| `ErliOrderSourceAdapter.write()` skeleton (returns `unsupported` for `cancelled`) | **ALREADY EXISTS** | `libs/integrations/erli/src/infrastructure/adapters/erli-order-source.adapter.ts` |
| `ErliOfferManagerAdapter.updateOfferQuantity()` w/ frozen-stock | **ALREADY EXISTS** | `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts` |
| `ERLI_PRODUCT_ID_PATTERN` | **ALREADY EXISTS** (needs extraction) | `libs/integrations/erli/src/infrastructure/adapters/erli-offer-manager.adapter.ts:126` — NOT yet in `erli.constants.ts` |
| `ErliAdapterFactory.createAdapters()` | **ALREADY EXISTS** (needs extension) | `libs/integrations/erli/src/application/erli-adapter.factory.ts` |
| `IErliAdapterFactory.createAdapters()` | **ALREADY EXISTS** (needs extension) | `libs/integrations/erli/src/application/interfaces/erli-adapter.factory.interface.ts` |
| `erli-plugin.ts` / `createErliPlugin()` | **ALREADY EXISTS** (needs dep added) | `libs/integrations/erli/src/erli-plugin.ts` |
| `ErliIntegrationModule` (currently a `DynamicModule` via `createNestAdapterModule`) | **ALREADY EXISTS** (needs conversion to class) | `libs/integrations/erli/src/erli-integration.module.ts` |
| `ErliWebhookProvisioningModule` (has own `onModuleInit`) | **ALREADY EXISTS** | `libs/integrations/erli/src/erli-webhook-provisioning.module.ts` |
| `IInventoryQueryService` + `getAvailabilityByVariantIds()` | **ALREADY EXISTS** | `libs/core/src/inventory/application/services/inventory-query.service.interface.ts` |
| `INVENTORY_QUERY_SERVICE_TOKEN` | **ALREADY EXISTS** | `libs/core/src/inventory/inventory.tokens.ts:16` |
| `InventoryModule` exports `INVENTORY_QUERY_SERVICE_TOKEN` | **ALREADY EXISTS** | `libs/core/src/inventory/inventory.module.ts` — explicit `exports` array confirmed |
| `VariantAvailability.totalAvailable` | **ALREADY EXISTS** | `libs/core/src/inventory/domain/types/inventory.types.ts` (shape: `{ productVariantId, totalAvailable, locationCount }`) |
| `erli-order-source.adapter.spec.ts` test file | **ALREADY EXISTS** | `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order-source.adapter.spec.ts` |
| Worker's `AppModule` imports `InventoryModule` | **ALREADY EXISTS** | `apps/worker/src/app.module.ts:36` — no new import needed |
| `ErliIntegrationModule` in worker plugins | **ALREADY EXISTS** | `apps/worker/src/plugins.ts:51` |
| `ErliIntegrationModule` in API plugins | **ALREADY EXISTS** | `apps/api/src/plugins.ts:47` |
| `ErliPluginDeps` interface | **ABSENT** | Does not exist; plan hedges with "or equivalent deps interface" — implementer must add the type |

**No reinvention detected.** All ports, tokens, services, and test scaffolding the plan depends on are present. The only genuinely new code is the `write('cancelled')` implementation body, the factory/constructor wiring changes, the module conversion, and the test additions.

---

## Phase C — Backward-Compatibility Checklist

| Surface | Change | Severity | Notes |
|---|---|---|---|
| `IErliAdapterFactory.createAdapters()` signature | New optional `inventoryQuery?` param appended | ✅ OK | Optional parameter, all existing call sites remain valid |
| `ErliOrderSourceAdapter` constructor | Two new params added | ✅ OK | Constructed only inside `ErliAdapterFactory`; no external callers |
| `ErliIntegrationModule` exported shape | `DynamicModule` object → `@Module` class | ✅ OK | Both are valid `PluginEntry` values in the NestJS import array; external API (`import { ErliIntegrationModule }`) unchanged |
| `erli-order-source.adapter.spec.ts` existing test | Line 388: `'reports unsupported for a cancelled event'` | ⚠️ **Warning — must update** | This test currently asserts `unsupported` unconditionally. After implementation `cancelled` returns `applied` (happy path) or `unsupported` only when `inventoryQuery` is missing. The test **must be replaced**, not just added beside. Failure to update it will cause the existing test to fail. |
| `@openlinker/core/*` barrel exports | No changes | ✅ OK | Plan correctly makes zero CORE modifications |
| `OfferManagerPort` / `OrderSourcePort` signatures | No changes | ✅ OK | |
| ORM schema / migrations | No changes | ✅ OK | |
| `check-cross-context-imports` invariant | Imports `@openlinker/core/inventory` barrel + `@openlinker/core/listings` barrel | ✅ OK | Both are top-level barrel imports; allowed cross-context pattern |

---

## Important Corrections (act on these before committing)

### ⚠️ IMPORTANT-1 — Positional indexing in `restockOnCancellation` will silently assign wrong stock

**Where**: Step 1.3, `restockOnCancellation` implementation, line:
```typescript
const stockByOfferId = new Map(
  offerIds.map((id, i) => [id, availabilities[i]?.totalAvailable ?? 0]),  // ← WRONG
);
```

**Problem**: `getAvailabilityByVariantIds` does not guarantee that its output array order matches the input array order. Using positional index `i` to correlate input IDs with output rows can silently assign wrong stock quantities (e.g., item A gets item B's stock).

**Correct approach** — match the reference implementation in `OfferStockRestoreService` (line 113):
```typescript
const availability = await this.inventoryQuery.getAvailabilityByVariantIds(offerIds);
const stockByVariantId = new Map(
  availability.map((row) => [row.productVariantId, row.totalAvailable]),
);
// then: stockByVariantId.get(offerId) ?? 0
```
`VariantAvailability.productVariantId` is the correct key. Since for Erli `offerId === variantId`, `stockByVariantId.get(offerId)` works directly.

### ⚠️ IMPORTANT-2 — Existing `cancelled` test at spec:388 must be updated, not just extended

**Where**: `libs/integrations/erli/src/infrastructure/adapters/__tests__/erli-order-source.adapter.spec.ts:388`

Current test:
```typescript
it('reports unsupported for a cancelled event (Erli has no cancel writeback verb)', async () => {
  const result = await adapter.write({ type: 'cancelled', externalOrderId: ORDER_ID });
  // asserts outcome === 'unsupported'
```

After implementation, this test **will fail** because `write('cancelled')` will perform the stock restore (returning `applied` on success). The plan's Phase 3 lists the `unsupported` scenario only for when `inventoryQuery` is not wired — correct — but does not call out that the existing test at line 388 must be replaced. Replace it with the happy-path test (scenario 1 from Phase 3) and add scenario 5 (`unsupported` when `inventoryQuery` is absent) as a separate test using a different adapter instance constructed without `inventoryQuery`.

---

## Minor Corrections (low-risk, action during implementation)

### W3 — `validateErliOrder` vs `assertErliOrder`
Plan (Step 1.3) references `validateErliOrder(response.data)`. The actual function in `erli-order-source.adapter.ts` is `assertErliOrder()`. Use the correct name.

### W4 — Step 1.4 is mandatory, not conditional
Plan says "If the pattern is already in a shared location (check `erli.constants.ts`), skip this step." It is NOT in `erli.constants.ts` — it's only in `erli-offer-manager.adapter.ts:126`. Step 1.4 must execute.

### W5 — `INTEGRATIONS_SERVICE_TOKEN` in Step 2.2 pseudo-code should be omitted
The plan's Step 2.2 pseudo-code includes `@Inject(INTEGRATIONS_SERVICE_TOKEN)` in the constructor. `AllegroIntegrationModule` does NOT inject `IIntegrationsService` — it's not needed for plugin registration. Including it would add an unnecessary DI dependency. Follow Allegro's actual constructor, not the plan's pseudo-code for this field.

### W6 — `ErliPluginDeps` interface must be created
No such interface exists in `erli-plugin.ts`. The implementer must add it (or add the `inventoryQuery` dep to `createErliPlugin()`'s explicit parameter type) in Step 2.1.

---

## Open Questions Resolved by Live Code

| Plan Question | Resolution |
|---|---|
| Q3: Is it safe to import `InventoryModule` directly in `ErliIntegrationModule`? | **Yes** — `InventoryModule` already imported in `apps/worker/src/app.module.ts` and other worker modules. No circular risk. |
| Is `getAvailabilityByVariantIds` zero-fill guaranteed? | **Yes** — documented in interface file and confirmed in reference implementation comments. |
| Does `InventoryModule` export the token for injection? | **Yes** — explicit `exports` array at line 76-82 includes `INVENTORY_QUERY_SERVICE_TOKEN`. |
| Does worker already include `ErliIntegrationModule`? | **Yes** — `apps/worker/src/plugins.ts:51`. |

---

## Verdict Summary

**READY.** All contracts, tokens, ports, and modules referenced by the plan exist in the live tree. No CORE changes, no migration, no SDK widening. The two **Important** corrections (positional indexing and the existing cancelled test) must be addressed during implementation but do not require replanning — they are code-level corrections to the implementation snippets in the plan, not architectural changes.
