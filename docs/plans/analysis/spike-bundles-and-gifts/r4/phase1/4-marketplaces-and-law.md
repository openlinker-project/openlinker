# R4 / Phase 1 / 4 - Marketplace order schemas and tax/fiscal law (primary sources only)

Researcher: R4 agent, 2026-11-04. Method: downloaded each spec or statute and quoted from the file. No blogs, forums or vendor marketing carry any conclusion here. Web search was used only to find primary URLs.

## 0. Sources consulted (all primary)

| # | Source | Kind | Retrieved / version |
|---|---|---|---|
| S1 | `https://erli.pl/svc/shop-api/doc/swagger.json` | Official OpenAPI (Erli Shop API) | info.version `1.0`, retrieved 2026-11-04 |
| S2 | `github.com/amzn/selling-partner-api-models` `models/orders-api-model/ordersV0.json` | Official model repo | HEAD `db2936aa19f4b48185173c385c51ab115166f221` |
| S3 | same repo, `models/orders-api-model/orders_2026-01-01.json` | Official model repo | same commit, info.version `2026-01-01` |
| S4 | `https://sellerapi.kaufland.com/swagger.json` + `https://sellerapi.kaufland.com/?page=orders` | Official OpenAPI + official docs | info.version `2.47.0` |
| S5 | `https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/orders/or11.md` | Official API reference (markdown export of OpenAPI) | "latest-release", retrieved 2026-11-04 |
| S6 | `https://developer.ebay.com/api-docs/master/sell/fulfillment/openapi/3/sell_fulfillment_v1_oas3.json` | Official OAS | `v1.20.7` |
| L1 | Ustawa o VAT, tekst jednolity **Dz.U. 2026 poz. 1263** (obwieszczenie z 1 września 2026), via official Sejm ELI API `https://api.sejm.gov.pl/eli/acts/DU/2026/1263/text.pdf` | Statute | newest consolidated text (2025 poz. 775 now "wygaśnięcie aktu") |
| L2 | Rozporządzenie MF z 25 czerwca 2025 r. w sprawie kas rejestrujących, **Dz.U. 2025 poz. 845** (`api.sejm.gov.pl/eli/acts/DU/2025/845/text.pdf`), in force 1 July 2025 | Regulation | status "obowiązujący" |
| L2b | Rozporządzenie MF z 29 kwietnia 2019 r., Dz.U. 2019 poz. 816 | Regulation | status **"uznany za uchylony"** (repealed) |
| L3 | FA(3) XSD `http://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd` | Official schema | |
| L3b | "Broszura informacyjna dotycząca struktury logicznej FA(3)", `https://ksef.podatki.gov.pl/media/0ivha0ua/broszura-informacyjna-dotyczaca-struktury-logicznej-fa-3.pdf` | MF official brochure, wrzesień 2025 | |
| L4 | KIS / DIS individual interpretations via the official Eureka API `https://eureka.mf.gov.pl/api/public/v1/informacje/{id}` | Tax-authority rulings | ids 214565, 322896, 676872, 703725 |
| L5 | Council Directive 2006/112/EC, `http://publications.europa.eu/resource/celex/32006L0112` | EU law, OJ L 347 original text | |
| L6 | BFH Urteil 22.01.2025, XI R 19/23, `https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/STRE202520153/` | Court ruling | ECLI:DE:BFH:2025:U.220125.XIR19.23.0 |
| L7 | DPR 633/1972 art. 2 and art. 15, Normattiva, version vigente 2026-11-01 | Statute | Normattiva marks both "ABROGATO DAL D.LGS. 19 GENNAIO 2026, N. 10" |
| L7b | D.Lgs. 19 gennaio 2026, n. 10 (Testo unico IVA), Gazzetta Ufficiale SO n. 4, GU n. 24 of 30-01-2026, full text exported from gazzettaufficiale.it | Statute | applies from 1 Jan 2027 (art. 171) |

Not obtainable from primary source in this run: ISAP (isap.sejm.gov.pl) returned 403 behind Incapsula, so the official Sejm ELI API was used instead (same Dziennik Ustaw PDF). EUR-Lex HTML returned 202/empty; the Publications Office CELEX resource returned the OJ text.

---

## 1. Marketplace field cheat-sheet

### 1.1 Erli Shop API (S1)

| Concern | Field | Definition (verbatim from spec) |
|---|---|---|
| Line price | `Order.items[].unitPrice` | `{"type":"integer"}` (no description; required). Currency unit not stated on this field; the sibling `CreateDiscount.newPrice` says `"Cena w groszach"`, so grosze is likely but **unverified for the order field**. |
| Pre-discount price | `Order.items[].unitPriceBeforeRebate` | `{"type":"integer"}` (optional, no description) |
| Discount | `Order.rebate` | object `{id, name, code}`; `code`: `"tylko w przypadku jednorazowych kodów"`. **Order-level only, no amount field.** |
| Line tax | `items[].taxRate` | `"Stawka VAT obowiązująca na produkcie w trakcie zamówienia, TAX_NP = Nie przysługuje, TAX_ZW = Zwolniony z VAT, TAX_23 = 23%, etc."` enum `TAX_0, TAX_5, TAX_8, TAX_23, TAX_NP, TAX_ZW, TAX_7, TAX_19` |
| Free quantity / gift / gift wrap | none | Keyword search over the whole spec: `gratis` 0, `bundle` 0, `gift` 0, `prezent` 0 hits. |
| Bundle / composition | none | The only "zestaw" hit is unrelated: `"Nie zmienia zestawu dopasowanych produktów"`. |
| Returns granularity | `Order.returns[].items[]` | `index`: `"Numer zwracanej pozycyji, odnosi się do pola items zamówienia"`; `quantity`: `"Określa ilość zwracanej pozycji"`. So: **per order line by positional index, with quantity**. |

Ratings: line price Full, discount Partial (order-level label, line effect only derivable from `unitPriceBeforeRebate - unitPrice`), free qty None, gift wrap None, bundle None, returns Full (line+qty).

### 1.2 Amazon SP-API Orders v0 (S2)

| Concern | Field | Verbatim |
|---|---|---|
| Line price | `OrderItem.ItemPrice` | "The selling price of the order item. Note that an order item is an item and a quantity. This means that the value of `ItemPrice` is equal to the selling price of the item multiplied by the quantity ordered. `ItemPrice` excludes `ShippingPrice` and GiftWrapPrice." |
| Discounts | `PromotionDiscount`, `PromotionDiscountTax`, `PromotionIds` | "The total of all promotional discounts in the offer." / "A list of promotion identifiers provided by the seller when the promotions were created." |
| Gift flag | `IsGift` | "Indicates whether the item is a gift. **Possible values**: `true` and `false`." (buyer-is-sending-a-gift, not a free item) |
| Gift wrap | `BuyerInfo.GiftWrapPrice`, `GiftWrapTax`, `GiftMessageText`, `GiftWrapLevel` | "The gift wrap price of the item." / "A gift message provided by the buyer." / "The gift wrap level specified by the buyer." |
| Pack count | `ProductInfo.NumberOfItems` | "The total number of items that are included in the ASIN." |
| Associated items | `AssociatedItems[]`, `AssociationType` enum `["VALUE_ADD_SERVICE"]` | "A list of associated items that a customer has purchased with a product. For example, a tire installation service purchased with tires." |
| Free quantity | none | no field |
| Bundle components | none | grep `bundl` over both Amazon files: 0 hits |
| Returns | none in Orders API | (not in this model; out of scope of S2) |

### 1.3 Amazon SP-API Orders 2026-01-01 (S3)

| Concern | Field | Verbatim |
|---|---|---|
| Unit price | `ItemProduct.price.unitPrice` | "The price charged for a single unit of this product, before any quantity-based calculations." |
| Proceeds | `ItemProceedsBreakdown.type` | "**Possible values**: `ITEM`, `SHIPPING`, `GIFT_WRAP`, `COD_FEE`, `OTHER`, `TAX`, `DISCOUNT`" |
| Discount detail | `ItemProceedsDetailedBreakdown` | "Further granular breakdown of the subtotal of the proceeds breakdown, only available for TAX and DISCOUNT proceeds types." |
| Promotions | `ItemPromotionBreakdown.promotionId` | "Unique identifier for the promotion applied to this item." (id only, no amount on this object) |
| Gift wrap | `ItemPacking.giftOption` -> `GiftOption.giftMessage`, `giftWrapLevel` | "Personal message from the buyer to be included with the gift-wrapped item." / "Type or quality level of gift wrapping service selected by the customer." |
| Associated | `AssociatedOrderItem.associationType` | "`VALUE_ADD_SERVICE` (The associated item is a service order) - `WARRANTY` (The associated item is a product covered by a warranty or protection plan)"; `purchasePrice`: "the amount the customer paid, excluding shipping, tax, gift wrap, and promotions" |
| Fulfilment granularity | `ItemFulfillment.quantityFulfilled/quantityUnfulfilled`, `PackageItem.quantity` | "The number of units of this item that have been successfully processed and shipped." / "Number of units of this item included in the package shipment." |
| Substitution | `ItemSubstitutionOption` | "Alternative product that can be substituted for an original order item when it becomes unavailable during fulfillment." |
| Free qty / bundle | none | no field; `NumberOfItems` present in v0 is **absent** from `ItemProduct` in 2026-01-01 |

### 1.4 Kaufland Seller API v2 (S4)

Key structural fact (docs `?page=orders`): "Each order is composed of one or more order units , each corresponding to a unit . **If the same unit gets ordered several times, several order units are created.**" So an `OrderUnit` has **no quantity field**: one row = one piece.

| Concern | Field | Verbatim |
|---|---|---|
| Line price | `OrderUnit.price` (integer), `revenue_gross`, `revenue_net`, `vat` | docs: "The discount is already factored into the price field: price is the post-discount amount the buyer paid." |
| Discounts | `OrderUnit.discounts[]` `{usage_type, discount_value}` | spec: `discount_value`: "Absolute discount amount in the order unit's currency subunit (e.g. cents)". Docs: "Only seller-created discounts appear here. **Kaufland-funded promotions are not reflected in this field.**" / "There are two possible values for usage_type : voucher ... volume" / "**At most one discount applies per order unit.**" / `price = original_price - discount_value` |
| Free qty / gift / bundle | none | spec grep: `bundle` 0, `gift` 0, `promotion` 0 hits; `free` only in shipping `cost_free`. |
| Returns | `ReturnUnit.id_order_unit`, `reason`, `status` | return is per order unit, i.e. **per piece**; reasons enum includes `missing_parts`, `wrong_article`. |
| Refund | `PATCH /order-units/{id_order_unit}/refund`, body `{amount, reason}` | "Send a refund to a customer for a particular order unit. `amount` must be in Eurocents." |

### 1.5 Mirakl Marketplace seller API, OR11 (S5)

| Concern | Field | Verbatim |
|---|---|---|
| Unit price | `order_lines.price_unit` (required) | "Unit price for the offer associated with the order line" |
| Original price | `order_lines.origin_unit_price` | "The original unit price of the offer associated with the order line" |
| Line price | `order_lines.price` / `total_price` | "Order line's price without shipping price" / "Order line's price with shipping price and fees." |
| Tax mode | query param | "`TAX_EXCLUDED`: the price fields (price, unit price, shipping price, cancellation amount, refund amount and order total prices) do not include taxes." |
| Promotions (line) | `order_lines.promotions[]` | `deduced_amount`: "Promotion's amount for this line."; `apportioned`: "true when the promotion's reward amount is divided and allocated proportionally to multiple order lines." |
| Promotion types | `configuration.type` | Enum: `"AMOUNT_OFF"`, `"FREE_ITEMS"`, `"PERCENTAGE_OFF"`, `"REDUCED_UNIT_PRICE"` |
| **Free quantity** | `promotions.offered_quantity`, `configuration.free_items_quantity` | "The quantity of free items offered by the promotion for this line. Only applicable when promotion is of type FREE_ITEMS, null otherwise." / "The free item target quantity of the promotion." |
| Order-level promos | `orders.promotions.applied_promotions[]`, `total_deduced_amount` | same sub-fields |
| Bundle | none | only `offer_sku` / `product_sku`; grep `bundle` 0 hits |
| Refunds | `order_lines.refunds[]` `amount`, `quantity` | `quantity`: "The quantity of products refunded (**This quantity is informative only**)." |
| Cancellations | `order_lines.cancelations.quantity` | "The quantity of products canceled (This quantity is informative only)" |

Open question (Unknown): whether `order_lines.quantity` includes the `offered_quantity` free units or not. The spec does not say.

### 1.6 eBay Sell Fulfillment API (S6)

| Concern | Field | Verbatim |
|---|---|---|
| Line price | `LineItem.lineItemCost` | "The selling price of the line item before applying any discounts. The value of this field is calculated by multiplying the single unit price by the number of units purchased" |
| After discount | `discountedLineItemCost` | "The cost of the line item after applying any discounts. This container is only returned if the order line item was discounted through a promotion." |
| Promotions | `appliedPromotions[]` `{description, discountAmount, promotionId}` | "The monetary amount of the sales promotion." |
| Gift | `giftDetails` | "This container is only returned and applicable for **digital gift card line items**." (not a free item, not gift wrap) |
| Free qty / bundle / gift wrap | none | |
| Refunds | `RefundItem {refundAmount, lineItemId}` | "used if the seller is issuing a refund for one or more individual order line items" - **amount per line, no quantity** |

---

## 2. Law findings (verbatim)

### 2.1 Poland - VAT Act (L1, Dz.U. 2026 poz. 1263)

**Art. 7 ust. 2** - free transfer is a supply:
> "2. Przez dostawę towarów, o której mowa w art. 5 ust. 1 pkt 1, rozumie się również przekazanie nieodpłatnie przez podatnika towarów należących do jego przedsiębiorstwa, w szczególności: [...] 2) wszelkie inne darowizny – jeżeli podatnikowi przysługiwało, w całości lub w części, prawo do obniżenia kwoty podatku należnego o kwotę podatku naliczonego z tytułu nabycia, importu lub wytworzenia tych towarów lub ich części składowych."

**Art. 7 ust. 3** - small gifts and samples excluded:
> "3. Przepisu ust. 2 nie stosuje się do przekazywanych prezentów o małej wartości i próbek, jeżeli przekazanie to następuje na cele związane z działalnością gospodarczą podatnika."

**Art. 7 ust. 4** - current thresholds (100 zł/year/person with a register; 20 zł unit without):
> "4. Przez prezenty o małej wartości, o których mowa w ust. 3, rozumie się przekazywane przez podatnika jednej osobie towary:
> 1) o łącznej wartości nieprzekraczającej w roku podatkowym kwoty 100 zł (bez podatku), jeżeli podatnik prowadzi ewidencję pozwalającą na ustalenie tożsamości tych osób;
> 2) których przekazania nie ujęto w ewidencji, o której mowa w pkt 1, jeżeli jednostkowa cena nabycia towaru (bez podatku), a gdy nie ma ceny nabycia, jednostkowy koszt wytworzenia, określone w momencie przekazywania towaru, nie przekraczają 20 zł."

**Art. 7 ust. 7** - sample definition (relevant to "próbki" in parcels):
> "7. Przez próbkę, o której mowa w ust. 3, rozumie się identyfikowalne jako próbka egzemplarz towaru lub jego niewielką ilość, które pozwalają na ocenę cech i właściwości towaru w jego końcowej postaci, przy czym ich przekazanie (wręczenie) przez podatnika: 1) ma na celu promocję tego towaru oraz 2) nie służy zasadniczo zaspokojeniu potrzeb odbiorcy końcowego [...]"

**Art. 29a ust. 1, 2, 7, 10** - base, deemed-supply base, discounts:
> "1. Podstawą opodatkowania [...] jest wszystko, co stanowi zapłatę, którą dokonujący dostawy towarów lub usługodawca otrzymał lub ma otrzymać z tytułu sprzedaży od nabywcy [...]"
> "2. W przypadku dostawy towarów, o której mowa w art. 7 ust. 2, podstawą opodatkowania jest cena nabycia towarów lub towarów podobnych, a gdy nie ma ceny nabycia – koszt wytworzenia, określone w momencie tej dostawy towarów."
> "7. Podstawa opodatkowania nie obejmuje kwot: [...] 2) udzielonych nabywcy lub usługobiorcy opustów i obniżek cen, uwzględnionych w momencie sprzedaży;"
> "10. Podstawę opodatkowania obniża się o: 1) kwoty udzielonych po dokonaniu sprzedaży opustów i obniżek cen; 2) wartość zwróconych towarów i opakowań;"

**Art. 106e ust. 1 pkt 7-11** - invoice line content:
> "7) nazwę (rodzaj) towaru lub usługi; 8) miarę i ilość (liczbę) dostarczonych towarów lub zakres wykonanych usług; 9) cenę jednostkową towaru lub usługi bez kwoty podatku (cenę jednostkową netto); 10) kwoty wszelkich opustów lub obniżek cen, w tym w formie rabatu z tytułu wcześniejszej zapłaty, o ile nie zostały one uwzględnione w cenie jednostkowej netto; 11) wartość dostarczonych towarów lub wykonanych usług, objętych transakcją, bez kwoty podatku (wartość sprzedaży netto);"

**Art. 2 pkt 22, art. 106b ust. 1, art. 111 ust. 1** - invoice/receipt duties attach to "sprzedaż" (paid supply):
> "22) sprzedaży – rozumie się przez to odpłatną dostawę towarów i odpłatne świadczenie usług na terytorium kraju, eksport towarów oraz wewnątrzwspólnotową dostawę towarów;"
> "Art. 106b. 1. Podatnik jest obowiązany wystawić fakturę dokumentującą: 1) sprzedaż, [...]"
> "Art. 111. 1. Podatnicy dokonujący sprzedaży na rzecz osób fizycznych nieprowadzących działalności gospodarczej oraz rolników ryczałtowych są obowiązani prowadzić ewidencję sprzedaży przy zastosowaniu kas rejestrujących."

Inference (not a ruling): a deemed free supply under art. 7 ust. 2 is not "sprzedaż", so the statutory text does not by itself require an invoice line or a receipt line for it; its VAT is still due on the art. 29a ust. 2 base. Have a tax adviser confirm before OL builds on this.

### 2.2 Poland - cash register regulation (L2)

The brief's "Rozporządzenie 2019 par. 25" is **repealed**: ELI API marks Dz.U. 2019 poz. 816 "uznany za uchylony". Its successor is Dz.U. 2025 poz. 845 (§ 61: "Rozporządzenie wchodzi w życie z dniem 1 lipca 2025 r."). The receipt content moved to **§ 26 ust. 1** with essentially the same wording:
> "§ 26. 1. W przypadku prowadzenia przez podatnika ewidencji przy użyciu kas z elektronicznym lub papierowym zapisem kopii paragon fiskalny zawiera co najmniej: [...] 6) nazwę towaru lub usługi pozwalającą na jednoznaczną ich identyfikację; 7) cenę jednostkową towaru lub usługi; 8) ilość i wartość sumaryczną sprzedaży danego towaru lub usługi z oznaczeniem literowym przypisanej stawki podatku; 9) wartość opustów, obniżek lub narzutów, o ile występują; 10) wartość sprzedaży brutto i wysokość podatku należnego według poszczególnych stawek podatku z oznaczeniem literowym po uwzględnieniu opustów, obniżek lub narzutów;"

Old 2019 § 25 ust. 1 pkt 6-10 had the same items (verified in Dz.U. 2019 poz. 816 text).

Also § 9 ust. 1 pkt 1 (2025): taxpayers check "prawidłowego zaprogramowania nazw towarów i usług, stawek podatku [...] oraz właściwego przypisania do nazw towarów i usług stawek podatku" - i.e. name-to-rate binding lives in the register.

### 2.3 KSeF FA(3) (L3, L3b)

XSD documentation for `FaWiersz` fields:
- `P_9A`: "Cena jednostkowa towaru lub usługi bez kwoty podatku (cena jednostkowa netto)." type `TKwotowy2`, pattern `-?([1-9]\d{0,13}|0)(\.\d{1,8})?` (so **0 is a valid unit price**).
- `P_10`: "Kwoty wszelkich opustów lub obniżek cen, w tym w formie rabatu z tytułu wcześniejszej zapłaty, o ile nie zostały one uwzględnione w cenie jednostkowej netto, a w przypadku stosowania art. 106e ust. 7 ustawy w cenie jednostkowej brutto."
- `P_11`: "Wartość dostarczonych towarów lub wykonanych usług, objętych transakcją, bez kwoty podatku (wartość sprzedaży netto)." type `TKwotowy` (2 decimals).
- `P_9B`/`P_11A`: gross variants "w przypadku zastosowania art. 106e ust. 7 i 8 ustawy".
- `Indeks`: "Pole przeznaczone do wpisania wewnętrznego kodu towaru lub usługi nadanego przez podatnika albo dodatkowego opisu"; `GTIN`: "Globalny numer jednostki handlowej"; `UU_ID`: "Uniwersalny unikalny numer wiersza faktury".
- Brochure L3b: "Cenę jednostkową w polach P_9A, P_9B, P_9AZ oraz kwoty opustów lub obniżek prezentowane w polu P_10 można podawać z dokładnością do 8 miejsc po kropce."

No primary source found that tells how to show a gratis or a bundle in FA(3). The brochure has no "gratis"/"zestaw" guidance (grep: 0 relevant hits). Rating: Unknown.

### 2.4 Poland - tax authority interpretations (L4, Eureka)

**(a) 0114-KDIP1-1.4012.876.2025.2.IZ, 23 Jan 2026 (Eureka id 676872), Dyrektor KIS** - "Kup 5 produktów a najtańszy otrzymasz gratis" shown in the basket at 0 zł as "rabat 100%". Facts quoted: "Wartość gratisu jest wliczona w całą cenę zamówienia – czyli Spółka nie rabatuje najdroższego produktu o wartość najtańszego, ale pokazujemy w koszyku konsumenta produkt za 0 zł. Gratisy będą dokumentowane na fakturze lub paragonie jako produkty z rabatem 100%". Holding (stanowisko **nieprawidłowe**):
> "Zatem w sytuacji, gdy dokonujący dostawy towarów nie żąda od nabywcy zapłaty, to trudno mówić o jej zmniejszeniu, gdyż zapłata nie występuje. W konsekwencji obniżenie przez Państwa ceny zakupu produktu o 100% na rzecz uczestników opisanych we wniosku akcji promocyjnych nie będzie równoznaczne z udzieleniem rabatu."
> "W konsekwencji dostawa na rzecz klienta towaru objętego rabatem w wysokości 100% stanowić będzie nieodpłatną dostawę towarów."
It also rejected the "it is one complex supply" argument for a 5-product basket: "Biorąc pod uwagę skład zamówienia nie można go uznać za świadczenie kompleksowe".

**(b) IBPP1/4512-383/16-1/MS, 9 Sep 2016 (id 322896), Dyrektor IS Katowice** - basic product + gratis:
> "w sytuacji gdy cena towaru dodatkowego nie stanowi elementu kalkulacyjnego ceny za towar podstawowy" -> free supply under art. 7 ust. 2 (small-gift test applies);
> where the gift cost is part of the price calculation: "nie dochodzi do nieodpłatnego przekazania towaru w postaci towaru dodatkowego (gratisu) na rzecz kontrahenta, gdyż kontrahent płaci za ten dodatkowy towar";
> and on the bundle: "sprzedaż pakietowa (obejmująca towar podstawowy i towar określony jako gratis) powinna być uznana dla celów rozliczeń VAT jako dwie odrębne transakcje, tj. ... prawidłowe".

**(c) ILPP2/443-764/13-4/MR, 29 Nov 2013 (id 214565), DIS Poznań**:
> "dostawa produktu „podstawowego” jest/będzie opodatkowana stawką właściwą dla tego produktu, natomiast dostawa dołączonego do niego gratisu opodatkowana jest/będzie stawką właściwą dla tego właśnie gratisu (jako odrębnego od produktu „podstawowego” towaru)."
(Its 10 zł figure is the pre-change threshold; current law says 20 zł, see 2.1.)

**(d) 0114-KDIP4-2.4012.449.2026.3.WH, 3 Aug 2026 (id 703725)** - stanowisko prawidłowe; quotes the MF communiqué on sets: "Przykładowo, określając cenę poszczególnych towarów wchodzących w skład zestawu, podatnicy często stosują proporcjonalne obniżenie ceny – cena każdego towaru zestawu jest obniżana o tyle samo procent [...] – nie ma wątpliwości, że jest to postępowanie prawidłowe" and the earlier ruling: "dopuszczalna jest alokacja rabatu na jeden z wchodzących w skład zestawu promocyjnego towar, jeżeli jest to uzasadnione wyższą rentownością jednego z towarów". (Communiqué itself, "Nieprawidłowe określanie podstawy opodatkowania VAT dla towarów sprzedawanych w formie zestawów", MF 2017, read here only as quoted inside the KIS ruling.)

Conflict: (b) says a gratis whose cost is built into the paid price is paid for (no deemed supply); (a) says a 100%-discount gratis is a deemed free supply even though the applicant stated "Wartość gratisu jest wliczona w całą cenę zamówienia". I trust (a) more as current practice (2026, KIS, the exact e-commerce pattern OL will see), but individual interpretations bind only the applicant; the outcome depends on facts. OL cannot decide this; it must carry the facts and let the operator/adapter choose.

### 2.5 EU VAT Directive 2006/112/EC (L5)

> "Article 16 The application by a taxable person of goods forming part of his business assets for his private use or for that of his staff, or their disposal free of charge or, more generally, their application for purposes other than those of his business, shall be treated as a supply of goods for consideration, where the VAT on those goods or the component parts thereof was wholly or partly deductible. However, the application of goods for business use as samples or as gifts of small value shall not be treated as a supply of goods for consideration."
> "Article 79 The taxable amount shall not include the following factors: [...] (b) price discounts and rebates granted to the customer and obtained by him at the time of the supply;"
The Directive sets **no amount** for "gifts of small value"; each Member State sets its own (PL 100/20 zł, IT 50 EUR with a scope limit, see 2.7).

### 2.6 Germany - BFH XI R 19/23, 22 Jan 2025 (L6)

Leitsatz:
> "Eine Methode zur Aufteilung eines einheitlichen Gesamtentgelts, die dazu führt, dass auf ein Produkt einer rabattierten Warenzusammenstellung ein anteiliger Verkaufspreis entfällt, der höher ist als der Einzelverkaufspreis, ist nicht sachgerecht."
Court reasoning:
> "Als einfachstmögliche Methode sieht der BFH dabei die Aufteilung nach Marktwerten beziehungsweise Einzelverkaufspreisen an"
> "Notwendige Voraussetzung hierfür ist aber jedenfalls, dass die angewendete Methode zumindest ebenso sachgerecht ist wie die grundsätzlich vorzunehmende Aufteilung nach Einzelverkaufspreisen."
Facts: "Spar-Menüs (bestehend aus Getränken und Speisen zu einem einheitlichen Gesamtpreis)" with 7% and 19% components; the cost-based "Food-and-Paper" method was rejected.

### 2.7 Italy - DPR 633/1972 (L7) and Testo unico IVA (L7b)

Normattiva marks DPR 633/72 art. 2 and art. 15 "ARTICOLO ABROGATO DAL D.LGS. 19 GENNAIO 2026, N. 10". The repeal takes effect with the Testo unico: art. 171 "Le disposizioni del presente testo unico si applicano a decorrere dal 1° gennaio 2027." Until 31 Dec 2026 the DPR text applies; from 1 Jan 2027 the same rules sit in TU IVA art. 5 and art. 29.

DPR 633/72 art. 2 comma 2 n. 4 (vigente 2026-11-01) = TU IVA art. 5 comma 2 lett. d:
> "4) le cessioni gratuite di beni ad esclusione di quelli la cui produzione o il cui commercio non rientra nell'attività propria dell'impresa se di costo unitario non superiore ad euro cinquanta e di quelli per i quali non sia stata operata, all'atto dell'acquisto o dell'importazione, la detrazione dell'imposta a norma dell'articolo 19"
(TU: "d) le cessioni gratuite di beni ad esclusione di quelli la cui produzione o il cui commercio non rientra nell'attivita' propria dell'impresa se di costo unitario non superiore a 50 euro [...]")

DPR 633/72 art. 15 comma 1 n. 2 = TU IVA art. 29 comma 1 lett. b:
> "Non concorrono a formare la base imponibile: [...] 2) il valore normale dei beni ceduti a titolo di sconto, premio o abbuono in conformità alle originarie condizioni contrattuali, tranne quelli la cui cessione è soggetta ad aliquota più elevata;"

Reading: the 50 EUR carve-out covers only goods **outside** the seller's own trade. A retailer giving away its own stock is not in the carve-out. But goods given "a titolo di sconto, premio o abbuono" under the original contractual terms are excluded from the base - unless the free good carries a higher VAT rate than the paid one.

---

## 3. Law findings table

| Rule | Statute / ruling | Verbatim quote (short) | Implication for OL |
|---|---|---|---|
| Free transfer = taxable supply | PL VAT art. 7 ust. 2; Dir. art. 16 | "przekazanie nieodpłatnie przez podatnika towarów [...] wszelkie inne darowizny" | A gratis line can create output VAT with no revenue. Core must keep "free" as a fact, not drop the line. |
| Small-gift threshold PL | art. 7 ust. 3-4 | "100 zł (bez podatku), jeżeli podatnik prowadzi ewidencję"; "nie przekraczają 20 zł" | Threshold needs cost price and per-recipient yearly totals - data OL may not have. Belongs in a PL country pack / operator config, not core. |
| Deemed-supply base = cost | art. 29a ust. 2 | "podstawą opodatkowania jest cena nabycia towarów [...] a gdy nie ma ceny nabycia – koszt wytworzenia" | If the operator treats a gratis as deemed supply, the document needs purchase cost, not the 0 sale price. OL has cost snapshot (ADR-080) - possible source. |
| Discount at sale reduces base | art. 29a ust. 7 pkt 2; Dir. art. 79(b) | "opustów i obniżek cen, uwzględnionych w momencie sprzedaży" | Line must carry pre-discount price and discount amount separately. |
| 100% rabat is not a rabat | KIS 0114-KDIP1-1.4012.876.2025.2.IZ (2026) | "obniżenie [...] ceny zakupu produktu o 100% [...] nie będzie równoznaczne z udzieleniem rabatu" | A marketplace "0 zł line" or Mirakl FREE_ITEMS cannot be mapped blindly to "discount 100%" on a receipt/invoice. Needs an explicit `pricing basis` fact. |
| Gift cost inside price = paid | IBPP1/4512-383/16-1/MS (2016) | "kontrahent płaci za ten dodatkowy towar" | Competing reading; operator chooses per promotion. OL must support both renderings. |
| Gift and product taxed separately | ILPP2/443-764/13-4/MR (2013); IBPP1/4512-383/16 | "dostawa dołączonego do niego gratisu opodatkowana [...] stawką właściwą dla tego właśnie gratisu" | Gift line needs its own VAT rate, not the parent's. |
| Set price split | KIS 703725 (2026) quoting MF; BFH XI R 19/23 | "proporcjonalne obniżenie ceny [...] postępowanie prawidłowe"; "Aufteilung nach Marktwerten beziehungsweise Einzelverkaufspreisen" | Bundle with mixed VAT rates must be split per component by standalone price. OL needs component standalone prices at sale time. |
| No component priced above its standalone price | BFH XI R 19/23 Leitsatz | "anteiliger Verkaufspreis [...] höher ist als der Einzelverkaufspreis, ist nicht sachgerecht" | Allocation algorithm must cap each component at its standalone price. |
| Invoice line content | art. 106e ust. 1 pkt 7-11; FA(3) P_9A/P_10/P_11 | "kwoty wszelkich opustów lub obniżek cen [...] o ile nie zostały one uwzględnione w cenie jednostkowej netto" | KSeF mapper can emit either net-after-discount price or price + P_10. P_9A may be 0. |
| Receipt line content | Rozp. kasy 2025 § 26 ust. 1 pkt 6-10 | "wartość opustów, obniżek lub narzutów, o ile występują" | Receipt adapter must print discount values; names must identify the good "jednoznacznie" - matters for bundle naming on receipts. |
| Invoice/receipt only for "sprzedaż" | art. 2 pkt 22, 106b ust. 1, 111 ust. 1 | "sprzedaży – rozumie się przez to odpłatną dostawę" | (Inference) a deemed free supply may need no receipt line; VAT still in the JPK. Needs adviser sign-off. |
| IT free goods | DPR 633 art. 2 c.2 n.4 -> TU art. 5 c.2 lett. d | "cessioni gratuite [...] ad esclusione di quelli la cui produzione o il cui commercio non rientra nell'attività propria dell'impresa se di costo unitario non superiore ad euro cinquanta" | Own-stock gifts are taxable regardless of value in IT. Thresholds differ by country -> country pack. |
| IT discount-in-kind | DPR 633 art. 15 n.2 -> TU art. 29 lett. b | "beni ceduti a titolo di sconto, premio o abbuono [...] tranne quelli la cui cessione è soggetta ad aliquota più elevata" | IT treats contractual free goods as outside the base unless higher rate - opposite of PL 2026 KIS. Core cannot hard-code either. |

---

## 4. Surprises

1. **The 2019 cash-register regulation is repealed.** Dz.U. 2019 poz. 816 is "uznany za uchylony"; receipt content is now **§ 26** of Dz.U. 2025 poz. 845 (in force 1 July 2025). Wording of the discount item is unchanged.
2. **Italian DPR 633/72 art. 2 and 15 are repealed from 1 Jan 2027** by the Testo unico IVA (D.Lgs. 10/2026); content moves to TU art. 5 and art. 29 with the same substance.
3. **Newest Polish consolidated VAT text is Dz.U. 2026 poz. 1263** (1 Sept 2026); 2025 poz. 775 is superseded.
4. **KIS (Jan 2026) says a "100% rabat" gratis is a deemed free supply**, not a discount - in exactly the "buy 5, cheapest free" basket pattern. This conflicts with the 2016 line that a gift whose cost is built into the price is paid for.
5. **Kaufland has no quantity**: one order unit per piece; Kaufland-funded promotions are not visible in `discounts`; "At most one discount applies per order unit."
6. **Mirakl is the only one of the five with a native free-quantity concept** (`FREE_ITEMS`, `offered_quantity`). It does not say whether free units are inside `quantity`.
7. **Amazon has no bundle or free-quantity field** in either Orders model. `IsGift` and gift wrap mean "buyer sends a gift", not "seller adds a gratis". `NumberOfItems` (pack count) disappears in 2026-01-01.
8. **eBay `giftDetails` is digital gift cards only**; refunds are amount-per-line with no quantity.
9. **Erli discount is order-level with no amount** (`rebate {id,name,code}`); per-line effect only via `unitPriceBeforeRebate`. Returns reference lines by **array index**, so line order must be preserved.
10. **Italy's 50 EUR exemption does not cover the seller's own merchandise**, unlike Poland's 20 zł/100 zł tests which apply to any goods.
11. FA(3) allows `P_9A = 0` by pattern, but no official FA(3) guidance on gratis/bundle exists (Unknown).

## 5. Confidence

- High: all field quotes (read from downloaded files); statute texts (official PDFs/XML); BFH Leitsatz.
- Medium: Erli `unitPrice` unit (grosze inferred from a sibling field).
- Low / unverified: inference that a deemed free supply needs no receipt line; whether Mirakl `quantity` includes free units; Amazon/eBay returns (other APIs not read).
- Interpretations bind only the applicant; outcome depends on facts each time.
