# Implementation Plan: Empik as product and inventory master (#4284)

Part of epic #4273. Stacked on `4279-empik-returns`.

## 1. Goal

Let an Empik connection act as the catalogue and stock source of truth:

- **ProductMaster**: the seller's Empik offers (OF21) are read into OpenLinker
  as products, so they can be listed on Allegro (or any other channel) through
  the existing offer wizard.
- **InventoryMaster**: Empik's offer quantity is the stock OpenLinker mirrors
  and publishes; a sale elsewhere (OMS on, #3453) or a manual correction lowers
  or raises it on Empik through STO01.

Layer: Integration (Mirakl plugin) plus one manifest and one mapper change.
No core change.

### Non-goals

- Images: the spike (2026-11-23) found no media field in OF21 or P31,
  `/api/products/export` answers 403 and the MCM status export carries
  identifiers only. Products are read without images; the operator adds them
  on the destination. Recorded, not worked around.
- Tax rate: Mirakl offers carry no VAT rate. `taxRate` stays unreported
  ("not checked"), which keeps ADR-063 behaviour (documents wait only when
  strict mode is on).
- Writes to the catalogue (create/update/delete product): refused with a
  not-supported error, like Shopify.
- Location / multi-warehouse: positions are pooled.
- Empik decrementing its own stock on an Empik sale is Empik's behaviour and
  not verified on staging (no orders); nothing here depends on it.

## 2. Spike result (step 0)

| Question | Answer |
|---|---|
| Product data in OF21 | `shop_sku`, `product_title`, `product_description`, `product_brand`, `product_references` (EAN), `category_code`/`category_label`, `price`, `quantity`, `active`, `state_code` |
| Images | Not available to the seller (OF21, P31, exports) |
| Stock write | STO01 `offer-sku;quantity`, absolute, async (~5 s on staging) |
| Stock read | OF21 `sku=<shop_sku>` (single) or paged `max/offset` |

## 3. Design

### 3.1 Identity

- One Empik offer = one OL product with one synthetic variant (Empik offers
  have no variants).
- Product external id = `shop_sku` (`CORE_ENTITY_TYPE.Product`); variant
  external id = `shop_sku` too, under `ProductVariant` with
  `parentEntityType: Product` (the Shopify pattern).
- Internal ids via `identifierMapping.batchGetOrCreateInternalIds`.

### 3.2 `MiraklProductMasterAdapter` (new, `infrastructure/adapters/catalog-master/`)

- `getProduct(id)`: resolve `shop_sku` from the mapping, OF21 `sku=`; no
  matching offer -> `MasterProductNotFoundError` (an offer deleted on Empik is
  a master-side deletion, #1599). No mapping -> plugin error (retryable gap).
- `getProducts(filters)`: `externalIds` -> one OF21 read per sku (OF21 has no
  multi-sku filter; bounded by the batch size); otherwise an offset window
  over OF21, `query` filtered client-side on title/sku/EAN.
- `listExternalIds({limit, offset})`: OF21 offset paging, `shop_sku` only.
- `getProductVariants(id)`: the single synthetic variant (sku, EAN, price).
- `getProductCategories(id)`: `[{id: category_code, name: category_label}]`.
- `searchProducts`: delegates to `getProducts`.
- create/update/delete/upsertVariant/assignCategories: throw
  `MiraklNotSupportedException` (new, the not-supported shape core
  already treats as a refusal).
- No `BulkProductReader`: OF21 has no multi-sku filter, so a prefetch could
  not target the page's ids. Instead one `MiraklOfferReader` per adapter build
  remembers each offer it read, so product, variants, categories and stock of
  one product in one job cost one OF21 call.
- Mapping OF21 -> `Product`: name, description (sanitised by core inbound),
  `sku`, `price` gross, `currency`, `categories`, `features.brand` when present,
  no images, no `gpsr` (left `undefined`, i.e. not reported).
- Inactive offers (`active: false`) are still products (zero stock is a
  stock fact, not a deletion).

### 3.3 `MiraklInventoryMasterAdapter` (new, `infrastructure/adapters/catalog-master/`)

- `getInventory` / `listInventory` / `getAvailableQuantity`: OF21 `sku=`
  -> `{quantity, reserved: 0, available: quantity}`, keyed to the synthetic
  variant, pooled. Missing offer -> `MasterProductNotFoundError`.
- `adjustInventory(delta)`: read-then-write, because STO01 is absolute.
  1. Per-sku lock (host `SyncLockPort` from the plugin module, short TTL) so two adjustments
     of one sku never interleave.
  2. Idempotency key already applied (CachePort, 7 days, the WooCommerce /
     PrestaShop #2368 shape) -> `deduplicated`, return current stock.
  3. Current quantity = the pending target remembered in the cache for this
     sku if its STO01 import is not yet complete, else OF21 `quantity`. This
     closes the lost-update window of an async import.
  4. Target = `max(0, current + delta)` (clamped and warn-logged like
     PrestaShop).
  5. One-line STO01 (`/api/offers/stock/imports`), remember
     `{target, importId}` for the sku, record the key AFTER the submit succeeds.
  6. Return the target with `adjustmentOutcome {applied, honoured|unsupported|
     not_requested, appliedAt: null}` (Mirakl reports no instant).
  - A transport failure throws (core records `in_doubt`); a 429 throws the
    rate-limit exception (deferred by the classifier).
  - Known window: an Empik sale landing between the read and the import
    being applied is overwritten. Stated in the adapter header and README.
- `reserveInventory` / `releaseInventory`: throw not-supported (deprecated).

### 3.4 Order mapper

`productRef` is `{type: 'offer', externalId: offer_sku}` today. On a master
connection there is no `Offer` mapping, only `Product`. The order source gets
a `catalogMaster: boolean` setting (true when `ProductMaster` is in the
connection's `enabledCapabilities`) and then emits `{type: 'product',
externalId: offer_sku}`, which `OrderItemRefResolver` resolves to the lone
variant. Default keeps `offer`, so existing connections are unchanged.

### 3.5 Manifest, factory, plugin

- `supportedCapabilities` + `ProductMaster`, `InventoryMaster`.
- `defaultEnabledCapabilities`: the current set (everything except the two
  masters), so a new Empik connection stays a marketplace by default. This is
  required, not cosmetic: InventoryMaster + OfferManager on one connection is
  refused (#1498), so defaulting to the whole manifest would make create fail.
- Factory builds the two new adapters with `host.identifierMapping`,
  `host.cache` and the lock; dispatch table gains both entries.
- No scheduler task: the core master sweeps (`master.product.syncAll`,
  `master.inventory.syncAll`) drive capability-gated connections already.
  Their cadence (20 / 15 min) satisfies "not more often than every few
  minutes"; the STO01 writes are event-driven, one line each.

### 3.6 Web

No web change. The generic connection capabilities panel already lists every
advertised capability and disables InventoryMaster beside OfferManager with
its reason (`capability-metadata.ts`), which is the whole operator step.

## 4. Steps

| # | File(s) | Done when |
|---|---|---|
| 1 | `domain/types/mirakl-offer.types.ts` | OF21 fields used above typed (description, brand, category) |
| 2 | `domain/exceptions/mirakl-unsupported-operation.exception.ts` | not-supported error, non-retryable in classifier |
| 3 | `infrastructure/adapters/catalog-master/mirakl-offer-reader.ts` | shared OF21 read by sku / page with per-instance cache |
| 4 | `.../catalog-master/mirakl-product.mapper.ts` + spec | OF21 -> Product/Variant |
| 5 | `.../catalog-master/mirakl-product-master.adapter.ts` + spec | reads, not-found, refusals, prefetch |
| 6 | `.../catalog-master/mirakl-inventory-master.adapter.ts` + spec | reads, adjust (lock, dedupe, pending target, clamp, STO01), refusals |
| 7 | `mirakl-order.mapper.ts`, order source settings, factory | `product` ref when catalogue master; spec |
| 8 | `mirakl-plugin.ts`, factory interface | manifest, defaults, dispatch; spec |
| 9 | `apps/api/test/integration/empik/empik-master.int-spec.ts` + fake | product sync creates products/variants/stock rows; adjust sends STO01 with the read-then-write target; order on master connection resolves by product ref |
| 10 | README, architecture-overview bullet | docs updated |

## 5. Risks / open questions

1. Lost update between OF21 read and STO01 apply on a concurrent Empik sale
   (accepted, documented; the pending-target cache covers OpenLinker's own
   writes).
2. OF21 has no multi-sku filter; `getProducts({externalIds})` costs one call
   per sku unless a prefetch page covered it. Acceptable at Empik catalogue
   sizes; revisit if a seller has tens of thousands of offers.
3. No staging order exists, so the end-to-end "Allegro sale lowers Empik
   stock" path is covered by the int-spec and by a manual STO01 adjust on
   staging, not by a real sale.
