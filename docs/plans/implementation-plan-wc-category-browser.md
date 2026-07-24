# Implementation Plan — WooCommerce CategoryBrowser (shop-side) — #1834 (S7 of epic #1838)

## Goal

Give shop destinations a browsable category tree so an operator can pick an
existing destination category in the publish edit flow. WooCommerce today only
exposes `CategoryProvisioner` (create-if-missing from the master path); there is
no read/browse path. Marketplaces have `CategoryBrowser` (a sub-capability of
`OfferManagerPort`); shops have no equivalent.

## Layer classification

- CORE (domain port + guard + neutral type + application read service)
- Integration (WooCommerce adapter method + manifest advertisement)
- Interface (one read endpoint on the existing `ShopPublishController`)
- Frontend (self-contained category picker component + query hook)

## Decision: new `ShopCategoryBrowser` sub-capability, NOT reuse of `CategoryBrowser`

The marketplace `CategoryBrowser` guards against `OfferManagerPort`
(`isCategoryBrowser(adapter: OfferManagerPort)`) and returns `OfferCategory`
(with a `leaf` flag — marketplaces force a leaf pick). Reusing it for a shop
adapter would require the WC product-publisher to implement `OfferManagerPort`,
blurring the marketplace/shop boundary ADR-024 draws.

Instead add `ShopCategoryBrowser` as an optional sub-capability of
`ShopProductManagerPort` (the shop-side sibling), co-located `isShopCategoryBrowser`
guard — exactly mirroring `CategoryProvisioner`. It is **advertised-without-dispatch**
(declared in the WC manifest `supportedCapabilities` so host discovery / the FE
can tell it apart, resolved by narrowing the dispatched `ProductPublisher`
adapter with its `is*` guard — the same pattern Allegro uses for its own
`CategoryBrowser`). It is NOT added to `CoreCapabilityValues` (only capabilities
that need independent registry dispatch are, e.g. `CategoryProvisioner`).

Neutral return type is a minimal `ShopCategory { id, name, parentId }` — shops
allow assigning a product to any category node (parent or child), so there is no
`leaf` gate; the picker allows Select on every node and Browse to drill in.

## Steps

1. `libs/core/src/listings/domain/types/shop-category.types.ts` — `ShopCategory`.
2. `libs/core/src/listings/domain/ports/capabilities/shop-category-browser.capability.ts`
   — `ShopCategoryBrowser` + `isShopCategoryBrowser` guard.
3. Barrel: export both from `libs/core/src/listings/index.ts`.
4. `application/interfaces/shop-category-browse.service.interface.ts` +
   `application/services/shop-category-browse.service.ts` — resolve
   `ProductPublisher` → `ShopProductManagerPort`, narrow guard (422 otherwise),
   return `browseCategories(parentId)`.
5. Token `SHOP_CATEGORY_BROWSE_SERVICE_TOKEN` in `listings.tokens.ts`; register +
   export in `listings.module.ts`; export interface + token from barrel.
6. WC adapter: add `browseCategories(parentId?)` to
   `WooCommerceProductPublisherAdapter` (implements `ShopCategoryBrowser`),
   paging `GET /products/categories?parent=&per_page=100&page=`; advertise
   `'ShopCategoryBrowser'` in `woocommerceAdapterManifest.supportedCapabilities`.
7. API: `GET /listings/connections/:connectionId/shop-publish/categories?parentId=`
   on `ShopPublishController` + `ShopCategoryResponseDto`.
8. FE: `listings.types.ts` `ShopCategory` type; `listings.api.ts`
   `browseShopCategories`; query key; `use-shop-categories-query.ts`;
   `shop-category-picker-modal.tsx` (self-contained, shop semantics); barrel export.
9. Tests: core service (guard pass/fail), WC adapter (paging + parent), FE hook +
   component.
10. Docs: `docs/capabilities.md` (REQUIRED), `architecture-overview.md`,
    WooCommerce README, ADR-024.

## Integration point for #1830

#1830 (shop edit modal) is not merged. Deliver the picker as a self-contained
`ShopCategoryPickerModal` + `useShopCategoriesQuery`, exported from the listings
barrel, so #1830 mounts it in the shop edit modal exactly where the marketplace
path mounts `BulkCategoryChooseModal` (gated on the shop `ShopCategoryBrowser`
capability instead of the marketplace `canBrowseCategories`). No dependency on
#1830 code.

## Non-goals

- No change to the provision (write) path.
- No `CoreCapabilityValues` / DTO-enum change (advertised-without-dispatch).
- No wiring into #1830's unmerged modal shop-mode.
