# Research: Bundles ("zestawy") and free gifts ("gratisy") on Allegro

Phase 1 (problem) researcher 1 of 5. Date: 2026-11-04.

## Sources consulted

Primary (Allegro developer):
- Allegro REST API OpenAPI spec, downloaded 2026-11-04: https://developer.allegro.pl/swagger.yaml
  - Schemas read verbatim: `CheckoutForm`, `CheckoutFormLineItem`, `LineItemDiscount`, `LineItemReconciliation`, `CheckoutFormAdditionalService`, `OfferReference`, `OfferProductSetReference`, `OfferProductSetProductReference`, `CheckoutFormLineItemTax`, `OfferTaxSettings`, `SaleProductOfferRequestV1.productSet`, `ProductSetElementQuantity`, `CreateOfferBundleDTO`, `BundledOfferDTO`, `BundleDiscountDTO`, `OfferBundleDTO` (`createdBy USER|ALLEGRO`), `BundlePublicationDTO` (`ACTIVE|SUSPENDED`), `FlexibleBundleDiscountDTO`, `CustomerReturnItem`, `RefundLineItem`, paths `/sale/bundles` (deprecated), `/sale/flexible-bundles`, `/sale/loyalty/promotions`.
- Rebates & promotions tutorial: https://developer.allegro.pl/tutorials/jak-zarzadzac-rabatami-promocjami-yPya2mj6zUP
- Offer bundles / promotions page: https://developer.allegro.pl/offer_bundles
- News 2017-10-18 "Promocyjne zestawy ofert": https://developer.allegro.pl/news/promocyjne-zestawy-ofert-7Gzm9POD3Hd
- News 2018-02-01 "Rabaty ilościowe": https://developer.allegro.pl/news/rabaty-ilosciowe-AgGk0D8zDCq
- News 2021-03-15 Allegro Ceny / reconciliation: https://developer.allegro.pl/news/allegro-ceny-dodamy-nowe-obiekty-i-typy-pol-do-obslugi-zamowien-ZM9L1B7eqcX
- News 2021-09-30 product sets (zestawy produktowe): https://developer.allegro.pl/news/udostepnilismy-mozliwosc-tworzenia-zestawow-produktowych-BvZwql690H6
- News 2022-01-10 product sets new functions: https://developer.allegro.pl/news/zestawy-produktowe-dodalismy-nowe-funkcjonalnosci-yPy9lnrklTb (seen in search only)
- News 2023-12-13 productSet in orders: https://developer.allegro.pl/news/zamowienia-dodalismy-informacje-o-zestawach-produktow-7GWeDzwWMfv
- News 2025-05-05 `lineItems[].discounts`, order-level `discounts` deprecated, removal 2026-01-07: https://developer.allegro.pl/news/zamowienia-dodalismy-informacje-o-rabatach-i-znizkach-dla-kazdej-pozycji-zakupowej-zl7ZYa04GSO

Seller community (Allegro Gadane, moderator answers):
- Automatic bundles (feature since 2024-02-05, not discounted automatically): https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/automatyczne-zestawy/td-p/730293
- 10-product set limit; return of part of a set, discount spread proportionally: https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zestaw-10-produkt%C3%B3w/td-p/727363
- "Druga sztuka -50%" return, refund calc, discount split proportionally at purchase: https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/zwrot-towaru-obj%C4%99te-promocj%C4%85-2gi-50/m-p/214069
- Cross-multipack return dispute 2026-03: https://spolecznosc.allegro.pl/t5/dyskusje-kupuj%C4%85cych/jaka-kwota-do-zwortu/td-p/1166508
- Commission on gifts; 100% discount -> 0,01 zł, min. commission 0,25 zł: https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/allegro-pobiera-prowizj%C4%99-od-gratis%C3%B3w/m-p/49695
- Gifts described in offer, moderator ruling "zapisy dotyczące gratisów były niejasne" (2025-07-16): https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/gratisy-do-oferty/td-p/1050074
- Buyer may return part of a set; "3+1" limits across offers: https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/rabaty-na-klika-sztuk/m-p/58392

Third party:
- Comarch e-Sale help, zestawy ofert & rabaty ilościowe (PL market only, discount not editable, Allegro emails about auto-bundles): https://pomoc.comarch.pl/esale/index.php/dokumentacja/czym-sa-zestawy-ofert-i-rabaty-ilosciowe-w-allegro/
- Comarch e-Sale 2026 notes, flexible bundles: https://pomoc.comarch.pl/esale/dokumentacja/nowosci-i-zmiany-w-comarch-e-sale-2026/
- VAT on mixed-rate sets (tax law, not Allegro): https://amavat.pl/zestawy-i-pakiety-produktow-z-roznymi-stawkami-vat-jak-je-prawidlowo-fakturowac/ , https://www.podatki.biz/artykuly/sprzedaz-zestawu-roznych-produktow-jaka-stawka-vat_4_59220.htm

Not accessible: allegro.pl/dla-sprzedajacych/* help pages returned HTTP 403 to automated fetch (e.g. https://allegro.pl/dla-sprzedajacych/automatycznie-laczymy-wybrane-oferty-w-zestaw-K6VYllRgbs0). Help-page claims below are taken from moderator quotes of those pages.

Read-only look at OpenLinker code for context: `libs/integrations/allegro/src/infrastructure/adapters/allegro-order-source.adapter.ts` lines ~948-1011.

## Findings

### Theme 1: Allegro has FOUR different "bundle" mechanisms, each arriving differently

1. **Zestaw produktowy / product set (one offer, several products)** - `POST /sale/product-offers` with `productSet[]`, each element `product` (catalogue UUID or EAN) + `quantity.value` ("The number of a given product included in a single offer sold as an element of a product set"). `stock.available` is the number of SETS ("For number of sets available in stock, use `stock.available`"). The offer is validated and settled (category, commission) on the FIRST product of the list (news 2021-09-30). In some categories only "wielopak" (N units of the same product) is allowed. TecDoc products cannot be in sets. Moderator: max 10 different products per set (forum 2024-02-01); another source said 9 (unverified which is current).
   - In the order: ONE `lineItems[]` entry, `offer.id` = the set offer, plus `offer.productSet.products[] = {id: <catalogue product UUID>, quantity}` (added 2023-12-13). One `price`, one `tax.rate`. Components are identified only by Allegro catalogue product UUID, not by seller SKU/EAN.
   - Tax: `OfferTaxSettings.rates[]` is one rate per COUNTRY per offer, so a productSet offer carries one VAT rate even if components are taxed differently.
2. **Zestaw ofert / offer bundle (several separate offers bought together, fixed discount)** - legacy `POST /sale/loyalty/promotions` benefit `ORDER_FIXED_DISCOUNT` + criteria `CONTAINS_OFFERS` (2-9 offers, an offer in max 7 sets, 2017), later `/sale/bundles` (`offers[].requiredQuantity`, `entryPoint`, `discounts[]` per marketplace amount) - `/sale/bundles` is now marked `deprecated: true` in the spec. Bundles may be created by Allegro itself (`createdBy: ALLEGRO`, feature since 2024-02-05, "nie są automatycznie rabatowane"). Bundle status `ACTIVE|SUSPENDED` per marketplace.
   - In the order: one `lineItems[]` entry PER OFFER. The fixed discount is spread proportionally across the items (moderator: 1000 zł set with 100 zł off -> 900 zł item becomes 810, 100 zł item becomes 90). Each such line carries `discounts[{type: "BUNDLE"}]` ("used also for bundles with no price change"). `originalPrice` vs `price` shows the reduction.
   - No bundle id, no "which lines form one bundle" grouping is present in `LineItemDiscount` (schema has only `type`).
3. **Zestawy elastyczne / flexible bundles** - `/sale/flexible-bundles`: 2-6 slots, up to 30 offers per slot from the same leaf category, buyer picks one offer per slot (this is how "choose the size/model" works inside a bundle), `entryPoint`, discount `WHOLE_BUNDLE_DISCOUNT` ("distributed proportionally across the offers in the bundle", optional `minimumBoughtOffers`) or `SLOT_DISCOUNT` (per-slot percentage). Excluded: B2B, age-restricted, multiple offers of the same product, mixing One Fulfillment with non-1F. Availability "calculated for each offer... unavailable when not active or stock not sufficient".
   - In the order: one line per offer bought, discount type presumably `BUNDLE` (unverified - spec enum has no separate flexible type).
4. **Rabat ilościowy / MULTIPACK and CROSS_MULTIPACK ("druga sztuka taniej", "co N-ta sztuka")** - `POST /sale/loyalty/promotions` benefit `UNIT_PERCENTAGE_DISCOUNT`, `trigger.forEachQuantity` 2-5, `discountedNumber` always 1, percentage > 15 (2 pcs) / > 30 (3) / > 40 (4) / > 50 (5), max 100. MULTIPACK = one offer, CROSS_MULTIPACK = several offers. Not allowed in "strefa okazji". PL buyers only. Cannot be edited (delete + recreate).
   - In the order: `discounts[{type: "UNIT_PERCENTAGE_DISCOUNT"}]`. Moderator (2021-05-31): "Po zakupie rabat automatycznie naliczymy i rozdzielimy proporcjonalnie na wszystkie przedmioty" - the discount is spread over all units, so the per-unit `price` is an average, not "full price + one cheap unit". Rounding of non-divisible amounts to grosze (unverified - no source).
   - Cross-multipack discounts the cheaper unit (2026 forum dispute, knives vs pans).
5. Other order-level price reductions also show up per line: `WHOLESALE_PRICE_LIST`, `LARGE_ORDER_DISCOUNT`, `TURNOVER_DISCOUNT` (B2B only), `COUPON`, `CAMPAIGN`; and Allegro-funded "Allegro Ceny" via `reconciliation {value, type BILLING|WALLET, quantity}`.

### Theme 2: How it arrives in the order (checkout-form)
- `CheckoutFormLineItem` = `{id, offer{id, name, external.id, productSet?}, quantity, originalPrice, price, deposit?, reconciliation?, selectedAdditionalServices[], vouchers[], tax{rate, subject, exemption}, boughtAt, discounts[], serialNumbers, allegroAds}`.
- `LineItemDiscount` has ONLY `type`, no amount, no promotion/bundle id. Amount must be derived as `originalPrice - price` (per unit) times quantity. (Inference from schema.)
- Order-level `discounts` was deprecated 2025-05-05 and scheduled for removal 2026-01-07; the current spec's `CheckoutForm` no longer has it.
- `Price.amount` is a string "to avoid rounding errors". `summary.totalToPay` "including additional services and delivery".
- Gift wrapping: an additional service definition `GIFT_WRAP` exists (seller-configured groups, "Describe how you gonna pack product as a gift"). It arrives as `lineItems[].selectedAdditionalServices[] {definitionId, name, price, quantity}` - a priced service attached to a line, not a product.
- OpenLinker today (read-only observation): the Allegro order mapper uses `price * quantity` per line, maps the line to `offer.id`, and does not read `originalPrice`, `discounts`, `productSet` or `selectedAdditionalServices`.

### Theme 3: Gifts ("gratisy")
- Allegro has no "add a free gift to the order" feature (no gift type in the API; search found none). Ways sellers do it:
  - **100% unit discount via multipack** ("kup 2, trzecia gratis"): Allegro lowers the price of that item to 0,01 zł and charges min. commission 0,25 zł (help-article line quoted by moderator 2020-07-29). Buyers see "GRATIS" but pay 0,01 zł; and because the discount is spread across units, the order line shows an averaged unit price (combination of two moderator statements; exact representation unverified).
  - **Gift described in the offer** (title/photo with "+ gift"): moderator 2025-07-16 ruled such gift terms "niejasne" and potentially misleading; the gift does NOT appear in the order at all, buyers file "niezgodność z umową" complaints when the gift is missing (e.g. promo ended).
  - **Gift as a component of a product set** (productSet including the gift product): arrives as one line, one price; gift is visible only as a catalogue product UUID in `productSet`. (Mechanism inferred from productSet rules; no source describing this usage.)
  - **Separate cheap offer (e.g. 1 zł) or bundle with a gift offer**: no source found (unverified).
  - **Secret gift added at packing** (not mentioned to the buyer): forum user advice, not in the order.
- Commission: moderator 2020: "Nie pobieramy prowizji od gratisów rozumianych jako darmowe przedmioty, które oferujesz jako dodatek w swoich ofertach" but commission is charged per item in a purchased set; 100% discount -> 0,25 zł min. commission. Rules conflict and are 2020 vintage (verify).
- Can an offer cost 0 zł? No source found allowing it; the 100%-discount rule (floor 0,01 zł) suggests not (unverified for listing price).

### Theme 4: Returns and refunds
- Buyer may return part of a set (any type), sellers complain ("kupujący ma prawo zwrócić część z zestawu co jest bzdurą w przypadku np. motoryzacji", 2020).
- Moderator 2024-02-27: seller should enable return term "Kupujesz produkt w zestawie? - jeżeli zwrócisz część zestawu, stracisz prawo do zniżki"; "Kwota zwrotu zostanie pomniejszona o różnicę pomiędzy ceną produktu w zestawie a ceną produktu bez zestawu".
- Moderator 2021-05-31 (art. 31 ust. 1 ustawy o prawach konsumenta): seller may deduct the granted discount on partial return; example 26,99 + 13,49 (2nd -50%), buyer returns the expensive one -> refund 13,50.
- 2026-03 dispute: buyer returned the discounted (cheaper) items, seller refunded what was paid; moderator saw no error.
- `CustomerReturnItem` = `{offerId, quantity, name, price, url, reason, serialNumbers}` - no productSet component, so a return of ONE component of a productSet offer cannot be expressed per component (schema inference; real-world behaviour unverified).
- `RefundLineItem` supports `QUANTITY` and `AMOUNT` per line, so a "lost discount" clawback is expressed as a partial AMOUNT refund on a line.

### Theme 5: Fiscal/document side
- Allegro sets VAT per offer (0/5/8/23, one rate per country); line `tax.rate` comes from the offer. Tax law (amavat, podatki.biz): a set of functionally unrelated goods is several supplies and each element is taxed at its own rate; one rate only with a functional link. Allegro provides no per-component price or rate for a productSet line, so the seller must allocate.
- Invoice/receipt per line should use the discounted `price` (proportionally spread) - consistent with moderator statements; no Allegro doc on invoices with bundle discounts found.
- A 0,01 zł "gift" line is a real priced sale line; a gift given outside the order (description/secret) is not in the order and its document treatment (nieodpłatne przekazanie) is outside Allegro (unverified, tax-advisor topic).

## Use cases
ALG-01 | seller | creates a "zestaw ofert" (laptop + mouse, -50 zł) | one line per offer, discount spread proportionally, `discounts[BUNDLE]`, `price < originalPrice`, no bundle id | must reconstruct "these lines were a bundle" heuristically | spec LineItemDiscount + forum 727363
ALG-02 | Allegro (automatic) | Allegro auto-bundles two offers, no discount | lines carry `discounts[BUNDLE]` with `price == originalPrice` | seller did not create it, cannot opt out (thread unanswered), offers paired badly | thread 730293 + spec
ALG-03 | seller | one offer "zestaw: konsola + gra" via productSet | ONE line, one price, one VAT rate, `offer.productSet.products[] {catalogue UUID, qty}` | stock of N components vs `stock.available` of sets; component SKUs not in order | news 2023-12-13, spec
ALG-04 | seller | wielopak 6 x same product in one offer | one line, productSet `quantity 6`, `quantity` = number of packs | stock decrement must multiply by 6 | news 2021-09-30, spec ProductSetElementQuantity
ALG-05 | seller | "druga sztuka -50%" (MULTIPACK) | one line qty 2, unit price averaged, `discounts[UNIT_PERCENTAGE_DISCOUNT]` | partial return refund 13,50 not 26,99; averaged price vs "real" price | forum 214069, spec
ALG-06 | seller | "kup 2, trzecia gratis" (multipack 100%) | gift unit priced 0,01 zł, spread across units (unverified exact), min commission 0,25 zł | gift not identifiable as a line; grosz rounding | forum 49695, spec 4449
ALG-07 | seller | CROSS_MULTIPACK across offers (pans + knives) | lines per offer, cheaper unit discounted | buyer disputes refund when returning discounted part | forum 1166508
ALG-08 | seller | flexible bundle, buyer picks a model per slot | one line per chosen offer, discount spread (WHOLE) or per slot | bundle availability depends on every slot offer's stock | spec /sale/flexible-bundles
ALG-09 | seller | "telefon + etui + głośnik gratis" in title/description | gift not in order at all | moderator: terms misleading; complaint when gift missing | thread 1050074
ALG-10 | seller | secret gift added at packing | nothing in order | stock of gift item drifts, no record | forum 49695 (user advice)
ALG-11 | buyer | buys with gift wrapping | `selectedAdditionalServices[GIFT_WRAP] {price, qty}` on a line | a paid service, must reach packer and invoice | spec CheckoutFormAdditionalService
ALG-12 | buyer | returns one item of a zestaw ofert | return item = offerId+qty; seller deducts lost discount via AMOUNT refund | correct clawback amount needs bundle original prices | forum 727363, spec RefundLineItem
ALG-13 | buyer | wants to return one component of a productSet offer | return API has no component level | partial refund by AMOUNT, component restock manual (unverified) | spec CustomerReturnItem
ALG-14 | seller | productSet mixing 5% book + 23% toy | one `tax.rate` per line | invoice/receipt must split by rate; Allegro gives no split price | spec OfferTaxSettings, amavat
ALG-15 | B2B buyer | large-order / wholesale discount | per-line `discounts[LARGE_ORDER_DISCOUNT/WHOLESALE_PRICE_LIST]` | same "no amount" shape as bundles | spec

## Checklist answers
- Bundle definition: four mechanisms - productSet offer (one listing), zestaw ofert (/sale/bundles, deprecated in spec; legacy promotions ORDER_FIXED_DISCOUNT), flexible bundles (slots), multipack/cross-multipack.
- Variants inside a bundle: only flexible bundles (buyer picks offer per slot, up to 30 offers same leaf category); productSet is fixed; zestaw ofert fixed offers.
- Bundle stock & availability: productSet has own `stock.available` = sets (seller must keep in sync with components); offer bundles/flexible have no own stock, derived from each offer, bundle `SUSPENDED` / offer unavailable in bundle when stock insufficient.
- Bundle as listing: productSet = its own offer (own EAN, category of first product); zestaw ofert/flexible = shown on entry-point offer pages, not a separate offer.
- Order containing a bundle: productSet -> 1 line + `offer.productSet.products[]`; offer bundle/flexible -> N lines with `discounts[BUNDLE]`; multipack -> 1 line with averaged unit price + `discounts[UNIT_PERCENTAGE_DISCOUNT]`. No discount amount and no bundle id in the line.
- Packing & split parcels: all lines in one checkout-form; physical split is the seller's choice (`delivery.calculatedNumberOfPackages` exists); flexible bundle forbids mixing 1F and non-1F offers. No bundle-specific packing info (unverified beyond that).
- Return of a bundle component: allowed by Allegro for offer bundles; seller may deduct lost discount if return term enabled; productSet component return not expressible in return API (unverified behaviour).
- Return when a gift was included: multipack gift is a 0,01 zł unit inside the line -> deduct discount on partial return (moderator rule); description gifts: no rule found (unverified).
- Splitting bundle price across VAT rates: not supported by Allegro data (one rate per offer/line); seller allocates.
- Gift source: no channel gift rule; seller manual (description / secret), multipack 100% (0,01 zł), component of productSet (inferred).
- Gift stock & running out: Allegro does not track gift stock; description gifts that run out cause complaints; multipack gift uses same offer stock.
- Gift on receipt/invoice: multipack gift is a priced line (0,01 zł); description/secret gifts are absent from order data.
- Gift limits: none native; multipack limits by trigger 2-5 and discountedNumber 1; no per-customer limit found (unverified).

## Conflicts / open questions
- Max products per productSet: moderator says 10, another forum post says 9.
- Gift commission: "no commission on gifts" vs "0,25 zł min commission on 100% discount" (both moderator, 2020).
- Exact multipack representation: one averaged line (moderator "rozdzielimy proporcjonalnie") vs whether Allegro ever splits into two lines - not confirmed by any payload sample.
- Whether flexible bundles report `discounts[type=BUNDLE]` - spec enum has no flexible-specific value.
- Grosze rounding of proportional splits and whether sum(lines) can differ from totalToPay - no source.

## Confidence
- High: line item schema, discount type enum without amount, productSet in orders, multipack constraints (spec).
- Medium: proportional split and partial-return deduction (several consistent moderator answers, not official docs).
- Low: gift mechanics outside multipack, mixed-VAT handling in practice, productSet component returns.

## What the caller might do with this
- Decide whether OpenLinker must recognise Allegro bundles as bundles (grouping lines) or only needs correct per-line money and stock.
- Decide whether productSet component explosion (catalogue UUID -> master SKU) is in scope for stock and packing.
- Ask pilot merchants how they give gifts on Allegro today (multipack 100% vs description vs secret).
