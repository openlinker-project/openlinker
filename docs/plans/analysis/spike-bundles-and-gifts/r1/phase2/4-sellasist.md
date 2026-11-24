# Research: Sellasist (sellasist.pl) - bundles ("zestawy") and gifts ("gratisy")

Date: 2026-11-04. Researcher 4 of 8, solution phase. Read-only; no signup, no contact.

## Sources consulted

Primary source is the Sellasist help centre (pomoc). Article bodies are not in the page HTML; they are loaded by the
site's own public front-end call (`admin-ajax.php`, action `get_page_sections`), which I used read-only, exactly as a
browser does. Article list discovered via the public WordPress search endpoint (`/wp-json/wp/v2/search?subtype=help`).
Raw dumps: `.../scratchpad/spike/phase2/sellasist-raw/a1.txt..a8.txt`, `search1.txt`, `search2.txt`, `api.yaml`.

Bundles
- [S1] https://sellasist.pl/pomoc/zestawy-produktow-w-panelu-sellasist/ (mod. 2025-11-08) - static bundles: definition, stock, price, Allegro, splitting via automation. KEY.
- [S2] https://sellasist.pl/pomoc/informacje-o-zestawach-w-karcie-produktu/ (2024-07-25) - "Znajduje się w zestawie" on product card; "Przekształć w zestaw".
- [S3] https://sellasist.pl/pomoc/automatyczna-synchronizacja-cen-produktow-w-zestawie/ (2024-12-06) - "Auto. Synchronizacja" of component prices.
- [S4] https://sellasist.pl/pomoc/zestawy-dynamiczne-2/ (2026-10-11) and https://sellasist.pl/pomoc/zestawy-dynamiczne/ (2024-10-01) - dynamic bundles, buyer-choice page, stock.
- [S5] https://sellasist.pl/pomoc/zestaw-dynamiczny-warunek-automatyzacji-dla-zamowien-2/ and https://sellasist.pl/pomoc/wariantprodukt-w-zestawie-dynamicznym-warunek-automatyzacji-dla-zamowien/ - automation conditions.
- [S6] https://sellasist.pl/pomoc/jak-utworzyc-zestaw-produktow-podczas-importu-w-sellasist/ - import column "Zestaw" 0/1.
- [S7] https://sellasist.pl/pomoc/jak-wykonac-import-powiazan-produktow-z-zestawami-2/ - import of bundle-component links.
- [S8] https://sellasist.pl/pomoc/obsluga-zestawow-w-pliku-xml-b2b/ - XML B2B `as_set` + components.
- [S9] https://sellasist.pl/pomoc/jak-sprzedawac-w-wielopaku-czym-sa-produkty-zalezne/ - multipack via "produkty zależne" (experimental).
- [S10] https://sellasist.pl/pomoc/jak-stworzyc-zestawy-promocyjne-allegro/ - Allegro "zestawy promocyjne" created from Sellasist.
- [S11] https://api.sellasist.pl/ (spec `api.yaml?v=1.90.7`) - `/sets/{main_product_id}`, `/sets_bulk`, `/sets_items/{id}`, product flag `as_set`.
- [S12] https://sellasist.pl/cennik/ - "Zestawy produktowe: Statyczne i dynamiczne" in paid plan; "Brak" in free package.
- [S13] https://sellasist.pl/manager-produktow/ - marketing: "zestawy statyczne i dynamiczne".

Gifts
- [S14] https://sellasist.pl/pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/ (2026-02-11) - automation effect "Dodaj produkt": gift rules, 100% discount line per VAT rate, proportional quantity. KEY.
- [S15] https://sellasist.pl/pomoc/jak-dodac-opcje-ukrycia-produktu-w-trybie-zbierania-i-pakowania/ (2024-10-25) - "Nie pokazuj w trybie zbierania / pakowania"; gifts revealed only at packing. KEY.
- [S16] https://sellasist.pl/pomoc/asystent-pakowania-sellasist/ (2026-10-13) - packing statuses incl. "Pakowanie z gratisem", "Pakowanie na prezent".
- [S17] https://sellasist.pl/pomoc/czym-sa-opcje-w-produktach-sellasist/ - product "Opcje" incl. "gratisy do wyboru", "ozdobne opakowanie" (no stock).
- [S18] https://sellasist.pl/tryb-pakowania/ - marketing: notes "gratis do paczki czy ulotka z kodem rabatowym" shown on packing screen.
- [S19] https://sellasist.pl/pomoc/jak-w-sellasist-skonfigurowac-program-rabatowy-wedlug-wartosci-koszyka/ - cart-value discount (own Sellingo shop only).

Packing / picking / shortages
- [S20] https://sellasist.pl/pomoc/jak-skonfigurowac-widok-trybu-pakowania/ (2026-10-13) - packing view options incl. "Wyświetlaj informacje o produkcie z zestawu".
- [S21] https://sellasist.pl/pomoc/obsluga-brakow-magazynowych-podczas-zbierania-w-sellasist-wms/ (2026-10-27) - shortage queue "Braki", substitution, re-putaway.
- [S22] https://sellasist.pl/pomoc/podzial-zamowienia-ze-wzgledu-na-stan-magazynowy/ - "Skopiuj zamówienie" / "Podziel zamówienie według stanu magazynowego".
- [S23] https://sellasist.pl/pomoc/szablony-wydrukow-z-opcja-grupowania-i-sortowania-produktow/ - pick-list grouping.

Documents / fiscal / returns
- [S24] https://sellasist.pl/pomoc/jak-skonfigurowac-paragony-jak-wystawic-paragon/ - receipts in "Dokumenty [Nowe]"; editable positions.
- [S25] https://sellasist.pl/pomoc/czy-jest-mozliwy-wydruk-paragonu-przez-drukarke-fiskalna/ and https://sellasist.pl/pomoc/jak-zintegrowac-sellasist-wms-z-drukarka-fiskalna/ - fiscal printers (Posnet / Thermal protocol), paid service via AppsBusters.
- [S26] https://sellasist.pl/pomoc/eparagonypl-nowa-integracja-erplink/ - eparagony.pl integration (Erplink), VAT-rate mapping.
- [S27] https://sellasist.pl/pomoc/obsluga-ksef-konfiguracja-integracji-z-ksef-w-sellasist/ (2026-04-03) - KSeF, only in new docs module.
- [S28] https://sellasist.pl/pomoc/dokumenty-sprzedazowe-i-magazynowe-nowy-modul-w-sellasist/ - document series, "Źródło VAT".
- [S29] https://sellasist.pl/pomoc/nowy-modul-zwrotow-zamowien/ and https://sellasist.pl/pomoc/jak-dodac-zwrot-zamowienia/ - returns per position, correction, restock.
- [S30] https://sellasist.pl/pomoc/akcje-dla-zamowien-lista-warunkow-i-efektow-omowienie-wraz-z-zastosowaniem/ - automation conditions list (partial page).

Searched, nothing found (thin signal): web search for Sellasist reviews / complaints about zestawy or gratisy
(general search engine returned only unrelated results; Polish forums not indexed for this). The public ideas board
https://pomysly.sellasist.pl/ (Frill) loads ideas client-side; I did not extract its contents. YouTube (esprzedaztv) not checked.

## Findings

### 1. Two bundle types, both are "products" in the catalogue

**Static bundle ("zestaw statyczny")** [S1]
- Menu: **Asortyment -> Zestawy -> "Dodaj zestaw produktowy"**. Tab **Informacje podstawowe** (name, etc.) -> Zapisz -> more tabs appear.
- Tab **Produkty -> "Dodaj produkt" -> "Wybierz"** per component. Per component: **ilość** and **"Cena produktu w zestawie"**; Akcje: X (remove), > (edit product).
- A variant product must be pinned to ONE variant ("musisz konkretnie wybrać, który wariant wchodzi w skład zestawu").
- "Zestaw traktowany jest jako oddzielny produkt." Bundle price = sum of component "Cena produktu w zestawie"; lowering a component price is how you discount the bundle.
- Uses REGULAR, not promo, component prices: "Konfiguracja zestawów produktów w Sellasist nie obsługuje wykorzystania cen promocyjnych."
- Price sync: checkbox **"Auto. Synchronizacja"** in column "Cena produktu w zestawie" -> component price changes (field "Cena sprzedaży brutto" on product card) propagate to bundle; logged in "logi czynności" [S3].
- Purchase cost: "Nowy sposób automatycznie wylicza cenę zakupu na podstawie cen zakupu jego składników. Ręczna zmiana tej wartości jest niedostępna." [S1]
- Stock: section **Magazyn** auto-computed = min over components (example: 3 scarves + 80 jackets -> 3 bundles). "Nie musisz sam pilnować, ile jeszcze możesz sprzedać oferowanych zestawów."
- Own content: description (OPIS) and GALERIA are NOT inherited from components; tabs KATEGORIE, PROMOCJE, POWIĄZANE, POZYCJONOWANIE.
- Reverse lookup: product card section **"Znajduje się w zestawie"** (bundle ID, name, image; click opens bundle) [S2].
- Guard: a product that is already a component cannot be turned into a bundle: "Nie możesz utworzyć zestawu z tego produktu, ponieważ jest częścią składową zestawu..." Workaround: copy product, then **"Przekształć w zestaw"** [S2].
- API: `/sets/{main_product_id}` returns `product_id`, `productvariant_id`, `price`, `quantity` (example `1.5`, i.e. decimal component quantity) [S11]. (Decimal quantities in UI: unverified.)
- Plan gating: free package "Zestawy produktowe: Brak"; subscription "Statyczne i dynamiczne" [S12].

**Dynamic bundle ("zestaw dynamiczny")** - buyer choice [S4]
- Same screen; either add several products as alternatives with the "+" in Akcje (e.g. 3 colours of trousers), or add a variant product leaving at least one variant attribute unselected ("pozostawienie co najmniej jednej cechy wariantu bez wyboru"). Picking all attributes makes it static again.
- Listed on Allegro "jako standardową ofertę, a nie jako zestaw Allegro".
- Choice happens AFTER purchase: buyer gets e-mail/SMS with a link to a Sellasist personalisation page (mobile-optimised), picks variants, confirms.
- Until then the order card shows: **"Klient nie wybrał jeszcze produktu z grupy produktów zestawu"**; operator can choose manually ("możliwość ręcznego dostosowania wyboru"). Link also in order logs.
- Stock: availability limited by combinations (worked example: 4 pairs from 100/100/99 -> 24 sets). "Stan magazynowy produktów jest aktualizowany w systemie dopiero po dokonaniu wyboru przez klienta." If buyer never chooses, bundle is not split and stock is not updated.
- Auto notification only for Allegro by default; other marketplaces need a manual automation: status "Zamówienia z zestawem dynamicznym" + condition **"Zestaw dynamiczny"** + effect **"Wyślij powiadomienie"** template **"Wybierz wariant"** (Administracja -> Powiadomienia -> Powiadomienia informacyjne) [S4][S5]. Further condition **"Wariant/Produkt w zestawie dynamicznym"** [S5].

### 2. Order with a bundle: split ("rozbij") is an automation, timing chosen by operator [S1]
- Order arrives with the bundle as one line (Allegro offer linked to the bundle product).
- Splitting into components is an automation: condition **"Zestaw nierozbity na produkty"** + effect **"Rozbij zestaw na produkty"** (Administracja -> Automatyzacja -> Akcje dla zamówień, or Zamówienia -> Akcje automatyczne). Legacy global switch **"Automatycznie rozbijaj zestaw na produkty"** in Zamówienia -> Ustawienia. Since 22.05.2024 the system auto-creates the action if none exists.
- Operator picks the moment by adding a **"Status zamówienia"** condition (e.g. "Do pakowania").
- Coupling to documents: "jeśli chcesz aby na fakturze zamówione produkty widniały jako zestaw, to należy tak ustawić akcję automatyczną aby rozbijała zestawy dopiero po wystawieniu FV." If split earlier, the document shows components.
- Coupling to stock: **"Stan magazynowy zmieniają się w momencie rozbicia zestawu na produkty."**
- After split, "na karcie zamówienia zostanie zachowane powiązanie oferty Allegro z produktami zestawu".
- Order-line API (`CartsResponse`) shows no bundle/parent field [S11] - representation of the split lines in API: unknown.

### 3. Picking and packing
- Packing view setting **"Wyświetlaj informacje o produkcie z zestawu"** (Magazyn -> Sellasist WMS -> Tryb pakowania) [S20]. What exactly is shown: unverified (no screenshot text).
- Generic WMS: scan before closing parcel, video recording, "Dodatkowa lista produktów spakowanych", carrier logos, stock/EAN/location display [S20].
- Pick lists can group by EAN/Symbol across orders [S23].
- Shortages: picker marks a missing item, order goes to status/tab **"Braki"**; BOK decides: drop item, reduce quantity, substitute ("zamiennik": BOK removes the line, adds agreed product; already-picked lines keep their state), or cancel -> **"Do częściowego rozlokowania"** / "Do rozlokowania" for re-putaway [S21]. Setting "Moment zmiany statusu zamówienia z brakami": "Po zakończeniu zbierania" vs "Po pierwszym oznaczeniu braku".
- Order split by stock: automation effect **"Skopiuj zamówienie"** with parameter **"Podziel zamówienie według stanu magazynowego"** (operator + threshold) - out-of-stock lines go to a separate order [S22]. Not bundle-specific.

### 4. Multipack and Allegro sets
- Multipack = **"produkty zależne"** (experimental: Administracja -> Funkcje eksperymentalne). Copy product, then on main product **Warianty i opcje -> "Powiąż produkt"**, choose the copy, enter number of units. Dependent products have no stock; they modify the main product's stock by N [S9].
- Allegro "zestawy promocyjne" (offer bundles with discount) can be created from Sellasist: **Oferty -> Allegro -> Lista ofert -> "Utwórz zestaw promocyjny"**, move offers, set discount; managed in **Oferty -> Allegro -> Zestawy promocyjne** [S10]. How the resulting multi-line discounted order is represented: unknown.
- "Zestawów utworzonych na Sellasist nie możesz powiązać z zestawami utworzonymi na Allegro." [S1]

### 5. Gifts: rule effect "Dodaj produkt" [S14]
- Administracja -> Automatyzacja -> Akcje dla zamówień -> "+". Condition e.g. **"Wartość zamówienia" >= 1000 PLN**; effect **"Dodaj produkt"** -> "Dodaj produkt" -> pick product.
- Per added product: **Id, Nazwa, "Cena sprzedaży brutto"** (checkbox = special price, else main price), **Ilość**, **"Wybierz wariant"**; several products per effect.
- Checkbox **"Dodaj pozycję rabatującą"** -> adds a line (default name **"Rabat"**, optional **Symbol** and **EAN**) worth -100% of the added products: "Szalik o wartości 119 PLN dodany jako gratis -> Rabat wyniesie: -119 PLN". Multiple gifts summed in one line; **"Jeśli dodawane produkty mają różne stawki VAT, system utworzy osobne pozycje rabatujące dla każdej stawki"**.
- Gift line visibility on documents tied to checkbox **"Ukryj na dokumentach sprzedaży"** (must be unchecked for the discount line to show).
- Symbol/EAN on the discount line serve as hooks for later automations (e.g. send a specific e-mail).
- Proportional mode: checkbox **"Ustawiaj ilość produktów gratisowych proporcjonalnie do ilości produktu w zamówieniu"** + a product extra field (Produkty -> Dodatkowe pola, e.g. "Próbka") whose value marks qualifying products -> one sample per qualifying unit.
- **"Ignoruj stan magazynowy dodawanego produktu"** - add even without stock (made-to-order, virtual, services). Implies by default stock is checked (behaviour when gift out of stock: unverified).
- Other available conditions useful for gift rules (names only): "Źródło zamówienia", "Status zamówienia", "Dane produktu", "Pole dodatkowe produktu", "Liczba pozycji w zamówieniu", "Dane klienta", "Metoda płatności", "Komentarz do zamówienia", "Stan magazynowy" [S14][S30].
- Triggering: automatic or manual buttons ("przyciski"/"aktywatory"), delay >= 5 min (1 min in one article), schedule; "Data złożenia" floor - backdating re-applies to old orders (explicit warning) [S1][S5].

### 6. Gifts in the warehouse [S15][S16][S18]
- Product card -> Informacje podstawowe -> Magazyn: **"Nie pokazuj w trybie zbierania"**, **"Nie pokazuj w trybie pakowania"**.
- Documented pattern: hide gifts from picking, reveal them at packing so the packer adds them ("Gratisy są dodawane dopiero w trybie pakowania"). Same flags hide non-physical "Rabat" products from both modes.
- Suggested packing statuses: **"Pakowanie z gratisem"**, **"Pakowanie na prezent"** (Asystent Pakowania / SmartPack).
- Packing screen shows notes "gratis do paczki czy ulotka z kodem rabatowym" (marketing) [S18].

### 7. Buyer-chosen gifts / options [S17]
- Product **"Opcje"**: optional add-ons, no stock, may cost extra; "gratisy do wyboru", "ozdobne opakowanie". Applies to the own Sellingo shop (unverified for marketplaces).

### 8. Documents and fiscal
- Receipts/invoices in **Dokumenty [Nowe] -> Dokumenty sprzedaży**; issued from the order card **Dokumenty [Nowe] -> "Wystaw dokument sprzedażowy"** or automation effect "Wystaw dokument z serią"; positions editable after issuing [S24].
- Fiscal printers: Posnet and Thermal-protocol printers via paid integration by AppsBusters [S25]. eparagony.pl via Erplink; operator types VAT rates "tak jak w swoim panelu eparagony.pl" [S26].
- KSeF: only in new document module; per-series KSeF account; option "Nie dodawaj numerów EAN do KSeF"; retries 5x every 30 min; offline mode [S27].
- VAT source per series: **"Źródło VAT"** (from order / from Sellasist warehouse / fixed / destination-country default) [S28].
- Bundle on documents: one line vs components decided only by split timing (section 2). Mixed-VAT price split for bundle components: unknown.
- Gift: list price + per-VAT-rate "Rabat" line (section 5). How eparagony/fiscal printer handle a rate bucket that nets to 0: unknown.

### 9. Returns [S29]
- Return per order position: accept / reject all, change quantity, edit position; justification required; then correction ("Nie można wystawić korekty" if no invoice/receipt), refund (incl. shipping checkbox), Allegro commission refund request.
- Restock: accepted items go back to stock automatically unless "zarządzanie stanami tylko za pomocą dokumentów" (then PZ zbiorcze).
- Bundle-specific return logic (return one component, lost bundle discount): not documented -> unknown.
- Gift-specific return logic: not documented -> unknown.

## Per-use-case table

| ID | Rating | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Asortyment -> Zestawy -> "Dodaj zestaw produktowy"; tab Produkty -> Dodaj produkt -> Wybierz; ilość + "Cena produktu w zestawie". Also "Przekształć w zestaw", import column "Zestaw" 0/1, link-import, XML B2B, API /sets | Variant must be pinned (else it becomes dynamic); component cannot itself become a bundle | S1,S2,S6,S7,S8,S11 |
| B-02 | Full | Bundle stock auto = min over components; shared components; Allegro bundle offer auto-disabled when any component unavailable ("po skonfigurowaniu ustawień") | Component stock only decremented at split time (see B-04) | S1 |
| B-03 | Partial | Only virtual bundle documented (stock derived). Pre-built kit with own stock = just a normal product (unverified) | No kit-assembly flow found | S1 |
| B-04 | Full (own bundles) | Order line = bundle; automation "Zestaw nierozbity na produkty" -> "Rozbij zestaw na produkty", timing via Status condition | Channel-native sets not linked to a Sellasist bundle: unknown | S1 |
| B-05 | Unknown | - | - | - |
| B-06 | Unknown | - | - | - |
| B-07 | Partial | Can CREATE Allegro "zestawy promocyjne" (Oferty -> Allegro -> Lista ofert -> Utwórz zestaw promocyjny). Order-side handling unknown | Cannot link Sellasist bundles to Allegro sets | S10,S1 |
| B-08 | Partial | "Produkty zależne": copy product, Warianty i opcje -> Powiąż produkt, N units; no own stock | Experimental feature; manual copy+link | S9 |
| B-09 | Full | Zestaw dynamiczny; buyer picks AFTER purchase via e-mail/SMS link; order shows "Klient nie wybrał jeszcze..."; operator can choose manually | Auto-notify only Allegro; other channels via own automation; no choice = no split, no stock update | S4,S5 |
| B-10 | Unknown | Split creates component lines at split time (snapshot implied, unverified) | - | S1 |
| B-11 | Partial | Packing view option "Wyświetlaj informacje o produkcie z zestawu"; scanning per component after split (unverified) | Exact display not documented | S20 |
| B-12 | Partial | Generic: "Braki" queue with drop/reduce/substitute/cancel; "Podziel zamówienie według stanu magazynowego" | Not bundle-aware (unverified) | S21,S22 |
| B-13 | Unknown | - | - | - |
| B-14 | Partial | Bundle as one line if split after invoice; components if split before. "Źródło VAT" per series | Mixed-VAT bundle price split: unknown | S1,S28 |
| B-15 | Partial | Return per position, change qty, correction, auto-restock | Bundle-aware refund / lost discount: unknown | S29 |
| B-16 | Full | Bundle purchase price auto = sum of component purchase prices; manual edit blocked | - | S1 |
| B-17 | Full | Bundle listed on Allegro as a single standard offer; also Sellingo shop | Needs own description + gallery (not inherited) | S1,S4 |
| B-18 | Partial | File import (Zestaw column, link importer), XML B2B; shop/ERP pack import unknown | Link importer only links existing products to existing bundles | S6,S7,S8 |
| G-01 | Unknown | - | - | - |
| G-02 | Unknown | - | - | - |
| G-03 | Unknown | - | - | - |
| G-04 | Partial | Rule "Dodaj produkt" keyed on product/source/extra field; or status "Pakowanie z gratisem" + packing note | No offer-description parsing; all rule-based | S14,S16 |
| G-05 | Full | Edit order and add product (BOK adds substitute in Braki flow); packer adds gift in packing mode | - | S21,S15 |
| G-06 | Full/Partial | Automation: condition (Wartość zamówienia, Źródło, Dane produktu, ...) + effect "Dodaj produkt" (cena specjalna, ilość, wariant, proporcjonalnie, "Ignoruj stan magazynowy") | Per-customer limit / once-per-customer not found | S14 |
| G-07 | Unknown | Component price editable, 0 zł component plausible (unverified) | - | S1 |
| G-08 | Partial | Gift is a real product line -> stock; option to ignore stock | Out-of-stock gift behaviour unverified | S14 |
| G-09 | Full | "Nie pokazuj w trybie zbierania" -> gift appears only in packing; packing notes | - | S15,S18 |
| G-10 | Full | "Dodaj pozycję rabatującą": list price + "Rabat" line, separate per VAT rate; can hide on docs | Zero-sum bucket on eparagony/fiscal printer: unknown | S14 |
| G-11 | Unknown | - | - | - |
| G-12 | Partial | Symbol/EAN on "Rabat" line usable as automation hook | No gift report found | S14 |
| G-13 | Partial | Product "Opcje" (gratisy do wyboru) in own shop; dynamic bundle choice page | Options have no stock | S17,S4 |
| G-14 | Partial | Status "Pakowanie na prezent"; option "ozdobne opakowanie" | Mapping of Allegro GIFT_WRAP / Amazon IsGift: unknown | S16,S17 |
| X-01 | Unknown | - | - | - |
| X-02 | Unknown | - | - | - |

## UX patterns worth copying
1. Gift rule produces "list price + per-VAT-rate discount line" (named, with Symbol/EAN hooks), toggled by one checkbox "Dodaj pozycję rabatującą".
2. Per-product flags "hide in picking" / "hide in packing": gifts skipped by picker, surfaced at the pack bench; same flags clean non-physical lines.
3. Operator-chosen expansion moment (status-gated), which decides both what the invoice shows and when stock moves.
4. Reverse lookup "Znajduje się w zestawie" on the component card plus a guard against nesting.
5. Buyer-choice-after-purchase page for variable bundles, with a visible "buyer has not chosen yet" banner on the order and manual override.
6. Proportional gift quantity keyed on a product tag (one sample per qualifying unit).

## Anti-patterns / complaints
(No public user complaints found - thin signal. Below are design risks visible in the docs.)
1. Stock decrements only when the bundle is split; if the split is delayed (e.g. after invoice) or a dynamic bundle is never chosen, components are not reserved -> oversell window.
2. Two mechanisms for one job (legacy "Automatycznie rozbijaj zestaw" switch vs automation, auto-created since 22.05.2024) - confusing.
3. Bundles ignore promo prices; description and gallery must be rebuilt per bundle.
4. Gift-line visibility tied to a separate "Ukryj na dokumentach sprzedaży" flag; rules can be backdated and fire on old orders (explicit warning in docs).
5. Multipack only via an experimental, copy-and-link feature; no linking of OMS bundles to Allegro-native sets.

## New use cases not in the catalogue
- N1 Buyer chooses bundle contents AFTER purchase via a link (pending-choice state on the order, reminder, manual override).
- N2 Expansion timing as a setting: which status triggers the split; invoice shows bundle vs components depending on it.
- N3 Proportional gift quantity (one gift per qualifying unit), driven by a product tag.
- N4 Non-physical lines (discount, service, warranty) hidden from pick and pack but kept on documents.
- N5 Decimal component quantities (API example 1.5) - weight-based kits (unverified in UI).
- N6 Component price auto-sync into bundle price, and bundle purchase cost auto-derived (locked).
- N7 Pick-time vs pack-time visibility of a line (gift collected at the bench, not by the picker).
- N8 Out-of-stock "Braki" queue with BOK decision (substitute / reduce / cancel + re-putaway of already-picked components).

## Confidence assessment
- High: static/dynamic bundle definition, stock min rule, split automation and its coupling to stock/invoice, gift effect "Dodaj produkt" with per-VAT discount line, hide-in-pick/pack flags (all quoted from official help, 2024-2026).
- Low: packing display of bundle components, order-line API representation after split, multipack maturity.
- Unknown: channel-native set ingestion (B-05/06, G-01..03), returns of bundle components/gifts, fiscal handling of 0 buckets, gift reporting/limits.
