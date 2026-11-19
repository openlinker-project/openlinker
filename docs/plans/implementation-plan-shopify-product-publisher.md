# Implementation Plan: Shopify ProductPublisher and CategoryProvisioner (#3979)

Stacked on #3981 (`3981-shopify-webhooks`). Branch `3979-shopify-product-publisher`.

## 1. Task

Publish products from another master to Shopify: simple and variant products, images, collections, metafields,
prices. Integration layer only; no core change.

### Non-goals

- `ShopProductStatusReader` (publish status reconcile) - later.
- Changing the manifest default (ProductMaster on); the publisher refuses a master connection instead (A20).
- Scheduled sales, per-variant images, dimensions, tax classes (reported as warnings).

## 2. Research

Prototype (`origin/3928-shopify-prototype`): publisher adapter, publish mapper, metafields mapper, GraphQL documents,
description format. Core contracts: `ShopProductManagerPort` (+ `getDescriptionFormat`), `CategoryProvisioner`,
`ShopCategoryBrowser`, `ShopAttributeReader`, `ShopCurrencyDeclarer`, `ShopProductPriceUpdater`;
`PublishProductCommand.taxRate` (a net-priced shop converts with the catalogue rate and refuses without one).

## 3. Changes from the prototype

- Tax-exclusive stores are published net (catalogue rate) instead of refused; price-only updates convert with the
  variant's rate from `ShopifyTaxRateReader`.
- A connection with ProductMaster enabled is refused (A20).
- `ShopCategoryBrowser` added: manual collections, flat, for the destination taxonomy sync.
- Manifest: `ProductPublisher`, `CategoryProvisioner` (dispatched to the same instance), `ShopCategoryBrowser`,
  `ShopAttributeReader` (advertised only).

## 4. Validation

- Hexagonal: implements core ports; no core change.
- Tests: publish mapper, metafields mapper, adapter specs; plugin spec manifest.
- E2E on a dev store pending: needs a publish-only Shopify connection (Product master off) and a master shop.
