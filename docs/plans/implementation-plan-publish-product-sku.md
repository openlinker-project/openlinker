# Implementation Plan — Publish carries the variant SKU (#1485)

## 1. Understand the task

**Goal:** a product published to a shop must carry its OL variant SKU. Today the neutral `PublishProductCommand` has no `sku` field, so `WooCommerceProductPublisherAdapter` sets nothing and every published WooCommerce product comes out with `sku: ""` — breaking SKU-keyed reconciliation / inventory / automation on the shop side.

**Classification:** CORE (domain type + application builder) + Integration (WooCommerce adapter). No new ports, no schema/ORM change, no migration.

**Non-goals (explicitly out of scope):**
- Category-on-publish (`getProductCategories` MVP deferral) — tracked elsewhere.
- Variable-product / variations grouping.
- Threading SKU into marketplace `createOffer` (offer side already carries identifiers via its own path).
- **The PrestaShop `ProductPublisher` is intentionally NOT modified.** It already sets `reference = internalVariantId` and uses that `reference` as its idempotency / orphan-recovery key (`prestashop-product-publisher.adapter.ts:191`, #1107). Mapping the new `cmd.sku → reference` would break PS upsert — the optional field correctly leaves PS untouched (it ignores `cmd.sku`). Whether PS should *additionally* surface the human SKU in a separate field is a **separate follow-up**, not this issue. (See the pre-implement analysis for the full rationale.)

## 2. Research (established facts)

- `PublishProductCommand` — `libs/core/src/listings/domain/types/product-publish.types.ts`. Optional-field convention already in use (`content?`, `parameters?`, `externalProductId?`).
- **Sole construction site:** `ProductPublishBuilderService.buildPublishProductCommand` (`libs/core/src/listings/application/services/product-publish-builder.service.ts:108`). `ProductPublishExecutionService` (single **and** bulk) calls the builder — no other literal builds the command. Fixing the builder covers all publish paths.
- The builder already fetches the variant at line 70: `const variant = await this.productsService.getVariant(input.internalVariantId)`. `IProductsService.getVariant → ProductVariant | null`; `ProductVariant.sku: string | null` (`libs/core/src/products/domain/entities/product-variant.entity.ts:20`).
- WooCommerce wire type `WooCommerceProductPublishRequest` — `.../product-publisher/woocommerce-product-publish.types.ts`. `buildProductBody` (`woocommerce-product-publisher.adapter.ts:110`) assembles the sparse body (spreads `platformParams` first so modelled fields win). WooCommerce product resource natively has a `sku` string field.
- Existing specs to mirror: `product-publish-builder.service.spec.ts` (mocks `getVariant` returning `{ …, sku: null }`) and `.../product-publisher/__tests__/woocommerce-product-publisher.adapter.spec.ts` (`baseCommand()` + body `toMatchObject`).

## 3. Design

Additive, optional, neutral field threaded variant → command → adapter. No platform vocabulary in core (`sku` is a neutral variant field).

```
ProductVariant.sku ──(builder)──▶ PublishProductCommand.sku? ──(WC adapter)──▶ WC products.sku
     string|null        omit when null/empty        string?         set when present
```

## 4. Steps

1. **Domain type** — `product-publish.types.ts`: add `sku?: string` to `PublishProductCommand` with a doc comment (variant-level identifier; publishers that support a SKU field map it, others ignore; absent ⇒ unchanged).
   *AC:* type compiles; field optional.

2. **Builder** — `product-publish-builder.service.ts` (~line 116): add `...(variant.sku ? { sku: variant.sku } : {})` to the command literal. `variant.sku` is `string | null` → only set when a non-empty string (spread-omit convention, matching `content`/`parameters`).
   *AC:* variant SKU threads into the command; `null`/empty variant SKU ⇒ field absent.

3. **WC wire type** — `woocommerce-product-publish.types.ts`: add `sku?: string` to `WooCommerceProductPublishRequest`.
   *AC:* type compiles.

4. **WC adapter** — `woocommerce-product-publisher.adapter.ts` `buildProductBody`: `if (cmd.sku != null) typed.sku = cmd.sku;` (applies to both create + upsert, which share `buildProductBody`).
   *AC:* `sku` written to body when present; omitted when absent.

5. **Tests**
   - Builder spec: add a case with `getVariant` returning a non-null `sku` → asserts `command.sku` equals it; keep/assert the existing `sku: null` mock path yields **no** `sku` key.
   - WC adapter spec: `baseCommand({ sku: 'SKU-1' })` → body `toMatchObject({ sku: 'SKU-1' })` (create); assert `baseCommand()` (no sku) → body has **no** `sku` key; one upsert (PUT) assertion that `sku` is present.
   *AC:* both present + absent branches covered on builder and adapter.

## 5. Validate

- **Architecture:** neutral field in core; adapter maps neutral→wire — no platform term leaks into core. Optional field ⇒ no publisher behavior change (PrestaShop/Shopify publishers, if any, ignore it).
- **Contract surface:** additive optional field on a published domain type — **not** a break (no removed/renamed/newly-required field). No barrel/token/DTO/ORM change ⇒ no migration, no `check:invariants` trip.
- **Testing:** unit only (no vertical slice added). Builder + adapter specs cover present/absent.
- **Pre-implement gate:** **unnecessary** — purely additive optional field, single known builder construction site verified, one adapter, no schema/contract change. Documented here rather than a separate analysis file.
