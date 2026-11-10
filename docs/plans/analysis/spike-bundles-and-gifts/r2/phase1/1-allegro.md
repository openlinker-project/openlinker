# Phase 1 / Allegro - bundles (zestawy) and gifts (gratisy)

Date: 2026-11-04. Researcher 1 of 5. Read-only.
Primary source: Allegro OpenAPI spec downloaded 2026-11-04 from https://developer.allegro.pl/swagger.yaml
(version 'latest'; line numbers below refer to that copy). Secondary: developer.allegro.pl tutorials + news,
Społeczność Allegro moderator answers, Comarch e-Sale help. Allegro seller help pages (allegro.pl/dla-sprzedajacych/...)
returned HTTP 403 to the fetcher, so official help text is quoted second-hand where noted.
Repo context: current OL mapper `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts:998-1015`.

## 1. The Allegro mechanisms that group goods

| Mechanism | What it is | API | Stock | Status (Nov 2026) |
|---|---|---|---|---|
| Product-set offer (`productSet[]` with >1 product) | ONE offer selling several catalogue products together (phone + case, kit). | `POST/PATCH /sale/product-offers`, `productSet[].product` (UUID or EAN or full definition), `productSet[].quantity.value` | `stock.available` = number of SETS; unit enum `UNIT|PAIR|SET`. No per-component stock on Allegro. | Live. Limit of products per set: moderator says 10 different products (spolecznosc thread "Zestaw 10 produktów", 01-02-2024) - unverified against API. |
| Multipack offer (`productSet` = 1 product, `quantity.value` > 1) | "6-pack" of one product in ONE offer. Allegro shows a % discount label automatically when unit price is lower than the single-unit offer. | same as above | sets | Live; it is Allegro's announced REPLACEMENT for single-offer MULTIPACK promos (news 15-10-2026). |
| Offer bundle ("zestaw ofert", legacy) | Several separate offers bought together, optional fixed-amount discount distributed proportionally. `createdBy: USER|ALLEGRO`. | `/sale/bundles` - **all operations `deprecated: true`** in the spec (swagger L3013+). `BundleDiscountDTO {marketplace, amount, currency}` fixed amount. | each offer keeps its own stock | Deprecated; superseded by flexible bundles. |
| Automatic bundles | Allegro itself combines a seller's offers into bundles (since 5 Feb 2024, moderator nat_not). Not discounted automatically (moderator). Seller notified by e-mail, can delete. | visible as `createdBy: "ALLEGRO"` | own offer stock | Live. |
| Flexible bundle ("zestaw elastyczny") | 2-6 slots, up to 30 offers per slot (same category leaf), buyer picks one offer per slot; `requiredQuantity` per slot; discount `WHOLE_BUNDLE_DISCOUNT` (%; distributed proportionally across offers; `minimumBoughtOffers` 2-6) or `SLOT_DISCOUNT` (% per slot); `excludedFromDiscount` per offer; per-marketplace availability with reasons `STOCK_NOT_SUFFICIENT`, `NOT_AVAILABLE_TO_PURCHASE`. No 1F/non-1F mix, no B2B, no age-restricted, no two offers of same product. | `POST/GET/PUT/DELETE /sale/flexible-bundles` (swagger L3351, schemas L28053-28400) | each offer keeps its own stock; bundle offer becomes unavailable on that marketplace when stock insufficient | Live. Max % not documented; 100% slot discount unverified. |
| MULTIPACK promo (single offer) | "every Nth unit X% off" on one offer. `UNIT_PERCENTAGE_DISCOUNT`, `forEachQuantity` 2-5, `discountedNumber` must be 1, percentage >15/30/40/50 for qty 2/3/4/5 and **<=100** (so "2+1 gratis" possible). | `POST /sale/loyalty/promotions` criterion `CONTAINS_OFFERS` with 1 offer | offer stock | **Withdrawn 12 Jan 2027**: create + GET filter removed, existing multipacks deleted (news 15-10-2026, date moved from 30-11-2026 per news 19-10-2026). |
| CROSS_MULTIPACK promo | Pool of >1 offers; buyer picks `forEachQuantity` items, the cheapest gets the %. | same endpoint, >1 offer in criterion | offer stock | Stays (explicitly not affected by withdrawal). |
| Large order discount / wholesale price list | B2B only, % thresholds by order value / unit count. | `/sale/loyalty/promotions` | - | Live (B2B). |
| Turnover discount | B2B | - | Endpoints removed 2 Nov 2026 (news). |

Help/tutorial facts: `"Minimalna wartość rabatu to 15%, a maksymalna 100%."` (rebates tutorial, multipack);
"Rabatu ilościowego nie dodasz do ofert ze strefy okazji"; quantity discounts only for PL market (Comarch).
Legacy bundles: up to 9 offers per bundle, one offer in up to 7 bundles, fixed discount "proportionally deducted
from the value of the offers" (Comarch e-Sale help, unverified vs Allegro).

## 2. How each shape arrives in `GET /order/checkout-forms/{id}`

`CheckoutFormLineItem` (swagger L31021): `id` (uuid), `offer` (`OfferReference`: `id`, `name`, `external.id`,
`productSet.products[]{id (catalogue product UUID), quantity}`, `hsNumber`), `quantity`, `originalPrice`, `price`
(unit, gross), `deposit.price` (sum of deposits of all products in a set), `reconciliation {value, type BILLING|WALLET,
quantity}` (Allegro Ceny), `selectedAdditionalServices[] {definitionId, name, price, quantity}`, `vouchers[]`,
`tax {rate, subject, exemption}`, `boughtAt`, `discounts[] {type}`, `serialNumbers`, `allegroAds`.
There is NO order-level discounts array in the current `CheckoutForm` schema (tutorial still calls the old one deprecated).

`LineItemDiscount` = `{ type }` ONLY - no amount, no bundle id. Enum (L31255): `BUNDLE` ("used also for bundles with no
price change"), `UNIT_PERCENTAGE_DISCOUNT` ("a MULTIPACK or CROSS_MULTIPACK discount"), `WHOLESALE_PRICE_LIST`,
`LARGE_ORDER_DISCOUNT`, `TURNOVER_DISCOUNT`, `COUPON`, `CAMPAIGN`.
Tutorial (jak-obslugiwac-zamowienia) still lists `MULTIPACK`, `CROSSMULTIPACK`, `ALLEGRO_PRICES` - conflict with the spec;
an adapter must accept unknown strings.
`originalPrice` = "pierwotna cena w ofercie, przed zastosowaniem jakichkolwiek zniżek (rabatów ilościowych, zestawów itp.)";
`price` = price after discount/coupon (tutorial).

Per shape:
- **Product-set offer**: ONE lineItem, `offer.productSet.products[]` = component catalogue UUIDs + per-set quantity;
  `price` is the SET price; one `tax.rate` (offer has one rate per country, `OfferTaxSettings.rates[]{rate,countryCode}`).
  No per-component price, name, EAN or SKU. Component identity = Allegro catalogue UUID -> needs `/sale/products/{id}`
  (GTIN) or OL's own publish record to map to OL variants. Present only "if the offer was a product set" (whether a
  single-product offer also carries productSet: unverified).
- **Multipack offer**: ONE lineItem, `productSet.products[0].quantity` = pack size; lineItem.quantity = number of packs.
  Units to pick = pack size x quantity.
- **Offer bundle / flexible bundle**: N lineItems (one per offer), each `discounts:[{type:"BUNDLE"}]`, `price` <
  `originalPrice` when discounted (proportional split by Allegro). Nothing links which lines formed which bundle; no bundle id.
- **MULTIPACK / CROSS_MULTIPACK**: lineItem(s) with `discounts:[{type:"UNIT_PERCENTAGE_DISCOUNT"}]`; the free/discounted unit
  is folded into `price` (exact averaging vs separate line: unverified - no live sample). A 100% unit is priced 0.01 zł, not 0.
- **Gift wrap**: `selectedAdditionalServices[{definitionId:"GIFT_WRAP", name:"Zapakuj na prezent", price, quantity}]` on the line.

Shipping: `POST /order/checkout-forms/{id}/shipments` `lineItems[]{id}` - waybill per lineItem, NO quantity and no component;
a product-set line cannot be declared split across parcels.

## 3. Returns and refunds

- `GET /order/customer-returns` item (`CustomerReturnItem`): `offerId`, `quantity`, `name`, `price`, `url`, `reason
  {type, userComment}`, `serialNumbers` - keyed by OFFER id, not lineItem id, no component. A buyer returning one
  component of a product-set offer cannot express it (quantity is in sets) - unverified how the form handles it.
- `POST /payments/refunds` `lineItems[] {id, type: QUANTITY|AMOUNT, quantity | value}` plus `delivery`, `overpaid`,
  `surcharges`, `additionalServices`, `deposits[]`. Partial component refund = `AMOUNT` with a seller-chosen value.
- Partial return of a discounted bundle: buyer may return "całość lub część zamówienia"; moderator advises choosing the
  return-terms option that the set discount is forfeited on partial return (spolecznosc "Zestaw 10 produktów", 27-02-2024).
  The discount is distributed proportionally, so each line's `price` is already the post-discount refund basis.
- Customer-return statuses include `COMMISSION_REFUND_CLAIMED`, `COMMISSION_REFUNDED`.

## 4. Gifts on Allegro

- No gift feature, no gift flag, no zero-price line. Allowed: gift promised in the offer DESCRIPTION; title/photos must
  not advertise it; unclear gift terms judged misleading (moderator Natalia, thread "Gratisy do oferty", 16-07-2025).
- Description-only gift => gift is NOT in the order at all (nothing in checkout form).
- Gift inside a product-set offer (phone + "free" case as second product) => appears only as a component UUID; no price split.
- "N+1 gratis" via MULTIPACK/CROSS_MULTIPACK 100%: "Jeśli udzielisz 100% rabatu, obniżymy cenę przedmiotu do 0,01 zł i
  naliczymy minimalną prowizję w wysokości 0,25 zł" (help article update cited by moderator nat_not, 29-07-2020; current
  minimum commission amount unverified). Commission per item, not on bundle total. Single-offer MULTIPACK disappears 12-01-2027.
- Flexible-bundle SLOT_DISCOUNT could in theory make a "free" slot; max % undocumented (unverified).
- Seller-side manual gift (packed without trace) is common practice (forum advice "dodawać gratisy bez informowania").
- GIFT_WRAP is a paid (or seller-priced) additional service, not a gift product.

## 5. Use cases

ALG-01 | merchant | phone+case+charger as one product-set offer | 1 lineItem, offer.productSet.products[3], one price, one tax.rate | component stock never decremented in OL today (mapper reads offer.id only) | swagger OfferProductSetReference L30244
ALG-02 | merchant | 6-pack of water as one offer | 1 lineItem, productSet.products[0].quantity=6 | units to pick = 6 x qty; OL reserves 1 | news 4R3MoYWrPi5
ALG-03 | merchant | flexible bundle: shampoo + choose 1 of 3 conditioners, 10% whole-bundle | 2 lineItems, discounts[BUNDLE], price<originalPrice | cannot tell which lines formed one bundle; discount amount = originalPrice-price only | /sale/flexible-bundles
ALG-04 | Allegro | auto-created bundle (createdBy ALLEGRO) | lines with discounts[BUNDLE] even without price change | seller did not create it; bundles with mismatched products | spolecznosc automatyczne-zestawy 731581
ALG-05 | merchant | "2+1 gratis" via MULTIPACK 100% | 1 line, discounts[UNIT_PERCENTAGE_DISCOUNT], free unit folded into price, priced 0.01 zł | gift not identifiable; 0.25 zł commission on "free" item; mechanism removed 12-01-2027 | spolecznosc 49695, news
ALG-06 | merchant | cross-multipack: any 3 from a pool, cheapest free | N lines with UNIT_PERCENTAGE_DISCOUNT | which unit was free unknown; returning the free one vs a paid one | swagger L4440
ALG-07 | merchant | gift promised in description ("etui gratis") | nothing in the order | gift not reserved, not on documents, cannot prove it was shipped; misleading-offer risk | spolecznosc gratisy-do-oferty 1050074
ALG-08 | merchant | gift as 2nd product in a product-set offer | component UUID only, whole price on set | VAT/price split for receipt impossible from data | swagger
ALG-09 | buyer | returns 1 of 3 components of a product-set offer | customer-return item keyed by offerId, quantity in sets | refund = AMOUNT chosen by seller; component restock unknown | CustomerReturnItem
ALG-10 | buyer | returns one line of a discounted offer bundle | return per offerId; refund line price already discounted | seller wants to claw back lost bundle discount; needs return terms | spolecznosc 727363
ALG-11 | merchant | set mixing 23% and 5% products in one offer | single tax.rate on the line | mixed-VAT set not expressible on Allegro; invoice must split | OfferTaxSettings L29912
ALG-12 | buyer | gift wrap | selectedAdditionalServices[GIFT_WRAP] with price | needs to reach packing slip; separate invoice line | tutorial jak-obslugiwac-zamowienia
ALG-13 | merchant | ship product set in two parcels | waybill per lineItem only | cannot declare split component shipments | CheckoutFormAddWaybillRequest L31690
ALG-14 | merchant | bundle component runs out | flexible bundle availability reason STOCK_NOT_SUFFICIENT per marketplace; product-set offer has only set stock | set stock must be derived = min(component/qty) by seller; Allegro will not do it | swagger L3351

## 6. Adapter: derivable vs not

Can derive: product-set composition (catalogue UUIDs + qty per set); multipack size; list vs paid unit price
(originalPrice/price) and per-line discount amount by subtraction; discount TYPE (bundle / quantity / coupon / campaign);
that a line took part in some bundle; gift-wrap service and its price; per-line tax rate; Allegro Ceny reconciliation.
Can derive with an extra call: component GTIN via /sale/products/{id}; candidate bundle grouping via
/sale/flexible-bundles?offer.id= (current state, not order-time).
Cannot: component prices or VAT inside a product-set line; bundle id / which lines form one bundle; which unit was free in
multipack; discount amount from discounts[] itself; any gift that was promised in the description; component-level returns
or shipments.

## 7. Checklist
- bundle definition: productSet offer (seller-defined in offer) or offer bundle / flexible bundle (separate offers + discount).
- variants inside a bundle: flexible-bundle slot = choice among up to 30 offers; product-set components are fixed catalogue products.
- bundle stock: product-set = set count only; bundles = each offer's own stock; Allegro does not compute set stock.
- bundle as offer: yes (productSet); offer bundles are not offers.
- order with bundle: productSet line OR N lines with discounts[BUNDLE]/UNIT_PERCENTAGE_DISCOUNT.
- packing & split parcels: waybill per lineItem, no component/quantity split.
- return of a component: keyed by offerId + set quantity; partial refund via AMOUNT.
- return when a gift was included: gift invisible (description gift) or folded into price (multipack); no rule.
- VAT split: one rate per offer/line; no split.
- gift source: description promise, product-set component, 100% multipack unit (0.01 zł).
- gift stock / running out: not modelled; seller problem.
- gift on receipt/invoice: absent from order data unless multipack (0.01 zł).
- gift limits: none in Allegro.

## 8. Surprises
1. Single-offer MULTIPACK promos are removed on 12 Jan 2027 and existing ones deleted; replacement is a multipack OFFER (productSet qty>1).
2. `/sale/bundles` is fully deprecated; flexible bundles are the only bundle API.
3. `LineItemDiscount` carries only a type - no amount, no bundle id.
4. Allegro auto-creates bundles from the seller's offers (since 5 Feb 2024), so BUNDLE lines can appear without seller action.
5. A "free" unit is 0.01 zł with minimum commission, never 0.00 (2020 help text; current amount unverified).
6. OL's current mapper drops productSet, originalPrice, discounts and selectedAdditionalServices.

## Sources
- https://developer.allegro.pl/swagger.yaml (OfferReference L30229, CheckoutFormLineItem L31021, LineItemDiscount L31255, /sale/bundles L3013, /sale/flexible-bundles L3351, /sale/loyalty/promotions L4411, MultiPackBenefitSpecification ~L24230, InitializeRefund L22580, RefundLineItem L23001, CustomerReturnItem L23216, OfferTaxSettings L29912, CheckoutFormAddWaybillRequest L31690, ProductSetElementQuantity ~L33010)
- https://developer.allegro.pl/tutorials/jak-zarzadzac-rabatami-promocjami-yPya2mj6zUP
- https://developer.allegro.pl/tutorials/jak-obslugiwac-zamowienia-GRaj0qyvwtR
- https://developer.allegro.pl/tutorials/jak-jednym-requestem-wystawic-oferte-powiazana-z-produktem-D7Kj9gw4xFA
- https://developer.allegro.pl/news/rabaty-ilosciowe-wycofujemy-mozliwosc-tworzenia-rabatu-typu-multipack-4R3MoYWrPi5
- https://developer.allegro.pl/news/rabaty-ilosciowe-wycofujemy-mozliwosc-tworzenia-rabatu-typu-multipack-3ALR4dZPmS7
- https://developer.allegro.pl/news/allegro-ceny-dodamy-nowe-obiekty-i-typy-pol-do-obslugi-zamowien-ZM9L1B7eqcX
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/automatyczne-zestawy/m-p/731581
- https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zestaw-10-produkt%C3%B3w/td-p/727363
- https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/gratisy-do-oferty/td-p/1050074
- https://pomoc.comarch.pl/esale/dokumentacja/czym-sa-zestawy-ofert-i-rabaty-ilosciowe-w-allegro/
- https://allegro.pl/dla-sprzedajacych/automatycznie-laczymy-wybrane-oferty-w-zestaw-K6VYllRgbs0 (403 to fetcher; cited by spec)
