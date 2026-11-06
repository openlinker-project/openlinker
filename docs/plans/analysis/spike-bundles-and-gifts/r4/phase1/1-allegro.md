# R4 phase 1 - Allegro (primary sources only)

Date of research: 2026-11-04. Channel: Allegro.

## Sources consulted (all primary)

| ID | Source | Kind |
|---|---|---|
| S1 | `https://developer.allegro.pl/swagger.yaml`, downloaded 2026-11-04, 41 371 lines, sha256 `26f1d6b2f674073f9c198cd4a90ae71f0f950f29c2b4dd5ff08ddcb12f92567c`. Line numbers below refer to this file. | Official OpenAPI spec |
| S2 | developer.allegro.pl news (all 86 list pages crawled, 858 articles; slugs grepped for zestaw/bundle/multipack/rabat/gratis/wariant) | Official API changelog/news |
| S3 | `https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR` | Official API tutorial (orders, returns, refunds) |
| S4 | `https://developer.allegro.pl/tutorials/jak-jednym-requestem-wystawic-oferte-powiazana-z-produktem-D7Kj9gw4xFA` | Official API tutorial (product offers, product sets) |
| S5 | `https://developer.allegro.pl/tutorials/jak-zarzadzac-rabatami-promocjami-yPya2mj6zUP` | Official API tutorial (rebates, flexible bundles) |
| S6 | `https://allegro.pl/pomoc/aktualnosci/zestawy-produktow-skorzystaj-z-nowej-mozliwosci-sprzedazy-v8yKMW6klFY` (dated 4 Apr 2022, page itself warns it may be outdated) | Official seller help-center news |
| S7 | `https://allegro.pl/pomoc/aktualnosci/zapakuj-na-prezent-nowa-usluga-w-ofertach-allegro-D5VmO9rA9C7` (27 Jul 2017) | Official seller help-center news |
| S8 | `https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695` (posts 01-07-2020, 02-07-2020) | **Official moderator answer** (Moderacja Społeczności, "Natalia, Moderatorka Allegro"), old |
| S9 | `https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/gratis-do-zakup%C3%B3w/td-p/500411` (05-01-2023) | **Official (former) moderator answer** (ko_alka, "Była Moderatorka Społeczności"), via WebFetch summary |

Not reachable: `allegro.pl/regulaminy/...`, `allegro.pl/pomoc/dla-sprzedajacych/...` (404/403 to curl), `allegro.pl/dla-sprzedajacych/automatycznie-laczymy-wybrane-oferty-w-zestaw-K6VYllRgbs0` (403 to curl and WebFetch). The Allegro Terms of Service and the fee schedule were therefore NOT read; every claim about commission rests on S8 only (old moderator post) and is weak.

## Three different "bundle" concepts on Allegro

1. **Product set (zestaw produktowy) / multipack (wielopak)** - ONE offer whose `productSet[]` lists several catalogue products with per-unit quantities. Sold, stocked and priced as one offer.
2. **Offer bundle (zestaw ofertowy, `/sale/bundles`)** - several separate offers sold together with a fixed-amount discount. Being replaced; creation endpoint already switched off.
3. **Flexible bundle (zestaw elastyczny, `/sale/flexible-bundles`)** - slots of interchangeable offers, percentage discount. Live since 10 June 2026.
Plus **promotions**: MULTIPACK (n-th unit discount on one offer, being removed 12 Jan 2027) and CROSS_MULTIPACK (cheapest of N items across offers discounted, staying), both allowing up to 100% discount - the only API-level "free unit" mechanism.

## Exact schema quotes (S1)

### CheckoutFormLineItem (S1 l.31021-31067)
```yaml
CheckoutFormLineItem:
  required: [id, offer, quantity, originalPrice, price]
  properties:
    id: {type: string, format: uuid, description: Line item identifier}
    offer: {$ref: OfferReference}
    quantity: {type: number, format: integer, description: quantity, minimum: 1}
    originalPrice: {$ref: Price}
    price: {$ref: Price}
    deposit: {$ref: LineItemDeposit}
    reconciliation: {$ref: LineItemReconciliation}
    selectedAdditionalServices: {type: array, items: {$ref: CheckoutFormAdditionalService}}
    vouchers: {type: array, items: {$ref: LineItemVoucher}}
    tax: {$ref: CheckoutFormLineItemTax}
    boughtAt: ...
    discounts: {type: array, items: {$ref: LineItemDiscount}}
    serialNumbers: ...
    allegroAds: ...
  description: Order item
```
`price` and `originalPrice` carry NO description in the spec (only `$ref: Price`). The tutorial S3 gives the meaning: `"amount": "2999",    // cena w chwili zakupu uwzględniająca ewentualne zniżki np. rabat ilościowy, zestawy, itp.)` and for `originalPrice`: `// pierwotna cena w ofercie, przed zastosowaniem jakichkolwiek  zniżek (rabatów  ilościowych, zestawów itp.)`. Neither source says whether `price` is per unit or per line. (Unknown)

### OfferReference + productSet (S1 l.30229-30283)
```yaml
OfferReference:
  required: [id, name]
  properties:
    id: {type: string, example: '3213213'}
    name: {type: string, description: 'Offer name.'}
    external: {$ref: ExternalId}
    productSet: {$ref: OfferProductSetReference}
    hsNumber: ...
OfferProductSetReference:
  required: [products]
  properties:
    products: {type: array, items: {$ref: OfferProductSetProductReference}, description: List of products in a product set.}
OfferProductSetProductReference:
  required: [id]
  properties:
    id: {type: string, format: uuid, description: Product id.}
    quantity: {type: number, format: integer, minimum: 1, description: Product quantity in a product set.}
  description: Product element definition.
```
No price, no tax rate, no GTIN, no name per product element - only the Allegro catalogue product UUID and quantity.

### LineItemDeposit (S1 l.31086-31095)
"This is the deposit value charged for a given offer. If the offer consists of multiple products with different deposits, the value in this field is the sum of those deposits."

### CheckoutFormAdditionalService (S1 l.31117-31134)
```yaml
definitionId: {type: string, description: Additional service id, example: "CARRY_IN"}
name: {type: string, description: Additional service name, example: "Wniesienie"}
price: {$ref: Price}
quantity: {type: integer, minimum: 1, description: Quantity of an additional service}
```
S3 example: `"definitionId": "GIFT_WRAP", "name": "Zapakuj na prezent", "price": {"amount": "10.00", // jednostkowy koszt usługi`.

### LineItemDiscount (S1 l.31255-31277) - type only, no amount, no bundle id
```yaml
LineItemDiscount:
  properties:
    type:
      enum: [BUNDLE, UNIT_PERCENTAGE_DISCOUNT, WHOLESALE_PRICE_LIST, LARGE_ORDER_DISCOUNT, TURNOVER_DISCOUNT, COUPON, CAMPAIGN]
      description: >
        - `BUNDLE` - a bundle discount (used also for bundles with no price change)
        - `UNIT_PERCENTAGE_DISCOUNT` - a MULTIPACK or CROSS_MULTIPACK discount
        ...
```
News 5 May 2025 (`.../zamowienia-dodalismy-informacje-o-rabatach-i-znizkach-dla-kazdej-pozycji-zakupowej-zl7ZYa04GSO`): "Dzisiaj wprowadziliśmy nowe pole “lineItems[].discounts”, dzięki któremu informację o rabatach i zniżkach zwracamy dla każdej pozycji zakupowej" and the order-level `discounts` "7 stycznia 2026 całkowicie je usuniemy".

### CheckoutFormLineItemTax (S1 l.31172-31189)
`rate` ("The tax rate.", nullable, example '23.00'), `subject` (example 'GOODS'), `exemption` (example 'MONEY_EQUIVALENT') - ONE rate per line item. Offer side: `OfferTaxSettings` (S1 l.29912) `rates: Tax rates for offer.`, `OfferTaxRate: Offer tax rate for country.` - one rate per country per offer, set at offer level (S1 l.32553 `taxSettings` is a property of the offer body, not of `productSet[]`).

### CustomerReturnItem (S1 l.23216-23241)
```yaml
CustomerReturnItem:
  properties:
    offerId: {type: string}
    quantity: {type: integer, format: int64}
    name: {type: string, example: 'Product name'}
    price: {$ref: Price}
    url: {type: string}
    reason: {$ref: CustomerReturnItemReason}
    serialNumbers: {type: array, description: List of serial numbers of included items}
```
No `lineItemId`, no product id. S3 labels `price` as `// cena jednostkowa`. `CustomerReturn.items` = "List of returned items." (S1 l.23149-23153).

### RefundLineItem (S1 l.23001-23038) and RefundDetails (S1 l.22758)
```yaml
RefundLineItem:
  required: [id, type]
  properties:
    id: {format: uuid, description: The line-item identifier.}
    type:
      description: Type for line items refund. QUANTITY is provided when you can refund one or more items. AMOUNT is provided when you can refund a partial price.
      enum: ["AMOUNT", "QUANTITY"]
    quantity: {type: number, minimum: 0, description: This field is provided for QUANTITY type only. It specifies how many items will be refunded.}
    value: {nullable: true, description: This field is available for AMOUNT type only and specifies the amount refunded to the customer.}
```
`RefundDetails` also has `deposits[]` (RefundLineItemDeposit: "the total deposit amount, per line item"), `delivery`, `overpaid`, `surcharges`, `additionalServices` ("Payment refund for additional services." - one amount for the whole order, not per line).

### One Fulfillment refund dispositions (S1 l.22853, 22940)
`FulfillmentRefundDisposition.product` -> `FulfillmentRefundDispositionProduct { gtins: Product GTINs, name: Product name, quantity: Product quantity }`, plus `offerId`, `orderId`, `stockStatus` (SELLABLE/NON_SELLABLE/MISSING/ITEM_MISMATCH/NOT_APPLICABLE). Product-level return detail exists only for 1F (Allegro warehouse).

### Waybill request - CheckoutFormAddWaybillRequest (S1 l.31690-31722, POST /order/checkout-forms/{id}/shipments)
```yaml
required: [carrierId, waybill]
carrierId, waybill (maxLength 64), carrierName (maxLength 30),
lineItems:
  description: List of order line items. They must be from the order specified in the path parameter.
    When list is not provided or it is empty it means that every item from an order is included in shipment.
  items: {required: [id], properties: {id: {description: Identifier of an order line item.}}}
```
No quantity per line item in a parcel. Wysyłam z Allegro `ShipmentCreateRequestDto` (S1 ~l.39600+) has deliveryMethodId, sender, receiver, referenceNumber, packages, insurance, cashOnDelivery, labelFormat, additionalServices - no line items at all. Order delivery has `calculatedNumberOfPackages` ("Calculated number of packages.", S1 l.30740).

### Offer product set (S1 l.32654-32666, 33003-33021)
`SaleProductOfferRequestV1.productSet: array of ProductSetElement + ProductSetElementQuantity + responsible person/producer + safety info + deposits + composition`.
`ProductSetElementQuantity.quantity.value`: "The number of a given product included in a single offer sold as an element of a product set. **Note:** For number of sets available in stock, use `stock.available` property."

### Offer bundles /sale/bundles (S1 l.3013-3340) - all four remaining operations `deprecated: true`; no POST path left in spec. DTOs: `BundledOfferDTO { id: Offer ID, requiredQuantity: How many units of this offer will be in bundle., entryPoint }`, `BundleDiscountDTO { marketplace, amount: Discount value., currency }`, `OfferBundleDTO.createdBy` enum `USER | ALLEGRO` ("`ALLEGRO` when bundle was created automatically by Allegro").

### Flexible bundles /sale/flexible-bundles (S1 l.3351-3373, 28053-28395)
Requirements (verbatim list): "there are max 6 slots in bundle; order value for each slot must be unique (ranging from 0 to 5); each slot can contain up to 30 offers; all offers in slot must be from the same category leaf (based on assortment's tree); at least one slot has to be marked as entrypoint; offer can be used in bundle only once (cannot be used in multiple slots); only offers active on at least one marketplace can be used; B2B offers cannot be used; age-restricted offers (eg. alcohol) cannot be used; cannot use multiple offers which are representing same product; all offers in bundle have to be 1F or not 1F."
Response: "While creating bundle, for each offer their availability to buy in a bundle is calculated on each marketplace. Offer can be unavailable to buy in bundle when it is not active on marketplace or it's stock is not sufficient."
`FlexibleBundleDiscountDTO.type`: "WHOLE_BUNDLE_DISCOUNT means that the discount amount will be distributed proportionally across the offers in the bundle. SLOT_DISCOUNT allows you to specify which slots in the bundle are discounted and by how much". `FlexibleBundleMarketplaceDiscountDTO.percentage: integer, Discount percentage` - no max stated. `FlexibleBundleOfferDTO.excludedFromDiscount`. `FlexibleBundleSlotDTO.requiredQuantity: Required quantity of offers from this slot`.

### Multipack promotions (S1 l.4447-4455)
"This percentage should be an integer value greater than 15 for quantity 2, greater than 30 for quantity 3, greater than 40 for quantity 4, greater than 50 for quantity 5 and lower than or equal to 100. ... the discountedNumber field must be set to 1 by default as you can only discount one unit in a multipack."
Cross-offer: "This group of offers is then considered as a pool from which users can pick and choose forEachQuantity offers and the cheapest of them gets a discount." Spec examples use `percentage: 100, forEachQuantity: 3` (S1 l.4539-4565) - i.e. "buy 3, cheapest free".

## News / changelog quotes (S2)

| Date | URL | Verbatim |
|---|---|---|
| 30 Sep 2021 | https://developer.allegro.pl/news/udostepnilismy-mozliwosc-tworzenia-zestawow-produktowych-BvZwql690H6 | "Są to oferty sprzedaży zestawu, który składa się z: kilku różnych produktów, np. konsola z dodatkową grą oraz dwoma padami, wielu sztuk jednego produktu (tzw. wielopak)." / "Oferta, którą utworzymy, będzie przez nas walidowana i rozliczana w oparciu o pierwszy produkt z listy, a w szczególności o kategorię produktu." / "Planujemy rozwijać funkcjonalność zestawów produktowych w zasobach /sale/product-offers, tak aby w przyszłości w całości zastąpiły one dotychczasowe zestawy ofert." |
| 10 Jan 2022 | https://developer.allegro.pl/news/zestawy-produktowe-dodalismy-nowe-funkcjonalnosci-yPy9lnrklTb | "produkty z bazy TecDoc mogą wchodzić w skład zestawów" |
| 13 Dec 2023 | https://developer.allegro.pl/news/zamowienia-dodalismy-informacje-o-zestawach-produktow-7GWeDzwWMfv | "sprzedający, który w swoich ofertach ma zdefiniowany zestaw produktowy, dowie się z jakich produktów i z jakiej liczby składa się dane zamówienie." / "Do struktury zamówień, do sekcji "offer" dodaliśmy nowy obiekt "productSet"" |
| 18 Oct 2017 | https://developer.allegro.pl/news/promocyjne-zestawy-ofert-7Gzm9POD3Hd | "Zestaw możesz utworzyć z co najmniej 2 ofert. Zestaw możesz utworzyć z maksymalnie 9 ofert. Do jednej oferty dodasz do 7 zestawów." (historical, via /sale/loyalty/promotions ORDER_FIXED_DISCOUNT) |
| 3 Oct 2024 | https://developer.allegro.pl/news/udostepnilismy-nowe-zasoby-do-obslugi-zestawow-ofert-x5xGRdvjzH3 | "Zestawy ofert to połączenie kilku ofert, które możesz sprzedawać w obniżonej cenie." / new `/sale/bundles`; `/sale/loyalty/promotions` for bundles deprecated, removal 13.01.2025 |
| 29 Jan 2026 | https://developer.allegro.pl/news/zestawy-elastyczne-wprowadzimy-nowe-zasoby-do-obslugi-zestawow-ofert-g0OZM8v1RUY | "Wraz z wdrożeniem zaczniemy przenosić istniejące zestawy ofertowe do nowego narzędzia. Równocześnie, wyłączymy dotychczasowe API do tworzenia zestawów ofertowych" / "Kupujący będzie mógł samodzielnie wybrać inny produkt w zestawie na inny, np. wybrać inny wariant kolorystyczny" / "Wprowadzimy rabaty procentowe." |
| 10 Jun 2026 | https://developer.allegro.pl/news/zestawy-elastyczne-udostepnilismy-nowe-zasoby-do-obslugi-zestawow-ofert-1nGyxnn3RcO | "Migrujemy istniejące zestawy ofertowe do nowego narzędzia - te, które zostały utworzone automatycznie przez nas. Wyłączyliśmy endpoint API do tworzenia zestawów ofertowych: POST /sale/bundles" / "Możesz jeszcze skorzystać z pozostałych endpointów ze ścieżki /sale/bundles, natomiast te w przyszłości także całkowicie usuniemy." |
| 15 Oct 2026 | https://developer.allegro.pl/news/rabaty-ilosciowe-wycofujemy-mozliwosc-tworzenia-rabatu-typu-multipack-4R3MoYWrPi5 | "wycofamy możliwość tworzenia oraz pobierania rabatów typu multipack (rabat na n-tą sztukę przypisany do jednej oferty)" / "Tworzenie rabatów typu cross-offer multipack (dla więcej niż jednej oferty) pozostanie bez zmian." / "Wszystkie rabaty typu multipack zostaną usunięte z systemu." / "Rabaty typu multipack zostają zastąpione przez wielopaki w ofercie" / "w obiekcie productSet przekażesz jeden produkt ze wskazaną w polu quantity.value wartością większą niż 1" |
| 19 Oct 2026 | https://developer.allegro.pl/news/rabaty-ilosciowe-wycofujemy-mozliwosc-tworzenia-rabatu-typu-multipack-3ALR4dZPmS7 | "Zmieniliśmy datę wycofania rabatów typu multipack z 30 listopada 2026 na 12 stycznia 2027" |
| 13 Jan 2026 | https://developer.allegro.pl/news/zarzadzanie-ofertami-14-kwietnia-2026-wylaczymy-zasoby-do-tworzenia-i-obslugi-ofert-wielowariantowych-g0O41x47xhV | "Wielowariantowość ofertową zastąpią warianty produktowe, które tworzymy automatycznie na podstawie Katalogu produktów." (`/sale/offer-variants` absent from S1: 0 matches) |
| 6 Feb 2020 | https://developer.allegro.pl/news/zamowienia-nowe-pole-shipmentsummary-lineitemssent-LRV05508gFj | "SOME - przynajmniej jednego przedmiotu z zamówienia." |

## Tutorial / help quotes

- S4 product sets: "Kilku różnych produktów (maksymalnie 10), np. konsola z dodatkową grą oraz dwoma padami." / "productSet.quantity.value - liczba sztuk wskazanego produktu, która wejdzie w skład pojedynczego zestawu."
- S6 (help, 2022, outdated warning): "W zestawie może być maksymalnie 5 różnych produktów." / "Klient może kupić tylko cały zestaw." / "Parametry określasz tylko dla produktu głównego." / "Nie sprawdzamy wspólnych stanów magazynowych dla ofert z tym samym produktem." / "Po każdym zamówieniu odejmujemy odpowiednią liczbę sztuk tylko z tej oferty, z której skorzystał kupujący." / "Parametr Liczba zestawów w sekcji Ustawienia sprzedaży: to liczba pełnych zestawów, które sprzedajesz." - **CONFLICT** with S4 on max products (5 vs 10). Trust S4 (current API tutorial, no outdated banner).
- S5 flexible bundles: "Ograniczenia asortymentu: W zestawach nie można wykorzystywać ofert B2B, ofert z ograniczeniem wiekowym (np. alkohol), wielu ofert reprezentujących ten sam produkt oraz łączyć ofert zwykłych z ofertami One Fulfillment." / multipack: "Minimalna wartość rabatu to 15%, a maksymalna 100%." / `"reasons": ["STOCK_NOT_SUFFICIENT"]`.
- S3 waybill: "Jeżeli nie przekażesz w żądaniu kolejnych lineItem.id to numer przesyłki automatycznie przypiszemy do każdego lineItem.id z zamówienia."
- S3 refund: "QUANTITY - zwrot według liczby sztuk ... AMOUNT - zwrot określonej kwoty, możesz zwrócić część kwoty sprzedanego przedmiotu."
- S7: "Za usługę dodatkową nie pobieramy od sprzedających żadnych opłat i prowizji." (GIFT_WRAP additional service; 2017)
- S8 (official moderator, 2020): "Nie pobieramy prowizji od gratisów rozumianych jako darmowe przedmioty, które oferujesz jako dodatek w swoich ofertach. Natomiast w przypadku zestawów, które tworzysz z różnych ofert, prowizja jest pobierana od wszystkich przedmiotów, wchodzących w skład zakupu." and 02-07-2020: "pobieramy prowizję od każdego przedmiotu. Również tego, który sprzedajesz za 1gr." The seller's opening post states the minimum commission 0,25 zł was charged on the 1-grosz gift.
- S9 (former moderator, 2023): "Najważniejsze jest to, żeby klientów, którzy otrzymają gratis, nie wyłaniać drogą losowania."

## Checklist

| Item | Rating | Evidence |
|---|---|---|
| Bundle definition | Full (3 kinds) | Product set: S1 `OfferProductSetReference` "List of products in a product set."; offer bundle: S2 3 Oct 2024 "połączenie kilku ofert"; flexible: S1 l.3351 slots. |
| Variants in bundle | Partial | Flexible bundle slot holds up to 30 offers of one category leaf; buyer picks one (S2 29 Jan 2026 "wybrać inny wariant kolorystyczny"). Product set: fixed products, no variant choice (no field). Offer-variants API removed 14 Apr 2026. |
| Bundle stock | Partial | Product set: offer-level `stock.available` = number of sets (S1 ProductSetElementQuantity note). Allegro does NOT net component stock across offers (S6). Offer/flexible bundle: no own stock; availability derived from each offer's stock ("STOCK_NOT_SUFFICIENT", S5; S1 l.3379-3380). |
| Bundle as offer | Full for product set, None for offer/flexible bundles | Product set = one offer (S4). Offer/flexible bundles reference separate offer ids (BundledOfferDTO.id "Offer ID"). |
| Order with bundle | Partial | Product set: one lineItem with `offer.productSet.products[{id,quantity}]` (S1 l.30244-30283), no per-component price/tax/name/GTIN. Offer/flexible bundle: each offer is its own lineItem (inferred from offer-based bundle model + `discounts[].type = BUNDLE` per line; no explicit statement) and NO bundle id, NO discount amount (LineItemDiscount has only `type`). |
| Split parcels | Partial | Waybill can target subset of lineItems by id, but NO quantity (S1 l.31715-31722). Cannot express "component A in parcel 1, component B in parcel 2" for a product-set line; cannot split quantity of one line. |
| Component return | None (seller-fulfilled) / Partial (1F) | `CustomerReturnItem` keyed by `offerId`+`quantity`, no product id (S1 l.23216). Refund by line `QUANTITY` or `AMOUNT` only (S1 l.23001); component refund only as free-form AMOUNT. 1F dispositions carry `product.gtins/quantity` (S1 l.22940). |
| Return with gift | None | No gift concept in any schema (grep "gift|gratis" in S1 hits only GIFT_WRAP service). A 100%-discounted multipack unit is part of the same line quantity; refund semantics for it: no primary source. |
| VAT split | None | One `tax.rate` per line item (S1 l.31172) and one offer rate per country (S1 l.29912); product set elements carry no tax. Mixed-rate set cannot be expressed. |
| Gift source | Partial | Only priced mechanisms: MULTIPACK / CROSS_MULTIPACK `percentage` <= 100 (S1 l.4449, example `percentage: 100`); MULTIPACK removed 12 Jan 2027 (S2). Free-text gifts described in offer: S9 (moderator). No API field for "gift". |
| Gift on documents | Unknown | No primary source. Allegro does not issue the seller's invoice; order carries no gift line for a description-only gift. |
| Gift limits | Partial | Multipack: `discountedNumber` must be 1 (S1 l.4449); thresholds >15/30/40/50%. Flexible bundle percentage: no max in spec (Unknown). Commission on gifts: only S8 (2020 moderator, contradicted by seller-reported 0,25 zł). Price 0 offer: no primary source (spec `BuyNowPrice` has no minimum). |

## Use cases

| ID | Scenario | Exact fields | Source |
|---|---|---|---|
| ALG-01 | Product set (2 different products) bought | `lineItems[].offer.productSet.products[].id` (uuid), `.quantity`; one `price`/`originalPrice`/`tax` for the whole line | S1 l.30244-30283: "Product quantity in a product set." |
| ALG-02 | Multipack 6x one product | `productSet.products` = 1 element with `quantity` 6; offer `stock.available` counts packs | S2 15 Oct 2026: "przekażesz jeden produkt ze wskazaną w polu quantity.value wartością większą niż 1 (np. 6 sztuk)" |
| ALG-03 | Line quantity x set quantity | line `quantity` 2 of an offer whose set says product X `quantity` 2 => 4 units of X (inference from two quantity fields) | S1 l.31036 "quantity", l.30276 "Product quantity in a product set." |
| ALG-04 | Product set with deposit products | `lineItems[].deposit.price` = sum of component deposits | S1 l.31095 "the value in this field is the sum of those deposits" |
| ALG-05 | Offer bundle / flexible bundle bought | separate lineItems per offer, each `discounts[{type: BUNDLE}]`, price already reduced; no bundle id, no discount amount | S1 l.31270 "`BUNDLE` - a bundle discount (used also for bundles with no price change)" |
| ALG-06 | Flexible bundle with variant choice | buyer picks one offer per slot; order = chosen offers' lineItems | S2 29 Jan 2026 "wybrać inny wariant kolorystyczny" |
| ALG-07 | "Buy 3, cheapest free" (cross-multipack 100%) | `discounts[{type: UNIT_PERCENTAGE_DISCOUNT}]`; amount not given | S1 l.4455 "the cheapest of them gets a discount"; example `percentage: 100` |
| ALG-08 | Single-offer multipack promo (n-th unit free) | same as ALG-07; ends 12 Jan 2027 | S2 "Wszystkie rabaty typu multipack zostaną usunięte z systemu." |
| ALG-09 | Gift wrap service | `selectedAdditionalServices[{definitionId: GIFT_WRAP, name, price (unit), quantity}]` | S3 `"definitionId": "GIFT_WRAP" ... // jednostkowy koszt usługi` |
| ALG-10 | Ship set components in two parcels | `POST .../shipments {carrierId, waybill, lineItems[{id}]}` - line granularity only | S1 l.31715 "When list is not provided or it is empty it means that every item from an order is included in shipment." |
| ALG-11 | Buyer returns one component of a product set | `items[{offerId, quantity, price, reason}]` - no product id; component unidentifiable | S1 l.23216-23241 |
| ALG-12 | Partial refund for one component | `POST /payments/refunds lineItems[{id, type: AMOUNT, value}]` | S1 l.23018 "AMOUNT is provided when you can refund a partial price." |
| ALG-13 | 1F return of set | `FulfillmentRefundDisposition.product{gtins,name,quantity}`, `stockStatus` | S1 l.22940-22958 |
| ALG-14 | Mixed-VAT set | single `lineItems[].tax.rate` | S1 l.31175 "The tax rate." |
| ALG-15 | Gift described only in offer text | nothing in order | S9 (moderator) "nie wyłaniać drogą losowania"; no schema field |

## Adapter can derive
- Component catalogue product ids and per-set quantities of a product-set line: `offer.productSet.products[].id/quantity` (S1 l.30267-30283).
- Total units per component = line `quantity` x component `quantity` (inference).
- That a line was discounted by a bundle / multipack / coupon / campaign: `discounts[].type` (S1 l.31255).
- Reduced vs list price per line: `price` vs `originalPrice` (S3 comments).
- Summed deposit per line (S1 l.31095).
- Which lines a parcel covers (S1 l.31715), which offer a return refers to (S1 l.23218).

## Adapter cannot derive
- Component prices, names, GTINs or tax rates inside a product set - schema has only `id`, `quantity` (S1 l.30267).
- Mapping Allegro product UUID to the seller's SKU without a separate catalogue lookup (not in order).
- Which bundle (bundleId) produced a `BUNDLE` discount, and the discount amount - `LineItemDiscount` has only `type` (S1 l.31255).
- Which units of a quantity>1 line got the free/discounted unit (no per-unit data).
- Whether `price` is unit or line total - spec silent; tutorial ambiguous (Unknown).
- Component of a returned product set (seller-fulfilled) - `CustomerReturnItem` has no product id (S1 l.23216).
- Partial-quantity parcel split - waybill line items have no quantity (S1 l.31722).
- Any gift that is not a discounted unit of a purchased offer.

## Conflicts / open questions
- Max products in a set: S4 "maksymalnie 10" vs S6 "maksymalnie 5" (S6 dated 2022 with outdated banner). Trust S4.
- Commission on gifts: S8 moderator says none for gifts, but per-item commission incl. 1-grosz items in multi-offer sets; seller reports 0,25 zł minimum charged. 2020, superseded fee rules not read. Rate Unknown.
- Product set "walidowana i rozliczana w oparciu o pierwszy produkt" (S2 2021) - whether fees are still based on the first product's category today: not re-confirmed in current docs (Unknown).
- `/sale/bundles` GET/DELETE/PUT still live but deprecated; removal date not announced.
