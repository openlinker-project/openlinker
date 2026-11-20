# Implementation Plan: Amazon publish destination - create offers (#4181)

Part of epic #4176. Branch `4181-amazon-offer-creator`, stacked on `4180-amazon-offer-manager`.

## 1. Task

Let the bulk offer wizard create Amazon listings from a master catalogue (PrestaShop, Shopify, ...):

- **A. Offer on an existing ASIN** - the product is already in Amazon's catalogue; find the ASIN by EAN
  and attach the seller's offer (price, stock, condition). The common case.
- **B. New ASIN** - the product is not on Amazon; create it under a product type with the attributes
  that product type requires.

**Layer**: Integration (Amazon adapter) + a small CORE change (taxonomy owner vocabulary, part B).

**Non-goals**: GTIN exemption (manual in Seller Central, no API), brand registry, FBA inbound,
variation families (parent / child ASINs), B2B prices.

## 2. Research

Core contracts (all guard-narrowed off the dispatched `OfferManager` adapter):

| Capability | Method | Use |
|---|---|---|
| `CatalogProductReader` | `findProductsByBarcode`, `getProduct` | EAN -> ASIN (unique / ambiguous / no match) |
| `EanCategoryMatcher` | `resolveCategoriesForBatchByEan` | the wizard's resolve step: barcode -> category + card |
| `OfferCreator` | `createOffer` -> `CreateOfferResult` | the create; `validating` is then polled by `OfferStatusPollService` through `OfferStatusReader` (#4180) |
| `CategoryBrowser` + `TaxonomyIdentityProvider` | `fetchCategories`, `getTaxonomyIdentity` | categories in the pickers, via the `destination.taxonomy.sync` read model (ADR-037) |
| `CategoryParametersReader` | `fetchCategoryParameters` | required attributes for the wizard and the attribute projection (ADR-023) |

Amazon APIs (published models, `amzn/selling-partner-api-models`):

- Catalog Items 2022-04-01 `searchCatalogItems` (`identifiers`, `identifiersType=EAN`, `marketplaceIds`,
  `includedData=summaries,images,identifiers,productTypes`).
- Listings Items 2021-08-01 `putListingsItem` with `requirements=LISTING_OFFER_ONLY` (case A) or
  `LISTING` (case B); answers `ACCEPTED` / `INVALID` with issues. `putListingsItem` replaces the whole
  listing, which is right for a create and never used for an update (#4180).
- Product Type Definitions 2020-09-01 `searchDefinitionsProductTypes`, `getDefinitionsProductType`
  (returns a link to the product type's JSON Schema; the static sandbox returns only a stub link,
  #2881 Evidence #45).
- The category "id" on Amazon is the **product type** (`KITCHEN`, `SHOES`, ...), which is what a
  listing needs; browse nodes are a separate tree used only for navigation on the storefront.

## 3. Design

### Part A - offer on an existing ASIN (no core change)

1. `CatalogProductReader` over `searchCatalogItems`: one result -> `unique` (id = ASIN, name, images,
   EAN), several -> `ambiguous`, none -> `no_match`.
2. `EanCategoryMatcher`: per EAN, the ASIN's product type as the category and the ASIN as the card, so
   the wizard pre-fills both and marks the row card-linked.
3. `OfferCreator.createOffer` with a card (`productCardId` = ASIN): `putListingsItem`
   (`LISTING_OFFER_ONLY`) with `merchant_suggested_asin`, `condition_type` (`new_new` / `used_good`),
   `purchasable_offer` per configured marketplace in the price's currency, `fulfillment_availability`
   (`DEFAULT`, the command's stock). SKU = the variant's SKU from the master, else the internal variant
   id. `ACCEPTED` -> `validating`, `externalOfferId` = SKU (the poller then reads issues);
   `INVALID` -> `draft` with Amazon's issues as `validationErrors`.
4. Without a card and without part B the create is refused, naming the reason (no ASIN for this EAN).

### Part B - new ASIN (core change)

5. Core: add `'amazon'` and `'amazon:sandbox'` to `TaxonomyOwnerValues` (+ any mirror the invariants
   name).
6. `CategoryBrowser`: product types as a flat list of leaves (`searchDefinitionsProductTypes`),
   `TaxonomyIdentityProvider` per environment.
7. `CategoryParametersReader`: `getDefinitionsProductType` + download its JSON Schema; top-level
   required properties become required `CategoryParameter`s (string, number, enum values); conditional
   requirements (`allOf` / `if-then`) are read as optional and noted, because the wizard cannot express
   them.
8. `OfferCreator` without a card: `putListingsItem` (`LISTING`) with `item_name`, `brand`,
   `externally_assigned_product_identifier` (EAN), `product_description`, `main_product_image_locator`
   / `other_product_image_locator_*`, the projected parameters, plus the offer attributes from step 3.
   A product without a valid EAN is refused with the GTIN exemption named as the remedy.

## 4. Steps and commits

| # | Commit | Files |
|---|---|---|
| 1 | Part A: catalog reader, EAN matcher, offer-only create | `infrastructure/adapters/offer-manager/`, `domain/types/amazon-catalog.types.ts`, specs |
| 2 | Part B core: taxonomy owner values | `libs/core/src/listings/domain/types/taxonomy-owner.types.ts` (+ mirrors) |
| 3 | Part B Amazon: product types, schema parameters, full create | `infrastructure/adapters/offer-manager/`, `infrastructure/mappers/`, specs |

Manifest: `OfferCreator`, `CategoryBrowser`, `EanCategoryMatcher` advertised-without-dispatch (the
Allegro / Erli precedent), so the wizard and the pickers show Amazon.

## 5. Validation and risks

- Hexagonal: adapter-only except step 2; no new core port.
- Rate limits: Catalog Items 2 req/s, Listings 5 req/s, Product Type Definitions 5 req/s; batch resolve
  paced through the existing resolve concurrency ceiling.
- **Risk**: product type JSON Schemas are large and conditional; part B covers required top-level
  attributes only. Verifiable only on a live account (the sandbox returns a stub schema link).
- **Risk**: `TaxonomyOwnerValues` change touches the taxonomy read model; part B must re-run the
  taxonomy specs.
- Tests: unit specs per capability on recorded-shape fixtures; no live verification possible here.
