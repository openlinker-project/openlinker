# Research: Bundles ("zestawy") and free gifts ("gratisy") on Erli, Amazon, Kaufland and Empik (Mirakl)

Phase 1 (problem) of the bundles/gifts spike. Researcher 4 of 5. Date: 2026-11-04.
Anything not confirmed by a source is marked (unverified). "Inference" = derived from field definitions, not stated by the source.

## Sources consulted

### Erli
- Erli Shop API sandbox swagger, checked into this repo: `docs/architecture/adrs/erli-sandbox-swagger.json` (title "Marketplace API", v1.0; live doc at sandbox.erli.dev/svc/shop-api/doc). Schemas read: `Order`, `ProductCreate`, `CreateDiscount`, `Discount`, `BillingEntriesResponse`; paths `/products/{externalId}/discount`, `/billing/company/rebates`.
- OpenLinker's own Erli adapter types: `libs/integrations/erli/src/infrastructure/adapters/erli-order.types.ts` (models `unitPrice`, `unitPriceBeforeRebate`; comment says the resource also carries `rebate`, not modelled).
- Picodi (buyer side, discount codes behind "Dodaj rabat"): https://www.picodi.com/pl/erli-pl
- Search for Erli seller set/bundle/gift features returned nothing official (thin signal).

### Amazon
- Orders API v0 model (official, GitHub): https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/orders-api-model/ordersV0.json
- Orders API 2026-01-01 model (official, GitHub): https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/orders-api-model/orders_2026-01-01.json
- getOrderItems reference (Pending orders carry no prices/promotions/gift status): https://developer-docs.amazon.com/sp-api/reference/getorderitems
- VAT Calculation Service changelog (KSeF Number column from 2026-04-01; shipment-level tax by rate from 2026-06-01 in PL and 9 other EU stores): https://developer-docs.amazon/sp-api/changelog/vat-calculation-service-updates
- Polish e-invoice columns (buyer-nip, seller-nip) in VAT Invoice Data Report from 2026-03-27: https://developer-docs.amazon.com/sp-api/changelog/addition-of-polish-e-invoice-columns-to-vat-invoice-data-report
- Order report attributes (gift-wrap-price, item-promotion-discount, ship-promotion-discount, promotion-ids): https://developer-docs.amazon.com/sp-api/docs/order-tracking-reports-attributes
- Virtual Product Bundles (all secondary): https://www.ecomcrew.com/get-started-with-amazon-product-bundling/ , https://canopymanagement.com/amazon-virtual-bundles-secret-weapon/ , https://www.helium10.com/es/blog/selling-on-amazon/how-to-sell-on-amazon-fba/using-amazons-virtual-product-bundle-tool/ , https://www.sellerassistant.app/blog/amazon-virtual-product-bundles-all-you-need-to-know/ , Seller Central forum on partial-bundle complaints: https://sellercentral.amazon.com/forums/t/virtual-product-bundles-new-beta/570520 , EU forum "Cannot List Virtual Bundle as FBA": https://sellercentral-europe.amazon.com/seller-forums/discussions/t/c461007f-255c-40ff-b5c9-f84686f91e89 and https://sellercentral-europe.amazon.com/seller-forums/discussions/t/493a42e3-ac75-4f6f-a299-2c9dc2c58522
- Bundling policy (secondary, quoting Amazon): https://blog.bqool.com/what-sellers-should-know-amazon-bundling-policy-2025/ , https://litcommerce.com/blog/guide-to-amazon-product-bundles/ , https://www.zentail.com/blog/9-ground-rules-of-product-bundling-on-amazon , https://www.sellerlabs.com/knowledge-base/product-bundling-multi-packs-that-avoid-variation-errors/
- BOGO promotions (secondary + forums): https://support.landingcube.com/article/38-create-a-buy-one-get-one-promotion , https://sellercentral-europe.amazon.com/seller-forums/discussions/t/7d12fb1a-a43f-40b5-bdc9-ba42b58f73fb , https://sellercentral-europe.amazon.com/seller-forums/discussions/t/a6fd7d39b30d1fabc9540954b7aa98d0

### Kaufland
- Seller API docs, Orders page (order units, discounts): https://sellerapi.kaufland.com/?page=orders
- Vouchers page: https://sellerapi.kaufland.com/?page=vouchers
- Order invoices page: https://sellerapi.kaufland.com/?page=order-invoices
- Returns page: https://sellerapi.kaufland.com/?page=returns
- Generated SDK model (OrderUnit field list): https://github.com/christian71-stack/kauflandV2/blob/HEAD/docs/Model/OrderUnit.md and OrderUnitsApi: https://github.com/christian71-stack/kauflandV2/blob/HEAD/docs/Api/OrderUnitsApi.md
- Product data "one product page per EAN" (secondary): https://wisepim.com/de/guides/marketplace-listing/kaufland
- PL coupon redemption fee 2 zł / 4 zł (secondary, seller studio): https://marszalstudio.pl/kaufland-marketplace/
- PL launch 7 Aug 2024: https://amavat.pl/kaufland-marketplace-w-polsce-7-sierpnia-2024/

### Empik (Mirakl)
- Mirakl Seller API OR11 (GET /api/orders): https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or11 . Full schema extracted from the page-data JSON: https://developer.mirakl.com/page-data/shared/api-docs-content/product/mmp/rest/seller/openapi3.json.json (schemas `OR11_Response_200_Orders_OrderLines`, `..._OrderLines_Promotions`, `..._Promotions_Configuration`, `OR11_Response_200_Orders_Promotions`, PR01 examples, document types).
- Empik buyer help "Czym jest Platforma Empik Marketplace": https://www.empik.com/pomoc/marketplace
- Empik shop terms (Empik not party to marketplace contracts; seller responsible for order and after-sale): https://empik.com/regulamin
- Mirakl operator-dependent promotion types incl. free items (help centre of another Mirakl operator): https://help.jinius.com.cy/hc/en-us/articles/28798415136913-How-can-I-create-a-promotion-in-Mirakl
- ChannelEngine Empik guide (margin VAT invoice offer attribute): https://support.channelengine.com/hc/en-us/articles/36744464583197

---

## Findings per marketplace

### 1. Erli.pl

**Bundle definition / listing.** The Shop API has no bundle concept. A product is `externalId` + one `price`, `stock`, `taxRate`, `ean`, `sku`, `invoiceType` (swagger `ProductCreate`). Variants are grouped across products with `externalVariantGroup` + `attributes`, not inside a product. So a set ("zestaw") is just another product the seller creates with its own `externalId`, its own stock number and ONE `taxRate`. (Confirmed by schema shape; that sellers do it this way is (unverified).)
**Variants inside a bundle:** not expressible.
**Bundle stock:** the seller pushes a single `stock` integer for the set product; Erli does not derive it from components (schema has no component list).
**Multi-buy / promotions:** 
- `POST /products/{externalId}/discount` "utwórz promocję czasową" = timed price drop: `{ newPrice, startAt, restoreAt, unfreezeAfterwards }` (grosze). Not a multi-buy.
- `automaticDiscountRuleId` (integer, nullable) on product: links a product to an automatic discount rule; the rule itself is not exposed in this API (unverified what rules exist).
- `cataloguePrice` + `referencePriceType: cataloguePrice` = strikethrough reference price.
- `basketLimit` 1..100 "Ograniczenie liczby na koszyk" - per-basket quantity cap.
- No buy-X-get-Y, no free-item field anywhere in the swagger.
**How it arrives in the order** (`Order`):
- `items[]`: `id` (int), `externalId`, `quantity`, `unitPrice` (int grosze), `unitPriceBeforeRebate` (int grosze, optional), `name`, `slug`, `ean`, `sku`, `weight`, `taxRate` enum `TAX_0|TAX_5|TAX_8|TAX_23|TAX_NP|TAX_ZW|TAX_7|TAX_19` ("Stawka VAT obowiązująca na produkcie w trakcie zamówienia").
- Order-level `rebate`: `{ id, name, code }` - `code` "tylko w przypadku jednorazowych kodów" (one-time codes only).
- `totalPrice` (int), `delivery.price`, `calculatedParcelsCount` ("Obliczona liczba paczek").
- So a discount is visible as per-line `unitPriceBeforeRebate - unitPrice` plus one order-level rebate identity. Who funds the rebate: `/billing/company/rebates` = "rezerwa i historia rabatów firmy (dotyczy wszystkich sklepów)", and billing entries carry `rebateOrigin[] {amount, rebateReason}` "Detale przyznanych rabatów". This suggests rebates are accounted through seller billing / a company rebate reserve, but who pays (Erli vs seller) is (unverified).
- OpenLinker today: the adapter type models `unitPriceBeforeRebate` but no mapper reads it (grep: only the types file), and `rebate` is not modelled at all.
**Packing / split parcels:** `calculatedParcelsCount` is Erli's estimate; a set product is one line, so the packer sees "1 x Zestaw X" with no component list from Erli.
**Returns:** `returns[]` with `items[] { index, quentity }` (sic, typo in Erli schema) - index points to the order `items` array. A set returns as one line; returning one component of a set is not representable (Erli only knows the set line). A gift that is a separate paid-0 line would be returnable by index; but Erli has no gift line concept, so a seller gift added outside Erli never appears.
**VAT split:** one `taxRate` per product/line. A mixed-rate set (e.g. book 5% + mug 23%) must be listed at one rate on Erli; splitting is the seller's job on the document. (Inference.)
**Gift source / stock / limits:** not applicable on Erli side - no gift mechanism; any gift is the seller's own decision outside the marketplace.
**Fiscal:** `invoiceType` per product: `vatInvoice | vatInvoiceWithMarginScheme | invoiceWithoutVat | withoutInvoice`. Seller issues the document (Erli is not the seller of record) (unverified for Erli specifically, consistent with model). A set mixing a margin-scheme item and a normal item cannot be expressed with one `invoiceType` (inference).

### 2. Amazon (amazon.pl / EU)

**Bundle definition.** Three distinct things:
1. **Multipack**: N units of the same item under its own ASIN/UPC (secondary sources quoting Amazon policy).
2. **Bundle listing (own ASIN)**: "Bundles consist of multiple single items that can each be identified by a unique ASIN/UPC and are sold together as a single offering. A pre-packaged kit ... identified by a single ASIN/UPC is not considered a bundle." Needs its own GS1 UPC/EAN; component identifiers do not transfer. Since the Oct-14-2024 policy update, most single-ASIN bundles must be packaged by the original manufacturer/brand (bqool, secondary). For OpenLinker this is just a normal SKU on the order - the seller (or brand) pre-packs it.
3. **Virtual Product Bundles** (Brand Registry only, 2-5 components, all components FBA, new, in stock, no separate inventory; each component ships separately). Secondary sources only; one forum report of a customer complaining after receiving only part of a bundle. EU forum reports that virtual bundles default to FBM and cannot be switched to FBA in Seller Central Europe (anecdotal). Availability in PL (unverified; sources list US/CA/UK/DE/FR/IT/ES/JP, not PL).
**Variants inside a bundle:** virtual bundles pick fixed component ASINs (unverified whether variant choice is possible; secondary sources imply fixed).
**Bundle stock:** virtual bundle availability derives from component FBA stock; "Amazon doesn't create a separate SKU for the bundle itself" (secondary).
**Order containing a bundle:**
- Own-ASIN bundle: one `OrderItem` with the bundle `SellerSKU`, `QuantityOrdered`, `ItemPrice`. `ProductInfo.NumberOfItems` = "The total number of items that are included in the ASIN" (v0) - the only bundle-ish hint; not a component list.
- Virtual bundle: no bundle field exists in either the v0 or the 2026-01-01 model (checked all definitions: no `bundle`/`kit`). Components therefore arrive as separate order items with their own SKUs (unverified - inferred from "no separate SKU" + model). Grouping back into "this was a bundle" is not possible from the API (inference). They are FBA, so the seller only sees them via the read-only FBA path.
**Order line fields (v0 `OrderItem`)** - all quoted from ordersV0.json:
- `QuantityOrdered`; `ItemPrice` "equal to the selling price of the item multiplied by the quantity ordered. ItemPrice excludes ShippingPrice and GiftWrapPrice"; `ItemTax`.
- `PromotionDiscount` "The total of all promotional discounts in the offer"; `PromotionDiscountTax`; `PromotionIds` (list); `ShippingDiscount`.
- `IsGift` (string "true"/"false") "Indicates whether the item is a gift" = buyer marked it as a gift (packing slip without prices), NOT a free item.
- `BuyerInfo` (restricted, needs RDT): `GiftWrapPrice`, `GiftWrapTax`, `GiftMessageText` (MFN only), `GiftWrapLevel`, `BuyerCustomizedInfo`.
- `AssociatedItems[]` {`OrderId`, `OrderItemId`, `AssociationType`} - for services/warranties, not bundles.
- Order: `FulfillmentChannel` MFN/AFN, `IsBusinessOrder`, `IsIBA`/`IsSoldByAB` (Amazon Business EU SARL buys and resells - becomes seller of record).
- Pending orders: no pricing, taxes, gift status or promotions returned (getOrderItems reference).
**Order line fields (2026-01-01 `OrderItem`)**: `orderItemId`, `quantityOrdered`, `product {asin, title, sellerSku, price.unitPrice, ...}`, `promotion.breakdowns[] {promotionId}` (ids only, no amount), `proceeds {proceedsTotal, breakdowns[] type ITEM|SHIPPING|GIFT_WRAP|COD_FEE|OTHER|TAX|DISCOUNT, detailedBreakdowns[] for TAX/DISCOUNT}`, `fulfillment.packing.giftOption {giftMessage, giftWrapLevel}`, `associatedOrderItems[]` (VALUE_ADD_SERVICE, WARRANTY). Order-level `packages[] {packageReferenceId, packageItems[] {orderItemId, quantity}}` (FBM only). In v2026 the discount amount moves from `PromotionDiscount` into `proceeds.breakdowns[type=DISCOUNT]`.
**Gifts / promotions:**
- Seller Promotions: percentage off and Buy One Get One (forum + guides). The customer must add the free item to the cart themselves (landingcube guide; forum). (unverified as official.)
- BOGO, same ASIN: inferred representation is one OrderItem `QuantityOrdered=2`, `ItemPrice=2*p`, `PromotionDiscount=p`, `PromotionIds=[promo]` (inference from field definitions; (unverified) without a real order).
- BOGO, different free ASIN: free ASIN as its own OrderItem with `ItemPrice` = its normal price and `PromotionDiscount` = same amount (inference, unverified).
- Gift wrap / gift message: `IsGift`, `GiftWrapPrice`, `GiftMessageText`, `giftOption` - a SERVICE, charged separately (proceeds `GIFT_WRAP`).
**Gift stock / running out:** a BOGO reward is a normal listing; it consumes normal stock; if the free item is out of stock the promotion cannot be fulfilled by the buyer adding it (inference).
**Packing / split parcels:** FBM orders can be shipped in multiple packages (v2026 `packages[]` with per-item quantities). Virtual bundle components ship separately by design.
**Returns:** per order item; a returned BOGO free unit or a returned bundle component is a normal order-item return; refund apportionment of the promotional discount is Amazon's (unverified details).
**VAT split:** one product tax code per ASIN (inference). An own-ASIN bundle with mixed rates therefore gets one rate on Amazon's side. VCS from 2026-06-01 computes tax "at the shipment level by applicable tax rate instead of by individual unit" in PL - so documents are by rate per shipment, and an OpenLinker-issued invoice can differ from Amazon's VCS figures by rounding if computed per unit (changelog).
**Fiscal:** VCS available in PL: Amazon can create invoices for the seller, or the seller uploads its own (`UPLOAD_VAT_INVOICE` feed). From 2026: KSeF Number column in the VAT Calculation Report (2026-04-01) and buyer-nip/seller-nip in VIDR (2026-03-27). E-receipt obligation for B2C sales on amazon.pl rests on the seller (unverified; general PL rule).

### 3. Kaufland.pl (Kaufland Global Marketplace; PL live since 2024-08-07)

**Bundle definition / listing.** Catalogue is EAN-based: "one product page per EAN"; offers (price/stock/condition) are separate from shared product data (secondary). A set therefore needs its own EAN and product data (inference; no official set/bundle page found).
**Variants inside a bundle:** not applicable (no bundle concept).
**Multi-buy:** yes, seller-funded `volume` discounts ("quantity-based pricing rules") and `voucher` discounts (`PERCENTAGE` max 85 or `ABSOLUTE` cents, `usage_limit`, up to 3000 products/EANs, storefront-specific, new condition only, cannot be scoped to a single unit) (vouchers page). PL redemption fee 2 zł (<=400 zł) / 4 zł per coupon (secondary). No free-item promotion type found.
**How it arrives in the order (orders page):**
- "Each order is composed of one or more order units, each corresponding to a unit." "If the same unit gets ordered several times, several order units are created." -> quantity 3 = 3 order units; no quantity field.
- Order unit fields: `id_order_unit`, `id_order`, `status`, `price` (post-discount, cents), `id_offer`, `revenue_gross`, `revenue_net`, `vat` (in examples), `shipping_rate`, `is_marketplace_deemed_supplier`, `fulfillment_type`, `product {...}`, `discounts[]`.
- `discounts[] { discount_value (cents, already subtracted from price), usage_type: voucher|volume }`. At most one discount per unit. "Only seller-created discounts appear here." Original price is not a field: price + discount_value. Example: price 4615, discount 500 voucher -> would have cost 5115.
- Kaufland does not reimburse the seller for the discount.
**Packing / split parcels:** each order unit is marked sent separately (`PATCH /order-units/{id}/send`), so an order can ship across parcels unit by unit.
**Returns:** return -> `return_units[] { id_order_unit, reason, status }`; refunds `PATCH /order-units/{id}/refund { amount, reason }` with reasons `defect|delivery_damage|delivery_delay|incomplete_delivery|incorrect_delivery|other_refund|refund_postage_fee|refund_return_postage_fee` (amount is seller-chosen, so partial refund possible). A set is one unit; returning one component of a set = partial refund on the set unit with `incomplete_delivery`-like reason (inference).
**VAT split:** one product per EAN; one rate per unit (`vat`). Mixed-rate sets cannot be split by Kaufland (inference).
**Gift source / stock / limits:** not applicable (no gift mechanism).
**Fiscal:** invoices are uploaded per ORDER: `POST /order-invoices/{id_order}` (not per unit). Who must issue: not stated on the page; `is_marketplace_deemed_supplier` exists but is undocumented there (likely the EU deemed-supplier case for non-EU sellers - unverified).

### 4. Empik Marketplace (Mirakl)

**Bundle definition / listing.** No bundle concept found in Mirakl order or offer APIs; sets are separate products in Empik's catalogue (unverified). Seller adds products in the Seller Panel (secondary).
**Multi-buy / promotions (Mirakl capability):** seller promotions via PR01 `/api/promotions` with types `AMOUNT_OFF|FREE_ITEMS|PERCENTAGE_OFF|REDUCED_UNIT_PRICE`, `trigger_offer_ids`, `reward_offer_ids`, `reward_on_purchased_items` ("Specifies if the promotion's reward applies to purchased items or to a specific selection"), `triggers[] {quantity_purchased, same_item_purchased, type: every_quantity}`, `application_to_cart[] {promo_code}`. Available "depending on your operator's configuration"; at least one Mirakl operator marks Free Items "not implemented yet". Whether Empik enables seller promotions at all: (unverified). Empik's own help: "Kody rabatowe oraz promocje w programie Empik Premium zostaną naliczone tylko dla zamówień realizowanych przez Empik" - buyer codes don't apply to marketplace sellers' orders. Operator-run "Akcje handlowe" (Black Week etc.) exist (secondary) -> `discount_campaign` on lines.
**How it arrives in the order (OR11):**
- `order_lines[]`: `order_line_id`, `offer_sku`, `product_sku`, `quantity`, `price_unit` ("Unit price for the offer associated with the order line"), `origin_unit_price` ("The original unit price of the offer"), `price` (line without shipping), `total_price` (with shipping and fees), `taxes[] {amount, code, rate, ...}` (array: several taxes per line possible), `discount_campaign {identifier}`, `promotions[]`, `refunds`, `cancelations`, `can_refund`.
- `order_lines[].promotions[]`: `id` ("Promotion's id, defined by the shop"), `deduced_amount` ("Promotion's amount for this line"), `offered_quantity` ("The quantity of free items offered by the promo..."), `apportioned` (bool), `promo_code`, `campaign.identifier`, `configuration {type, amount_off, percentage_off, reduced_unit_price, free_items_quantity ("Only applicable when promotion is of type FREE_ITEMS, null otherwise"), internal_description}`.
- order-level `promotions { applied_promotions[] (same shape), total_deduced_amount }`, `discount_campaigns`.
- Free item: arrives on the reward offer's line with `offered_quantity` > 0 and `deduced_amount` covering the free units. Whether the free units are included in `quantity` (so price_unit*quantity - deduced = price) is (unverified). `apportioned=true` likely means the deduction is spread across lines (unverified).
**Packing / returns:** per order line; Mirakl refunds per line (OR28, not researched in detail). A free item on its own line can be cancelled/refunded independently (inference).
**VAT split:** `taxes[]` per line allows multiple tax entries, but rate applies to the line's price; a mixed-rate set is still one offer at one rate (inference).
**Fiscal:** Empik is not party to the sale ("nie jesteśmy stroną umów"); seller is responsible for fulfilment and after-sale. Seller uploads the invoice as an order document of type `CUSTOMER_INVOICE` (Mirakl document types; OR74-style upload) and `has_invoice` flags availability. Margin-VAT invoice exists as an offer attribute (ChannelEngine). E-receipt duty is the seller's (unverified).

---

## Checklist matrix

| Item | Erli | Amazon | Kaufland | Empik/Mirakl |
|---|---|---|---|---|
| Bundle definition | none; set = own product | multipack / own-ASIN bundle / virtual bundle (BR, FBA) | none; set = own EAN (inf.) | none (unverified) |
| Variants inside bundle | no | fixed ASINs (unverified) | no | no |
| Bundle stock | single `stock` int pushed by seller | own-ASIN: own stock; virtual: from FBA components | seller offer stock | seller offer stock |
| Order with bundle | 1 line, set externalId | own-ASIN: 1 item (`NumberOfItems`); virtual: component items, no grouping (inf.) | 1 order unit PER PIECE | 1 line, qty |
| Packing / split parcels | `calculatedParcelsCount`, no component list | `packages[]` FBM; virtual bundle components ship separately | per unit send | per line |
| Return of a component | not representable (line-level only) | per item | partial refund on unit | per line refund |
| Return when gift included | no gift concept | free unit is a normal item | n/a | free line refundable (inf.) |
| VAT split of bundle price | one `taxRate` per product | one tax code per ASIN (inf.); VCS by rate per shipment from 2026-06 | one rate per unit | one offer, taxes[] per line |
| Gift source | none (seller's own) | BOGO seller promotion; buyer gift-wrap service | none | FREE_ITEMS promo (operator-dependent) |
| Gift stock / running out | n/a | reward ASIN normal stock | n/a | reward offer stock (inf.) |
| Gift on receipt/invoice | n/a | free unit with PromotionDiscount=price (inf.) | n/a | line with deduced_amount (inf.) |
| Gift limits | `basketLimit` per product only | promotion budget/limits in SC (unverified) | voucher `usage_limit` | promotion config (unverified) |

---

## Conflicts / open questions
- Amazon virtual bundles: sources disagree on market availability (US-only vs US/CA/UK/DE/FR/IT/ES/JP) and EU forum says they can only be FBM-listed while all sources say components must be FBA. PL availability not confirmed by any source.
- Amazon BOGO representation in the order (same-ASIN qty 2 vs separate item) is inferred from field semantics; needs a real order or the official Seller Central promotions help page (login-walled).
- Erli rebate funding (seller vs Erli) - billing has a "company rebate reserve", which hints that rebates hit seller billing, but nothing states who pays. This decides whether the receipt shows `unitPrice` or `unitPriceBeforeRebate`.
- Mirakl `offered_quantity` vs `quantity`: unclear whether free units are counted inside `quantity`.
- Whether Empik turns on Mirakl seller promotions at all.
- Kaufland `is_marketplace_deemed_supplier` meaning not documented on the pages read.

## Confidence assessment
- High: Amazon OrderItem fields (official models); Kaufland order unit per piece + discounts[] semantics + per-order invoice upload (official docs); Mirakl OR11 promotion fields and promotion types (official spec); Erli order/product schema (official swagger in repo).
- Medium: Amazon bundling policy and virtual bundle rules (secondary sources quoting Amazon).
- Low / unverified: how free items actually appear in Amazon and Mirakl orders; who funds Erli rebates; Empik promotion availability; PL e-receipt duties per marketplace.

## What the caller might do with this
- Decide whether OpenLinker's order model needs "original price + discount + promotion id + free quantity" per line, since Erli, Kaufland and Mirakl each expose a different subset (Erli: before/after price; Kaufland: discount_value; Mirakl: deduced_amount + offered_quantity; Amazon: PromotionDiscount or proceeds breakdown).
- Decide whether a marketplace "set" SKU should be expanded into components by OpenLinker (no marketplace in this group gives a component list).
- Decide how per-piece order units (Kaufland) are collapsed into lines before pack bench and documents.
- Ask a pilot merchant for one real Amazon BOGO order and one Erli rebate order to settle the unverified shapes.
