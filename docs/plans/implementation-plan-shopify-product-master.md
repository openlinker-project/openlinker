# Implementation Plan: Shopify ProductMaster - catalogue, variants, categories, delta sync (#3975)

Stacked on #3974 (Shopify plugin foundation, PR #4042), which is not merged yet:
this branch starts from `3974-shopify-plugin-foundation` and its PR targets it.

## 1. Task

Shopify as product master (role A). Implement `ProductMasterPort` in
`libs/integrations/shopify` so the catalogue (products, variants, gross prices,
EAN, SKU, weight, images, taxonomy categories) replicates into OpenLinker and
stays current through the delta pass, plus the guard-only rungs
`ModifiedProductLister`, `BulkProductReader` and `ProductTaxRateReader`.

Layer: Integration / infrastructure. No core change is planned.

### Non-goals

- Webhooks (`products/*` push) - a separate issue.
- InventoryMaster, ProductPublisher, OrderSource, OrderProcessorManager - their own issues.
- Product writes (`createProduct`, `updateProduct`, ...): refused with `ShopifyNotSupportedException`.
- Multi-location: one location, as in the foundation.
- Gross-up of a tax-EXCLUSIVE shop's net prices (see decisions).

## 2. Research findings

Prototype (`3928-shopify-prototype`, reference only) - files re-read:
`shopify-product-master.adapter.ts`, `shopify-product.reader.ts`,
`shopify-product.queries.ts`, `shopify-product.mapper.ts`, `shopify-external-id.ts`.
Spike: `SPIKE-3928-shopify-capabilities.md`, `SPIKE-3928-run2-evidence.md`.

| Case | Live result | What it means here |
|---|---|---|
| A05 | price 249, compareAtPrice 299; OL took 249 | decision below |
| A09 | price change picked up by the sweep | per-product read |
| A10 | `productDelete` -> `master_deleted`, variant stale | `product: null` -> `MasterProductNotFoundError` |
| A11 | DRAFT not carried, product stays sellable | decision below |
| A13 | cdn.shopify.com URLs served through `/products/:id/images/0` | no extra work |
| A15 | leaf + ancestors on `Product.categories`; parent mapping resolves | mapper as prototype |
| A16 | 1000 products, sweep 500/run in batches of 100 | bulk prefetch + cursor checkpoint |
| A17 | gift cards | decision below |
| A19 / L-M2 | variant price edit bumps only `variant.updatedAt`; Shopify clock 14 s behind | union + 15 s pull-back |
| L-M1 | search index lags writes 5-10 s | direct reads (`product(id)`, `nodes(ids)`) for hydration |
| L-T2 / L-T4 | no stored tax rate; `draftOrderCalculate` returns `taxLines` | computed `ProductTaxRateReader` |

Core contracts read: `ProductMasterPort` (incl. optional `getCategories`),
`ModifiedProductLister`, `BulkProductReader` (prefetch only, an id the master no
longer has stays unwarmed), `ProductTaxRateReader` + `TaxRateResolution`
(`unknown` is never `'0'`; `unreadable` is not persisted; core reads the rate on
every product sync, per variant only when `readsTaxRatePerVariant()`).

Pattern: Shoper `ShoperProductMasterAdapter` (same three rungs, window over a
paged API, per-instance memo, prefetch that never throws).

### Shopify API (2026-10), checked against shopify.dev

| Point | Reference says | Change from the prototype |
|---|---|---|
| Query cost | one query may not exceed 1000 points; the per-connection formula is no longer published (the old rule was `2 + first x node`, nested multiplied) | prototype's `variants(first:250)` with `media(first:5)` per variant is ~4300 by the old rule. Now: `variants(first:50)` with `media(first:1)`, further variants read page by page; bulk reads halve the batch on `MAX_COST_EXCEEDED` |
| `Product.category` | `TaxonomyCategory { id name fullName ancestorIds }` | none |
| `Product.status` | `ACTIVE ARCHIVED DRAFT UNLISTED` (`UNLISTED` since 2025-10) | read now (decision 2) |
| `Product.isGiftCard` | `Boolean!`; `gift_card:` filter on `products` and `productVariants` | read now (decision 3) |
| `ProductVariant.barcode` | deprecated in 2026-10 (replaced by the `barcodes` connection, `barcode` returns the first) | kept on `barcode` for 2026-10; moving to `barcodes` is noted for the next API version |
| `ProductVariant.price` / `compareAtPrice` | `Money!` / `Money` | none |
| weight | `inventoryItem.measurement.weight { value unit }`, `WeightUnit` GRAMS/KILOGRAMS/OUNCES/POUNDS; `variant.weight` removed | none |
| search | `updated_at` on `products` and `productVariants` | none |
| `draftOrderCalculate` | scope `write_draft_orders`; "without creating it"; `taxLines` on `CalculatedDraftOrder` only (per line item and shipping line, aggregated), `CalculatedDraftOrderLineItem` has only `taxable` | one variant per call, no shipping line, so every tax line belongs to that variant; `write_draft_orders` is an OPTIONAL scope (tech review): without it the catalogue syncs and rates stay not checked |

## 3. Design

### 3.1 Files (`libs/integrations/shopify/src`)

- `infrastructure/readers/shopify-product.queries.ts` - GraphQL documents.
- `infrastructure/readers/shopify-product.reader.ts` - `product(id)` memo; the
  ONE place `product: null` becomes `MasterProductNotFoundError`; `seed()` for
  list and prefetch reads.
- `infrastructure/readers/shopify-external-id.ts` - internal -> Shopify id via
  identifier mapping; a gap is `ShopifyNotMappedException`.
- `infrastructure/readers/shopify-id-pager.ts` - offset window over a cursor
  API with a cached checkpoint (3.4).
- `infrastructure/mappers/shopify-product.mapper.ts` - product / variant /
  category path / directory.
- `infrastructure/adapters/product-master/shopify-product-master.adapter.ts`.
- `infrastructure/tax/shopify-tax-rate.reader.ts` - `draftOrderCalculate` (3.6).
- `domain/exceptions/shopify-not-supported.exception.ts`, `shopify-not-mapped.exception.ts`.
- `domain/policies/shopify-gid.policy.ts` already exists (foundation).
- Plugin: `supportedCapabilities: ['ProductMaster']`,
  `defaultEnabledCapabilities: ['ProductMaster']`, dispatch entry built from
  `ShopifyAdapterFactory.resolve()`.
- Retry classifier: `ShopifyNotMappedException`, `ShopifyNotSupportedException` non-retryable.

### 3.2 Mapping

As the prototype: every Shopify variant is a `ProductVariant` keyed by its own
id (the "Default Title" variant is a simple product, attributes `null`); gross
price only when the shop has `taxesIncluded`; `barcode` -> `ean` + `gtin`;
weight from `inventoryItem.measurement.weight` (0 = not set); vendor as a
feature; product media -> `images`, variant media -> variant `images`;
`categories` = leaf first then ancestors; `categoryBreadcrumb` root first.

### 3.3 Deletion

`product(id:)` answering `null` is the only deletion signal. Transport, auth,
throttle errors pass through untouched.

### 3.4 Enumeration and cursor checkpoint

`listExternalIds` / `listExternalIdsModifiedSince` take a `{limit, offset}`
window, but Shopify pages by cursor only. The prototype re-walked from the
start on every call (O(offset)). A sweep's windows advance monotonically, so
the pager stores one checkpoint `{position, cursor, queryKey}` per connection
and kind in the host cache; a call whose offset is at or past the checkpoint
resumes from it, otherwise it restarts from the beginning. The cache is an
optimisation only: a miss restarts, never fails. Ordered by `sortKey: ID`.

The modified-since read is a union of two searches (products and variants), so
it cannot resume from one cursor: it reads both id sets for the window's
`since` (stable within a cycle, ADR-048 decision 3), caches the merged sorted
list for that `since` briefly, and slices.

### 3.5 Bulk prefetch

`prefetchProducts(ids)`: `nodes(ids:)` in chunks (start at 10 products); a
`MAX_COST_EXCEEDED` answer halves the chunk and retries, down to 1, and the
size that worked is remembered per process. Seeds the reader memo (a product
whose variants did not fit the first page is not seeded, so its per-product
read pages them). Never throws; a missing id stays unwarmed.

### 3.6 Tax rate (L-T4)

`readProductTaxRate`: `draftOrderCalculate` with the product's first variant,
quantity 1, and a shipping address in the sales country (config
`salesCountryIso2`, else the shop's own billing country; province + zip added
when it is the shop's own country). One tax line -> `resolved` with its
`ratePercentage` as the code and the country; no tax line -> `unknown /
not-configured`; several lines -> `unknown / ambiguous`; unreadable answer ->
`unknown / unreadable` (also for a missing `write_draft_orders`); transport errors
throw. Cached per variant + country for a day - not per `updatedAt`, which a
stock change bumps (L-M2, tech review). Product-keyed
(`readsTaxRatePerVariant` absent).

## 4. Steps

1. Exceptions, queries, external-id resolver, reader (+ specs).
2. Mapper (+ spec: variants, default title, gross / net shop, weight units, category path / directory).
3. Id pager with checkpoint (+ spec).
4. ProductMaster adapter: reads, writes refused, modified-since, prefetch (+ spec).
5. Tax reader (+ spec).
6. Plugin manifest + dispatch + factory; classifier additions (+ plugin spec).
7. README + architecture-overview bullet; decisions recorded.
8. Quality gate: lint, type-check (tests on CI).

## 5. Validation

Hexagonal: everything in the plugin; core untouched. No `any`. Scopes: the one
new scope (`write_draft_orders`) is optional, in `SHOPIFY_OPTIONAL_SCOPES`.

## Decisions (user, 2026-11-09)

1. **compareAtPrice (A05): `price` is the catalogue price.** It is what the
   buyer pays in the shop; `compareAtPrice` (the struck-through "was" price) is
   not carried.
2. **ARCHIVED is removed from sale, DRAFT is synced as is (A11).** An ARCHIVED
   product reads as `MasterProductNotFoundError`, so its variants go stale and
   its offers are paused; setting it back to ACTIVE re-syncs it (the variant
   upsert writes `isStale = false`). It is also left out of `listExternalIds`,
   so the full sweep does not raise a failure for it on every tick; the delta
   pass (the archive bumps `updatedAt`) and the deletion reconcile (OL's own
   mappings) still reach it. DRAFT and UNLISTED products sync normally.
3. **Gift cards are skipped (A17).** Not a physical product and redeemable
   only at Shopify checkout: left out of `listExternalIds` and the delta pass
   (`isGiftCard` / `gift_card:false`).
