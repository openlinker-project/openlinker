# Pre-Implement Analysis: PrestaShop ProductPublisher + CategoryProvisioner Adapter

**Plan**: `docs/plans/implementation-plan-prestashop-product-publisher.md`
**Issue**: #1107
**Gate run**: 2026-06-18
**Verdict**: ✅ READY — one plan correction required before coding starts (see §Plan Corrections)

---

## Reuse Audit

All CORE contracts the plan depends on exist and are exported correctly. No plan artifact collides with anything already in the repo.

| Plan Artifact | Status | Location |
|---|---|---|
| `ShopProductManagerPort` | EXISTS — export confirmed | `@openlinker/core/listings` barrel, line 278 |
| `CategoryProvisioner` | EXISTS — export confirmed | `@openlinker/core/listings` barrel, line 279 |
| `isCategoryProvisioner()` type guard | EXISTS — export confirmed | `@openlinker/core/listings` barrel, line 280 |
| `PublishProductCommand` / `PublishProductResult` | EXISTS | `libs/core/src/listings/domain/types/product-publish.types.ts` |
| `ProvisionCategoryCommand` / `ProvisionCategoryResult` | EXISTS | `libs/core/src/listings/domain/types/category-provision.types.ts` |
| `ProductPublishRejectedException` | EXISTS — export confirmed | `@openlinker/core/listings` barrel, line 293 |
| `'ProductPublisher'` in `CoreCapabilityValues` | EXISTS | `libs/core/src/integrations/domain/types/adapter.types.ts:31` |
| `'CategoryProvisioner'` in `CoreCapabilityValues` | EXISTS | `libs/core/src/integrations/domain/types/adapter.types.ts:32` |
| `PrestashopApiException` barrel export | EXISTS | `libs/integrations/prestashop/src/index.ts:42` |
| `PrestashopAuthenticationException` barrel export | EXISTS | `libs/integrations/prestashop/src/index.ts:40` |
| `IPrestashopWebserviceClient` | EXISTS | `libs/integrations/prestashop/src/infrastructure/http/prestashop-webservice.client.interface.ts` |
| `prestashop-product-publish.types.ts` | ABSENT — new file | `infrastructure/adapters/product-publisher/` (to be created) |
| `prestashop-product-publisher.adapter.ts` | ABSENT — new file | `infrastructure/adapters/product-publisher/` (to be created) |
| `prestashop-product-publisher.adapter.spec.ts` | ABSENT — new file | `infrastructure/adapters/product-publisher/__tests__/` (to be created) |
| `productPublisher` in `PrestashopAdapters` | ABSENT — new field | `prestashop-adapter.factory.interface.ts` (to be added) |
| `PrestashopLangField` / `langField` helper | ABSENT — new | (to be created in types file) |

---

## Backward-Compat Findings

All plan modifications are **purely additive**. No existing consumer can break.

| Touch point | Change | Impact |
|---|---|---|
| `PrestashopAdapters` interface | Adds optional `productPublisher?` field | Safe — all existing destructuring patterns unaffected |
| Factory `createAdapters` return | Adds `productPublisher` to the returned object | Safe — callers that don't destructure `productPublisher` are unaffected |
| `prestashopAdapterManifest.supportedCapabilities` | Adds `'ProductPublisher'`, `'CategoryProvisioner'` | Additive — `IntegrationsService` only checks membership, never iterates exhaustively for routing |
| `createCapabilityAdapter` dispatch table | Adds two new capability entries | Additive — existing entries untouched |
| ORM entities | None modified | No migration required |
| Barrel exports (`libs/integrations/prestashop/src/index.ts`) | No new exports required (adapter is internal) | No impact |

---

## Plan Corrections

### C1 — `CategoryProvisioner` needs its own dispatch entry (REQUIRED FIX)

**Plan claim (Phase 4c):**
> "CategoryProvisioner does not need its own dispatch entry — it is a sub-capability of ProductPublisher, narrowed by `isCategoryProvisioner(adapter)` at call sites."

**Actual WooCommerce reference (`woocommerce-plugin.ts`, lines 141–144):**
```typescript
ProductPublisher: () =>
  new WooCommerceProductPublisherAdapter(httpClient, connection),
CategoryProvisioner: () =>
  new WooCommerceProductPublisherAdapter(httpClient, connection),
```

The reference adapter **does** add a `CategoryProvisioner` dispatch entry — it creates a fresh (stateless) instance. Without it, `dispatchCapability` would throw `"{plugin} adapter does not support capability: CategoryProvisioner"` when `IntegrationsService.getCapabilityAdapter(connId, 'CategoryProvisioner')` is called.

**Correction**: In Phase 4c, add both entries to the dispatch table:
```typescript
ProductPublisher: () => adapters.productPublisher,
CategoryProvisioner: () => adapters.productPublisher,
```

The factory builds one instance stored in `adapters.productPublisher`; both dispatch entries return that same reference (unlike WooCommerce which creates two independent instances — either approach is correct since the adapter is stateless, but reusing the factory instance avoids double-construction).

---

## Open Questions

### Q1 — Does `PrestashopAuthenticationException extends PrestashopApiException`?

The `toPublishError` guard in Phase 2 uses:
```typescript
error instanceof PrestashopApiException &&
!(error instanceof PrestashopAuthenticationException) &&
error.statusCode >= 400 && error.statusCode < 500
```

If `PrestashopAuthenticationException` is a subclass of `PrestashopApiException`, the `!(...auth...)` guard is needed to prevent a 401 from being swallowed as a `ProductPublishRejectedException`. If it isn't a subclass, the guard is redundant but harmless. **Either way the logic is safe.** No action required — but confirming the exception hierarchy in `libs/integrations/prestashop/src/domain/exceptions/` during Phase 2 is recommended.

### Q2 — `stock_availables` behaviour with combinations (acknowledged in plan)

The plan targets simple products (one `stock_available` row with `id_product_attribute = 0`). The "take first result" strategy in `updateStock` is safe for the current bulk-flow scope. Noted as a known limitation.

---

## Summary

The plan is structurally sound and all referenced CORE contracts exist. The single required correction is the `CategoryProvisioner` dispatch entry (§C1) — without it the capability will be unreachable at runtime even though it's declared in the manifest. All other plan details align with the codebase and the WooCommerce reference. Implementation can proceed after applying that correction.
