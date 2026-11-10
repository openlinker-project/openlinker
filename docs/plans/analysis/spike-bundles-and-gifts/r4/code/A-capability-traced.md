# R4 code / A - Capability system, traced end to end

Angle: how OpenLinker's sub-capability mechanism actually behaves (declaration -> guard -> manifest -> resolution -> call sites -> degrade path -> tests), and what that implies for expressing bundles ("zestawy") and gifts ("gratisy").
Method: primary source only = code in this worktree (`main` @ 9e35aec9d). Every claim is `file:line` + quote. Paths relative to repo root.

## 0. The two gates every sub-capability sits behind (shared mechanics)

**Gate 1 - manifest + `enabledCapabilities`, base capability only.**
`libs/core/src/integrations/application/services/integrations.service.ts:104-117`:
```ts
if (!metadata.supportedCapabilities.includes(capability)) { ... throw new CapabilityNotSupportedException(...) }
if (!connection.enabledCapabilities.includes(capability)) { ... throw new CapabilityNotEnabledException(...) }
```
Listing path, `integrations.service.ts:194-196`:
```ts
const adapterSupports = metadata.supportedCapabilities.includes(filters.capability);
const connectionEnabled = connection.enabledCapabilities.includes(filters.capability);
if (adapterSupports && connectionEnabled) {
```
plus `status: 'active'` unless `includeAllStatuses` (`:169`), and `getAdapter` refuses `disabled`/`archived` (`:68`).

**Gate 2 - the factory dispatch table only knows BASE capabilities.** `libs/plugin-sdk/src/dispatch-capability.ts:75-80`:
```ts
const factory = Object.hasOwn(table, capability) ? table[capability] : undefined;
if (!factory) { throw new Error(`${pluginName} adapter does not support capability: ${capability}. ...`) }
```
So a sub-capability name passed to `getCapabilityAdapter` passes Gate 1 if it is in the manifest and then throws a generic `Error` here.

**Consequence (empirical):** no code path consults `enabledCapabilities` for a sub-capability name. A sub-capability is reached only by: resolve the BASE capability (gated), then narrow with an `is*` guard that probes `typeof method === 'function'`. "Gating" for a sub-capability = gating of its base port + the method existing.

**What "default enabled" puts into `enabledCapabilities`.** `apps/api/src/integrations/application/services/connection.service.ts:996-1004`:
```ts
const defaultCapabilities =
  metadata.defaultEnabledCapabilities !== undefined
    ? metadata.defaultEnabledCapabilities.filter((c) => metadata.supportedCapabilities.includes(c))
    : metadata.supportedCapabilities.includes('InventoryMaster')
      ? metadata.supportedCapabilities.filter((c) => c !== 'OfferManager')
      : [...metadata.supportedCapabilities];
const enabledCapabilities = rest.enabledCapabilities ?? defaultCapabilities;
```
So a sub-capability that IS listed in a manifest is copied into a new connection's `enabledCapabilities` by default (inert data), while the HTTP DTOs refuse it if sent explicitly: `apps/api/src/integrations/http/dto/create-connection.dto.ts:114` `@IsIn(CoreCapabilityValues, { each: true })`.

## 1. Traced precedents

### 1.1 ReceiptLineNameBudget (FiscalizationPort) - a declared VALUE folded by core, with a conservative fallback

| Step | Evidence |
|---|---|
| Interface | `libs/core/src/fiscalization/domain/ports/capabilities/receipt-line-name-budget.capability.ts:21-28` `export interface ReceiptLineNameBudget { getReceiptLineNameMaxLength(): number; }` ("Synchronous and side-effect free: it is read on a settings save.") |
| Guard | same file `:30-36` `return typeof (adapter as Partial<ReceiptLineNameBudget>).getReceiptLineNameMaxLength === 'function';` |
| Manifest | NOT listed. `libs/integrations/eparagony/src/eparagony-plugin.ts` manifest `supportedCapabilities: ['Fiscalization','FiscalRegistrationLocator','Invoicing','RegulatoryStatusReader','CorrectionIssuer']` (lines ~99-105). Guard-only. |
| Implementer | `libs/integrations/eparagony/src/infrastructure/adapters/eparagony-fiscalization.adapter.ts:104` `implements FiscalizationPort, FiscalRegistrationLocator, ReceiptLineNameBudget`; `:113-115` `getReceiptLineNameMaxLength(): number { return EPARAGONY_RECEIPT_LINE_NAME_MAX_LENGTH; }`; constant `libs/integrations/eparagony/src/eparagony.constants.ts:100` `= 40` with the statutory citation at `:86-88` ("Dz.U. 2024 poz. 1654 ... keys it on its first 40 characters"). |
| Resolver (only reader) | `apps/api/src/integrations/application/services/resolve-receipt-line-name-limit.ts:37-40` `listCapabilityAdapters<FiscalizationPort>({ capability: 'Fiscalization', lazy: true })`; `:52-53` `const adapter = (await entry.adapter) as FiscalizationPort; if (isReceiptLineNameBudget(adapter)) declared.push(adapter.getReceiptLineNameMaxLength());`; `:60` `return combineReceiptLineNameLimits(declared);` |
| Pure fold in core | `libs/core/src/sales-documents/domain/types/delivery-line.types.ts:152-161` "The SHORTEST wins ... A declaration that is not a positive whole number is ignored ... Nothing usable declared means the fallback, reported as undeclared." `if (usable.length === 0) return { maxLength: FALLBACK_RECEIPT_LINE_NAME_LENGTH, declared: false };` ; fallback `:113` `= 40`. |
| Call sites | `connection.service.ts:503` (save validation of `config.deliveryOnDocuments`, only when key present `:502`); `apps/api/src/integrations/http/allegro.controller.ts:129` (OAuth connect pre-check); `apps/api/src/sales-documents/http/delivery-line-suggestions.controller.ts:75`. |
| Not implemented | Nothing pushed -> fallback 40, `declared: false`. Construction failure: warn + skip that connection (`resolve-receipt-line-name-limit.ts:54-57`). Listing failure: fallback (`:41-46`). Never throws. |
| enabledCapabilities | Only the base `'Fiscalization'` is gated (via listCapabilityAdapters). The sub name is never checked. A connection with `Fiscalization` disabled contributes nothing -> fallback. |
| Tests | Guard: `receipt-line-name-budget.capability.spec.ts:15,23,28` (declares / base-only / non-callable property). Resolver: `resolve-receipt-line-name-limit.spec.ts:28,35,51,63` (none -> fallback undeclared; shortest wins; skip unconstructable; list failure). Fold: `delivery-line.types.spec.ts:73-88` incl. `combineReceiptLineNameLimits([0, -5, 12.5, Number.NaN, '20', null])`. Adapter: eparagony spec `:110` `expect(isReceiptLineNameBudget(adapter)).toBe(true)`. |

### 1.2 OrderCreateStockEffect (OrderProcessorManagerPort) - an async, probed, per-order BEHAVIOUR claim with a safe default

| Step | Evidence |
|---|---|
| Interface | `libs/core/src/orders/domain/ports/capabilities/order-create-stock-effect.capability.ts:30-38` `lowersStockOnOrderCreate(): Promise<boolean>;` ("Asked after the create, so an adapter may answer from a shop setting it already reads (cached)") |
| Guard | `:40-46` method probe. |
| Probe helper (core-owned degrade) | `:53-60` `if (!isOrderCreateStockEffect(adapter)) return false; try { return (await adapter.lowersStockOnOrderCreate()) === true; } catch { return false; }` - "Anything short of a declared `true` - no method, `false`, a throw or a rejection - answers `false`." |
| Manifest | Not listed in PrestaShop / WooCommerce / Shoper manifests (`*-plugin.ts` `supportedCapabilities`, checked). Guard-only. |
| Implementers | PrestaShop `prestashop-order-processor-manager.adapter.ts:158,226-236` (stateful: `lastCreatedOrder`, "Per instance because core asks the very adapter it created the order with, and a fresh adapter is built per resolution" `:165-168`); WooCommerce `woocommerce-order-processor.adapter.ts:207,252-254` (`return Promise.resolve(this.lastCreateReducedStock === true);`, answered from `_reduced_stock` item meta `:53-59`); Shoper `shoper-order-processor.adapter.ts:158,198-201` (`return context.decrementsStockOnOrder;` from shop setting `shopping_update_stock_on_buy`). No Subiekt implementation (grep empty). |
| Call site | `libs/core/src/orders/application/services/order-sync.service.ts:397` `lowersStock: await lowersStockOnOrderCreate(adapter),` - on the SAME adapter instance that ran `createOrder` (destinations come from `listCapabilityAdapters('OrderProcessorManager')`). Consumer `:511-540` `consumeHoldsAbsorbedByDestinations`: `if (!lowersStock) { this.logger.debug(...'keeps its holds until dispatch'); continue; }` |
| Not implemented | Holds kept until dispatch = under-sell, never oversell (`capability.ts:17-18`). |
| enabledCapabilities | Base `OrderProcessorManager` only. |
| Tests | `order-sync.service.spec.ts:1708-1740` `it.each([['declares nothing', makeAdapter], ['declares it does not lower stock', ...false], ['fails to answer', ...reject]])` -> `expect(masterAbsorbedReservations.consumeAbsorbedHolds).not.toHaveBeenCalled()`; plus per-adapter specs (`prestashop-order-processor-manager.stock-effect.spec.ts`, WC and Shoper adapter specs). |

### 1.3 ReturnSourceReader (OrderSourcePort) - method-bearing, ADVERTISED-without-dispatch, with an optional value member amended later

| Step | Evidence |
|---|---|
| Interface | `libs/core/src/orders/domain/ports/capabilities/return-source-reader.capability.ts:50-99` `listReturnFeed`, `getReturn`, and `readonly terminalRawStatuses?: readonly string[];` (amended by #2330: "Optional on purpose, and the guard is unchanged" `:90-96`). |
| Guard | `:101-108` probes BOTH methods; generic over `T extends object`. |
| Manifest | Listed: `libs/integrations/allegro/src/allegro-plugin.ts:119` `'ReturnSourceReader',` with comment `:111-118` ("listed HERE purely so host-side discovery can tell adapters apart ... NOT in the dispatch table"). |
| Call sites | `libs/core/src/returns/application/services/return-ingestion.service.ts:251-269` `getCapabilityAdapter<OrderSourcePort>(connectionId, 'OrderSource')` then `if (!isReturnSourceReader(adapter)) { ... return null; }`; `:178-184` `throw new ReturnSourceNotReadableError(...)`; `return-status-sync.service.ts:89-99` `const terminalRawStatuses = reader.terminalRawStatuses ?? [];` (empty degrades to age+budget bound); scheduler `libs/integrations/allegro/src/infrastructure/scheduler/allegro-scheduler-tasks.ts:254-258` "requiredCapability: 'OrderSource' and NOT 'ReturnSourceReader'"; webhook routing `libs/core/src/sync/application/services/inbound-routing-policy.service.ts:258-267` "Gated on `OrderSource`, never `ReturnSourceReader`". |
| Not implemented | Sweep: debug + no-op. Per-return job: named error -> handler `apps/worker/src/sync/handlers/marketplace-return-sync.handler.ts:65-74` TERMINAL `business_failure`, "Retrying cannot make an adapter grow a capability". |
| enabledCapabilities | Base `OrderSource` gate is over-permissive (any OrderSource passes), handled at the narrow. |
| Tests | Guard `__tests__/return-source-reader.capability.spec.ts:23-58` (both / only one / base-shaped / empty / non-function / narrowing double) + type-only contract assertions `:76-94`; handler `returns-handlers.spec.ts:158` "TERMINAL business_failure when the connection cannot read returns". |

### 1.4 ModifiedProductLister (ProductMasterPort) - deliberately NOT advertised; gating argued explicitly

| Step | Evidence |
|---|---|
| Interface + guard | `libs/core/src/products/domain/ports/capabilities/modified-product-lister.capability.ts:61` `listExternalIdsModifiedSince(input): Promise<string[]>`; guard `:64-70`. |
| Why not in manifest | same file header: "Guard-only: this name is deliberately NOT in any adapter manifest and NOT in `CoreCapabilityValues` ... a connection's `enabledCapabilities` is stamped at create from the manifest and is never retro-filled, so *gating* on a newly advertised name would silently drain nothing for every connection that already exists ... An advertised name invites exactly that gating, so it is not advertised." |
| Implementers | WooCommerce `woocommerce-product-master.adapter.ts:109,158`; Shoper `shoper-product-master.adapter.ts:65`. |
| Call sites | `apps/worker/src/sync/handlers/master-product-sync-delta.handler.ts:137-156` `getCapabilityAdapter<ProductMasterPort>(job.connectionId, 'ProductMaster')` then `if (!isModifiedProductLister(productMaster)) { this.logger.debug(...); return { outcome: 'ok' }; }`; `libs/core/src/catalog-trust/application/services/catalog-trust.service.ts:96-100` `return isModifiedProductLister(adapter) ? 'modified-since' : 'full-enumeration';` with resolve failure -> `'unknown'` (`:101-110`); scheduler `apps/worker/src/scheduler/scheduler.service.ts:222-230` `capability: 'ProductMaster'`, `defaultEnabled: false`. |
| Not implemented | `outcome: 'ok'`, debug log, nothing enqueued, watermark not moved; trust surface reports `'full-enumeration'` (a declared correct state, not a degradation). |
| Tests | Guard spec `:21,25,34`; handler spec `master-product-sync-delta.handler.spec.ts:112-122` (not implemented -> ok, no enqueue, cursor untouched) and `:124-131` "should resolve the rung by narrowing ProductMaster, never via its own capability name" (`toHaveBeenCalledWith('conn-1','ProductMaster')`). |

### 1.5 Adjacent precedents used in the proposal (not full traces)

- **Manifest VALUE field, not a capability:** `AdapterMetadata.variantGrouping?` `libs/core/src/integrations/domain/types/adapter.types.ts:149-165` ("read directly off the manifest for host/FE discovery, never resolved through `getCapabilityAdapter` (it is not a capability name)"); resolver with most-restrictive default `:328-332` `return metadata?.variantGrouping ?? 'parent-child';`; consumer `libs/core/src/listings/application/services/bulk-listing-submit.service.ts:203-204`; values `woocommerce-plugin.ts:96`, `erli-plugin.ts:94`, `allegro-plugin.ts:132`.
- **Required member on an optional sub-capability, probed + conservative fallback:** `libs/core/src/listings/application/services/description-format-resolution.ts:43,51-59` `return declares(adapter) ? adapter.getDescriptionFormat() : CONSERVATIVE_DESCRIPTION_FORMAT;`.
- **Value-level discovery on a base port:** `libs/core/src/invoicing/domain/ports/invoicing.port.ts:44-50` `getSupportedDocumentTypes(): DocumentType[];` ("Value-level variance, distinct from the method-bearing regulatory sub-capabilities").
- **Guard-only ProductMaster reader feeding a stored product fact:** `master-product-sync.service.ts:441` `if (!isProductTaxRateReader(adapter)) return [];`.
- **Neutral, three-state ORDER fields (source evidence):** `libs/core/src/orders/domain/types/incoming-order.types.ts:93-101` `fulfilledBySource?: true;` ("ABSENT means 'not asserted' ... Typed `true` on purpose"); `:111-118` `buyerNote?: string | null;`; `:182-186` `unitPriceGross?: number;` ("Gross (tax-inclusive) UNIT price as the SOURCE reported it"); totals `libs/core/src/orders/domain/types/order.types.ts:460-465` `discountTotal?: number;` ("The source's own figure ... never derived here").
- **Three-state PRODUCT field from the master:** `libs/core/src/products/domain/entities/product.entity.ts:88-99` `gpsr?: ProductGpsr | null;` ("`undefined` means the master did not report ... and leaves the stored value untouched; `null` means it reported that the product carries none").
- **Document line shape today:** `libs/core/src/invoicing/domain/types/invoicing.types.ts:443-501` `InvoiceLine { name; quantity; unitPriceGross; taxRate; ... productId?; variantId?; orderLineId? }` - no discount / rebate / parent-line field exists.

## 2. Empirical answers

1. **Adapter does not implement** -> in all four traces the base path continues and core picks a pre-declared safe default: fallback number (1.1), "keep holds" (1.2), no-op / terminal non-retry for a single job (1.3), "full-enumeration" (1.4). None throws to the operator. The default is chosen to be the conservative direction (under-sell, shorter name, re-read more).
2. **`enabledCapabilities` gating for sub-capabilities: does not exist.** Only base capabilities are gated (§0). For advertised sub-capabilities (1.3) the name may still land in `enabledCapabilities` via create defaults (§0), where nothing reads it.
3. **Tests pattern:** (a) guard spec with `declares / base-only / non-callable property` cases; (b) consumer spec covering `declares nothing / declares false / throws` (`it.each` in 1.2); (c) "never resolved by its own name" assertion (1.4); (d) pure-fold spec incl. garbage declarations (1.1). The fulfilment kit (`libs/core/src/fulfillment/testing/fulfillment-executor-contract.suite.ts`) is the only one that additionally asserts an optional sub-capability's ABSENCE in both directions; not traced in detail here.
4. **State caveat:** behaviour claims answered per created order (1.2 PS/WC) depend on core asking the SAME adapter instance; any new per-order capability must be called on the instance that performed the act.

## 3. Proposal (grounded only in the traced patterns)

| Concern | Field or capability | Shape | Precedent copied | Default when absent |
|---|---|---|---|---|
| Bundle composition on an incoming order line (source says "this line is a set of X,Y") | FIELD on `IncomingOrderItem` / `OrderItem` | optional, three-state: absent = not asserted, `null` = asserted none, value = components by external ref | `buyerNote?: string \| null` (`incoming-order.types.ts:111-118`), `fulfilledBySource?: true` (`:93-101`) | treat as plain line |
| Bundle composition in the master catalogue (PrestaShop pack, Woo bundle) | FIELD on `Product`/`ProductVariant`, filled by a guard-only ProductMaster reader if an extra read is needed | `components?: ... \| null`, repository keeps `undefined` = leave stored | `Product.gpsr` (`product.entity.ts:88-99`), `isProductTaxRateReader` (`master-product-sync.service.ts:441`), guard-only rationale `modified-product-lister.capability.ts` header | not a bundle |
| Gift / discount evidence | FIELDS, source-reported, never derived | per line: `unitPriceGross` as reported (already exists), plus a typed-true flag `isGift?: true` and a source-reported line discount figure; order: `totals.discountTotal` (exists) | `fulfilledBySource?: true` typed-true (`:93-101`), `discountTotal?` "never derived here" (`order.types.ts:460-465`) | price as reported, no gift claim |
| Master bundle stock policy (does the master itself decrement components when the bundle sells / when a bundle order is created there) | CAPABILITY, guard-only, probed, async, safe default | e.g. `ProductMasterPort`/`OrderProcessorManagerPort` sub-capability returning a closed answer; core helper swallows throw -> safe value | `OrderCreateStockEffect` + `lowersStockOnOrderCreate` helper (`order-create-stock-effect.capability.ts:53-60`); answer-from-shop-setting (`shoper-order-processor.adapter.ts:198-201`) | assume master does NOT decrement components (keep holds = under-sell) |
| Bundle listing support (can this destination list a bundle / needs component mapping) | MANIFEST VALUE FIELD if static per platform; probed method only if it varies per account | `AdapterMetadata.bundleListing?` + `resolveBundleListingModel(metadata)` returning the most restrictive default | `variantGrouping?` + `resolveVariantGroupingModel` (`adapter.types.ts:149-165,328-332`), read via `getAdapter` metadata (`bulk-listing-submit.service.ts:203`) | "not supported" |
| Document rebate rendering (provider can print a discount/rebate/negative line, or only netted unit prices) | CAPABILITY (declared value), ADR-046 shape, folded in core with conservative fallback; plus a NEW `InvoiceLine` field to carry the rebate | `InvoicingPort`/`FiscalizationPort` sub-capability `get...()` returning a closed descriptor; pure core fold; fallback = net into unit price | `ReceiptLineNameBudget` + `combineReceiptLineNameLimits` (`delivery-line.types.ts:152-161`), `CONSERVATIVE_DESCRIPTION_FORMAT` (`description-format-resolution.ts:51-59`); `getSupportedDocumentTypes` (`invoicing.port.ts:44-50`) as the alternative if it is static | netted unit prices (no separate line) |

Rules to carry over, each from a trace: no new `CoreCapabilityValues` entry and no gating on a new name (1.4 header); resolve the base capability, then narrow (1.3 scheduler comment, 1.4 handler spec `:124`); never trust the type, probe the method and catch throws (1.2 `:53-60`); keep the source's raw vocabulary adapter-side and opaque to core (1.3 `terminalRawStatuses` "Core treats it as an OPAQUE set"); a structural "cannot" on a job path is a terminal `business_failure`, not a retry (1.3 handler `:65-74`); ship tests (a)-(d) from §2.3.

## 4. Recommendation

Express bundles/gifts as **data first, capability second**:
- Composition and gift/discount evidence are facts about a specific order/product -> optional three-state fields on the neutral types, filled by adapters, never inferred by core.
- What a platform DOES (master stock behaviour) -> guard-only probed sub-capability with a conservative default, copied from `OrderCreateStockEffect`.
- What a platform CAN SHOW (listing model, document rebate rendering) -> a declared value: manifest field when static (`variantGrouping`), ADR-046 probed declaration + pure core fold + conservative fallback when it depends on connection/device (`ReceiptLineNameBudget`).
- Do not advertise any new sub-capability in manifests unless the FE needs discovery before construction; if advertised, accept that it is copied into `enabledCapabilities` by default and must never be gated on.

## 5. Docs/comments the code contradicts

1. `docs/architecture-overview.md:172`: "PrestaShop, WooCommerce and Subiekt declare nothing yet" (`OrderCreateStockEffect`). Code: PrestaShop implements it (`prestashop-order-processor-manager.adapter.ts:158,226-236`, resolver `prestashop-order-stock-effect.resolver.ts`) and WooCommerce implements it (`woocommerce-order-processor.adapter.ts:207,252-254`). Only Subiekt declares nothing.
2. `integrations.service.ts` lazy-mode comment (~`:213`) "No current lazy caller reads `.adapter`." Code: `resolve-receipt-line-name-limit.ts:52` `const adapter = (await entry.adapter) as FiscalizationPort;` does exactly that.
3. `marketplace-return-sync.handler.ts:67-68` "`ReturnSourceReader` is guard-only and `enabledCapabilities` can never carry it (#2085)". Code: it is in the Allegro manifest (`allegro-plugin.ts:119`) and `connection.service.ts:996-1004` copies the whole manifest into a new connection's `enabledCapabilities` when the caller omits it (Allegro declares no `defaultEnabledCapabilities` - grep empty). It can carry it; it is just never read. ("Guard-only" is also inaccurate for an advertised name; the capability's own docblock says "Advertised-without-dispatch".)
4. `docs/architecture-overview.md:1019` "the closed `CoreCapabilityValues` set grew to ten". Code: `adapter.types.ts:38-79` lists 12 values (adds `AvailabilityAuthority`, `FulfillmentExecutor`). Stale count.
5. Soft tension, not a bug: `receipt-line-name-budget.capability.ts:8` "core never holds the number", yet core's fallback `delivery-line.types.ts:113` is 40, defined as "equals the shortest budget any adapter in this repository declares" (`:106-107`), i.e. today the Polish regime number. Any new rebate-rendering fallback should be a behaviour (net into unit price), not a regime constant.
