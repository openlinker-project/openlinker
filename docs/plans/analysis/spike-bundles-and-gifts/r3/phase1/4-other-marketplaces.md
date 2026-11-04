# R3 / Phase 1 / 4 - Other marketplaces (Erli, Amazon EU, Kaufland, Empik/Mirakl, eBay) + country-agnostic VAT notes

Round 3, blind replication. Written from scratch on 2026-11-04; nothing under `docs/plans/analysis/` was read except `briefs/`.
Question: can sellers list sets, virtual bundles, multipacks and free-item promotions on these channels, and exactly what does the order carry (price, discount, promotion id, free quantity, gift-wrap vs free item), and can returns be made at component level?

## Sources consulted (with kind)

| # | Source | Kind | Retrieved how |
|---|---|---|---|
| S1 | `docs/architecture/adrs/erli-sandbox-swagger.json` (in repo; Erli Shop API sandbox swagger, `components.schemas.Order`, `CreateDiscount`) | Primary (vendor spec, snapshot in repo) | read locally |
| S2 | https://erli.pl/svc/shop-api/doc/CHANGELOG.txt (also sandbox copy) | Primary (vendor changelog) | curl 2026-11-04 |
| S3 | `libs/integrations/erli/src/infrastructure/adapters/erli-order.types.ts`, `erli-order.mapper.ts` | Code | read locally |
| S4 | https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/orders-api-model/ordersV0.json | Primary (official OpenAPI model) | curl |
| S5 | same repo, `orders_2026-01-01.json` | Primary (official OpenAPI model) | curl |
| S6 | https://developer-docs.amazon.com/sp-api/changelog/new-introducing-the-orders-api-v2026-01-01 and v0 model page | Primary (changelog), via search snippet only | WebSearch (page itself 301-redirected) |
| S7 | GitHub issues amzn/selling-partner-api-models #4858, #5191 | Developer reports (forum-grade, on vendor repo) | GitHub search |
| S8 | Helium10 "Using Amazon's virtual product bundle tool" (undated) | Secondary (vendor blog) | WebFetch |
| S9 | Amazon bundling policy summaries (litcommerce, bqool, seller forums) | Secondary / forum | WebSearch only - **official Seller Central help pages are behind login, not read** |
| S10 | https://sellerapi.kaufland.com/swagger.json (v2.47.0) | Primary (vendor OpenAPI) | curl |
| S11 | https://sellerapi.kaufland.com/?page=orders and ?page=returns | Primary (vendor docs) | curl |
| S12 | https://www.kauflandglobalmarketplace.com/en/seller-university/formal-framework/bundles-and-eans/ | Primary (vendor seller policy) | WebFetch |
| S13 | Mirakl Seller API OpenAPI, embedded in https://developer.mirakl.com/page-data/shared/api-docs-content/product/mmp/rest/seller/openapi3.json.json (OR11, OR28 schemas) | Primary (vendor spec) | curl |
| S14 | https://marketplace.empik.com/ and https://marketplace.empik.com/api/version | Live probe | curl 2026-11-04 |
| S15 | https://pomoc.comarch.pl/esale/?p=1959 (EmpikPlace offer vs product) | Secondary (integrator help) | WebFetch |
| S16 | eBay Sell Fulfillment API OAS3 v1.20.7, Marketing API OAS3, Inventory API OAS3 (developer.ebay.com/api-docs/master/...) | Primary (vendor spec) | curl |
| S17 | https://developer.ebay.com/api-docs/sell/static/inventory/pbse-special-listings.html | Primary (vendor docs) | WebFetch |
| S18 | Directive 2006/112/EC Art. 16, 73, 79, 226 via https://www.legislation.gov.uk/eudr/2006/112/article/{n} | Primary (law text; UK-hosted copy frozen at 31.12.2020, articles believed unchanged since 2006 - not cross-checked against EUR-Lex, which blocked the fetch) | curl |
| S19 | HMRC VAT Notice 700/7 https://www.gov.uk/guidance/business-promotions-and-vat-notice-7007 (last updated 25 June 2026) | Primary (tax authority guidance) | curl |
| S20 | gesetze-im-internet.de: UStG §3, KassenSichV §6, EStG §4 | Primary (law text) | curl |
| S21 | BFH XI R 19/23 (22.01.2025), via omnilex.ai | Primary text via secondary host | WebFetch |
| S22 | ecnews.it "Gli sconti merce tra fatture e scontrini" (14.03.2022) | Secondary (professional press) quoting DPR 633/72 art. 15 and circ. 3/E/2022 | WebFetch |

## Findings per marketplace

### 1. Erli.pl (Shop API)

**Bundles / sets.** The API has no bundle, set, component or "attached product" concept on products or orders. Product fields searched (S1) contain no such field; `ManageAttachedProducts` is about file attachments (`attachmentId`, `productIds`), not product composition. A set is just another product with its own `externalId` (and `ean`). Rating: bundle support None.

**Order line shape (S1, `Order.items`)**: required `id, externalId, quantity, unitPrice, name, slug`; optional `unitPriceBeforeRebate`, `ean`, `sku`, `weight`, `taxRate`. Money is integer minor units (S3 `erli-order.types.ts:62-74`: "Money fields (`unitPrice`, `unitPriceBeforeRebate`) are INTEGER minor units (grosze)").
- `taxRate` is a single enum per line: `"TAX_0","TAX_5","TAX_8","TAX_23","TAX_NP","TAX_ZW","TAX_7","TAX_19"` - "Stawka VAT obowiązująca na produkcie w trakcie zamówienia" (S1). One rate per line, so a mixed-rate set cannot be represented.
- Discount: order-level `rebate` object with required `id`, `name`, optional `code` ("tylko w przypadku jednorazowych kodów") - **no amount** (S1). The per-line effect is only visible as `unitPriceBeforeRebate` vs `unitPrice`. Changelog: "2020-06-08: dodanie pól "rebate" oraz "items.X.unitPriceBeforeRebate" w zamówieniu" (S2).
- Who funds the rebate: Erli removed it from the order payload - "2026-08-19: ... zamówienia nie zawierają już nieudokumentowanych pól wewnętrznych (rebate.donorType, ...)" (S2). Funding source is therefore Unknown per order; there is a separate billing endpoint "POST /billing/company/rebates (możliwość czytania rezerwy i historii rabatów)" (S2, 2022-02-14), which suggests some rebates are drawn from a seller reserve (unverified interpretation).
- Seller price promotions: `POST /products/{externalId}/discount` with `newPrice`, `startAt`, `restoreAt` (S1 `CreateDiscount`; S2 "2024-02-15: dodanie POST /products/:externalId/discount - utworzenie promocji czasowej"). This is a price change, not a free item. No free-item / BOGO / gift field anywhere in the order schema.
- Gift wrap / gift message: none (only `comment`, buyer note).

**Returns (S1 `Order.returns[]`)**: items reference the order line by array index: `index` - "Numer zwracanej pozycyji, odnosi się do pola items zamówienia" and a quantity. Line-level only, no component level. The repo swagger still names it `quentity`; the live changelog says "poprawka nazwy pola `quentity` -> `quantity` w dokumentacji pozycji zwrotów (payload zawsze zawierał `quantity`)" (S2, 2026-08-19). **The in-repo swagger is stale** (it also says `country: enum ["pl"]` while S2 2026-08-19 adds `market` `pl`/`de` and `currency`).

**OpenLinker today (S3)**: `erli-order.mapper.ts:203-212` maps `price: toMajorUnits(item.unitPrice)` and ignores `unitPriceBeforeRebate` and `rebate`; `erli-order.types.ts:114` notes the resource "carries more (rebate, payment, returns, ...)". So a rebate is already silently folded into the line price, and the promotion identity is lost.

### 2. Amazon (SP-API, EU)

**Bundles**: Amazon distinguishes (a) bundles listed as their own ASIN/GTIN (seller- or brand-assembled), (b) multipacks, (c) "Virtual Bundles" (brand tool combining existing ASINs). Evidence is secondary only (S8, S9) because Seller Central help is behind login:
- "Bundles consist of multiple single items that can each be identified by a unique ASIN/UPC and are sold together as a single offering. A pre-packaged kit or pack with multiple items that is identified by a single ASIN/UPC is not considered a bundle." (litcommerce, secondary, via search snippet)
- Virtual bundles: "for the time being, it's only available for Amazon USA"; "you have to have brand registry to be eligible"; "The sales are still reported to the component ASINs"; "individual components can be returned separately by the customer." (S8, undated vendor blog). **EU availability: Unknown / likely None.** Conflicting secondary claims exist about reporting (S9 search summary).

**Order line shape, v0 (S4 `OrderItem`)**:
- `QuantityOrdered`: "The number of items in the order."
- `ProductInfo.NumberOfItems`: "The total number of items that are included in the ASIN." (multipack count)
- `ItemPrice`: "the value of `ItemPrice` is equal to the selling price of the item multiplied by the quantity ordered. `ItemPrice` excludes `ShippingPrice` and GiftWrapPrice."
- `PromotionDiscount`: "The total of all promotional discounts in the offer." / `PromotionDiscountTax`; `PromotionIds`: "A list of promotion identifiers provided by the seller when the promotions were created."
- `IsGift`: "Indicates whether the item is a gift." Plus `BuyerInfo.GiftWrapPrice`, `GiftWrapTax`, `GiftMessageText`, `GiftWrapLevel`. This is the **buyer's gift option (wrap/message), not a free item**.
- Developers report the semantics are ambiguous: "There are two fields: `PromotionDiscount` and `PromotionDiscountTax` but no information if this is already applied to `ItemPrice` or not, or if it is for one or multiple items." (S7 #4858, closed `not_planned`).

**Order line shape, v2026-01-01 (S5)** - v0 is deprecated; per changelog snippet (S6) "you must migrate to Orders API v2026-01-01 by March 27, 2027":
- `quantityOrdered`, `product.price.unitPrice` ("The price charged for a single unit of this product, before any quantity-based calculations"), `product.sellerSku`, `product.asin`.
- `promotion.breakdowns[].promotionId` only - **no amount per promotion**. Money moves into `proceeds.breakdowns[]` typed `ITEM, SHIPPING, GIFT_WRAP, COD_FEE, OTHER, TAX, DISCOUNT`, with `detailedBreakdowns` "only available for TAX and DISCOUNT".
- `fulfillment.packing.giftOption.giftMessage/giftWrapLevel` (gift wrap separate from free items).
- `associatedOrderItems[]` with `associationType` `VALUE_ADD_SERVICE` or `WARRANTY` - no bundle/component association type.
- **`NumberOfItems` is gone** (0 occurrences of `numberofitems` in the 2026 model) - multipack unit count no longer arrives on the order.

**Free items / BOGO**: Amazon offers "Buy One, Get One" promotions (forum snippet in S9), but no source found that documents how the free unit appears in the order (separate line? same line with qty 2 and `PromotionDiscount` = one unit?). Rating: Unknown. Evidence that 100%-discount items are mishandled downstream: "Amazon Vine orders have a 100% promotional discount ... but this discount is not reflected anywhere in the `GET_VAT_TRANSACTION_DATA` report" (S7 #5191, open).

**Returns**: per order item (not verified beyond the virtual-bundle claim in S8). Component returns exist only where components are separate order items (virtual bundles, US).

### 3. Kaufland (Seller API v2, S10/S11)

**Core shape: one order unit = one piece.** "Each order is composed of one or more order units, each corresponding to a unit." / "If the same unit gets ordered several times, several order units are created." / "if a customer orders multiple products from you, they will be listed individually as separate order units." (S11). The `OrderUnit` schema has no quantity field (S10).

**Order unit money fields (S10 `OrderUnit`)**: `price` (int, cents), `revenue_gross`, `revenue_net`, `vat` (single float, e.g. 19), `shipping_rate`, `eco_fee`, `packaging_fee`, `discounts[] {usage_type, discount_value}`.
- "The discount is already factored into the price field: price is the post-discount amount the buyer paid. ... price = original_price - discount_value" (S11)
- "There are two possible values for usage_type: voucher ... volume — A volume discount created and funded by the seller with quantity-based pricing rules." "At most one discount applies per order unit." (S11)
- "Only seller-created discounts appear here. Kaufland-funded promotions are not reflected in this field." (S11) - i.e. a marketplace-funded discount is invisible on the order.
- No promotion id (only `usage_type`), no free-item flag, no gift wrap.

**Bundles policy (S12)**: "Permissible bundles are offers that contain a combined, value-added offer of at least two different products"; permissible: "pot set consisting of four pots of different sizes"; non-permissible: "smartphone with the addition of a transparent cover"; Kaufland "reserves the right to block any offers." Listing is per EAN/product (secondary S9-type sources say one product page per EAN - unverified). No bundle/component structure in the API.

**Returns / refunds**: "Initialize a return for one or more order units. All order units must belong to the same order." `ReturnUnit` references `id_order_unit` (S10). Partial refund per unit: `PATCH /order-units/{id}/refund` with `amount` (cents) and `reason` enum incl. `incomplete_delivery`, `defect`, `other_refund` (S10). Component-level return of a set: None; partial money refund on the set unit: Full.

### 4. Empik (EmpikPlace on Mirakl)

**Platform**: live probe (S14) - `https://marketplace.empik.com/` login page footer reads "Copyright © 2026 Mirakl Mirakl MP"; `https://marketplace.empik.com/api/version` returns `{"version":"3.1322"}`. A connector vendor's claim of a separate `developer.empik.com` / `api.empik.com` OAuth API could not be confirmed (`developer.empik.com` did not resolve on 2026-11-04). I trust the live probe.

**Catalogue (S15, secondary)**: "Niemożliwe jest utworzenie dwóch oddzielnych kart produktu z tym samym kodem EAN"; product mandatory fields include EAN and VAT rate. A set therefore needs its own catalogue product/EAN; no component structure (Mirakl spec S13 has no bundle field on order lines; full-text search of the spec found "bundle" only in help-site URLs).

**Order line (Mirakl OR11, S13)**: `quantity`, `price` ("Order line's price without shipping price"), `price_unit`, `origin_unit_price` ("The original unit price of the offer"), `taxes[] {code, rate, amount, origin_unit_amount}`, `price_amount_breakdown.parts[] {amount, commissionable, debitable_from_customer, payable_to_shop}` (advanced feature), `promotions[]`:
- `id` - "Promotion's id, defined by the shop"; `deduced_amount` - "Promotion's amount for this line."; `promo_code`; `campaign.identifier`
- `offered_quantity` - "The quantity of free items offered by the promotion for this line. Only applicable when promotion is of type FREE_ITEMS, null otherwise."
- `apportioned` - "true when the promotion's reward amount is divided and allocated proportionally to multiple order lines."
- `configuration.type` enum `AMOUNT_OFF, FREE_ITEMS, PERCENTAGE_OFF, REDUCED_UNIT_PRICE`; `configuration.free_items_quantity` - "The free item target quantity of the promotion."
- order-level `promotions.applied_promotions[]` and `total_deduced_amount`.
This is the richest free-item model of the five. Whether **Empik** enables seller promotions or `FREE_ITEMS` is Unknown (a Mirakl operator decides; one other Mirakl operator's seller help lists free items as "[not implemented yet]" - secondary, via search).
Whether the free unit is counted inside `quantity` (and offset by `deduced_amount`) or not: Unknown (not stated in the spec; inference only).

**Refunds (OR28, S13)**: per `order_line_id` with `amount`, `taxes[]`, `reason_code`, and `quantity` - "The quantity of products to refund. This quantity is informative only." Line-level money refund; no component level.

### 5. eBay (Sell APIs, S16/S17)

**Bundles (S17)**: "Manufacturer bundles are combinations of multiple products that are pre-packaged by manufacturers/brands"; "Seller-created bundles are custom combinations of products put together by sellers."; "Manufacturer bundles typically have a distinct GTIN of their own"; for a seller bundle with a primary product "the ePID for this product is passed in"; "the seller will still need to indicate that the listing is for a bundle through item specifics". Lots: "Lots refers to offers for multiple quantities of a given product (e.g., a set of 4 car tires)"; "Multiple-packs usually have a dedicated GTIN". Inventory API `lotSize`: "the integer value passed into this field is the total number of items in the lot" (S16). **The order does not carry lotSize** (not a LineItem field) - adapter must look it up from the listing.

**Order line (S16 `LineItem`)**: `quantity`; `lineItemCost` - "The selling price of the line item before applying any discounts ... single unit price by the number of units purchased"; `discountedLineItemCost` - "only returned if the order line item was discounted through a promotion"; `appliedPromotions[] {promotionId, description, discountAmount}` - "always returned, but will be returned as an empty array if no special sales promotions or discounts apply"; `taxes[]`, `ebayCollectAndRemitTaxes` (incl. "VAT collected for the UK, EU countries"); `refunds[]`; `giftDetails` - "only returned and applicable for digital gift card line items" (not a free item, not gift wrap).
**BOGO** is configurable (Marketing API `numberOfDiscountedItems`: "Use this field to configure "Buy One Get One" (or BOGO) discounts"; S16) and would surface as `appliedPromotions` on the line - exact allocation when items differ: Unknown.

**Returns**: line-level (`refunds[]` per line; Post-Order return API per item - not read in this round). Component level: None.

## Checklist per marketplace (one line each)

| Marketplace | Bundle definition | Bundle stock | Listing | Order with bundle | Component return | VAT split | Gift source | Gift on documents | Gift limits |
|---|---|---|---|---|---|---|---|---|---|
| Erli | None - set = ordinary product (S1) | Own `stock` of set product only; no components | Own `externalId`/EAN | One line, `externalId` of the set; no components | None - `returns[].items` by line `index` + qty (S1) | None - one `taxRate` per line (S1) | No free-item mechanism; `rebate` (id/name/code, no amount) + `unitPriceBeforeRebate`; funder hidden since 2026-08 (S2) | Not applicable (no free item in payload) | Unknown |
| Amazon EU | Bundle = own ASIN/GTIN; virtual bundles US-only, brand-registry (S8/S9, secondary) | Own ASIN stock; virtual bundle = component FBA stock (US, secondary) | Own ASIN; multipack via item count | One line per ASIN; v0 `NumberOfItems` (multipack), dropped in 2026 model (S4/S5) | Per order item; components only for virtual bundles (US, secondary) | None per line (one ASIN line); `ItemTax` per line | BOGO promotions exist (forum); order shape for free unit Unknown; `IsGift`/gift wrap = gift option, not free item (S4) | Amazon VAT report omits 100% promo in at least Vine case (S7 #5191) | Unknown |
| Kaufland | "at least two different products", value-added; seller may be blocked (S12) | Own unit stock per EAN; none for components | Own EAN product + unit | One order unit per piece, no qty (S11) | None; return per order unit, partial refund by amount (S10) | None - single `vat` per unit (S10) | Seller-funded `voucher`/`volume` only, amount resolved, max one per unit; Kaufland-funded invisible (S11) | Not applicable | Percentage voucher max 85% (S10 `/vouchers` description) |
| Empik (Mirakl) | None in API; set needs own catalogue product/EAN (S15) | Offer stock of set product only | Own EAN product + offer | One line; `promotions[]` with `deduced_amount`, `offered_quantity` (S13) | None; OR28 refund per line, quantity "informative only" (S13) | `taxes[]` array per line exists (S13); Empik's use Unknown | Mirakl `FREE_ITEMS` promo type (seller/shop-defined id); Empik enablement Unknown | Unknown | `free_items_quantity` target per promo (S13); Empik caps Unknown |
| eBay | Manufacturer vs seller-created bundles; item-specific flag; lots/multipacks (S17) | Listing quantity of the bundle SKU only | Own listing; `lotSize` for lots (S16) | One line; lot size not on order (S16) | None; refund per line (S16) | `taxes[]` per line; no component split | BOGO via `numberOfDiscountedItems` -> `appliedPromotions` (S16) | Not applicable (`giftDetails` = digital gift cards) | Promo discount range constraints (e.g. percentage 5-80) (S16) |

## Use cases (MKT-nn)

| ID | Marketplace | Who | Scenario | What arrives (fields) | Pain | Source + quote |
|---|---|---|---|---|---|---|
| MKT-01 | Erli | Merchant selling a "zestaw" (shampoo + conditioner) as one product | Buyer orders the set | 1 item: `externalId` (set), `quantity`, `unitPrice`, `taxRate` | No components; stock of components must be derived in OL; one VAT rate for the whole set | S1: items props `id, externalId, quantity, unitPrice, ... taxRate` (single enum) |
| MKT-02 | Erli | Merchant | Buyer uses a discount code | Order `rebate {id,name,code}`, line `unitPriceBeforeRebate` > `unitPrice` | No amount on rebate, no funder (donorType removed); OL mapper drops both | S2 2026-08-19: "nie zawierają już ... (rebate.donorType ...)"; S3 `erli-order.mapper.ts:207` |
| MKT-03 | Erli | Buyer | Returns one product of a 2-item set | `returns[].items[{index, quantity}]` | Can only say "1 of the set line" - which component is unknown | S1: "Numer zwracanej pozycyji, odnosi się do pola items zamówienia" |
| MKT-04 | Amazon EU | Brand seller | Sells a 3-pack (multipack) | v0: `QuantityOrdered`=1, `ProductInfo.NumberOfItems`=3; v2026: only `quantityOrdered` | Unit count disappears after migration (deadline 2027-03-27); pick/stock must come from OL mapping | S4: "The total number of items that are included in the ASIN."; S5: 0 hits for NumberOfItems |
| MKT-05 | Amazon EU | Buyer | Ticks "this is a gift", adds wrap + message | `IsGift`="true", `GiftWrapPrice`, `GiftWrapTax`, `GiftMessageText` (v0); `giftOption` (v2026) | Easy to misread `IsGift` as "free item"; gift wrap is a paid extra with its own tax | S4: "Indicates whether the item is a gift." / "GiftWrapPrice: The gift wrap price of the item." |
| MKT-06 | Amazon EU | Seller | BOGO / percentage promo | v0 `PromotionDiscount`, `PromotionIds`; v2026 `promotion.breakdowns[].promotionId` + `proceeds` DISCOUNT | Unclear whether discount is inside `ItemPrice`; v2026 has no per-promotion amount | S7 #4858: "no information if this is already applied to `ItemPrice` or not" |
| MKT-07 | Amazon EU | Accountant | Item given 100% free (Vine) | 100% promo on item | Not reflected in Amazon VAT transaction report - document mismatch | S7 #5191: "this discount is not reflected anywhere in the `GET_VAT_TRANSACTION_DATA` report" |
| MKT-08 | Kaufland | Merchant | Buyer orders 3 of the same set with a volume discount | 3 order units, each `price` (post-discount), `discounts[{usage_type:"volume", discount_value}]`, `vat` | Must re-group units by `id_order` + `id_offer` to rebuild a line; one `vat` per unit | S11: "If the same unit gets ordered several times, several order units are created." |
| MKT-09 | Kaufland | Merchant | Kaufland runs a marketplace-funded promotion | Order unit shows nothing about it | Buyer paid less than `price`? VAT base question (third-party consideration, Art. 73) invisible | S11: "Kaufland-funded promotions are not reflected in this field." |
| MKT-10 | Kaufland | Buyer | Set arrives with one component broken | Return per `id_order_unit` or partial refund `amount` + `reason` | No component reference; OL must record which component | S10 `OrderUnitRefundRequest {amount, reason}`; reasons incl. `incomplete_delivery` |
| MKT-11 | Empik (Mirakl) | Merchant | "Buy laptop, get mouse free" (FREE_ITEMS) | Line `promotions[{id, deduced_amount, offered_quantity, configuration.type:"FREE_ITEMS", free_items_quantity, apportioned}]` | Whether free unit is inside `quantity`, and on which line, unknown; Empik enablement unknown | S13: "The quantity of free items offered by the promotion for this line." |
| MKT-12 | Empik (Mirakl) | Merchant | Partial refund of one component of a set line | OR28 `{order_line_id, amount, taxes[], quantity, reason_code}` | Quantity is "informative only" - money, not units, is authoritative | S13: "The quantity of products to refund. This quantity is informative only." |
| MKT-13 | eBay | Seller | Lists a 4-tyre lot | Order line `quantity`=1; `lotSize`=4 only on the listing | Unit count not on order; adapter must look up listing | S16: "the integer value passed into this field is the total number of items in the lot" |
| MKT-14 | eBay | Seller | BOGO promotion | `appliedPromotions[{promotionId, description, discountAmount}]`, `lineItemCost`, `discountedLineItemCost` | Discount at line level only; free unit not flagged | S16: "Use this field to configure "Buy One Get One" (or BOGO) discounts." |

## Order-shape cheat-sheet

| Field concept | Erli | Amazon v0 | Amazon v2026 | Kaufland | Mirakl/Empik | eBay |
|---|---|---|---|---|---|---|
| Line grain | line + qty | item + qty | item + qty | **1 unit, no qty** | line + qty | line + qty |
| Unit price | `unitPrice` (gross, minor units) | derive `ItemPrice/QuantityOrdered` | `product.price.unitPrice` | `price` (post-discount, cents) | `price_unit` | `lineItemCost/quantity` |
| Pre-discount price | `unitPriceBeforeRebate` | Unknown (`ItemPrice` vs discount unclear) | n/a | `price + discount_value` | `origin_unit_price` | `lineItemCost` |
| Discount amount | none (derive) | `PromotionDiscount` (+Tax) | `proceeds` DISCOUNT | `discounts[].discount_value` | `promotions[].deduced_amount` | `appliedPromotions[].discountAmount` |
| Promotion id | `rebate.id` (order level) | `PromotionIds[]` | `promotion.breakdowns[].promotionId` | none (`usage_type` only) | `promotions[].id`, `campaign.identifier`, `promo_code` | `appliedPromotions[].promotionId` |
| Free quantity | none | none | none | none | `offered_quantity`, `free_items_quantity` | none |
| Multipack count | none | `ProductInfo.NumberOfItems` | none | none | none | listing `lotSize` only |
| Gift wrap / message | none | `IsGift`, `GiftWrapPrice/Tax`, `GiftMessageText` | `giftOption`, proceeds GIFT_WRAP | none | Unknown | none (`giftDetails` = digital gift cards) |
| VAT per line | `taxRate` (1 enum) | `ItemTax` amount | `tax` / proceeds TAX | `vat` (1 rate) | `taxes[]` (array) | `taxes[]`, collect-and-remit |
| Return grain | line index + qty | order item | order item | order unit | line + amount | line |
| Funder visible | No (removed 2026-08) | No | No | Seller-funded only | `price_amount_breakdown` flags (advanced) | No |

## Adapter can / cannot derive

**Can derive**
- Discount per line: Erli (`unitPriceBeforeRebate - unitPrice`), Kaufland (`discount_value`), Mirakl (`deduced_amount`), eBay (`discountAmount`), Amazon v0 (`PromotionDiscount`, semantics shaky).
- Promotion identity: Amazon, Mirakl, eBay (ids); Erli (order-level rebate id only); Kaufland (type only).
- Free-item quantity: only Mirakl (`offered_quantity`).
- Buyer gift option vs free item: Amazon (and must keep them apart).
- Mixed-rate split: nowhere at component level; Mirakl's `taxes[]` array is the only shape that could carry more than one rate per line (Empik practice Unknown).

**Cannot derive (must come from OL's own bundle definition)**
- Components of a set on any of the five channels (all treat a set as one product/EAN/ASIN/listing).
- Component quantities for stock decrement, pick lists, component VAT split, component returns.
- Multipack unit count on Amazon after v2026 migration and on eBay lots (listing lookup needed).
- Who funded a discount (Erli removed `donorType`; Kaufland hides marketplace-funded promos; Amazon/eBay do not state it on the order).
- Which component a return/partial refund concerns (all channels are line/unit grain; Mirakl refund quantity "informative only").

## Country-agnostic notes (VAT / receipts outside Poland)

1. **EU baseline - free giveaway vs discount.** Art. 16: disposal "free of charge ... shall be treated as a supply of goods for consideration ... However, the application of goods for business use as samples or as gifts of small value shall not be treated as a supply" (S18). Art. 79(b): the taxable amount excludes "price discounts and rebates granted to the customer and obtained by him at the time of the supply" (S18). So a "free" item tied to a purchase can be modelled as part of the paid supply (consideration covers both) rather than a separate free supply - national practice decides (see UK/DE/IT below).
2. **Third-party-funded discounts.** Art. 73: taxable amount includes "everything which constitutes consideration obtained ... from the customer or a third party, including subsidies directly linked to the price" (S18). A marketplace-funded discount (Kaufland, possibly Erli) may mean the VAT base is higher than what the buyer paid - and the order does not tell you (MKT-09). HMRC says the same for manufacturer-funded multisaves: retailer receipts "represent further consideration for the supply to the customer" (S19 §6.2).
3. **Invoice content.** Art. 226(6) requires "the quantity and nature of the goods supplied" and (8) "the unit price exclusive of VAT and any discounts or rebates if they are not included in the unit price" (S18). Interpretation (not verified with a tax adviser): a free unit that physically ships should appear on the invoice with its quantity, and the discount either inside the unit price or shown separately.
4. **UK.** BOGOF, 3-for-2, "buy a sofa and get a free foot stool": "This is normally referred to as a multiple supply and the total amount you receive from the customer will usually cover all the goods and services involved. If the items offered are liable to different rates of VAT you will usually have to apportion" (S19 §6.1). The linked-supplies concession (minor item at main item's rate) "has been withdrawn" (S19, updates 13 Feb 2026 / 25 Jun 2026) - so mixed-rate apportionment is now unavoidable for UK multi-buys. Separate business gifts: no VAT if total cost to one person "does not exceed £50, excluding VAT, in any 12-month period" (S19 §2.3).
5. **Germany.** UStG §3(1b) Nr. 3 deems "jede andere unentgeltliche Zuwendung eines Gegenstands, ausgenommen Geschenke von geringem Wert und Warenmuster" a supply (S20). Bundle price split across rates: BFH XI R 19/23 (22.01.2025) - a split method "die dazu führt, dass auf ein Produkt einer rabattierten Warenzusammenstellung ein anteiliger Verkaufspreis entfällt, der höher ist als der Einzelverkaufspreis, ist nicht sachgerecht" (S21) - i.e. component allocation must not exceed standalone prices. Receipts: KassenSichV §6 requires "die Menge und die Art der gelieferten Gegenstände" and "das Entgelt und den darauf entfallenden Steuerbetrag ... sowie den anzuwendenden Steuersatz" (S20) - a set on a receipt needs rate-correct lines. Direct-tax gift cap (not VAT): EStG §4(5) Nr. 1 "insgesamt 50 Euro nicht übersteigen" (S20).
6. **Italy.** Per S22 (secondary, quoting the law): DPR 633/72 art. 15 excludes from the taxable base "il valore normale dei beni ceduti a titolo di sconto, premio o abbuono" if "in conformità alle originarie condizioni contrattuali", but not when the free goods carry a higher VAT rate; invoice uses nature code N1; on the documento commerciale (receipt), circ. 3/E/2022 allows the free item as its own line plus a negative "SCONTO" line, only if its rate is not higher than the other goods'. Free gifts outside the purchase (omaggi) outside VAT if unit cost ≤ 50 EUR (art. 2 n. 4, per S22).
7. **Common pattern.** In UK, DE and IT the rate of the free/discounted component matters: a "free" item at a higher rate than the paid item either cannot be zero-valued (IT) or forces apportionment (UK, DE). A neutral model needs per-component rate + allocation, not just "gift = price 0".

## Conflicts / open questions
- Amazon bundle rules: secondary sources disagree on whether a new UPC is required and who may bundle (S9). Official Seller Central pages not read (login). Not trusted for conclusions.
- Amazon virtual bundles in EU: S8 says US-only (undated); not confirmed for 2026.
- Empik API: live probe says Mirakl (S14); a connector vendor describes a different OAuth API on `developer.empik.com` (host did not resolve). Trust S14.
- Erli rebate funder: field removed from orders; billing endpoint hints at seller reserve. Unknown per order.
- Mirakl FREE_ITEMS: whether the free unit is inside `quantity` - not stated. Needs a sandbox order.
- Directive text taken from the UK-hosted copy frozen at 31.12.2020; EUR-Lex fetch blocked. Articles 16/73/79/226 are believed unchanged, not re-verified.

## Confidence
- High: Erli order/return shape (spec + changelog + code); Kaufland unit grain, discounts, refunds (spec + docs); Mirakl promotion fields (spec); eBay line/promotion/lot fields (spec); Amazon v0/v2026 field definitions (official models); UK §6.1 and withdrawal of concession; DE statute texts; BFH headnote.
- Low: Amazon bundle policy and virtual bundles (secondary only); Empik actual promotion enablement; Italian rules (secondary press quoting the law).
- Unverified hypotheses: how Amazon BOGO free units appear; whether Mirakl free units count in `quantity`; whether marketplace-funded discounts change the seller's VAT base on these channels.

## Surprises
1. Kaufland has **no quantity field**: 3 sets = 3 order units, and marketplace-funded promotions are invisible in the order (S11).
2. Amazon's new Orders API (v2026-01-01, mandatory by 2027-03-27) **drops `NumberOfItems`** and per-promotion amounts - multipack and promo data get thinner, not richer (S5, S6).
3. Erli **removed `rebate.donorType`** from orders on 2026-08-19 and the in-repo swagger is stale (still `quentity`, PL-only), while Erli now has a `de` market and EUR (S2).
4. Mirakl is the only channel with a real **free-item model** (`FREE_ITEMS`, `offered_quantity`, `apportioned`) - but whether Empik switches it on is Unknown (S13).
5. UK **withdrew the linked-supplies concession** in 2026, so a "free" lower-value item can no longer simply follow the main item's VAT rate (S19).
