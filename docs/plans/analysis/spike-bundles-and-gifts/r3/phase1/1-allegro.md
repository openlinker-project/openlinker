# R3 phase 1 / 1 - Allegro: bundles ("zestawy") and free gifts ("gratisy")

Round 3, blind replication. Researched 2026-11-04 from scratch (no earlier-round material read).

## Sources consulted

Primary (API spec):
- **S1** `https://developer.allegro.pl/swagger.yaml`, downloaded 2026-11-04, `version: 'latest'`, sha256 `26f1d6b2f674073f9c198cd4a90ae71f0f950f29c2b4dd5ff08ddcb12f92567c` (kept in session scratchpad, not in repo). Line numbers below refer to that file.

Primary (Allegro developer news / tutorials / official GitHub forum, answered by Allegro staff):
- **S2** developer news 2026-10-15 "Rabaty ilościowe - wycofujemy możliwość tworzenia rabatu typu multipack" https://developer.allegro.pl/news/rabaty-ilosciowe-wycofujemy-mozliwosc-tworzenia-rabatu-typu-multipack-4R3MoYWrPi5 + mirror GitHub issue https://github.com/allegro/allegro-api/issues/14168 (comment 2026-10-19 moves date from 30 Nov 2026 to 12 Jan 2027).
- **S3** developer news 2026-01-29 "Zestawy elastyczne - wprowadzimy nowe zasoby do obsługi zestawów ofert" https://developer.allegro.pl/news/zestawy-elastyczne-wprowadzimy-nowe-zasoby-do-obslugi-zestawow-ofert-g0OZM8v1RUY
- **S4** developer news 2024-10-03 "Udostępniliśmy nowe zasoby do obsługi zestawów ofert" https://developer.allegro.pl/news/udostepnilismy-nowe-zasoby-do-obslugi-zestawow-ofert-x5xGRdvjzH3
- **S5** tutorial "Rabaty i promocje" https://developer.allegro.pl/tutorials/jak-zarzadzac-rabatami-promocjami-yPya2mj6zUP
- **S6** tutorial "Zamówienia" https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR
- **S7** GitHub allegro-api #12748 (2025-12-01, production order, answered by Allegro staff MartaNowaczyk) https://github.com/allegro/allegro-api/issues/12748
- **S8** GitHub allegro-api #9790 (2024-09, staff PrzemyslawLukanowski) and #9671 (2024-08, staff MaciejFrackowiak), #13348 (2026-04-30, staff MaciejFrackowiak), #822 (2018 news "Nowe pole discounts").

Primary (Allegro seller help, official but marketing-ish):
- **S9** help.allegro.com "Granting discounts for the purchase of multiple products" https://help.allegro.com/en/sell/a/granting-discounts-for-the-purchase-of-multiple-products-K6VzjEY01TE (no date shown)
- **S10** help.allegro.com "From now on, we will also display multipacks on the offer page" (2026-06-24) https://help.allegro.com/en/sell/a/from-now-on-we-will-also-display-multipacks-on-the-offer-page-m0b8jmavMh5
- **S11** allegro.pl/pomoc aktualności "Zestawy produktów" (2022-04-04, flagged by Allegro as possibly outdated) https://allegro.pl/pomoc/aktualnosci/zestawy-produktow-skorzystaj-z-nowej-mozliwosci-sprzedazy-v8yKMW6klFY

Secondary:
- **S12** Allegro community forum, official moderator posts 2020-07 https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695 (moderator = Allegro employee, but forum, and 6 years old)
- **S13** Comarch e-Sale help, 2025-01-27 https://pomoc.comarch.pl/esale/dokumentacja/czym-sa-zestawy-ofert-i-rabaty-ilosciowe-w-allegro/ (integrator docs)
- **S14** Regulamin Allegro gratis clause - only seen via search-engine excerpt; allegro.pl/regulamin returned 403 to curl/WebFetch. Treated as (unverified wording).

Code (current OpenLinker adapter):
- `libs/integrations/allegro/src/domain/types/allegro-api.types.ts:75-106` - wire type of `lineItems` (no `productSet`, `originalPrice`, `discounts`, `reconciliation`).
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:998-1017` - line mapping.
- `libs/integrations/allegro/src/infrastructure/adapters/allegro-customer-return.mapper.ts:112-123` - return line mapping.

Not done: no live sandbox order was placed (no credentials used in this round). Every "how it arrives" statement for flexible bundles and productSet offers is from spec + staff answers, not a live capture, unless stated.

---

## 1. The five Allegro mechanisms that look like a "bundle"

| # | Mechanism | Lives where | Status 2026-11 | Own offer id? |
|---|---|---|---|---|
| M1 | **Product-set offer** ("zestaw produktów") - one offer whose `productSet[]` lists several catalog products with per-product `quantity.value` | the offer itself (`/sale/product-offers`) | Active | Yes |
| M2 | **Multipack offer** ("wielopak") - product-set offer with ONE product and `quantity.value > 1` | the offer itself | Active; becomes the official replacement of M4 | Yes (separate offer from the single-unit offer) |
| M3 | **Offer bundle** ("zestaw ofert", `/sale/bundles`) -> **flexible bundle** (`/sale/flexible-bundles`, slots) | promotion layer over existing offers | `/sale/bundles` deprecated, POST already gone from spec; flexible bundles active | No |
| M4 | **MULTIPACK promotion** (`UNIT_PERCENTAGE_DISCOUNT`, one offer) | `/sale/loyalty/promotions` | Creation + listing withdrawn **12 Jan 2027**, all existing deleted | No |
| M5 | **CROSS_MULTIPACK promotion** (same benefit, >1 offer, cheapest discounted) | `/sale/loyalty/promotions` | Stays | No |

Plus one non-mechanism: **gift described only in the offer text** (regulamin permits gratis), which leaves no trace in the order at all.

### M1 Product-set offer
- Offer request: `SaleProductOfferRequestV1.productSet[]` items = `ProductSetElement` + `ProductSetElementQuantity` + GPSR/deposit/composition per element (S1:32648-32666).
- `ProductSetElementQuantity`: "The number of a given product included in a single offer sold as an element of a product set. **Note:** For number of sets available in stock, use `stock.available` property." (S1:33019-33022)
- Stock unit enum includes `SET` (S1:32640-32646).
- Max products: "W zestawie może być maksymalnie 5 różnych produktów." (S11, 2022, Allegro flags it as possibly outdated; the 2026 spec has no `maxItems` on `productSet` - I found none.) Category: "Ofertę wyświetlimy w kategorii, w której znajduje się produkt główny." (S11)
- Stock: "Nie sprawdzamy wspólnych stanów magazynowych dla ofert z tym samym produktem." (S11) - Allegro deducts only from the offer bought; component stock is the seller's problem.
- Tax: one rate per offer per country - `OfferTaxSettings.rates[]` "Offer tax rate for country" (S1, `OfferTaxRate`). No per-component rate exists.
- Deposit: line-level deposit is summed - "If the offer consists of multiple products with different deposits, the value in this field is the sum of those deposits." (S1 `LineItemDeposit`, ~31086)

### M2 Multipack offer
- "Thanks to multipacks, you can sell **multiple units of the same product in a set**." / "It is impossible to buy products from a multipack separately." / "We display multipacks on the offer page only if it is cheaper or price-neutral for the buyer." (S10, 2026-06-24)
- Official replacement for M4: "...w obiekcie productSet przekażesz jeden produkt ze wskazaną w polu quantity.value wartością większą niż 1..." (S2)

### M3 Offer bundles -> flexible bundles
- Generation 1: bundles inside `/sale/loyalty/promotions`; S4 (2024-10-03) moved them to `/sale/bundles` and said of the old ones "W dniu 13.01.2025 całkowicie je usuniemy."
- Generation 2: `/sale/bundles` - in today's spec GET, GET/{id}, DELETE/{id}, PUT/{id}/discount are all `deprecated: true` (S1:3015, 3134, 3205, 3253). **There is no POST path any more**; only an orphan schema `CreateOfferBundleDTO` remains (S1:27901, referenced nowhere). S3 (2026-01-29) announced POST/GET/GET id/DELETE/PUT discount would be switched off together with the flexible-bundle launch "w drugiej połowie kwietnia 2026" and "Wraz z wdrożeniem zaczniemy przenosić istniejące zestawy ofertowe do nowego narzędzia."
- Old model: `BundledOfferDTO {id, requiredQuantity, entryPoint}`, discount = absolute amount per marketplace (`BundleDiscountDTO.amount` "Discount value", S1:27936-27952). `createdBy` `ALLEGRO` "when bundle was created automatically by Allegro" (S1:27985-27996).
- Generation 3 flexible bundles (S1:3351-3373): "there are max 6 slots in bundle"; "each slot can contain up to 30 offers"; "all offers in slot must be from the same category leaf"; "at least one slot has to be marked as entrypoint"; "offer can be used in bundle only once"; "B2B offers cannot be used"; "age-restricted offers (eg. alcohol) cannot be used"; "cannot use multiple offers which are representing same product"; "all offers in bundle have to be 1F or not 1F."
- Slot: `requiredQuantity` "Required quantity of offers from this slot"; offer flag `excludedFromDiscount` (S1:28184-28255).
- Discount: percentage, per marketplace; `WHOLE_BUNDLE_DISCOUNT` "means that the discount amount will be distributed proportionally across the offers in the bundle. SLOT_DISCOUNT allows you to specify which slots in the bundle are discounted and by how much" (S1:28318-28320). Whole-bundle `minimumBoughtOffers` 2..6. Percentage has no documented max (S1:28384-28396) - whether 100% (a free slot) is accepted is **Unknown**.
- Availability: "Offer can be unavailable to buy in bundle when it is not active on marketplace or it's stock is not sufficient." (S1:3379-3380) - bundle availability is derived from each member offer's own stock; there is no bundle stock.
- Bundles may be created by Allegro itself (`createdBy: ALLEGRO`, S1 `FlexibleBundleGetDTO`); S13: sellers are emailed and "Zestawy te możesz usunąć w dowolnym momencie."

### M4 / M5 Multipack promotions
- Spec (S1:4447-4455): "a single benefit of type **UNIT_PERCENTAGE_DISCOUNT** and a single criterion of type **CONTAINS_OFFERS** ... percentage should be an integer value greater than 15 for quantity 2, greater than 30 for quantity 3, greater than 40 for quantity 4, greater than 50 for quantity 5 and lower than or equal to 100 ... discountedNumber field must be set to 1 ... Cross-offer multipack ... more than 1 offer ... the cheapest of them gets a discount." Example: `percentage: 100, forEachQuantity: 3, discountedNumber: 1` (S1:4531-4547) = "buy 3, the 3rd is free".
- Withdrawal: "**12 stycznia 2027** wycofamy możliwość tworzenia oraz pobierania rabatów typu **multipack**" and "Wszystkie rabaty typu multipack zostaną usunięte z systemu." Cross-offer "pozostanie bez zmian" (S2; date moved from 30 Nov 2026 per #14168 comment).
- Today's spec still lists `promotionType` enum `MULTIPACK, CROSS_MULTIPACK, ...` (S1:4745-4746) - will be stale after 12 Jan 2027.

---

## 2. Exactly how things arrive in `GET /order/checkout-forms/{id}`

`CheckoutFormLineItem` (S1:31021-31074): required `id, offer, quantity, originalPrice, price`; optional `deposit, reconciliation, selectedAdditionalServices, vouchers, tax, boughtAt, discounts, serialNumbers, allegroAds`.

- `offer` = `OfferReference {id, name, external, productSet, hsNumber}` (S1:30229-30250).
- `offer.productSet` = `OfferProductSetReference.products[] {id (uuid), quantity}`: "If the offer was a product set, you can see a list of component products (product id with quantity)." (S1:30251-30282). IDs are **Allegro catalog product UUIDs**, not EAN or seller SKU. There is no per-component price, name, EAN, tax or external id.
- `quantity`: number of offer units (= sets for M1/M2). Component units = `lineItem.quantity × productSet.products[].quantity` (derived, not stated in spec; inferred from S1:33019-33022 "For number of sets available in stock, use stock.available").
- `price` vs `originalPrice` (S6 verbatim): price = "cena w chwili zakupu uwzględniająca ewentualne zniżki np. rabat ilościowy, zestawy, itp." ; originalPrice = "pierwotna cena w ofercie, przed zastosowaniem jakichkolwiek zniżek (rabatów ilościowych, zestawów itp.)". Staff: "lineItem.price.amount is a value after any discount." (S8 #9671). Both are **unit** prices (staff confirmed `totalToPay = delivery + price×quantity + surcharges`, S8 #9671).
- `discounts[]` = `LineItemDiscount {type}` - **type only, no amount, no bundle/promotion id** (S1:31255-31275). Enum: `BUNDLE` ("a bundle discount (used also for bundles with no price change)"), `UNIT_PERCENTAGE_DISCOUNT` ("a MULTIPACK or CROSS_MULTIPACK discount"), `WHOLESALE_PRICE_LIST`, `LARGE_ORDER_DISCOUNT`, `TURNOVER_DISCOUNT`, `COUPON`, `CAMPAIGN`. Staff 2024: "COUPON ... At this moment, this value will not be returned in any case" (S8 #9790).
- `reconciliation {value, type BILLING|WALLET, quantity}` - Allegro Prices subsidy (S1 `LineItemReconciliation`). Staff: "In the lineItems.reconciliation.value.amount we will return the gross amount returned by Allegro." (S8 #9790). Not bundle-related, but means `price` ≠ seller's net revenue.
- `selectedAdditionalServices[] {definitionId, name, price, quantity}` e.g. `GIFT_WRAP` exists as a service (S1:23338, 24120) - **gift wrap is a paid service, not a free gift**. Naming trap.
- `tax {rate, subject, exemption}` one per line item (S1 `CheckoutFormLineItemTax`).

### Per mechanism
- **M1 productSet**: one lineItem, `offer.productSet.products[]` populated, one price, one tax rate. (spec; no live capture this round)
- **M2 multipack offer**: one lineItem of the multipack offer id, `productSet.products = [{id, quantity: N}]`. (inferred from spec + S2; not live-verified)
- **M3 bundle (classic, live production evidence S7)**: bought items are separate lineItems; the **same offer can appear in two lineItems** differing only by `discounts: [{type: BUNDLE}]` vs `discounts: null`, identical `price`/`originalPrice` (2.62 both; a no-price-change bundle). Flexible bundle with discount: each member offer is its own lineItem with `BUNDLE` and a proportionally reduced `price` (spec S1:28318 "distributed proportionally"; S6 "zestawy" lowers `price`) - **(unverified live)**. Which lineItems form one bundle instance: **not exposed**.
- **M4/M5 multipack promo**: S9 "We automatically add the discount and divide it proportionally among all the products after the purchase." and "If the buyer purchases three units of that item, we will round it to a 6.67 PLN discount on each unit." and "The discounted prices are rounded down to grosz (0.01 PLN)." So a "3rd free" arrives as ONE lineItem quantity 3 with averaged unit `price` < `originalPrice` and `discounts:[UNIT_PERCENTAGE_DISCOUNT]` - **no zero-priced gift line**. For cross-offer: "We calculate the discount for several different products in the cart — from the price of the cheapest product." (S9) - discount amount then spread (S9 "among all the products"), so the per-line price does not show which unit was free.
- 100%: "If you enable a 100% discount, we will lower the item's price to 0.01 PLN, and charge you the minimum sales commission – 0.25 PLN." (S9; same in S12 2020: "Jeśli udzielisz 100% rabatu, obniżymy cenę przedmiotu do 0,01 zł i naliczymy minimalną prowizję w wysokości 0,25 zł"). **Price 0 is never produced by Allegro.**
- **Order-level `discounts` is gone from the spec**: `CheckoutForm` has no `discounts` property (S1 `CheckoutForm`), yet S6 tutorial and S8 #822 (2018) still describe an order-level list with `MULTIPACK`/`CROSSMULTIPACK`/`BUNDLE`; staff in 2024 still named `ALLEGRO_PRICES` (S8 #9790) which is not in today's `LineItemDiscount` enum. **Conflict: trust the spec** (machine-generated, current), treat tutorial as stale; adapter must tolerate unknown enum values.

### Campaigns
Staff 2026-04: for a campaign price "The values are the same, because the buyer sees the item with the price visible on the offer" and campaign is flagged via "lineItems.discounts.type ... CAMPAIGN" (S8 #13348). So `originalPrice == price` does not mean "no discount".

---

## 3. Returns, refunds, commission refunds, waybills

- **Customer returns** `CustomerReturnItem {offerId, quantity, name, price, url, reason, serialNumbers}` (S1:23216-23241) - **no lineItem id, no productSet component**. Staff refused to add a line reference: "są to sporadyczne przypadki i na ten moment nie mamy w planach takiej zmiany." (S7). Integrators map by `offerId + price`, which collides exactly in the bundle case (S7: two lineItems, same offer, same 2.62 price, one with BUNDLE).
- A component of a product-set offer cannot be named in a return; partial component return = return of `quantity` of the whole offer or free-text `userComment`. Reason `INCOMPLETE` exists (S1:23273-23281).
- **One Fulfillment only**: `FulfillmentRefundDisposition` has `product {gtins[], name, quantity}` + `stockStatus SELLABLE|NON_SELLABLE|MISSING|...` (S1:22853-22958) - the only place Allegro speaks at component/GTIN level. Not for seller-shipped orders.
- **Refunds** `InitializeRefund.lineItems[] {id, type QUANTITY|AMOUNT, quantity, value}` (S1:22580-22640, 23001-23037): line-level by quantity or amount. No component, no "gift" notion. A component refund must be expressed as `AMOUNT` on the set's line.
- **Commission refund claim** `RefundClaimRequest {lineItem.id, quantity}` (S1:22737-22751): per line + quantity, not per component.
- **Waybills** `CheckoutFormAddWaybillRequest.lineItems[] {id}` "When list is not provided or it is empty it means that every item from an order is included in shipment." (S1:31690-31726) - **no quantity**, so a quantity-3 line split across two parcels, or a set split by component across parcels, cannot be expressed; the same line id can only be attached to several waybills.

## 4. Commission
- Bundles: "w przypadku zestawów, które tworzysz z różnych ofert, prowizja jest pobierana od wszystkich przedmiotów, wchodzących w skład zakupu" and "nie znaczy, że sumujemy koszt zestawu i od tej kwoty naliczamy prowizję" (S12, moderator 2020; secondary/old).
- Gifts described in offer: "Nie pobieramy prowizji od gratisów rozumianych jako darmowe przedmioty, które oferujesz jako dodatek w swoich ofertach." (S12)
- 100% promo unit: 0.01 PLN price, min commission 0.25 PLN (S9).
- Product-set offer commission basis: **Unknown** (no primary source found; presumably the offer price, category of main product per S11).

## 5. Gift practices on Allegro
- Regulamin (S14, wording unverified - seen only as search excerpt): "Sprzedający może udzielić rabatu lub zaoferować bezpłatny dodatek do Towaru (gratis), pod warunkiem, że Kupujący ... nie jest wyłaniany w drodze losowania. Zarówno rabat jak i gratis muszą być określone w sposób jednoznaczny." and prohibited goods "nie mogą być oferowane ... jako bezpłatny dodatek (gratis)", except cosmetic samples in Uroda.
- Practices seen: (a) gift only in description -> **nothing in the order** (seller must know from offer config); (b) gift as an extra product in the `productSet` -> component UUID in order, not priced separately; (c) "buy N, 1 free" via MULTIPACK/CROSS_MULTIPACK 100% -> averaged price, `UNIT_PERCENTAGE_DISCOUNT`, min 0.01; MULTIPACK variant disappears 12 Jan 2027; (d) flexible bundle with a discounted slot (100% Unknown); (e) separate 0.01 gift offer bought together - **Unknown** whether minimum offer price allows; S12 forum hint that banks do not process ≤1 zł payments is (unverified).
- No gift object, no gift flag, no gift stock anywhere in the API (grep of S1 for "gift": only `GIFT_WRAP` service).

---

## 6. Use cases

| ID | Who | Scenario | What arrives (fields) | Pain | Source + quote |
|---|---|---|---|---|---|
| ALG-01 | Seller of kits (e.g. "zestaw kosmetyków") | Sells a fixed set as one product-set offer | 1 lineItem; `offer.productSet.products[{id uuid, quantity}]`; one `price`, one `tax.rate` | Components are catalog UUIDs (no SKU/EAN/price); OMS must map UUID->own variant to reserve/pick | S1:30266 "If the offer was a product set, you can see a list of component products (product id with quantity)." |
| ALG-02 | Seller of multipacks (6x water) | Sells 6-pack as its own offer (new official way) | 1 lineItem of multipack offer; `productSet [{id, quantity:6}]`; `quantity` = packs | Stock deduction = line qty × 6; no shared stock with single-unit offer | S2 "w obiekcie productSet przekażesz jeden produkt ze wskazaną w polu quantity.value wartością większą niż 1"; S11 "Nie sprawdzamy wspólnych stanów magazynowych" |
| ALG-03 | Seller with "3rd item free" promo | MULTIPACK 100%, buyer buys 3 | 1 lineItem qty 3, `price` averaged & rounded down, `originalPrice` full, `discounts[{type:UNIT_PERCENTAGE_DISCOUNT}]` | No zero line, no discount amount; gift invisible as a unit; rounding residue | S9 "We automatically add the discount and divide it proportionally among all the products after the purchase." |
| ALG-04 | Same, 100% | Free unit price | unit min 0.01 PLN, commission 0.25 | "Free" costs 0.25 PLN; never price 0 | S9 "we will lower the item's price to 0.01 PLN, and charge you the minimum sales commission – 0.25 PLN" |
| ALG-05 | Seller with cross-offer promo | CROSS_MULTIPACK: buy 3 of pool, cheapest free | several lineItems each with `UNIT_PERCENTAGE_DISCOUNT`, prices reduced | Cannot tell which unit was the free one; per-line discount spread | S1:4453 "the cheapest of them gets a discount"; S9 "divide it proportionally among all the products" |
| ALG-06 | Seller using flexible bundles | Phone + case + earphones bundle, 10% whole-bundle | N lineItems (one per offer), each `discounts[{type:BUNDLE}]`, `price` lowered | No bundle id / instance grouping in order (unverified live) | S1:28318 "WHOLE_BUNDLE_DISCOUNT means that the discount amount will be distributed proportionally across the offers in the bundle" |
| ALG-07 | Any seller (Allegro-made bundle) | Buyer buys same offer once in a bundle and once alone | Two lineItems, same offer id, same price, one `BUNDLE`, one `discounts:null` | Duplicate offer lines; returns cannot be matched | S7 lineItems `"discounts":[{"type":"BUNDLE"}]` vs `"discounts": null`, both price 2.62 |
| ALG-08 | Buyer returns 1 component | Returns earphones from a set | `CustomerReturnItem {offerId, quantity, price}` only | No component, no lineItem id; whole-offer granularity | S1 `CustomerReturnItem`; S7 staff "nie mamy w planach takiej zmiany" |
| ALG-09 | Buyer returns paid item, keeps/returns gift | Return after "3rd free" | Return of offerId qty n at line `price` (averaged) | Refund value per unit = averaged price; gift entitlement logic absent | S9 "A buyer can return the order in full or in part."; S1 `RefundLineItem` QUANTITY/AMOUNT |
| ALG-10 | 1F seller | Allegro warehouse return of a set component | `FulfillmentRefundDisposition.product {gtins, name, quantity}`, `stockStatus` | Component-level only for 1F; different shape from seller returns | S1:22940 `FulfillmentRefundDispositionProduct` "Product GTINs." |
| ALG-11 | Packer | Set split into 2 parcels / qty-3 line in 2 parcels | Waybill `lineItems[{id}]` no quantity | Partial line shipment inexpressible | S1:31717 "When list is not provided or it is empty it means that every item from an order is included in shipment." |
| ALG-12 | Accountant | Set with 5% book + 23% toy | single `tax.rate` per line; offer has one rate per country | VAT split impossible from Allegro data | S1 `OfferTaxRate` "Offer tax rate for country." |
| ALG-13 | Seller with description-only gift | "Gratis: brelok" in offer text | Nothing | OMS must attach gift from its own offer config; Allegro can't tell | S12 "Nie pobieramy prowizji od gratisów rozumianych jako darmowe przedmioty, które oferujesz jako dodatek w swoich ofertach." |
| ALG-14 | Integrator | Old MULTIPACK promos after 12 Jan 2027 | Promotions deleted; new orders come as multipack offers (ALG-02) | Mapping must handle both eras; historical orders keep `UNIT_PERCENTAGE_DISCOUNT` | S2 "Wszystkie rabaty typu multipack zostaną usunięte z systemu." |
| ALG-15 | Integrator | Campaign price, no visible discount | `price == originalPrice`, `discounts[{type:CAMPAIGN}]` | equal prices ≠ no discount | S8 #13348 "We return such information in the field "lineItems.discounts.type" - in your case "CAMPAIGN"." |

## 7. Adapter can / cannot derive

Can derive (from one checkout-form):
- That a line is a product set and its components as `(allegroProductUuid, qtyPerSet)` -> component units = line qty × qtyPerSet.
- That a line was discounted, and the per-unit discount = `originalPrice - price` (except campaigns, where equal).
- Discount *kind* per line (`BUNDLE`, `UNIT_PERCENTAGE_DISCOUNT`, `CAMPAIGN`, B2B kinds).
- Allegro-funded part (`reconciliation`), gift-wrap services, summed deposit.
- Per-line tax rate (nullable).

Cannot derive:
- Bundle instance grouping / bundle id / which lineItems belong together; which slot.
- Which unit of a multipack/cross-multipack was "free"; a separate gift line; any price 0.
- Discount amount per discount type when several apply (type-only array).
- Component SKU/EAN/price/tax (only Allegro catalog UUIDs) - needs catalog lookup or OL product mapping.
- Description-only gifts.
- Component-level returns (except 1F dispositions), return->lineItem link, partial-quantity waybills.
- Whether a flexible bundle at 100% slot discount is possible (Unknown).

Current OL adapter: wire type omits `productSet`, `originalPrice`, `discounts`, `reconciliation` (`allegro-api.types.ts:75-106`); mapper emits one item per line with `productRef {type:'offer', externalId: offer.id}` and `sku: lineItem.offer.id` (`allegro-order-source.adapter.ts:1004-1011`); return mapper says "its items key on `offerId` with no reference back to an order line" (`allegro-customer-return.mapper.ts:115-116`). So today a product-set line reserves/picks as one opaque offer.

## 8. Checklist (one line each)
- **Bundle definition**: four live forms - product-set offer (≤5 products per 2022 help), multipack offer (1 product qty>1), flexible bundle (2-6 slots, ≤30 offers/slot), CROSS_MULTIPACK; MULTIPACK promo dies 12 Jan 2027; `/sale/bundles` POST gone. Full (spec).
- **Variants in bundle**: flexible bundle slot lets buyer pick among up to 30 offers of one category leaf; product set fixed; `/sale/offer-variants` absent from spec. Partial.
- **Bundle stock**: product set = `stock.available` counts sets, no shared stock with component offers; flexible = each member offer's own stock, bundle availability computed. Full.
- **Bundle as offer**: yes for product set / multipack (own offer id); no for flexible bundle (promotion over offers). Full.
- **Order with bundle**: product set = 1 line + `productSet.products[{uuid, qty}]`; flexible = N lines with `discounts[BUNDLE]` (type only), price reduced proportionally (unverified live). Partial.
- **Packing/split parcels**: waybill `lineItems[{id}]` without quantity; no component split. None.
- **Component return**: `CustomerReturnItem` offer-level, no lineItem id, no component; 1F only has GTIN-level dispositions. None (Partial for 1F).
- **Return with gift**: no gift concept; returns of averaged-price units; refund by QUANTITY or AMOUNT. None.
- **VAT split**: one tax rate per line and per offer/country; mixed-VAT set not representable. None.
- **Gift source**: offer description (no data), product-set component, MULTIPACK/CROSS_MULTIPACK up to 100%, possibly flexible slot discount. Partial.
- **Gift stock/running out**: not modelled by Allegro anywhere; description gifts invisible; product-set component not separately stocked. None.
- **Gift on documents**: Allegro issues no invoice; data gives averaged prices, min 0.01; seller's documents must decide. None.
- **Gift limits**: no lottery, unambiguous terms, prohibited goods not as gratis (regulamin, unverified wording); promo % thresholds >15/30/40/50, ≤100; 0.01 floor + 0.25 min commission. Partial.

## 9. Surprises
1. **"Free" never arrives as a free line.** 100% promos become 0.01 PLN and the discount is spread proportionally over all units/products (S9), with a 0.25 PLN minimum commission. A neutral "gift line at price 0" cannot be fed from Allegro data - only reconstructed from OL's own promo config.
2. **`lineItems[].discounts` is type-only.** No amount, no bundle/promotion id, and `BUNDLE` is set "also for bundles with no price change" (S1). Production shows the same offer split into two identical-price lines (S7), which breaks offer+price matching of returns; Allegro declined to add a line id to returns.
3. **Three bundle API generations in two years** (promotions -> `/sale/bundles` 2024 -> flexible 2026, POST already removed) and **MULTIPACK promos deleted 12 Jan 2027** in favour of multipack *offers*. Orders before and after carry different shapes for the same commercial intent; historical orders keep `UNIT_PERCENTAGE_DISCOUNT`.
4. **Documentation conflict**: tutorial (S6) and 2018 news still describe an order-level `discounts` list with `MULTIPACK`/`CROSSMULTIPACK`; staff in 2024 named `ALLEGRO_PRICES`; none of these exist in today's spec (`CheckoutForm` has no `discounts`; enum lacks `ALLEGRO_PRICES`). Adapters must tolerate unknown discount types.
5. **Components are Allegro catalog UUIDs**, and the current OL adapter drops `productSet`, `originalPrice` and `discounts` entirely - today a kit sold on Allegro reserves and packs as one opaque SKU equal to the offer id. Also: `GIFT_WRAP` is a paid additional service, not a gift - a naming trap for any "gift" detector.

## Confidence
- High: spec field shapes (S1), deprecation dates (S2, S3 + spec flags), return/waybill limitations, 0.01/0.25 rule (S9 + S12 agree).
- Medium: proportional distribution and rounding of multipack discounts (S9 help text, not a live capture).
- Low / unverified: exact flexible-bundle order shape live; product-set 5-product limit in 2026; regulamin gratis wording; commission basis of product-set offers; whether a 0.01 standalone gift offer is allowed.
