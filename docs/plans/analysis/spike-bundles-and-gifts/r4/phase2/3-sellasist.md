# R4 phase 2 - Competitor: Sellasist (bundles "zestawy" and gifts "gratisy")

Round 4, primary sources only. Researched 2026-11-04.

## Sources and how they were read

All sources are first-party Sellasist material (kind noted per item):

| Tag | Source | Kind |
|---|---|---|
| API | `https://api.sellasist.pl/api.yaml`, OpenAPI 3.0.1, `version: 1.92.8` | Official API spec (downloaded) |
| CL | `https://api.sellasist.pl/changelog` | Official API changelog |
| H-nnnn | Sellasist help centre `https://sellasist.pl/pomoc/`. The page loads article lists and bodies through its public WordPress endpoint: `POST https://sellasist.pl/wp-admin/admin-ajax.php` with `action=get_category_pages&category_id=<id>` (list) and `action=get_page_sections&post_id=<nnnn>` (body). The number in the tag is the `post_id`. | Official help centre |
| BLOG | `https://sellasist.pl/blog/<slug>/` posts written by Sellasist about its own releases (date from the page's `datePublished`) | Official vendor release notes / blog |

To reproduce a help citation: `curl -s -X POST -F action=get_page_sections -F post_id=4494 https://sellasist.pl/wp-admin/admin-ajax.php`.
All 793 help articles across 24 categories were downloaded and searched for `zestaw`, `gratis`, `prezent`, `rabat`, `bundle`, `pakiet`. Only the hits below matter. A missing hit is reported as Unknown, not None, unless a source states the absence.

Help articles used (post_id, title):
- H-4494 "Zestawy Produktów w Panelu Sellingo i Sellasist" (static sets, splitting)
- H-4616 "Zestawy dynamiczne"
- H-4618 "WARIANT PRODUKT W ZESTAWIE DYNAMICZNYM – warunek automatyzacji dla zamówień"
- H-4619 "ZESTAW DYNAMICZNY – warunek automatyzacji dla zamówień"
- H-4665 "Automatyczna synchronizacja cen produktów w zestawie"
- H-4676 "Informacje o zestawach w karcie produktu"
- H-4634 "Jak utworzyć zestaw produktów podczas importu w Sellasist?"
- H-4518 "Jak wykonać import powiązań produktów z zestawami?"
- H-4551 "Obsługa zestawów w pliku XML B2B"
- H-3661 "Jak zaimportować asortyment i oferty z Allegro?"
- H-4730 "Jak włączać i wyłączać synchronizacje w ofertach Allegro?"
- H-3762 "Jak stworzyć zestawy promocyjne Allegro?"
- H-4745 "Dodaj produkt — Efekt akcji automatycznej dla zamówień"
- H-4644 "Jak dodać opcje ukrycia produktu w trybie zbierania i pakowania?"
- H-4645 "Jak skonfigurować widok Trybu Pakowania?"
- H-4492 "Akcje dla zamówień: Lista warunków i efektów dla automatyzacji"
- H-4766 "Podział zamówienia ze względu na stan magazynowy"
- H-8701 "Obsługa braków magazynowych podczas zbierania w Sellasist WMS"
- H-4687 shopGold, H-4717 eBay, H-4732 PrestaShop, H-4808 Temu, H-4718 Sky-Shop, H-4733 Shopify, H-4659 IdoSell integration set-up articles
- H-3650 / H-3664 discount codes and individual discounts (Sellingo storefront)
- H-4328 / H-4546 Allegro additional services
- H-3759 / H-4569 automation log and activation buttons; H-4855 order card

Blog posts used:
- BLOG-2024-03 "Zestawy Allegro – nowa funkcja w Twoim Sellasist!" (2024-03-20)
- BLOG-2024-07 "Poznaj zastosowanie zestawów produktów – statyczne, dynamiczne a może Allegro?" (2024-07-05)
- BLOG-2026-08 "Nie zwalniamy tempa w wakacje – podsumowanie nowości w Sellasist czerwiec i lipiec 2026" (2026-08-07)
- BLOG-2026-09 "Podsumowanie nowości w Sellasist – sierpień 2026" (2026-09-09)
- BLOG-WMS-2024 "Nowości w Sellasist WMS" (2024-08-21)

## How Sellasist models bundles and gifts (short summary)

- **Bundle = a product flagged as a set** (`as_set`), with component rows `{product_id, productvariant_id, quantity, price}`. Stock and purchase cost come from the components. The selling price is the sum of per-component "price in set" values. Three kinds: static, dynamic (the buyer picks a variant after the sale, on a Sellasist page) and "Allegro sets" (experimental).
- **The order arrives as the set line (parent only)**. An automation, "Rozbij zestaw na produkty", replaces it with the components. The operator decides WHEN the split happens, and the timing also decides what the invoice shows (the set or the components) and when stock moves.
- **Gift = an automation effect "Dodaj produkt"** that appends real order lines, at the list price or a special price. An optional "pozycja rabatująca" (discount line) cancels them at 100%, with one discount line per VAT rate. Gifts can be hidden on sales documents and hidden in picking, then shown in packing.
- **No gift flag and no parent/child link in the order API.** Cart lines carry only product, variant, quantity, price and tax rate.

## Ratings per use case

### Bundles (B)

| ID | Rating | How it works for the operator | Evidence (URL + verbatim quote) |
|---|---|---|---|
| B-01 Define bundle | **Full** | `Asortyment -> Zestawy -> Dodaj zestaw produktowy`, tab `Produkty` -> `Dodaj produkt`, set quantity and "Cena produktu w zestawie" per component. A variant must be picked for a static set. Also "Przekształć w zestaw" on an existing product. API `GET/POST/PUT /sets/{main_product_id}`, `DELETE /sets_items/{id}`, `/sets_bulk`. | H-4494: "1. W panelu Sellasist przejdź do zakładki Asortyment -> Zestawy. 2. Kliknij Dodaj zestaw produktowy." / "Możesz ustalić ilość tego produktu w zestawie oraz cenę tego produktu w zestawie." API: `summary: Dodaje produkt do zestawu produktowego` with fields `product_id`, `productvariant_id`, `quantity`, `price`. |
| B-02 Availability = min over components, shared component | **Full** | Set stock is computed from the components. Allegro set offers switch off when a component runs out (once configured). The product card has a section "Znajduje się w zestawie" listing every set that uses the product. A product that is a component cannot itself be turned into a set. | H-4494: "Liczba zestawów jest określana na podstawie stanu magazynowego poszczególnych produktów wchodzących w skład zestawu. ... mogę utworzyć tylko 3 Zestawy jesienne" / "Jeśli którykolwiek z produktów składowych zestawu będzie niedostępny w magazynie, po skonfigurowaniu ustawień oferta zestawu na Allegro zostanie automatycznie wyłączona." H-4676: "Ta sekcja pokazuje, czy edytowany produkt jest częścią jakiegoś zestawu." |
| B-03 Pre-built kit with own stock vs virtual | **Partial** | Only the virtual kind is documented: set stock is always derived from components. A pre-assembled kit can only be modelled as an ordinary product, with no link to its components. | H-4494: "Zestaw traktowany jest jako oddzielny produkt. Stany magazynowe są pobierane z systemu z produktów wchodzących w skład zestawu." No source for an "own-stock kit" mode. |
| B-04 Parent only -> expand | **Full** (for channels whose line maps to a Sellasist set) | The order line is the set product. The automation condition "Zestaw nierozbity na produkty" plus the effect "Rozbij zestaw na produkty" (or the global switch "Automatycznie rozbijaj zestaw na produkty" in `Zamówienia -> Ustawienia`) replaces it with the components. Since 22.05.2024 the action is auto-created if missing. Since Aug 2026 it also works on merged orders. Allegro set offers can be imported as Sellasist sets (experimental). | H-4494: "wprowadziliśmy w ustawieniach zamówień ( Zamówienia-> Ustawienia ) funkcję konfiguracyjną „ Automatycznie rozbijaj zestaw na produkty „" / "Od 22.05.2024 r.: Sellasist automatycznie utworzy akcję, jeśli nie wykryje istniejącej akcji automatycznej odpowiedzialnej za rozbicie zestawu." BLOG-2026-09: "Akcja automatyczna rozbijająca zestawy na pojedyncze produkty uwzględnia teraz również pozycje znajdujące się w zamówieniach połączonych." H-3661: "Twórz produkty z zestawem Allegro: Umożliwia import ofert będących zestawami Allegro jako zestawy Sellasist." |
| B-05 Parent + children (Woo bundle plugins, Shoper) | **Unknown** | No help text for WooCommerce, PrestaShop, Shoper or IdoSell mentions bundle or pack lines. | No primary source (searched all integration articles for `zestaw`, `pakiet`, `bundle`, `pack`). |
| B-06 Children only, grouped (Shopify lineItemGroup, IdoSell bundleId) | **Unknown** | Same as B-05. The order API cart line has no group or parent field. | API `carts` items: `id, line_id, product_id, variant_id, ... quantity, price, tax_rate` (no parent or group field). No help source. |
| B-07 Offer bundles = N lines + proportional discount (Allegro) | **Partial** | The operator can CREATE and import Allegro "zestawy promocyjne" (main offer + other offers + discount value) from `Oferty -> Allegro`. How the resulting order (N lines with a discount) is ingested is not documented. | H-3762: "Zdecyduj, która oferta będzie główną, a następnie kliknij przy niej w przycisk akcji Utwórz zestaw promocyjny. ... Podaj wartość zniżki dla stworzonego zestawu promocyjnego." Order side: no primary source. |
| B-08 Multipack (N units of one product) | **Partial** | A set component quantity can be above 1 (e.g. a dynamic set of 4 pairs of trousers, the buyer picks colours). No separate multipack concept. Mapping to Allegro productSet quantity is not documented. WMS "Opakowania zbiorcze" is inbound-only (receiving), not a sales multipack. | H-4616: "Sytuacja zmienia się, gdy zdecydujemy, że zestaw będzie zawierał 4 pary spodni." H-8694: "Opakowania zbiorcze są obsługiwane w trzech trybach WMS: Przyjęcie magazynowe; Przesunięcie magazynowe; Rozlokowanie." |
| B-09 Buyer picks a variant per slot | **Full** | "Zestaw dynamiczny": leave at least one variant attribute unselected on a component. After the sale the buyer gets an e-mail/SMS link to a Sellasist personalisation page. Default for Allegro, set up by automation for other channels. Until the buyer chooses, the order shows a notice, the operator can choose by hand, and reminders can be automated. Stock moves only after the choice. | H-4616: "Aby przekształcić zestaw statyczny w dynamiczny, prosimy o pozostawienie co najmniej jednej cechy wariantu bez wyboru." / "Po zakupie klient automatycznie dostaje powiadomienie e-mail lub sms ... zawierające link do strony wyboru." / "Do czasu, kiedy klient nie dokona wyboru w edycji zamówienia widnieje informacja ‘ Klient nie wybrał jeszcze produktu z grupy produktów zestawu ”" / "Automatyczne powiadomienia ... są domyślnie ustawione tylko dla ofert Allegro." |
| B-10 Contents snapshot at order time | **Unknown** | The split happens when the automation fires, which can be days later (e.g. at status "Do pakowania"). No source says whether the split uses the composition at order time or at split time. Risk (unverified): a delayed split may use the current definition. | H-4494: "Stan magazynowy zmieniają się w momencie rozbicia zestawu na produkty." Nothing on freezing the composition. |
| B-11 Pack bench shows bundle and components | **Partial** | The WMS packing view has an option "Wyświetlaj informacje o produkcie z zestawu". Scanning each component and printing both on the packing slip are not documented. | H-4645: "Wyświetlaj informacje o produkcie z zestawu ... Te opcje zapewniają kompleksowe informacje o każdym produkcie, co jest istotne przy weryfikacji i pakowaniu produktów." |
| B-12 Component out of stock | **Partial** | Generic tools, nothing set-specific: Allegro set offer auto-off (B-02); automation "Skopiuj zamówienie" with "Podziel zamówienie według stanu magazynowego"; WMS shortage queue "Braki w zamówieniach" with customer service deciding (continue, pack, or put back). | H-4766: "Produkty, które mają stan magazynowy mniejszy lub równy zeru, zostaną przeniesione do osobnego zamówienia". H-8701: "W zależności od decyzji klienta, system kieruje zamówienie do dalszego zbierania, pakowania albo zwrotnego rozlokowania wcześniej zebranych produktów." |
| B-13 Components in different warehouses | **Unknown** | No source. | No primary source. |
| B-14 Documents: one line vs components, mixed VAT | **Partial** | The operator picks the invoice shape through split timing: invoice before the split shows the set line, invoice after shows the components. Each component has its own "price in set". How mixed VAT is split is not documented. | H-4494: "jeśli chcesz aby na fakturze zamówione produkty widniały jako zestaw, to należy tak ustawić akcję automatyczną aby rozbijała zestawy dopiero po wystawieniu FV." No source on VAT allocation. |
| B-15 Return of one component | **Unknown** | The returns API is keyed by order line (`cart_id`). Nothing set-specific. | API: "`returned_products[].cart_id`: ID pozycji w koszyku zamówienia". No set-specific source. |
| B-16 Cost = sum of component costs | **Full** | The set purchase price is computed from the components and cannot be edited by hand. | H-4494: "Nowy sposób automatycznie wylicza cenę zakupu na podstawie cen zakupu jego składników. Ręczna zmiana tej wartości jest niedostępna." |
| B-17 Publish OMS bundle as listing | **Full** (Allegro; Sellingo shop) | A Sellasist set is listed on Allegro as one single-product offer. Experimental "Zestawy Allegro" lists it as an Allegro set offer, with a sync module "Elementy zestawu" that pushes composition changes. Dynamic sets go out as a standard Allegro offer. **Conflict**: H-4494 says Sellasist sets "nie możesz powiązać" with Allegro sets; the newer BLOG-2024-03, H-3661 and H-4730 describe experimental Allegro set publishing and import. Newer sources trusted, as the experimental feature postdates the restriction. | H-4494: "Na platformach takich jak Allegro, zestaw wystawiany jest jako jedna aukcja pojedynczego produktu." BLOG-2024-03: "nową funkcję eksperymentalną, która umożliwia użytkownikom wystawianie ofert jako Zestawy Allegro bezpośrednio z panelu Sellasist". H-4730: "Elementy zestawu ... Synchronizacja zapewnia, że każda zmiana w składzie zestawu po stronie Sellasist będzie od razu widoczna na Allegro." |
| B-18 Import bundle definitions | **Partial** | File import with a "Zestaw" column (1/0); a separate importer for set-to-component links (keyed by EAN, symbol, catalogue number or ID); B2B XML `as_set`; API; Allegro set offers (experimental, components matched by productization or EAN). Import from PrestaShop packs, Shoper/IdoSell sets or Subiekt komplety is not documented. | H-4634: "Wartość 1 : Oznacza, że produkt zostanie zaimportowany jako zestaw." H-4518: "Unikalny element zestawów (wymagane) ... Unikalny element produktów (wymagane)". H-3661: "Produkty w zestawie są dobierane po parametrach lub kodzie EAN." |
| B-19 Which line carries price/VAT varies per channel | **Unknown** | Discount handling is configurable per integration (see X-03), but there is nothing on parent vs child price for bundles. | No primary source. |
| B-20 Master already decrements components | **Unknown** | The cart request has a `stock_update` flag on manual or API orders. No source on avoiding double decrement against an external master. | API `carts_request.stock_update`: "Zaktualizuj stan magazynowy w produkcie (0/1)". Nothing set-specific. |
| B-21 Split shipment of one bundle | **Unknown** | Multi-parcel exists ("Wielopaczkowość"), but nothing links parcels to bundle components or says how the channel is told. | No set-specific primary source. |

### Gifts (G)

| ID | Rating | How it works for the operator | Evidence (URL + verbatim quote) |
|---|---|---|---|
| G-01 Gift flagged by channel | **Unknown** | No integration article says a channel gift flag is read (IdoSell, Woo meta, Mirakl). The order API has no gift field. | API `carts` items: no gift or flag field. No help source. |
| G-02 Unflagged 0.00 / 100% discount | **Unknown** (generic discount handling only) | Per-integration "Sposób naliczania rabatów" decides whether discounts reduce line prices or become a separate "Rabat" product (X-01). Nothing recognises such a line as a gift. | H-4687: "Odejmuj od ceny produktów: Wartość rabatu zostanie odjęta od cen produktów ... Utwórz nowy pusty produkt „Rabat”: Ceny produktów pozostaną bez zmian, a wartość rabatu zostanie wykazana jako osobna pozycja w zamówieniu." |
| G-03 Gift folded into paid line | **Unknown** | No source. | No primary source. |
| G-04 Gift promised only in the listing | **Full** (via automation) | Effect "Dodaj produkt", triggered by conditions on product data, product extra field, source, value or date, adds the promised item to the order. | H-4745: "Efekt Dodaj produkt pozwala automatycznie tworzyć dodatkowe pozycje w zamówieniu , jeśli spełnione zostaną wybrane warunki." |
| G-05 Operator adds gift | **Full** | Pattern documented: an order extra field "Dodaj gratis" (checkbox) plus an automation that adds the product or notifies the packer. Manual activation buttons ("Aktywatory") are available. In WMS the gift can be hidden in picking and added by the packer. | H-4492: "możesz utworzyć pole dodatkowe Dodaj gratis i skonfigurować automatyzację, która będzie obejmować tylko zamówienia z zaznaczoną tą opcją." BLOG-WMS-2024: "możesz również ukryć artykuły, które dodawane są dopiero przez pakowacza jak np. baterie ... i gratisy." |
| G-06 Rule adds gift | **Full** | Conditions: "Wartość zamówienia", "Data złożenia" (campaign window), "Źródło zamówienia", "Status", product extra field, and more. Effect "Dodaj produkt" takes product, variant, quantity and optional special price. Option to add gift quantity proportional to matching ordered products ("Ustawiaj ilość produktów gratisowych proporcjonalnie..."). "Once per order" holds by construction (one action per order). A per-customer limit does not exist (G-15). | H-4745: "chcemy dodawać gratisowy szalik do każdego zamówienia o wartości minimalnej 1000 PLN" / "Zaznacz checkbox Ustawiaj ilość produktów gratisowych proporcjonalnie do ilości produktu w zamówieniu ." |
| G-07 Gift as bundle component | **Unknown** | A component price in a set is editable, so a 0 price component is plausible (unverified). No source shows it. | H-4494: "Jeżeli chcesz zmienić cenę produktu w zestawie, zmień ją w kolumnie Cena produktu w zestawie." (0 not shown) |
| G-08 Gift runs out mid-promotion | **Partial** | There is an option "Ignoruj stan magazynowy dodawanego produktu", which implies the default checks stock. What happens by default (skip, fail, notice) is not documented. No substitute gift. | H-4745: "Opcja Ignoruj stan magazynowy dodawanego produktu pozwala dodać produkt do zamówienia bez względu na jego aktualny stan magazynowy." Default behaviour: no primary source. |
| G-09 Gift visible on pack bench / slip | **Partial** | Product flags "Nie pokazuj w trybie zbierania" / "Nie pokazuj w trybie pakowania". A gift hidden in picking stays visible in packing. Packing-slip print templates: no gift-specific source. | H-4644: "Dzięki tej funkcji produkty gratisowe są niewidoczne dla pracowników podczas procesu zbierania. Gratisy są dodawane dopiero w trybie pakowania". |
| G-10 Gift on receipt/invoice | **Partial** | Two options: (a) gift line at list price plus an automatic "Rabat" line cancelling it 100%, one discount line per VAT rate, name, symbol and EAN configurable; (b) "Ukryj na dokumentach sprzedaży" hides the gift from the invoice. No typed reason (discount-in-goods vs gift) and no country policy. | H-4745: "System automatycznie doda pozycję Rabat , której wartość zrównoważy cenę dodanych produktów (np. Szalik o wartości 119 PLN dodany jako gratis → Rabat wyniesie: -119 PLN )." / "Jeśli dodawane produkty mają różne stawki VAT , system utworzy osobne pozycje rabatujące dla każdej stawki". BLOG-2026-08: "W efekcie „Dodaj produkt” dodano opcję „Ukryj na dokumentach sprzedaży”. Dzięki temu można np. ukryć produkty gratisowe, aby nie były wyświetlane na fakturze." |
| G-11 Gift and returns | **Unknown** | No source. | No primary source. |
| G-12 Gift reporting | **Unknown** | The discount line can carry a Symbol/EAN "to drive automation", but no gift report is documented. | H-4745: "Symbol i EAN: Pola powiązane z automatyzacją. Wpisz dowolną wartość, aby móc automatycznie procesować kolejne etapy realizacji". No report source. |
| G-13 Buyer chooses gift | **Partial** (own Sellingo storefront only) | In the Sellingo shop (Sellasist's storefront) a discount code of type "Gratis" exists, and a stacking mode allows "wybór gratisu". Not for marketplace orders. | H-3650: "Gratis – Kod po wpisaniu którego klient otrzyma jakiś dodatkowy gratis." H-3664: "Rabaty i promocje nie łączą się, z wyjątkiem gratisu ... możliwe będzie wybór gratisu." |
| G-14 Gift wrap / "is a gift" order | **Partial** | Allegro additional service "Zapakuj na prezent" is mapped and usable as an automation condition ("USŁUGI DODATKOWE W ALLEGRO"). Order-comment condition example: phrase "prezent" -> special packing status. | H-4328: "Usługi dodatkowe to opcje dotyczące zamówienia oferowane przez Allegro ... -Zapakuj na prezent". H-4492: "Jeśli komentarz zawiera frazę prezent, system może przenieść zamówienie do osobnego statusu wymagającego specjalnego pakowania." |
| G-15 Per-customer gift limit across orders | **Unknown** | There is a "DANE KLIENTA" condition, but no history/limit counter is documented. | No primary source. |
| G-16 Failed gift rule visible | **Partial** | The automation "Dziennik zdarzeń" lists executed actions for one month, and an action can be re-run by hand. No dedicated "gift failed" status on the order. | H-3759: "Tutaj możesz zobaczyć wszystkie wykonane akcje. Program przechowuje raporty przez miesiąc". H-4569: "możliwość ponownego wykonania akcji, gdy automatyczna próba zakończy się niepowodzeniem." |

### Cross-cutting (X)

| ID | Rating | How it works | Evidence |
|---|---|---|---|
| X-01 Neutral list price + reduction per line | **Partial** | Per integration: subtract the discount from line prices (rounding differences possible), or add an aggregate "Rabat" product line. An option balances the total to the amount paid. Discount code saved to an order extra field. No per-line list price plus reduction pair. Order cart lines have only `price`. Invoice lines have `discount`. | H-4717: "W przypadku opcji Odejmuj od ceny produktów mogą wystąpić różnice wynikające z zaokrąglania kwot do groszy. Opcja sumowania wszystkich rabatów pozwala dodać ich łączną wartość do zamówienia jako osobną pozycję Rabat." H-4687: "Wyrównaj rozbieżności w kwocie do zapłaty ... system wykorzysta pozycję rabatową albo zmieni cenę jednego z produktów. Jeśli zamówienie zawiera kilka sztuk tego samego produktu, korekta zostanie zastosowana wyłącznie do pierwszej sztuki." API `invoice_line_request.discount`: "Rabat". |
| X-02 Kaufland unit merge | **Unknown** | The Kaufland article does not mention unit merging. | H-4689: no mention. |
| X-03 Per-integration settings | **Partial** | Per-integration settings exist for discounts: "Sposób naliczania rabatów" (PrestaShop, shopGold, Temu; eBay separately for products and delivery), "Dodaj informacje o rabacie w komentarzu", and the field where the discount code is stored. The set split is a GLOBAL setting plus automation, filterable by "Źródło zamówienia". There are no per-channel declarations for bundle encoding or a gift flag. | H-4732: "Sposób naliczania rabatów: Wybierz sposób uwzględniania rabatów w zamówieniach." H-4717: "Sposób naliczania rabatów dla produktów ... Sposób naliczania rabatów dla dostawy". H-4619: "Możesz tu również dodać jeszcze jeden warunek „Źródło zamówienia”." |
| X-04 Line added after the order exists | **Partial** | The OMS can add lines (automation "Dodaj produkt", edits). Changes made in the shop back office after import are NOT re-synced, at least for Sky-Shop. | H-4718: "Jeżeli w sklepie internetowym, po pobraniu już konkretnego zamówienia dojdzie do zmiany wartości zamówienia przez naliczanie rabatów, dodanie/skasowanie produktu itd . – Sellasist nie zaktualizuje tych informacji." |
| X-05 Non-goods lines (deposit, credit, packaging, points) | **Partial** | Non-physical "products" (discount, service, warranty, subscription, coupon) are excluded from picking and packing by product flags. Stock can be ignored for virtual items. No typed line kind. | H-4644: "Funkcja ta jest szczególnie użyteczna dla produktów, które nie mają fizycznej formy, jak rabaty, produkty cyfrowe czy usługi dodatkowe, a które mogą być tratowane jako „produkt” w systemie Sellasist." |
| X-06 Promotion audit trail per line | **Partial** | The order card has logs of manual and automatic actions. Set price-sync changes are logged. The dynamic-set personalisation link is in the order logs. There are no per-line before/after promotion values. | H-4855: "Tutaj prześledzisz wszystkie działania wykonane ręcznie (przez konkretnego pracownika) oraz automatycznie (przez system czy akcje automatyczne)." H-4665: "informacja o zmianie ceny produktu jest widoczna w logach czynności." |

## Conflicts between sources

1. **Component price sync.** BLOG-2024-07 says "cena produktu składowego nie aktualizuje się wraz ze zmianą ceny tego produktu wystawionego indywidualnie". H-4665 documents a per-component checkbox "Auto. Synchronizacja" that updates the set price when the product price changes ("Funkcja automatycznej synchronizacji nie dotyczy zestawów dynamicznych"). Trusted: H-4665. It is the current help text and describes the checkbox as a newer feature; the blog predates it. Both can be true: sync is opt-in per component.
2. **Linking to Allegro sets.** H-4494: "Zestawów utworzonych na Sellasist nie możesz powiązać z zestawami utworzonymi na Allegro." BLOG-2024-03, H-3661 and H-4730 describe experimental "Zestawy Allegro" publishing and import ("Administracja → Funkcje eksperymentalne → Zestawy Allegro"). Trusted: the experimental-feature sources for what is possible. The restriction likely holds for non-experimental accounts (unverified).

## Integration normalisation (how Sellasist copes with channel differences)

- **Catalogue linking, not channel declarations.** A channel order line maps to a Sellasist product. If that product is a set (`as_set=1`), the "split" automation expands it. Normalisation therefore sits in the catalogue (offer -> product/set link), not in per-connector bundle semantics. Allegro set offers are matched to sets by productization, EAN, signature or CSV mapping (H-3661).
- **Per-integration discount mode.** Each shop or marketplace integration has "Sposób naliczania rabatów": either "Odejmuj od ceny produktów" (lossy, rounding differences) or "Utwórz nowy pusty produkt „Rabat”" (a separate negative line). Optionally "Wyrównaj rozbieżności w kwocie do zapłaty" adjusts the first unit of a product to match the amount paid (H-4687). eBay splits product and delivery discounts (H-4717). Discount codes land in a configurable order extra field (PrestaShop, IdoSell, Shopify, shopGold).
- **No channel gift flag is read.** Gifts are added by Sellasist automation, not ingested as typed lines. API cart lines carry no gift, parent or discount fields (API `carts` schema).
- **Global switch plus scoping by condition.** "Automatycznie rozbijaj zestaw na produkty" is global. Per-channel behaviour comes from automation conditions ("Źródło zamówienia", status). Dynamic-set notification is default for Allegro only; for other channels the operator builds it with automation (H-4616).
- **No re-sync of shop-side edits after import** (Sky-Shop explicitly; H-4718), so a gift or bundle line added in the shop back office later is lost unless re-keyed by hand.

## UX patterns worth copying

1. **Operator-chosen split moment.** "Zestaw nierozbity na produkty" plus "Rozbij zestaw na produkty" at a chosen status. This decouples what the document shows (set line) from what the warehouse handles (components). One switch answers B-14 and B-11 together (H-4494).
2. **Post-purchase variant chooser for dynamic bundles.** A buyer-facing personalisation page link sent by e-mail/SMS. The order shows "Klient nie wybrał jeszcze produktu z grupy produktów zestawu", the operator can choose by hand, and reminders are automated with a delay condition "nie został wybrany" (H-4616, H-4618).
3. **Gift = real line + automatic 100% discount line per VAT rate**, with an editable name, symbol and EAN, plus a "hide on documents" alternative. This avoids a zero-VAT-bucket problem and keeps stock correct (H-4745).
4. **Hide in picking, show in packing.** Gifts and inserts kept at the packing station are invisible to pickers and appear on the packing screen. The same flags drop non-physical lines (discounts, services) from both modes (H-4644).
5. **Reverse lookup on the product card.** "Znajduje się w zestawie" lists every set a product belongs to, and a component cannot itself become a set (H-4676).
6. **Proportional gift quantity** keyed on a product extra field: one sample per sweater ordered (H-4745).

## Anti-patterns

1. **Split timing changes stock timing.** "Stan magazynowy zmieniają się w momencie rozbicia zestawu" means delaying the split (to get a set line on the invoice) leaves component stock un-decremented until packing. That risks overselling components shared by other sets or sold alone (H-4494).
2. **Contents are not frozen (unverified).** Nothing documents a snapshot. A set edited between order and split may expand to the new composition (H-4494, absence of evidence).
3. **Dynamic set left unchosen breaks stock.** "Jeśli klient nie wybierze produktu lub wariantu z zestawu dynamicznego, zestaw nie zostanie prawidłowo rozbity ... a ich stany magazynowe nie zostaną zaktualizowane" (H-4616). The buyer's silence becomes a stock error.
4. **Discount mode "subtract from prices" is lossy** (rounding, first-unit correction) and loses the list price. "Rabat" as a pseudo-product mixes money adjustments into goods lines (H-4687, H-4717).
5. **Gift behaviour configured through generic automation, with no typed gift.** No gift flag in the order API and no default out-of-stock policy (only "Ignoruj stan magazynowy"). Failures are visible only in a one-month event log (H-4745, H-3759, API).

## New use cases (with source)

- **NEW-SA-1: Post-sale buyer choice for a bundle slot**, with a reminder escalation and an operator override when the buyer never answers (H-4616, H-4618). Extends B-09 with the "never chosen" state.
- **NEW-SA-2: Component price auto-sync opt-in per component**, so a component list-price change propagates to the bundle price and its listing (H-4665). Affects published bundle prices.
- **NEW-SA-3: Bundle of N units of the same product where the buyer mixes variants** (4 pairs, any colours). Availability is the number of whole sets the combined stock allows (H-4616). Sits between B-08 and B-09.
- **NEW-SA-4: Expanding bundles inside merged orders** (two orders joined before shipping) (BLOG-2026-09).
- **NEW-SA-5: Proportional gift lines** (N gifts per N qualifying units, chosen by a product attribute) (H-4745).
- **NEW-SA-6: Order-level "is a gift" signals from a marketplace add-on service** ("Zapakuj na prezent") routing to a special packing status (H-4328, H-4492).
- **NEW-SA-7: Inserts kept at the packing station** (batteries, flyers) added by the packer rather than picked (BLOG-WMS-2024).
