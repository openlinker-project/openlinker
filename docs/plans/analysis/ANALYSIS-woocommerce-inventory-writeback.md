# Pre-implement Analysis: WooCommerce inventory write-back (#1498)

**Plan**: `docs/plans/implementation-plan-woocommerce-inventory-writeback.md`
**Gate run**: 2026-07-13, against branch `1498-woocommerce-inventory-writeback` (= origin/main @ 6d2ceaf7)

## Verdict: **READY**

No reuse collisions, no contract-surface breaks. All plan assumptions verified against the live tree.

---

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `WooCommerceOfferManagerAdapter` | **NEW (confirmed absent)** | zero `OfferManager` hits in `libs/integrations/woocommerce/src/**` (non-test); no `updateOfferQuantity` in the package |
| `OfferManagerPort` / `UpdateOfferQuantityCommand` | **EXISTS -> reuse (no change)** | `libs/core/src/listings/domain/ports/offer-manager.port.ts:30`; `libs/core/src/listings/domain/types/offer-quantity-update.types.ts` |
| `IWooCommerceHttpClient.put` | **EXISTS -> reuse** | `infrastructure/http/woocommerce-http-client.interface.ts:45` |
| `toPositiveInt` id validator | **EXISTS -> reuse** | `infrastructure/utils/woocommerce-utils.ts:36` (throws `WooCommerceInvalidIdentifierException`) |
| `WooCommerceHttpResponseException` (404 detection) | **EXISTS -> reuse** | `infrastructure/http/woocommerce-http-response.exception.ts` (`statusCode` field) |
| ShopProduct fan-out in propagate handler | **NEW (confirmed absent)** | only consumers of `CORE_ENTITY_TYPE.ShopProduct` are the publish services (`product-publish-execution.service.ts`, `product-publish-builder.service.ts`, `bulk-shop-publish-submit.service.ts`) + `shop-product-publish.handler.ts` — no existing quantity/stock fan-out over ShopProduct mappings anywhere |
| `IIntegrationsService` in worker handler | **EXISTS -> reuse (new injection only)** | handler is a plain `@Injectable` provider (`sync-worker.module.ts:65`); `IntegrationsModule` already imported (`sync-worker.module.ts:51`) — `INTEGRATIONS_SERVICE_TOKEN` resolvable with **no module change** |
| `listCapabilityAdapters({ lazy })` eligibility filter | **EXISTS -> reuse, semantics verified** | `integrations.service.ts:143-230`: lists **active** connections only; filters `metadata.supportedCapabilities.includes(cap) && connection.enabledCapabilities.includes(cap)`; per-connection try/catch skips broken registrations; `lazy` defers adapter construction entirely when only `.connection` is read — exactly what the fan-out needs (no credential resolution at enqueue time) |
| ConnectionService default/guard | **PARTIAL (extend existing)** | default at `connection.service.ts:223`; subset-of-supported validation at 225-231 (create) and 398-406 (update); **no combination rule exists** — the InventoryMaster+OfferManager mutual-exclusion is new logic in the same method |
| Manifest sub-capability names in `supportedCapabilities` | **EXISTS -> precedent confirmed** | Allegro already declares `CategoryBrowser`, `EanCategoryMatcher` (`allegro-plugin.ts:87-93`); `OfferCreationLauncher.tsx:57` even carries a comment anticipating `OfferCreator` capability metadata |
| FE gates to change | **EXISTS, exact locations verified** | `products-list-page.tsx:81`, `OfferCreationLauncher.tsx:62`, `bulk-config-step.tsx:50` (all `supportedCapabilities.includes('OfferManager')`); `TriggerSyncDialog.tsx` `ALL_TRIGGERABLE_JOBS`: `marketplace.offers.sync` + `marketplace.orders.poll` both `requiredCapability: 'OfferManager'`; `inventory.propagateToMarketplaces` already re-gated to `InventoryMaster` (#1474) — untouched by this plan |

## Backward-compatibility findings

| Surface | Finding | Severity |
|---|---|---|
| Top-level barrels | No exports removed/renamed. New adapter is plugin-internal (not barrel-exported, matching sibling WC adapters). | none |
| Port signatures | `OfferManagerPort` unchanged; WC adapter adds an implementation only. | none |
| DTO shapes | No DTO field changes. New `BadRequestException` on a previously-accepted `enabledCapabilities` combination (`InventoryMaster`+`OfferManager`) is unreachable today for any existing adapter (no manifest declares both until this change lands atomically with it). | none |
| Symbol tokens | None added/removed/renamed. | none |
| ORM schema | No entity change -> **no migration**. | none |
| Idempotency keys | Offer-branch key byte-identical; ShopProduct branch introduces a NEW key shape (`...:shop:{externalId}`) — additive, no dedup collision with in-flight jobs. | none |
| `check:invariants` | New files import only top-level barrels (`@openlinker/core/listings`, `@openlinker/core/integrations`, `@openlinker/core/identifier-mapping`); adapter implements a `*Port` (satisfies service-interface rule N/A — it's an adapter); no cross-context deep imports. | none |
| Manifest additions (`OfferCreator`, `OfferEventReader` on Allegro; `OfferCreator` on Erli) | Additive. Default `enabledCapabilities` for NEW Allegro/Erli connections gains these names — same already-accepted state as `CategoryBrowser` (outside `CoreCapabilityValues`, nothing dispatches them via `getCapabilityAdapter`). Existing connections keep their snapshot: **existing Allegro/Erli connections will NOT have `OfferCreator` in `enabledCapabilities`** — irrelevant, because all changed FE gates read `supportedCapabilities` (manifest-derived), not `enabledCapabilities`. Verified each of the 4 surfaces reads `supportedCapabilities`. | none |
| TriggerSyncDialog re-gates | `marketplace.orders.poll` widens from Allegro/Erli to any `OrderSource` connection (WC, PrestaShop) — their schedulers already enqueue this job type, so the manual trigger exercises an existing, working path. `marketplace.offers.sync` narrows to `OfferEventReader` (Allegro-only): Erli loses a trigger that no-ops via the #1096 reconciliation-first skip — intended cleanup. | Warning (behavior widening/narrowing, intended per issue AC) |

## Open questions

1. **None blocking.** One implementation-time verification retained from the plan: FE tests pinned to the old `'OfferManager'` gate strings must be updated alongside (grep during Step 5).
2. FE capabilities panel error surfacing for the new `BadRequestException` — verify the existing mutation-error display renders it (plan already scopes this as verify-first, add-only-if-missing).
