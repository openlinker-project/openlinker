# R3 phase 2 - Competitor: Sellasist (sellasist.pl) - bundles ("zestawy") and gifts ("gratisy")

Round 3, blind replication. Researched 2026-11-04. No account was created; everything below comes from public sources.

## Sources consulted

| Source | Kind | What it gave |
|---|---|---|
| Sellasist help centre, article bodies loaded through the page's own public request `POST /wp-admin/admin-ajax.php action=get_page_sections post_id=<id>` (article list from `GET /wp-json/wp/v2/help?search=`) | Primary, vendor docs | Almost all behaviour below |
| Screenshots embedded in those articles (`crm.esprzedaz.com/Editor/assets/Pomoc/...`) | Primary, vendor screenshots of the live UI | Order editor before/after expansion, gift-rule config table |
| `https://api.sellasist.pl/api.yaml?v=1.90.7` (OpenAPI 3.0.1, `info.version: 1.92.8`) and `https://api.sellasist.pl/changelog` | Primary, API spec | Set endpoints, order line (`carts`) shape |
| sellasist.pl marketing pages (`/manager-produktow/`, `/cennik/`, `/asystent-pakowania/`) | Vendor marketing | Feature naming only, never used alone for a conclusion |
| Web search for reviews / forums | Third-party | Thin signal: nothing about Sellasist bundles or gifts was found |
| `pomysly.sellasist.pl` (Frill ideas board) | Vendor community | JS-rendered, content not retrievable with curl -> Unknown |

Article URLs used (all `https://sellasist.pl/pomoc/<slug>/`), with WP `modified` date where checked:
- A1 `zestawy-produktow-w-panelu-sellasist` (id 4494, modified 2025-11-08) - static sets, pricing, expansion ("rozbijanie")
- A2 `informacje-o-zestawach-w-karcie-produktu` (4676)
- A3 `automatyczna-synchronizacja-cen-produktow-w-zestawie` (4665)
- A4 `jak-utworzyc-zestaw-produktow-podczas-importu-w-sellasist` (4634)
- A5 `jak-wykonac-import-powiazan-produktow-z-zestawami-2` (4518)
- A6 `obsluga-zestawow-w-pliku-xml-b2b` (4551)
- A7 `zestawy-dynamiczne-2` (4616, modified 2026-10-11)
- A8 `zestaw-dynamiczny-warunek-automatyzacji-dla-zamowien-2` (4619), `wariant-produkt-w-zestawie-dynamicznym-warunek-automatyzacji-dla-zamowien` (4618)
- A9 `jak-zaimportowac-asortyment-i-oferty-z-allegro` (3661, modified 2026-05-04)
- A10 `laczenie-po-produktach-allegro` (4609, modified 2024-03-05)
- A11 `jak-stworzyc-zestawy-promocyjne-allegro` (3762)
- A12 `dodaj-produkt-efekt-automatyzacji-dla-zamowien` (4745, modified 2026-02-11) - gift rule
- A13 `jak-dodac-opcje-ukrycia-produktu-w-trybie-zbierania-i-pakowania` (4644)
- A14 `jak-skonfigurowac-widok-trybu-pakowania` (4645), `asystent-pakowania-sellasist` (4710), `jak-wlaczyc-tryb-pakowania-w-sellasist-wms` (4293)
- A15 `akcje-dla-zamowien-lista-warunkow-i-efektow-omowienie-wraz-z-zastosowaniem` (4492)
- A16 `podzial-zamowienia-ze-wzgledu-na-stan-magazynowy` (4766), `obsluga-brakow-w-sellasist-wms-...` (4775)
- A17 integration set-up: `jak-uruchomic-nowy-modul-integracji-sellasist-z-prestashop` (4732), `instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-shoper` (4724), `jak-uruchomic-nowa-integracje-sellasist-z-woocommerce` (4731), `instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-erli` (4723), `instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-idosell` (4659)
- A18 `czym-sa-opcje-w-produktach-sellasist` (4650)
- A19 `nowy-modul-zwrotow-zamowien` (4682)
- A20 `integracja-sellasist-z-subiekt-gt-poprzez-inspigo` (4515)
- A21 `powiazywanie-ofert-w-sellasist` (4850), `oferty-bez-powiazania-allegro` (4756)
- A22 `jak-w-sellasist-skonfigurowac-program-rabatowy-wedlug-wartosci-koszyka` (4336), `czym-sa-rabaty-na-zamowienia-allegro-jak-ustawic-rabat` (4169)

Note on product scope: Sellasist sells in one panel with its own storefront Sellingo; some features (product "Opcje", basket discount programme) apply to the Sellingo store only, not to marketplace orders.

## The model in one paragraph

Sellasist has two bundle types. A **static set** ("zestaw statyczny") is a product with `as_set = 1` whose components (product or exact variant, quantity, per-component price) are defined in `Asortyment -> Zestawy`; its stock is computed from the components. A **dynamic set** ("zestaw dynamiczny") leaves at least one variant attribute unselected, and the buyer picks the variant **after** the purchase on a Sellasist page reached through an e-mail/SMS link. An incoming order line points at the set product (through the offer-to-product link). The set line stays a single line until an order automation effect **"Rozbij zestaw na produkty"** fires; that **replaces** the set line with component lines, each labelled "Produkt z zestawu: <set name>", and stock is decremented at that moment. The operator chooses when (for example only after the invoice is issued, so the invoice shows the set). **Gifts** have no first-class model: a gift is an ordinary product line added by the order automation effect **"Dodaj produkt"** (or by hand), optionally neutralised on the sales document by a generated negative **"Rabat"** line, one per VAT rate.

## Rating table

| ID | Rating | How it works for the operator | Evidence |
|---|---|---|---|
| B-01 | Full | `Asortyment -> Zestawy -> Dodaj zestaw produktowy`, tab `Produkty -> Dodaj produkt`, set quantity and "Cena produktu w zestawie" per component; a product with variants must have a variant chosen. API `GET/POST/PUT /sets/{main_product_id}`, `/sets_bulk`, `DELETE /sets_items/{id}`. | A1: "Możesz ustalić ilość tego produktu w zestawie oraz cenę tego produktu w zestawie." API: `/sets/{main_product_id}` "Dodaje produkty do wskazanego zestawu" |
| B-02 | Full (one gap) | Stock is computed as min over components; a component can also sell alone and in several sets; the product card shows "Znajduje się w zestawie" with the list of sets; the Allegro offer of a set can be switched off automatically when any component runs out ("po skonfigurowaniu ustawień"). Gap: how quickly a component sale republishes set stock to every channel is not documented. | A1: "z dostępnej ilości mogę utworzyć tylko 3 Zestawy jesienne (szal + kurtka)"; "Jeśli którykolwiek z produktów składowych zestawu będzie niedostępny w magazynie, po skonfigurowaniu ustawień oferta zestawu na Allegro zostanie automatycznie wyłączona"; A2: "Ta sekcja pokazuje, czy edytowany produkt jest częścią jakiegoś zestawu" |
| B-03 | None | Only virtual sets were found. Stock always comes from the components, and no kit with its own stock or assembly document turned up. A pre-built kit can only be modelled as an ordinary product, with no link to its components (unverified that nothing else exists). | A1: "Stany magazynowe są pobierane z systemu z produktów wchodzących w skład zestawu." |
| B-04 | Full (via catalogue link) | Any channel order line linked to a set product arrives as one line and is expanded by the "Rozbij zestaw na produkty" effect. Since 2024-05-22 Sellasist creates that action automatically if none exists. Coverage depends on the offer being linked to the set product, not on how the channel encodes it. Allegro productSet offers can be imported as Sellasist sets, but only behind an experimental flag (see Conflicts). | A1: "Sellasist automatycznie utworzy akcję, jeśli nie wykryje istniejącej akcji automatycznej odpowiedzialnej za rozbicie zestawu."; screenshot `akcja-automatyczna-rozbijanie-zestawu-1/4.png` (one line "Zestaw Spodnie + bluzka na wiosne" 1 499,98 PLN becomes two lines tagged "Produkt z zestawu") |
| B-05 | Unknown | Nothing documents detecting a parent and its children in one order (WooCommerce bundle plugins, Shoper). Shop integrations import the cart as is and never resync it, so double counting is plausible if a parent line is linked to a set (unverified). | A17 (Shoper/Woo/Erli): "Do pobranych już zamówień nie dopuszczamy do aktualizacji pobranych już produktów." |
| B-06 | None (unverified) | The order line model in the API has no group or parent field. `carts_response` lists product_id, variant_id, price, quantity, `external_offer_id`, `selected_options`, `status`, `tax_rate` and similar fields, and nothing that groups children. | api.yaml `carts_response` / `order_line_request` (no group/parent property) |
| B-07 | Partial | Allegro "zestawy promocyjne" (multi-offer bundles with a discount) can be created and managed from Sellasist (`Oferty -> Allegro -> Zestawy promocyjne`). How the discount shows up on the resulting order lines is not documented. | A11: "Zdecyduj, która oferta będzie główną... Podaj wartość zniżki dla stworzonego zestawu promocyjnego." |
| B-08 | Partial | A set can contain N units of one product (component quantity). The Allegro import compares "skład i ilości produktów w zestawie" when it links a productSet offer to a set. No dedicated multipack concept. | A9: "system porównuje skład i ilości produktów w zestawie" |
| B-09 | Full | Dynamic set: leave at least one variant attribute unselected. After purchase the buyer gets an e-mail/SMS "Wybierz wariant" with a link to a mobile page. For Allegro this is sent by default; other channels need automation (condition "Zestaw dynamiczny", reminder with "Wariant/produkt w zestawie dynamicznym: nie został wybrany"). The order shows "Klient nie wybrał jeszcze produktu z grupy produktów zestawu", and the operator can pick manually. | A7: "Aby przekształcić zestaw statyczny w dynamiczny, prosimy o pozostawienie co najmniej jednej cechy wariantu bez wyboru."; "Do czasu, kiedy klient nie dokona wyboru w edycji zamówienia widnieje informacja 'Klient nie wybrał jeszcze produktu z grupy produktów zestawu'" |
| B-10 | Partial | Expansion copies the component lines into the order, so the contents are frozen once expanded. Before expansion the order holds only the set line, and nothing says whether a set edited in between changes what gets expanded (Unknown). | A1 expansion section; screenshots show component lines with their own prices after the split |
| B-11 | Partial | After expansion each component is an ordinary line, so it is scanned like any product in the WMS packing mode. The pack view has a toggle "Wyświetlaj informacje o produkcie z zestawu", and component lines carry the label "Produkt z zestawu: X". The packing slip content is Unknown. | A14 (4645): "Wyświetlaj informacje o produkcie z zestawu"; split screenshot label |
| B-12 | Partial (generic) | Nothing specific to sets. Generic tools: the "Skopiuj zamówienie" effect with "Podziel zamówienie według stanu magazynowego" (moves zero-stock lines into a new order), and the WMS "Braki" flag per line. No substitution. | A16: "Produkty, które mają stan magazynowy mniejszy lub równy zeru, zostaną przeniesione do osobnego zamówienia" |
| B-13 | Partial (generic) | WMS setting "Główny magazyn do pakowania - zamówienia, których nie da się skompletować w jednym magazynie będą docelowo pakowane w magazynie, jaki wybierzesz z listy". Not set-specific. | A14 (4293) quote |
| B-14 | Partial | The operator chooses one line or components by timing the expansion: expand after the invoice and the invoice shows the set; expand before and it shows the components. The component split of the price is the operator-entered "Cena produktu w zestawie", which defaults to each component's regular (never promotional) price, not a computed reference-price allocation. In the screenshot the unexpanded set line shows an empty VAT ("%"), while expanded components carry their own 23%. Nothing covers mixed VAT on a single set line (Unknown/None). | A1: "jeśli chcesz aby na fakturze zamówione produkty widniały jako zestaw, to należy tak ustawić akcję automatyczną aby rozbijała zestawy dopiero po wystawieniu FV"; "system używa regularnych cen poszczególnych produktów, a nie cen promocyjnych"; screenshot split1/split4 |
| B-15 | Partial | Once expanded, a component is a normal line and can be returned and restocked ("Zwracaj stan magazynowy" per accepted-product status). There is no logic for a lost bundle discount. | A19: "Tabela zawiera kolumnę Zwracaj stan magazynowy" |
| B-16 | Full | The set's purchase price is computed automatically from the component purchase prices and cannot be edited by hand. | A1: "Nowy sposób automatycznie wylicza cenę zakupu na podstawie cen zakupu jego składników. Ręczna zmiana tej wartości jest niedostępna." |
| B-17 | Full (Allegro) / Unknown (shops) | A set is listed on Allegro as one standard offer (not an Allegro "zestaw"), and dynamic sets too. Description and gallery must be authored for the set. Publishing to shops (Woo/PrestaShop export) was not documented for sets. | A1: "Każdy zestaw utworzony w panelu Sellasist jest traktowany jako jeden niepodzielny produkt. Oznacza to, że na Allegro, cały zestaw jest oferowany w ramach jednej aukcji" |
| B-18 | Partial | Imports: product file column "Zestaw" (1/0); a dedicated "Import powiązań produktów z zestawami" (match by EAN, symbol, catalogue no. or ID); XML B2B `as_set="1"` plus component list; Allegro productSet import (experimental flag); Subiekt GT "komplety" only through the 3rd-party AppsBusters connector, PRO version. PrestaShop packs, Shoper/IdoSell sets and Erli productSets: Unknown. | A4: "Wartość 1: Oznacza, że produkt zostanie zaimportowany jako zestaw"; A6 `as_set`; A9: "Twórz produkty z zestawem Allegro... dostępna po włączeniu jej w funkcjach eksperymentalnych"; A20: "Obsługa kompletów, rezerwacji i wielu magazynów (wersja PRO)." |
| B-19 | Unknown | No per-channel setting for "price on parent vs children". The only related knob found is PrestaShop's "Sposób naliczania rabatów" (its options are not documented). | A17 (4732): "Sposób naliczania rabatów: Wybierz sposób uwzględniania rabatów w zamówieniach." |
| B-20 | Unknown | Not addressed. | - |
| B-21 | Unknown | Multi-parcel ("Wielopaczkowość") exists generically, with nothing about a set split across parcels or what the channel is told. | - |
| G-01 | None (unverified) | No document reads a channel's gift flag. Gifts are a Sellasist-side construct. | - |
| G-02 | Unknown | Not documented how a 0.00/0.01 line or a 100%-discount line from a channel is treated. Order lines in the API carry no discount field. | api.yaml `carts_response` (no discount) vs `invoice_line_request.discount` |
| G-03 | Unknown | Not documented. | - |
| G-04 | Full | The "Dodaj produkt" effect adds the gift to the order when conditions hold (order value, product extra field, source, status, etc.), so a gift promised only in a listing description can be materialised. | A12: "Efekt Dodaj produkt pozwala automatycznie tworzyć dodatkowe pozycje w zamówieniu... np. dodawać gratisy zależnie od wartości koszyka" |
| G-05 | Full | Order editor buttons "dodaj pozycję" / "dodaj zestaw"; API `POST /orders_lines`; WMS packing statuses such as "Pakowanie z gratisem". Proof of shipment = the line on the order plus pack scanning (WMS can also record a packing video). | Screenshot split1 ("dodaj pozycję", "dodaj zestaw"); A14 (4710): "Pakowanie z gratisem - gdy chcesz dodać do paczki dodatkowy upominek." |
| G-06 | Full (for listed dimensions) | Rule = order automation: conditions (Wartość zamówienia, Źródło zamówienia, Status, Pole dodatkowe produktu/zamówienia, Data złożenia, ...) + effect "Dodaj produkt" (product, variant, quantity, own price or catalogue price), with an optional "Ustawiaj ilość produktów gratisowych proporcjonalnie do ilości produktu w zamówieniu" driven by a product extra field. Run window: "Wybrane dni i godziny". Campaign end dates and per-customer limits: not found. | A12 quotes above; A12: "Zaznacz checkbox Ustawiaj ilość produktów gratisowych proporcjonalnie do ilości produktu w zamówieniu" |
| G-07 | Partial | Any product can be a set component with its own "Cena produktu w zestawie". Whether 0.00 is allowed and how it prints on documents: Unknown. | A1 |
| G-08 | Partial | The "Dodaj produkt" effect has "Ignoruj stan magazynowy dodawanego produktu". The text implies that without it a missing stock blocks the action ("brak towaru na magazynie nie powinien blokować akcji automatycznych"). No substitute, no customer notice. | A12 quote |
| G-09 | Partial | A gift is a normal line, so it is visible at packing. Product flags "Nie pokazuj w trybie zbierania" / "Nie pokazuj w trybie pakowania" let a gift be hidden from pickers and revealed at packing. The flag is per product, not per gift line. Packing-slip content: Unknown. | A13: "Opcja ukrywania gratisowych produktów w trybie zbierania, a ich ujawniania dopiero w trybie pakowania" |
| G-10 | Partial (strong) | Effect option "Dodaj pozycję rabatującą": a "Rabat" line at -100% of the added gifts, nameable, with optional Symbol/EAN, and **one rebate line per VAT rate**. Alternatively a per-gift checkbox "Ukryj na dokumentach sprzedaży". No typed reason (discount-in-goods vs gift) and no country policy. | A12: "Jeśli dodawane produkty mają różne stawki VAT, system utworzy osobne pozycje rabatujące dla każdej stawki"; screenshot `dodaj-produkt-aa_09-02-2026--022138_009.png` (columns "Cena sprzedaży brutto / ilość / Ukryj na dokumentach sprzedaży / Wybierz wariant") |
| G-11 | None (unverified) | The returns module has no gift or threshold logic. "Rabat" exists only as a return type (reason) chosen by the customer. | A19: return types list "Wymiana uszkodzonych elementów, Rabat, Odstąpienie od umowy..." |
| G-12 | None (unverified) | No gift report. Workaround: the Symbol/EAN on the rebate line, for use in later automations. | A12: "Symbol i EAN: Pola powiązane z automatyzacją" |
| G-13 | Partial | Own store (Sellingo) only: product "Opcje" can offer "gratisy do wyboru". The dynamic-set choice page is a post-purchase choice mechanism that could carry a gift choice (not documented for gifts). | A18: "Można tu umieścić np. gratisy do wyboru" |
| G-14 | Partial | No gift-wrap order flag. Handled through Sellingo "Opcje" ("ozdobne opakowanie") and operator statuses such as "Pakowanie na prezent". | A18; A14 (4710): "Pakowanie na prezent - do zamówień wymagających dodatkowego zapakowania." |
| G-15 | None | The only customer-history condition is "Kolejne zamówienie klienta", and it looks back x minutes in order to merge shipments. | A15: "Warunek pozwala na sprawdzenie czy dany klient złożył już zamówienie w ciągu ostatnich x-minut" |
| G-16 | Partial | Automation results land in "Dziennik zdarzeń" with manual re-run. An action can be triggered both automatically and by button "gdy automatyczna próba zakończy się niepowodzeniem". There is no dedicated gift-failure status on the order. | A1/A7: "W Dzienniku zdarzeń znajdziesz wszystkie wykonane akcje. Możesz tu przeglądać raporty z ostatniego miesiąca i ręcznie uruchamiać akcje." |
| X-01 | Partial | Order lines have only a gross unit price and no discount field (API). Discounts are expressed as negative-price product lines ("Rabat", e.g. -50 zł). Invoice and receipt lines do have `discount`. Per-integration: the PrestaShop "Sposób naliczania rabatów" setting, and the discount code stored into a chosen extra field (PrestaShop, IdoSell). | A13: "tworzę produkt niematerialny 'Rabat', gdzie Cena sprzedaży brutto to: '-50 zł'"; api.yaml |
| X-02 | Unknown | Kaufland docs do not mention unit merging. | - |
| X-03 | Partial | Per-integration "Ustawienia zamówień" exist: discount mode, VAT-rate source, SKU source, EAN source, weight source, default VAT, discount-code field, plus field remapping ("EAN został wpisany w miejsce SKU") and auto-linking by identifier. No setting tells Sellasist how a channel encodes bundles or gifts. | A17 (4732): "Źródło stawki VAT w zamówieniach... Źródło Symbol/SKU produktu w zamówieniach... Mapowania pól produktów umożliwiają obsługę sytuacji, w których oznaczenia produktów w ofertach zostały zamienione" |
| X-04 | Partial | In-OMS edits are supported (dodaj pozycję / dodaj zestaw, `POST/PUT/DELETE /orders_lines`). Edits made in the shop back office after import are **not** synced: the operator must repeat them in Sellasist. | A17: "Jeżeli dokonujesz modyfikacji w koszykach zamówienia na sklepie internetowym, to należy wprowadzić te same zmiany w zamówieniu w Sellasist." |
| X-05 | Partial | Non-goods are products with "Nie pokazuj w trybie zbierania/pakowania": discounts, coupons, warranties, insurance, subscriptions. Packaging has its own "magazyn opakowań" / "Przypisane opakowanie wysyłkowe". Deposits and points: Unknown. | A13 quotes |
| X-06 | Partial | Action event log (last month); product price-change logs; order logs (e.g. the dynamic-set choice link). There is no per-line promotion audit with before/after values. | A3: "informacja o zmianie ceny produktu jest widoczna w logach czynności" |

## Integration normalisation (how Sellasist copes with channels encoding things differently)

- **Catalogue linking does the normalising, not line semantics.** Each channel offer is linked to a Sellasist product or set ("Powiązywanie ofert", "Braki powiązań" tab per integration; auto-linking "na podstawie wybranego unikalnego identyfikatora", with "Automatyczne powiązywanie nie obejmuje wariantów"). If the offer is linked to a set product, the order line becomes a set line and gets expanded later. The channel's own bundle encoding is therefore largely ignored. (A17 4732, A21)
- **Per-integration order settings** cover VAT source, SKU/EAN/weight source, default VAT, sales-document type, discount mode (PrestaShop) and the discount-code target field. These are field-mapping knobs, not bundle/gift semantics. (A17)
- **Field remapping per integration** ("Mapowania pól produktów") covers channels that swap identifiers. (A17 4732)
- **Allegro productSet import** (experimental) maps a multi-product Allegro offer to a Sellasist set. The match runs by productisation and EAN, by signature, or by CSV, and requires an exact composition and quantity match; otherwise it may create a new set or nothing, depending on import mode. (A9, A10)
- **No resync of the cart after import** for shops (Shoper, Woo, Erli, PrestaShop): late discounts or added lines in the channel are invisible. This is a deliberate stance, not a gap they hide. (A17)
- **Discount representation is not neutral**: order lines carry only a gross unit price, so a discount becomes either a lower price or an extra negative "Rabat" product line. Invoice and receipt lines have their own `discount` field. (api.yaml, A13)

## Conflicts between sources

1. **Allegro sets linkable or not.** A1 (modified 2025-11-08): "Zestawów utworzonych na Sellasist nie możesz powiązać z zestawami utworzonymi na Allegro." A9 (modified 2026-05-04): "Twórz produkty z zestawem Allegro: Umożliwia import ofert będących zestawami Allegro jako zestawy Sellasist", but only via "Funkcje eksperymentalne -> Zestawy Allegro". I trust A9 as the newer statement, with the caveat that the feature is experimental and A1 was never updated.
2. **Minimum automation delay:** A1/A7 say 5 minutes, A8 (4619) says "nie może być ono niższe niż 1 minuta". Minor; probably a later change.
3. **Dynamic-set stock arithmetic** (A7): with 100/100/99 pairs and 4 pairs per set they state 24 sets, "ograniczona przez najmniejszy dostępny stan magazynowy jednego ze składników" (99/4). That is a conservative rule (any mix is allowed, so up to 74 sets could be fulfilled). Reported as documented. It may be the doc's explanation rather than the engine (unverified).

## UX patterns worth copying

1. **Set composer with per-component price and an "Auto. Synchronizacja" checkbox per component.** The total is computed, the set's cost is derived from component costs and locked, and the set always uses regular (not promotional) component prices. (A1, A3)
2. **Reverse lookup "Znajduje się w zestawie" on the product card**, plus a hard refusal to turn a component into a set ("Nie możesz utworzyć zestawu z tego produktu, ponieważ jest częścią składową zestawu"). (A2)
3. **Explicit "unexpanded" state as an automation condition** ("Zestaw nierozbity na produkty"), with the operator choosing at which status expansion happens, and component lines keeping provenance ("Produkt z zestawu: X"). (A1, screenshot)
4. **Gift rule that produces document-ready rebates**: a "Dodaj pozycję rabatującą" line, renamable, taggable with Symbol/EAN, split per VAT rate; or "Ukryj na dokumentach sprzedaży" per gift. (A12)
5. **Gift quantity proportional to the triggering product**, driven by a product attribute (one sample per sweater). (A12)
6. **Per-product WMS visibility**: "Nie pokazuj w trybie zbierania" / "Nie pokazuj w trybie pakowania", so gifts appear only at packing and non-goods appear nowhere. (A13)

## Anti-patterns

1. **Destructive, timing-dependent expansion.** The set line is replaced by components, and what the invoice shows (and when stock moves) depends on when an automation fires. An auto-created action means a default many merchants never chose. (A1: "Stan magazynowy zmieniają się w momencie rozbicia zestawu na produkty.")
2. **Dynamic set leaves stock untouched until the buyer chooses.** If the buyer never chooses, the set is never expanded and stock never decrements, leaving an oversell window. (A7: "Jeśli klient nie wybierze produktu lub wariantu z zestawu dynamicznego, zestaw nie zostanie prawidłowo rozbity... a ich stany magazynowe nie zostaną zaktualizowane.")
3. **Discount as a fake product with a negative price** ("Rabat" -50 zł). It works for documents but loses the link to the line it discounts, so per-line refunds and returns cannot reason about it. (A13)
4. **A gift is just a product.** There is no gift flag, so returns, reporting and per-customer limits cannot tell gifts apart. Workarounds go through Symbol/EAN strings and extra fields. (A12, A15)
5. **No cart resync after import**, so the operator re-keys shop-side edits by hand. (A17)

## New use cases (not in v3 catalogue)

- **N-01 Expansion point is operator-chosen** (by status) and drives both document shape and stock timing; the "unexpanded" state is queryable. Source A1.
- **N-02 Post-purchase buyer choice** of a bundle slot variant via a link (e-mail/SMS), with a reminder rule, an operator override, and stock withheld until chosen. Source A7, A8.
- **N-03 Gift quantity proportional to a trigger line's quantity**, filtered by a product attribute. Source A12.
- **N-04 Gift hidden from picking, revealed at packing** (a stock-control and error-reduction pattern). Source A13.
- **N-05 Refuse nesting**: a product that is a component cannot become a set; the operator must copy it. Source A2.
- **N-06 Channel bundle offer matched to the internal bundle only on an exact composition and quantity match**, otherwise a new bundle is created or the match is rejected, depending on import mode. Duplicate-set risk. Source A9, A10.
- **N-07 Bundle price built from regular component prices only**, ignoring component promotions. Source A1.
- **N-08 Gift action blocked when the gift is out of stock unless "ignore stock" is set** (virtual gifts and made-to-order items). Source A12.

## Confidence

- High: B-01, B-02, B-09, B-16, G-04, G-06, G-10, G-09 (vendor docs plus screenshots).
- Medium: B-04, B-14, B-18 (docs clear, but channel coverage and the experimental flag add uncertainty).
- Low / Unknown: B-05, B-06, B-19 to B-21, G-01 to G-03, X-02. No public evidence, and no reviews or forum signal found ("thin signal").
