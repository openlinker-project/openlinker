# R4 phase 2 - Competitor: BaseLinker (Base.com) - bundles, gifts, discounts, documents

Round 4, primary sources only. Fetched 2026-11-04.

## Sources consulted (all primary, all operated by BaseLinker / Base.com)

Kind legend: **API** = official API reference (api.baselinker.com), **PROTO** = official shop integration-file protocol (developers.baselinker.com/shops_api), **HELP** = official help centre (base.com/pl-PL/pomoc, base.com/en-EN/help), **CL** = official changelog (API changelog page, and Base.com's own monthly "Spis aktualizacji" posts written by "Autor: Base.com").

| # | Source | Kind | What it gave |
|---|---|---|---|
| S1 | https://api.baselinker.com/index.php?method=addInventoryProduct | API | `is_bundle`, `bundle_products`, `relations` |
| S2 | https://api.baselinker.com/index.php?method=getInventoryProductsData | API | `is_bundle`, `bundle_products`, `ean_additional` (with quantity), `average_cost`, `relations` types |
| S3 | https://api.baselinker.com/index.php?method=getOrders | API | order product fields incl. `bundle_id`; `discounts` log |
| S4 | https://api.baselinker.com/index.php?method=addOrderProduct / setOrderProductFields / addOrder | API | line fields when adding/editing lines (no gift/discount/bundle field) |
| S5 | https://api.baselinker.com/index.php?method=getInvoices / getReceipt / getNewReceipts | API | invoice / receipt item fields |
| S6 | https://api.baselinker.com/index.php?method=addInventoryPriceGroup | API | bundle price auto-calculation |
| S7 | https://api.baselinker.com/index.php?method=getOrderReturns | API | return item carries `bundle_id` |
| S8 | https://api.baselinker.com/?changelog | CL | bundle-related API changes |
| S9 | https://developers.baselinker.com/shops_api/index.php?method=OrdersGet | PROTO | shop order line schema |
| S10 | https://base.com/pl-PL/pomoc/wiedza/zestawy/ (EN: https://base.com/en-EN/help/knowledgebase/bundles/) | HELP | bundle creation, stock, split setting, discount on split |
| S11 | https://base.com/pl-PL/pomoc/faq/magazyn-bl/ | HELP | bundle split for shop orders, CSV import, multi-warehouse bundle stock |
| S12 | https://base.com/pl-PL/pomoc/wiedza/masowe-tworzenie-zestawow/ | HELP | mass "każdy z każdym" bundles, price options |
| S13 | https://base.com/pl-PL/pomoc/wiedza/pozostale-wybrane-akcje-przyklady-automatycznych-akcji/ | HELP | gift-adding automation |
| S14 | https://base.com/en-EN/help/knowledgebase/automatic-actions/ | HELP | automation engine rules, stop-after-failure |
| S15 | https://base.com/en-EN/help/knowledgebase/order-card-how-to-use/ + https://base.com/pl-PL/pomoc/wiedza/karta-zamowien/ | HELP | manual discount as negative line, gift-wrap attribute, gift FAQ |
| S16 | https://base.com/en-EN/help/knowledgebase/order-manager-how-to-configure/ | HELP | where the split setting lives; order logs |
| S17 | https://base.com/pl-PL/pomoc/wiedza/asystent-pakowania/ | HELP | "Produkty domyślnie zebrane/spakowane" |
| S18 | https://base.com/pl-PL/pomoc/wiedza/moment-realizacji-zamowienia/ | HELP | fulfilment moment; buyer variant choice on info page |
| S19 | https://base.com/pl-PL/pomoc/faq/manager-zamowien/zwroty/ + https://base.com/pl-PL/pomoc/wiedza/zwroty-przyklady-automatycznych-akcji/ | HELP | returns, corrections |
| S20 | https://base.com/pl-PL/blog/?p=17781 ("Spis aktualizacji - wrzesień 2022") | CL | action "Rozbij zestawy", "bundle deal" |
| S21 | https://base.com/pl-PL/blog/spis-aktualizacji-czerwiec-2026/ | CL | event "Zestaw został rozbity", new discount module, Upgates/VTEX bundles, Nexo bundles |
| S22 | https://base.com/pl-PL/blog/?p=25071 ("Spis aktualizacji - kwiecień 2026") | CL | mass bundle edit, "Wyświetl produkty z ceną 0", Rabaty tab |
| S23 | https://base.com/pl-PL/blog/?p=24826 ("Spis aktualizacji - marzec 2026") | CL | WooCommerce bundles import, Yampi discount settings, Temu discount settings |
| S24 | https://base.com/pl-PL/blog/?p=24438 ("Spis aktualizacji - grudzień 2025") | CL | Gomag discount lines |
| S25 | https://base.com/pl-PL/blog/spis-aktualizacji-luty-2026/ | CL | bundle list filter "EAN elementu" |
| S26 | https://base.com/en-EN/help/knowledgebase/inventory/ | HELP | bundles cannot cross inventories |

Not found / not accessible: no primary source on Allegro productSet handling, Kaufland, Shopify lineItemGroup, PrestaShop packs, bundle cost, gift limits, gift reporting. Those IDs are rated Unknown.

## Core model in one paragraph (evidence-backed)

A bundle ("Zestaw") is a product in the Base inventory with `is_bundle = true` and a fixed map of component product id -> pieces (S1: "bundle_products | array | A list containing information about the products included in the bundle, where the key is the identifier of the product included in the bundle, and the value is the number of pieces of this product in the bundle."). Its stock is derived (S10: "Stan magazynowy zestawu jest równy najniższemu stanowi produktu wchodzącego w skład zestawu."). There is ONE global switch, in Zamówienia -> Ustawienia -> Przetwarzanie zamówień, that decides whether a sold bundle is expanded into its components on the order (S10: "Jeśli rozbijanie jest wyłączone, w zamówieniu pojawi się jedna pozycja z danym zestawem (ale odpowiednie składniki zestawu zejdą ze stanu). Jeśli rozbijanie jest włączone, w zamówieniu zamiast zakupionej oferty pojawią się wszystkie składniki zestawu."). Expanded lines carry `bundle_id` (S3). The order line has no gift flag and no list-price/discount column; discounts live in a separate order-level discount log (S3 `discounts`). Gifts are just ordinary lines, typically added by an automatic action (S13).

## Ratings per use case

### Bundles

**B-01 Define a bundle - Full**
- UI: Produkty -> zaznacz -> "Operacje → Stwórz zestaw z zaznaczonych produktów", or tab "Zestawy" -> "Dodaj zestaw" (S10: "Zestaw można utworzyć na dwa sposoby – z poziomu zakładki ' Produkty lub z poziomu zakładki Zestawy ."). Bundle card has its own data (S10: "Dla każdego zestawu możesz utworzyć osobne dane – opisy, parametry, zdjęcia, SKU, EAN i inne").
- API: S1 `bundle_products` quoted above; "Subproducts can only be defined if the added/edited product is a bundle (is_bundle = true)."
- Mass edit of compositions (S22: "Dodaliśmy możliwość edycji masowej zestawów poprzez dodawanie produktów do zestawu oraz usuwanie z zestawu jego elementów"). Reverse lookup (S25: "nowy filtr EAN elementu , który umożliwia wyszukiwanie zestawów na podstawie kodu EAN wchodzącego w ich skład produktu").
- Limit: components must be in the same inventory (S26: "products from different inventories cannot be combined into bundles").

**B-02 Availability = min over components, published - Full (timing Unknown)**
- S10 min rule quoted above. Shared components implied (component is a normal product used by many bundles; the EAN filter in S25 finds "wszystkie zestawy, które zawierają dany element").
- Published: S10 "W takim wypadku oferta marketplace będzie synchronizowana z danymi z zestawu (z jego ceną i stanem)". How fast a component sale propagates to all bundle offers: no primary source.

**B-03 Pre-built kit with own stock vs virtual - Partial**
- BaseLinker bundles are virtual (stock derived, S10). A pre-built kit can only be modelled as an ordinary product; no assembly/kitting conversion document found (no primary source). Rating Partial: one of the two modes exists.

**B-04 Order arrives as parent only -> expand - Full (when linked); Allegro productSet Unknown**
- Offer is linked to the bundle "just like a normal product" (S10 EN: "A bundle can be associated with an offer just like a normal product."), then split per setting (S10). Expanded lines carry `bundle_id` (S3: "bundle_id (int) - ID of the bundle that was split to aquire this order item. Only applies to bundles from Base inventory. Returns 0 if the product was not aquired from splitting a bundle.").
- Shop orders: extra precondition (S11: "Aby zestawy były rozbijane w zamówieniach ze sklepu, oprócz prawidłowego powiązania produktów , konieczne jest włączenie synchronizacji stanów z Base.com do sklepu .").
- Can also split later: automation action (S20: "[Automatyczne akcje] Dodano akcję “Rozbij zestawy”") and event (S21: "Dodaliśmy w akcjach automatycznych zamówień zdarzenie Zestaw został rozbity").
- No primary source on Allegro productSet multi-product offers specifically.

**B-05 Parent + children arrive (Woo bundle plugins, Shoper) - Unknown**
- WooCommerce bundles can be imported as bundle PRODUCTS (S23: "Dodaliśmy obsługę zestawów produktów w integracji z WooCommerce, dzięki czemu zestawy mogą być importowane do Base jako zestawy."). Nothing primary on de-duplicating an order that already carries parent + child lines.

**B-06 Children only, grouped (Shopify lineItemGroup, IdoSell bundleId) - None (as schema) / Unknown (per connector)**
- The only grouping field is `bundle_id`, and it applies only to Base-inventory bundles (S3 quote above). The shop protocol line has no group/parent field at all (S9: product fields are only "id, variant_id, name, quantity, price, weight, tax, ean, sku, location, attributes"). So a channel's own grouping has no slot in the neutral order. Whether a specific connector keeps it elsewhere (e.g. in attributes): no primary source.

**B-07 Offer bundles = N lines + proportional discount - Partial**
- Discount log has item-level entries with a per-line breakdown (S3: "type (text) - Discount type: "order" (whole order), "item" (single product), "shipment" (delivery cost)" ... "order_lines_details (array) - Per-item and shipment breakdown of the discount"). Marketplace discounts are imported "where the platform gives data" (S21: "Rabaty pochodzące z marketplace'ów (tam, gdzie platforma udostępnia dane) są teraz poprawnie widoczne w Base"). S20 lists "[Marketplace] Obsługa promocji “bundle deal”" (2022) without saying which marketplace. Whether Allegro flexible bundles specifically populate the log: no primary source.

**B-08 Multipack (one offer = N units) - Partial**
- A bundle may contain N pieces of one product (S1 value = "number of pieces"). Product can carry case EANs with quantity (S2: "ean_additional ... quantity (int) - quantity of product with given EAN number"; "User can set additional EANs for product, to work with products cases (4-pack etc.)"). Mapping to Allegro productSet quantity: no primary source.

**B-09 Buyer chooses variant per slot - Partial (workaround)**
- Composition is fixed. Workaround: generate one bundle per combination (S12: "chcesz szybko utworzyć zestawy „każdy z każdym"" ; S10: "jeśli w katalogu posiadasz 2 produkty, a każdy z nich ma po 3 warianty, możesz szybko utworzyć 9 zestawów"). Combinatorial explosion; no slot model.

**B-10 Contents snapshot at order time - Partial**
- Split mode writes components as order lines with `bundle_id` (S3, S10), so the order freezes what was expanded. Non-split mode: "jedna pozycja z danym zestawem (ale odpowiednie składniki zestawu zejdą ze stanu)" (S10) - whether the component list used is frozen at order time: no primary source.

**B-11 Pack bench shows bundle + components - Partial**
- With split on, the pack assistant sees component lines; `bundle_id` exists in data (S3). No primary source that the Asystent Pakowania shows the bundle header or groups components.

**B-12 Component out of stock: hold/substitute/split/back-order - Unknown**
- No primary source. (Relation type "substitution" exists on products, S2: "relation_type (string) - Relationship type (related, substitution, upsell, downsell, crosssell)" - not documented as used in fulfilment.)

**B-13 Components in different warehouses - Partial**
- Availability: S11 "Korzystając z opcji sumowania stanu, w pierwszej kolejności obliczamy stan zestawu osobno dla każdego magazynu, a następnie to sumujemy." (note: min per warehouse, then sum - a bundle whose components sit in different warehouses shows 0 under this rule). Each order line has its own `warehouse_id` (S3), so components could be sourced from different warehouses; no primary source on how the split assigns them.

**B-14 Documents: one line vs components; mixed VAT split - Partial**
- One line vs components = the global split switch (S10). Each component line has its own `tax_rate` (S3). Price gap becomes a discount (S10: "Zestaw może mieć oddzielną cenę, inną niż suma produktów wchodzących w jego skład. Jeżeli przy pobieraniu zamówienia zestaw jest rozbijany na oddzielne produkty, to ta różnica będzie wyświetlana jako rabat."). How that discount is allocated across VAT rates (proportional? per component?) and whether it is a separate negative line or a discount-log entry: no primary source. Invoice items carry only `price_brutto`/`price_netto`/`tax_rate`/`is_shipment` (S5), no rebate column.

**B-15 Return of one component - Partial**
- Return items carry `bundle_id` and `order_product_id` (S7: "bundle_id (int) - ID of the bundle that was split to aquire this order item."). Per-item correction + restock via automation (S19: "Wystaw korektę dla zwracanych produktów"; FAQ: "Czy moduł obsługuje wystawianie korekt oraz częściowych zwrotów płatności? Jak najbardziej"). Recalculating the lost bundle discount: no primary source.

**B-16 Bundle cost = sum of component costs - Unknown**
- Products expose `average_cost` (S2) but no primary source states how a bundle's cost is computed.

**B-17 Publish an OMS-defined bundle as a listing - Full**
- S10: "Zestawy widoczne są na liście wystawiania." and offer syncs "z jego ceną i stanem". Price can be derived from components per price group (S6: "is_bundle_price_calculated | bool | Whether bundle product prices should be automatically calculated from their component products."; "bundle_price_multiplier", "bundle_price_addition").

**B-18 Import bundle definitions from master/shop/ERP - Partial**
- CSV two-pass import (S11: "utwórz kolejny plik CSV, który będzie zawierał składowe zestawu oraz numer ID wcześniej utworzonego „rodzica""). WooCommerce (S23), Upgates and VTEX via `include_bundles` (S21: "W odpowiedziach produkty-zestawy są wyraźnie oznaczone jako is_bundle, a w szczegółach widać ich elementy składowe"), Subiekt nexo/GT option (S21: "gdy wyłączona jest opcja „traktuj jako zestawy", tak jak ma to już miejsce w integracji z SGT"). PrestaShop packs, Shoper, IdoSell, Erli: no primary source. Note: the public shop protocol (S9/PROTO) documents no bundle fields; `include_bundles` appears only in changelogs.

**B-19 Which line carries price/VAT varies per channel - Unknown**
- No bundle-specific primary source. (Discount-side per-integration settings exist, see X-03.)

**B-20 Master already decrements components on a pack sale - Unknown**
- No primary source.

**B-21 Split shipment of one bundle across parcels - Unknown**
- No primary source.

### Gifts

**G-01 Gift flagged by the channel - None**
- No gift field anywhere in the order line schema (S3 field list; S4; S9). Base's own docs identify gifts only by price 0 (S22: "nowy select Wyświetl produkty z ceną 0 , który pozwala ukryć na stronie informacyjnej dla kupującego produkty gratisowe lub opakowania"). A channel flag therefore has nowhere to land.

**G-02 Gift unflagged (0.00/0.01, or full price + 100% discount) - Partial**
- 0.00 lines are ordinary lines (S22). Full price + item discount is representable in the discount log (`value_before`, `value_after`, S3). Distinguishing a gift from a discount: not possible (no type beyond order/item/shipment).

**G-03 Gift folded into a paid line - Unknown**
- No primary source.

**G-04 Gift only in listing description -> add in OMS - Full (via automation)**
- S13: "W tym przykładzie dodasz gratis do zamówienia powyżej 500 zł." Action "Dodaj produkt do zamówienia (np. gratis)". Conditions can be product-based (S14: "only if it comes from eBay, one of the products is an iPhone").

**G-05 Operator adds a gift - Full**
- Order card "+Dodaj produkty do zamówienia"; S15 lists "add new products ( +Add products to order )". API `addOrderProduct` with `warehouse_id` (S4). Proof of shipping = generic pack-assistant scan; no gift-specific proof.

**G-06 Rule adds a gift - Partial**
- S13: event "Pobrano zamówienie", condition "Wartość zamówienia (tylko produkty)", action fields: "Wybierz katalog, w którym znajduje się produkt, który chcesz dodać, magazyn, z którego ma być obniżany stan, ID produktu, nazwę, która będzie widoczna w zamówieniu, ilość oraz cenę." Order-source condition optional. Campaign date windows: no primary source. Not retroactive (S14: "Actions do not work retroactively.").

**G-07 Gift as a bundle component - Unknown**
- A component cannot be marked free; bundle has one price; split gap becomes "rabat" (S10). No primary source on gift components.

**G-08 Gift runs out mid-promotion - Unknown**
- No primary source on stock-aware gift actions or declared substitutes.

**G-09 Gift visible on pack bench / slip - Partial**
- It is an ordinary line, so it is listed. A staff reminder can be shown at shipment creation (S13: "W tym przykładzie dodasz komunikat przypominający o sprawdzeniu, czy do zamówienia został dodany gratis po utworzeniu przesyłki."). No gift marker on slip: no primary source.

**G-10 Gift on receipt/invoice (list price + rebate, typed reason) - None (as data model)**
- Invoice item fields: "name ... price_brutto ... price_netto ... tax_rate ... quantity ... is_shipment ... order_product_id" (S5); receipt items: "name, sku, ean, price_brutto, tax_rate, quantity" (S5). No list price, rebate or reason fields. Whether printed templates show the discount log: no primary source.

**G-11 Gift and returns (threshold lost) - Unknown**
- No primary source.

**G-12 Gift reporting - Unknown**

**G-13 Buyer chooses the gift - Unknown**
- There is a buyer-side variant choice on the order info page for variant offers (S18: "w przypadku zamówień z opcją wyboru wariantu produktu na stronie informacyjnej, potwierdzenie zamówienia następuje w momencie, gdy klient wybierze wariant."), but no primary source applying it to gifts.

**G-14 Gift wrap / "is a gift" - Partial**
- Only as free-text line attribute (S15: "attributes – no product parameters (e.g. color, material) are taken to order. Here you can see information like packing for a gift ."). No order-level flag.

**G-15 Per-customer gift limit - Unknown**

**G-16 Failing gift rule gets visible status - Partial**
- Generic automation failure handling (S14: "The Stop after failure option ... allows you to stop the execution of remaining actions if a given action fails." / "In the Action after failure field, you can select a custom event that will be executed when an error occurs" / "The history of performed automatic actions is available on the order card."). Not gift-specific.

### Cross-cutting

**X-01 One neutral list price + reduction per line - Partial**
- Discount log with before/after per line (S3: "value_before (float) - Value before discount value_after (float) - Value after discount details (text) - Discount description (e.g. coupon code)"). But the order line itself has only "price_brutto (float) - Single item gross price" (S3), and the doc does not say whether it is pre- or post-discount. Manual workaround still documented: discount as negative line (S15 PL: "stwórz pozycję o nazwie np. "Rabat" i cenie na minusie").

**X-02 Kaufland one unit per order_unit -> merge - Unknown**

**X-03 Per-integration settings for how a channel encodes things - Partial**
- Bespoke per-connector advanced settings, not a generic declaration: Yampi (S23: "Możesz zdecydować, czy rabaty i opłaty mają być doliczane bezpośrednio do cen produktów, dodawane jako osobne pozycje w zamówieniu"), Temu (S23: "można teraz osobno włączyć pobieranie zniżek Temu oraz zniżek sprzedawcy"), Gomag (S24: "rozbija rabaty na osobne pozycje z nazwą zniżki i kodem vouchera, zamiast jednej zbiorczej pozycji „DISCOUNT""). Bundles: one global split switch (S16: "There you will find options for splitting bundles in orders").

**X-04 Line added after order exists - Full**
- API `addOrderProduct`, `setOrderProductFields` (S4); UI add/edit (S15); late split via action "Rozbij zestawy" (S20) and event "Zestaw został rozbity" (S21); manual discounts tracked in the log with author (S3 `profile_id`).

**X-05 Lines that are neither goods nor discount - Partial**
- Everything is a "product" line; packaging and gifts at price 0 (S22), discounts as negative lines (S15), delivery is a separate order field (`delivery_price`, S3) and an `is_shipment` invoice item (S5). No typed line kinds.

**X-06 Promotion/discount audit trail per line - Full**
- S3: "discount_id (int) - Discount log entry identifier" ... "date_add (int) - Date of discount creation" ... "profile_id (int) - Profile ID of the user who applied the discount (-1 for API)". UI tab (S22: "nową zakładkę – Rabaty, która zbiera informacje o historii przecen produktów w zamówieniu"; S21: "na karcie zamówienia widzisz pełną historię i szczegóły wszystkich udzielonych zniżek"). Also generic "Order logs – history of changes in orders" (S16).

## Integration normalisation (how BaseLinker absorbs channel differences)

1. **Catalogue linking is the normaliser for bundles.** A channel offer/shop product is linked to a Base product; if that product is a bundle, Base expands it. For shop orders Base literally swaps the shop's lines for linked catalogue products (S15/FAQ: "Zmieniane są magazyn/katalog, numery ID, waga, EAN, SKU i lokalizacja. Mechanizm nie dokonuje zmiany w nazwie pozycji zamówienia."), and only when stock sync Base->shop is on (S11). So bundle normalisation depends on Base being the stock master.
2. **One global switch, not per channel.** "rozbijać zestawy, czy też nie" is an order setting applying to all sources and manual orders (S10). No primary source on per-source split rules.
3. **Discounts: per-connector code + per-connector advanced settings** (Yampi, Temu, Gomag, Fizz.hu in S23/S24/S21/"Spis aktualizacji - styczeń 2026" https://base.com/pl-PL/blog/?p=24632: "Dodaliśmy obsługę rabatów na poziomie całego zamówienia dla Fizz.hu, tak aby działały tak samo, jak w innych kanałach sprzedaży w Base"). Each new channel gets its own tweak; there is a target model (the discount log) but no connector declaration contract.
4. **The public shop protocol carries none of this.** OrdersGet lines have no discount, gift, bundle or group fields (S9). A shop integration file author must pre-flatten everything into price-per-line; bundle support (`include_bundles`, `is_bundle`, `bundle_elements`) appears only in changelogs for specific platforms (S21), not in the published protocol.
5. **Gifts are not normalised at all.** No gift flag; recognition is by price 0 (S22) or by name ("Produkty domyślnie zebrane/spakowane ... np. ... stałą pozycję jak rabat", S17).
6. **Conflict to note:** S21 says the new discount module has "obsługa przez API" to add discounts, but the API method list and changelog (S8) show only the read side (`include_discounts_data` on getOrders). Trust the API reference for what is callable today; treat discount write via API as unverified.

## UX patterns worth copying

1. **Derived bundle stock with a stated aggregation rule** (min per warehouse, then sum, S11) - and documented in the FAQ so operators understand why a bundle shows 0.
2. **Bundle price from a price group rule** (auto-calc from components with multiplier + fixed addition, S6/S12) - keeps listings consistent when component prices move.
3. **Price gap surfaces as a discount when expanding** (S10) - keeps the order total equal to what the buyer paid while lines show component prices.
4. **Discount log per line with before/after, author (`profile_id`, -1 = API) and description** (S3) plus a "Rabaty" tab on the order card (S22).
5. **"Bundle was split" as an automation event and "Rozbij zestawy" as an action** (S20/S21) - lets operators hook packing/document steps to the expansion moment.
6. **Hide zero-price lines on the buyer-facing order page** (S22) and **auto-mark named non-goods lines as packed** (S17).

## Anti-patterns

1. **One global split switch for all channels** (S10) - cannot express "Allegro sends parent only, Woo sends parent+children".
2. **Gift = a line with price 0** (S22) - a real gift, a packaging line and a data error look identical; no reason code for documents (G-10).
3. **Discount as a negative "Rabat" product line** still documented as the manual method (S15) - breaks per-line VAT attribution and per-component returns.
4. **Bundle splitting on shop orders silently depends on stock sync being enabled** (S11) - an unrelated setting changes order semantics.
5. **Buyer choice via combinatorial bundles** ("każdy z każdym", S12) - 2 products x 3 variants = 9 catalogue items; does not scale.

## New use cases (with source)

- **NEW-BL-1 Bundle availability aggregation across warehouses**: decide whether bundle availability is computed per warehouse then summed (Base's rule, S11) or over pooled stock - they give different numbers.
- **NEW-BL-2 Bundle list price derived from component prices by rule** (multiplier/addition per price group, S6).
- **NEW-BL-3 Expansion as an observable event** that other automations can react to (S21 "Zestaw został rozbity"), including late expansion of an already-imported order (S20).
- **NEW-BL-4 Buyer-facing order page hides zero-price lines** (gifts/packaging) while the pack bench still shows them (S22).
- **NEW-BL-5 Shipping bundles to an external fulfilment centre as a unit** (S8: "addInventoryFulfillmentDeliveryItems : Added support for product bundles in fulfillment deliveries").
- **NEW-BL-6 Reverse lookup "which bundles contain this component"** by EAN (S25) - needed when a component is discontinued or recalled.
- **NEW-BL-7 Split an order to claim a marketplace commission refund for part of it** (S15 FAQ: "By rozłączyć zamówienie (np. w celu wysłania prośby do allegro o zwrot prowizji za część zamówienia), należy zduplikować istniejące zamówienie i usunąć z obu zamówień wybrane pozycje.") - relevant to returning one bundle component.

## Confidence assessment
- High: bundle definition, min-stock rule, global split switch, `bundle_id` on order and return lines, discount log shape, gift-by-automation, absence of gift/rebate fields in order/invoice/receipt/shop-protocol schemas.
- Low: anything channel-specific (Allegro productSet, Shopify groups, Woo plugin orders, Kaufland), how the split-gap "rabat" is allocated across VAT rates, bundle cost.
- Unverified: discount write via API (conflict in item 6 above).
