# Research: bundles/sets and free gifts on marketplaces beyond Allegro

Spike: bundles/kits/sets + free gifts, one neutral standard mapped per adapter. Area 4: Erli, Amazon (EU, SP-API), Kaufland, Empik (Mirakl), eBay, Temu/AliExpress; plus non-PL fiscal angles of free items.
Date: 2026-11-04. Read-only research. "(unverified)" = not confirmed in a primary source.

## Sources consulted (primary first)

- Erli Shop API swagger, downloaded live: `https://erli.pl/svc/shop-api/doc/swagger.json` (85 schemas) + prose doc `https://erli.pl/svc/shop-api/doc/` - Order.items, Order.rebate, Order.returns, ProductCreate.productSets / externalProductSets, `/products/{externalId}/discount`, `automaticDiscountRuleId`, `basketLimit`, `cataloguePrice`.
- OpenLinker repo, Erli wire types (read only): `libs/integrations/erli/src/infrastructure/adapters/erli-order.types.ts` - confirms live order shape (`unitPrice`, `unitPriceBeforeRebate`, integer grosze; `rebate` not mapped today).
- Amazon SP-API models (GitHub `amzn/selling-partner-api-models`, `models/orders-api-model/`): `ordersV0.json` and the new `orders_2026-01-01.json`.
- eBay Sell Fulfillment API OAS3: `https://developer.ebay.com/api-docs/master/sell/fulfillment/openapi/3/sell_fulfillment_v1_oas3.json` (LineItem, AppliedPromotion, PricingSummary, GiftDetails, LinkedOrderLineItem).
- eBay Marketing API discount examples: https://developer.ebay.com/api-docs/sell/static/marketing/pm-discount-examples.html (BOGO = `forEachQuantity` + `numberOfDiscountedItems` + `percentageOffItem: 100`).
- Kaufland Seller API swagger: `https://sellerapi.kaufland.com/swagger.json` (OrderUnit, OrderUnitDetails, Voucher, CreateVoucherRequest).
- Kaufland Seller University, Bundles and EANs: https://www.kauflandglobalmarketplace.com/en/seller-university/formal-framework/bundles-and-eans/
- Mirakl MMP Seller API (Empik runs on Mirakl), OR11 schema extracted from `https://developer.mirakl.com/page-data/shared/api-docs-content/product/mmp/rest/seller/openapi3.json.json` (OR11_Response_200_Orders_OrderLines_Promotions etc.). Page: https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or11
- Empik catalogue/EAN model (secondary): https://pomoc.comarch.pl/esale/dokumentacja/oferta-czy-produkt-w-empikplace-jakie-sa-roznice/ , https://base.com/pl-PL/pomoc/faq/moduly-marketplace/empik/
- Amazon bundles (secondary only; official page G200442350 not retrieved): https://www.amzadvisers.com/?p=212711 , https://www.sellerapp.com/blog/amazon-virtual-product-bundles-program/ , https://blog.bqool.com/what-sellers-should-know-amazon-bundling-policy-2025/ , https://sellercentral.amazon.co.uk/seller-forums/discussions/t/f2a44a7c-c355-4a94-8646-32b3e0cc910e
- Amazon promotions (secondary): https://wiki.amazowl.com/sop/seller-central/create-buy-one-get-one , https://sellercentral-europe.amazon.com/seller-forums/discussions/t/2ba1496c-6a8d-4c19-88ba-d1e4c7280f7d
- Temu PL (thin): https://base.com/pl-PL/pomoc/wiedza/temu-konfiguracja-integracji/ , https://cross-border-magazine.com/temu-fined-in-poland/
- Fiscal/VAT: Directive 2006/112 Art. 16 https://legislation.gov.uk/eudr/2006/112/article/16/2020-01-01?view=plain ; ECJ C-48/97 Kuwait Petroleum summaries https://www.vatupdate.com/2022/03/08/roadtrip-through-ecj-cases-focus-on-free-products-art-16 ; UK gov.uk "VAT on discounts and gifts" https://www.gov.uk/charge-reclaim-record-vat/vat-on-discounts-and-gifts ; HMRC VATVAL03420 https://gov.uk/hmrc-internal-manuals/vat-valuation/vatval03420 ; M&S v HMRC [2019] UKUT 182 https://rpc.co.uk/thinking/tax-take/marks-and-spencer-free-wine-supplied-as-a-promotional-offer-was-subject-to-vat ; Ireland Revenue TDM gifts/promotional items https://www.revenue.ie/en/tax-professionals/tdm/value-added-tax/part03-taxable-transactions-goods-ica-services/Goods/goods-gifts-and-promotional-items-etc-20170524111919.pdf ; Italy omaggi https://www.studiopizzano.it/la-disciplina-iva-delle-cessioni-gratuite-e-degli-omaggi , https://www.fiscozen.it/guide/fattura-omaggio-rivalsa-iva/ ; Germany BFH XI R 19/23 (price split by individual selling prices) https://app.omnilex.ai/de/sources/court-decision/de-rii--stre202520153/bfh-2025-01-22-xi-r-1923

## Findings per marketplace

### Erli.pl (primary: live swagger)

Bundles:
- Product payload carries `productSets: {items: [{metaProductId:int, quantity:int}]}` and `externalProductSets: {items: [{externalMetaProductId:string, quantity:int}]}`, plus `externalMetaProductId`. So Erli has a NATIVE way to declare that a product is a set of N catalogue ("meta") products with quantities. Semantics are NOT described anywhere in the swagger or prose doc (no description strings). Most likely a catalogue-level declaration (what the set consists of, for search / product card), not a stock link. (unverified)
- Nothing indicates Erli decrements component stock: `stock` is a single integer per product. Bundle stock = seller-managed. (inferred from schema)
- Order line (`Order.items[]`) has `externalId`, `quantity`, `unitPrice`, `unitPriceBeforeRebate`, `name`, `sku`, `ean`, `taxRate` (enum TAX_0/5/8/23/NP/ZW/7/19), `weight`, `dispatchTime`. No component list on the order line: a set arrives as ONE line with the set's own externalId. Components must come from the seller's own bundle definition.
- Returns: `Order.returns[].items[] = {index, quantity}` pointing at the order line index. A return is at line (set) level; no component-level return. (primary)

Gifts / discounts:
- Order-level `rebate: {id, name, code?}` ("code: only for one-time codes") - identifies ONE rebate/coupon on the order, not per line. Per-line effect is only visible as `unitPriceBeforeRebate` vs `unitPrice` (integer grosze, per unit). No promotion id per line, no free-quantity field.
- Seller-side promos: `POST /products/{externalId}/discount` = timed price change (`newPrice`, `startAt`, `restoreAt`) - shows up just as a lower `unitPrice` (no flag). `automaticDiscountRuleId` on product (no description; unverified what rules exist). `cataloguePrice` = reference/strike-through price.
- No gift / free item concept in the API (0 matches for gift/gratis/bundle). A "gratis" on Erli would be either text in the description (seller ships an extra item, never on the order) or a 0-price product the buyer must add (unverified whether a 0 price is even allowed - `price` has only a maximum, no minimum).
- Multi-market: `currency` PLN|EUR, `market` pl|de, `taxRate` includes TAX_7/TAX_19 -> German VAT already appears on Erli orders. Note: OL's current Erli type says "PLN-only, no currency field" - swagger now has `currency` and `market`. (Surprise; flag for adapter.)

### Amazon (SP-API; primary for order shape, secondary for programs)

Bundles:
- A seller bundle/multipack is listed as its OWN ASIN + seller SKU (Product Bundling Policy, help G200442350 - text not retrieved; policy tightened 2024 for consumables, "Bundle" in title debated). (secondary)
- `ProductInfo.NumberOfItems` (v0): "The total number of items that are included in the ASIN" - a multipack count signal, not composition. (primary)
- Virtual Product Bundles (brand owners, sold as one detail page of 2-5 component ASINs): secondary sources say the order records the COMPONENTS (each component ASIN as if bought separately), bundle ASIN largely invisible in reports; stock = min of components; FBA-oriented; reportedly US-only (one source). Conflicting eligibility claims. (unverified)
- New Orders API 2026-01-01: `OrderItem.associatedOrderItems[]` with `associationType` VALUE_ADD_SERVICE | WARRANTY - Amazon links items, but NOT for bundles or gifts. (primary)

Gifts / promotions:
- v0 `OrderItem`: `ItemPrice` (= unit price x quantity, excludes shipping and gift wrap), `PromotionDiscount` ("total of all promotional discounts in the offer"), `PromotionDiscountTax`, `PromotionIds[]`, `ShippingDiscount`, `IsGift` ("whether the item is a gift"), BuyerInfo `GiftWrapPrice`, `GiftWrapTax`, `GiftMessageText` (MFN only), `GiftWrapLevel`. (primary)
- `IsGift` = buyer is sending it as a present (gift receipt/wrap), NOT a free item. Must not be mapped to "gratis". (primary semantics)
- 2026-01-01 API: `promotion.breakdowns[] = {promotionId}` ONLY (no amount on the promotion object); amounts move to `proceeds.breakdowns[]` typed ITEM/SHIPPING/GIFT_WRAP/COD_FEE/OTHER/TAX/DISCOUNT with `detailedBreakdowns` subtypes. So promotion id and promotion amount are in two different places, and with >1 promotion on a line the per-promotion amount is NOT recoverable. (primary)
- BOGO ("Buy one get one", "Buy X get Y"): free unit appears as a normal order item with full `ItemPrice` and `PromotionDiscount` equal to its price; if same ASIN, same line with quantity 2 and discount = 1 unit. (unverified - consistent with field semantics, not seen in a doc)
- Promotion discount is a seller-funded rebate charged back to the seller (forum). (secondary)

### Kaufland Global Marketplace (primary: live swagger)

Bundles:
- Policy: "Permissible bundles are offers that contain a combined, value-added offer of at least two different products" at one total price; e.g. pot set OK, "smartphone with the addition of a transparent cover" NOT OK; offers may be blocked. (primary, Seller University)
- Products are EAN-matched; a bundle needs its own product/EAN (secondary, not confirmed). No component structure in the API (0 matches "bundle"). Bundle stock = seller-managed per offer.
Order shape:
- Kaufland splits orders into `order_units`; each unit = ONE piece (no quantity field). Fields: `id_order_unit`, `id_offer` (seller SKU), `price` (per unit, cents), `revenue_gross`, `revenue_net`, `vat` (float %, e.g. 19), `discounts[] = {usage_type (e.g. "voucher"), discount_value (cents)}`, `eco_fee`, `packaging_fee`, `status`, `cancel_reason`, `storefront`, `currency`, `return_unit` (embedded). (primary)
- Discounts: only `usage_type` + amount. No voucher id on the unit (Voucher resource has `id_voucher` but no link from the unit). Vouchers are seller-created (`CreateVoucherRequest`: discount_type, discount_amount, products/eans, usage_limit). (primary)
- Gift: no free-item concept, no gift-wrap field. (primary, 0 matches)
- Returns/cancels per order unit (= per piece) -> naturally per-unit, but still per bundle-SKU, not per component.

### Empik (Mirakl MMP; primary: OR11 schema)

Bundles:
- Catalogue keyed by EAN/GTIN; offers attach to a product card (secondary). No bundle structure in the Mirakl seller API (0 matches "bundle"/"kit" across 1420 seller schemas). A set must be its own product (own EAN or Empik-approved, unverified) and one order line.
Gifts / promotions - the richest model of the group:
- Order line: `offer_sku` (shop SKU), `product_sku`, `product_shop_sku`, `quantity`, `price_unit`, `origin_unit_price` ("original unit price of the offer"), `price` (line, no shipping), `taxes[]`, `promotions[]`, `discount_campaign`, `price_amount_breakdown` (advanced). (primary)
- Line promotion: `id` (shop-defined), `deduced_amount` ("Promotion's amount for this line"), `apportioned` (true = reward split proportionally over several lines; false = whole reward on one line or same % on several), `offered_quantity` ("quantity of free items offered by the promotion for this line. Only applicable when promotion is of type FREE_ITEMS"), `promo_code`, `campaign`, `configuration{type: AMOUNT_OFF|FREE_ITEMS|PERCENTAGE_OFF|REDUCED_UNIT_PRICE, amount_off, percentage_off, reduced_unit_price, free_items_quantity, internal_description}`. Order: `promotions{applied_promotions[], total_deduced_amount}`, `discount_campaigns[]`. (primary)
- So Mirakl explicitly tells: which promotion, how much per line, whether it was spread, and how many units on this line are FREE. Whether the free units are counted inside `quantity` of the same line is not stated (likely yes - "for this line"). (unverified)
- Whether Empik's instance has seller promotions enabled is operator config (unverified).

### eBay (primary: Fulfillment OAS3)

Bundles:
- A seller bundle is its own listing (item specifics "Bundle Listing"/"Bundle Description" in many categories - unverified for EU sites). No component data in the order. Multi-variation listings give `legacyVariationId` + `variationAspects`. `linkedOrderLineItems` exists but is for related items in OTHER orders (e.g. tyre + installation), not bundles. (primary)
Gifts / promotions:
- LineItem: `lineItemCost` (unit x qty before discounts), `discountedLineItemCost` (only if promotion), `appliedPromotions[] = {promotionId, description, discountAmount}` (always present, may be empty), `quantity`, `sku`, `total`, `taxes[]`, `ebayCollectAndRemitTaxes[]` (EU VAT collected by eBay), `properties{fromBestOffer, soldViaAdCampaign}`. Order `pricingSummary.priceDiscount` (negative), `deliveryDiscount`, `adjustment`. (primary)
- BOGO free is configured as `forEachQuantity:1, numberOfDiscountedItems:1, percentageOffItem:100` -> in the order it is the same line, quantity 2, `appliedPromotions[].discountAmount` = one unit. No "free unit" flag. (config primary; order rendering inferred)
- `giftDetails` exists ONLY for digital gift card line items (message, recipientEmail, senderName). Not a free item, not gift wrap. (primary)

### Temu / AliExpress (PL local sellers)
- Thin signal. Temu has per-market seller tokens (Base.com guide); no public order-field docs found for bundle/gift/subsidy. Temu was fined by UOKiK over discount presentation (platform-funded vs seller pricing matters). AliExpress not researched to field level. Treat as: platform-funded discounts may exist and must not be assumed seller-funded. (unverified, thin)

## Checklist (one line each)

| Marketplace | Bundle definition | Bundle stock | Bundle as listing | Order with bundle | Component return | VAT split | Gift source | Gift on documents | Gift limits |
|---|---|---|---|---|---|---|---|---|---|
| Erli | Native `productSets` / `externalProductSets` {meta product, qty}; semantics undocumented | Single `stock` per product, seller-managed | Own product (externalId) | One line, set's externalId; no components | Line-index + qty only | One `taxRate` per line (no per-component) | No gift concept; order `rebate{id,name,code}`, timed `discount`, `automaticDiscountRuleId` | Only `unitPriceBeforeRebate` vs `unitPrice` | `basketLimit` per product (generic) |
| Amazon | Own ASIN (bundling policy); Virtual Bundles = component ASINs (US, brands) | Own SKU stock; VPB = min of components (secondary) | Own ASIN; `NumberOfItems` for multipacks | Own SKU line; VPB -> component lines (secondary) | Per order item | Per item tax; no per-component | BOGO/% promotions; `IsGift`=present, not free | `PromotionDiscount`/`PromotionIds` (v0); id and amount split apart (2026) | Promotion config in Seller Central, not in order |
| Kaufland | Policy: >=2 different products, one price | Per offer | Own product/EAN | One unit per piece, `id_offer` | Per unit (piece) | `vat` % per unit | Seller vouchers only | `discounts[{usage_type, discount_value}]`, no id | Voucher `usage_limit` |
| Empik/Mirakl | None in API; own EAN product | Per offer | Own product card | One line, `offer_sku` | Per line (OR28-style refunds, unverified) | `taxes[]` per line | Promotions incl. FREE_ITEMS | `promotions[].deduced_amount`, `offered_quantity`, `apportioned`, `origin_unit_price` | `free_items_quantity` in config |
| eBay | Own listing; item specifics | Per listing | Own listing | One line, `sku` | Per line | `taxes[]`/collect-and-remit per line | Seller discounts (BOGO, order discounts) | `appliedPromotions[{promotionId, discountAmount}]`, `discountedLineItemCost` | In Marketing API config |
| Temu/AliExpress | unknown | unknown | unknown | unknown | unknown | unknown | platform subsidies possible | unknown | unknown |

## What an adapter can / cannot derive

Can (reliably):
- Which OL product/SKU was bought, quantity, paid unit price - all five.
- List vs paid price per unit: Erli (`unitPriceBeforeRebate`), Mirakl (`origin_unit_price` vs `price_unit`), eBay (`lineItemCost` vs `discountedLineItemCost`), Amazon v0 (`ItemPrice` and `PromotionDiscount`), Kaufland (`price` and `discounts[]`).
- Promotion identity: Mirakl (`id`, `promo_code`, campaign), eBay (`promotionId`), Amazon (`PromotionIds`), Erli (order-level `rebate.id` only).
- Free units count: ONLY Mirakl (`offered_quantity`, type FREE_ITEMS).
- Spread vs single-line reward: ONLY Mirakl (`apportioned`).
- VAT rate per line: Erli (`taxRate`), Kaufland (`vat`), Mirakl (`taxes[]`); Amazon/eBay give amounts.

Cannot:
- Bundle composition from any order payload. Always from OL's own bundle definition keyed by SKU (Erli's `productSets` is the only marketplace-side composition, and it is on the product, not the order).
- Which lines belong to the same promotion, except Mirakl (shared promotion id across lines) and partly Amazon/eBay (same `PromotionIds`/`promotionId` on several lines - unverified for Amazon).
- Free unit identity on Amazon/eBay/Kaufland/Erli: a 100% discount looks like any discount; "free" must be inferred (discount == unit price x n).
- Per-promotion amount on Amazon 2026 when a line has 2+ promotions.
- Whether a discount is seller- or platform-funded (only partly: Amazon proceeds, Kaufland voucher_fee on Voucher resource).
- Component-level returns: every marketplace returns at line/unit level of the sold SKU.
- An off-platform "gratis" the seller just packs: never in the order on any of these.

## Country-agnostic notes (free items, VAT, receipts)

1. EU baseline (Directive 2006/112 Art. 16): applying business goods for no consideration is treated as a supply for consideration, EXCEPT samples and gifts of small value. Threshold is national. Do not hardcode a PL amount.
2. A "free" item tied to a purchase is often NOT a gift for VAT: the paid price is consideration for everything delivered and may need apportioning across items (UK: M&S "Dine in for 10" wine held taxable, [2019] UKUT 182; gov.uk: apportion link-save offers unless free item resale <GBP1, sale <GBP5, or cost <20% of others; same-rate multibuys: tax the combined price). ECJ C-48/97 Kuwait Petroleum went the other way for voucher-redeemed goods (supply without consideration -> self-supply). Commentators call the area inconsistent.
3. Consequence for the standard: a free line must be able to carry EITHER "price 0, apportioned share of the bundle/order price" OR "price 0, separate free supply with own VAT base". Pick per country/tax policy, not per marketplace.
4. Mixed VAT rates inside a bundle (e.g. 5% book + 23% toy; DE 7%+19%): the single bundle price must be split per component rate on the invoice. Germany BFH XI R 19/23 (2025): split by individual selling prices; a split giving an item more than its own selling price is not acceptable. Standard needs per-component reference prices.
5. Italy: discount goods ("sconto merce", art. 15 DPR 633/72) are excluded from the VAT base, while "omaggi" (art. 2 c.2 n.4) are a distinct regime with documentation (invoice "senza rivalsa" / N2 code, or omaggi register); input VAT recoverability depends on a value threshold (sources disagree 25.82 vs 50 EUR - verify). Need a typed reason: discount-in-goods vs gift.
6. Receipts: German KassenSichV and Italian documento commerciale itemise goods; whether a free item must be its own 0-price receipt line is not confirmed (unverified). Keep the free item as its own line in the model so a fiscal adapter can choose to print or merge it.
7. Marketplace-collected VAT (eBay `ebayCollectAndRemitTaxes`, Kaufland `is_marketplace_deemed_supplier`, Amazon deemed supplier) changes who issues the tax document; bundle/gift VAT split must not assume the seller always invoices.
8. Erli DE market already sends TAX_7/TAX_19 - the standard must not assume PL rate sets.

## Conflicts / open questions
- Amazon Virtual Product Bundles: sources disagree on availability (US-only vs EU) and eligibility; order rendering (components vs bundle) only from blogs. Needs Seller Central help or a live order.
- Erli `productSets` semantics (stock link? catalogue only?) - no description. Needs Erli support answer or a sandbox test.
- Mirakl `offered_quantity`: inside or outside line `quantity`? Needs a sample order.
- Amazon BOGO rendering (same line vs separate line, PromotionIds on qualifying vs free item) - not documented.
- Kaufland bundle EAN requirement - only secondary.

## Confidence
- High: order field shapes for Erli, Amazon (v0 + 2026), eBay, Kaufland, Mirakl OR11 (all from live specs).
- Medium: Kaufland bundle policy (official, short), eBay BOGO config.
- Low: Amazon VPB, Erli productSets meaning, Temu/AliExpress, receipt rules for free lines.

## What the caller might do with this
- Should the neutral standard treat "free" as a derived fact (discount == price) or a source-declared fact (Mirakl FREE_ITEMS)? Both occur; the standard likely needs `freeQuantity` with provenance (declared vs inferred).
- Should bundle composition always be OL-owned (since no order carries it), with Erli productSets as an optional publish target?
- Does the standard need a promotion grouping key (id) separate from the discount amount, given Amazon 2026 splits them?
- Is the 2026 Amazon Orders API on OL's roadmap? It changes where discount amounts live.
