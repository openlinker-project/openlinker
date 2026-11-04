# Research: Sellasist (sellasist.pl) - bundles ("zestawy") and gifts ("gratisy"), and how it normalises integrations

Researched 2026-11-04. Read-only. No account, no sign-up, no contact.

## Sources consulted
- Sellasist help centre, all 899 articles. The article text is not in the page HTML; the help page loads it with
  `POST https://sellasist.pl/wp-admin/admin-ajax.php` (`action=get_page_sections`, `post_id=<id>`). Article ids come from
  `https://sellasist.pl/wp-json/wp/v2/help`. 890 of the 899 bodies were retrieved this way.
- Key articles (all under https://sellasist.pl/pomoc/):
  - zestawy-produktow-w-panelu-sellasist/ (static sets, splitting with automation; modified 2025-11-08)
  - zestawy-dynamiczne-2/ (dynamic sets, buyer choice page; modified 2026-10-11)
  - automatyczna-synchronizacja-cen-produktow-w-zestawie/ (2024-12-06)
  - informacje-o-zestawach-w-karcie-produktu/ (2024-07-25)
  - jak-utworzyc-zestaw-produktow-podczas-importu-w-sellasist/ , jak-wykonac-import-powiazan-produktow-z-zestawami-2/
  - obsluga-zestawow-w-pliku-xml-b2b/
  - zestaw-dynamiczny-warunek-automatyzacji-dla-zamowien-2/ , wariant-produkt-w-zestawie-dynamicznym-warunek-automatyzacji-dla-zamowien/
  - akcje-dla-zamowien-lista-warunkow-i-efektow-omowienie-wraz-z-zastosowaniem/ (full list of order conditions/effects; 2026-10-15)
  - dodaj-produkt-efekt-automatyzacji-dla-zamowien/ (gift effect; 2026-02-11)
  - jak-dodac-opcje-ukrycia-produktu-w-trybie-zbierania-i-pakowania/ (hide from pick/pack)
  - jak-skonfigurowac-widok-trybu-pakowania/ , asystent-pakowania-sellasist/ , jak-wlaczyc-tryb-pakowania-w-sellasist-wms/
  - pola-dodatkowe-zamowienia-warunek-automatyzacji-akcji-dla-zamowien/ , lokalizacja-warunek-automatyzacji-dla-zamowien/ , szablony-notatek/
  - czym-sa-opcje-w-produktach-sellasist/
  - jak-stworzyc-zestawy-promocyjne-allegro/ , zarzadzanie-ofertami/ (Allegro "Kup razem")
  - jak-zaimportowac-asortyment-i-oferty-z-allegro/ (Allegro set offers -> Sellasist sets; 2026-05-04)
  - jak-dodac-i-skonfigurowac-szablon-ustawien-oferty-allegro/ , jak-wystawic-oferte-allegro-na-licytacje/ , jak-wlaczac-i-wylaczac-synchronizacje-w-ofertach-allegro/ ("Elementy zestawu" sync)
  - jak-masowo-uzupelnic-parametry-allegro/ (FAQ "Jak mogę rozbić zestaw?" about Allegro parameter sets)
  - jak-uruchomic-nowy-modul-integracji-sellasist-z-prestashop/ , instrukcja-konfiguracji-integracji-sellasist-i-shopgold/ ,
    instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-ebay/ , temu-konfiguracja-integracji/ ,
    instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-shoper/ , jak-uruchomic-nowa-integracje-sellasist-z-woocommerce/ ,
    instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-kaufland/ , instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-idosell/ ,
    instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-amazon/ , jak-uruchomic-nowy-modul-integracji-sellasist-z-shopify/
  - ustawienia-zamowien-dla-konta-allegro/ , automatyczne-wiazanie-produktow-zamowien-allegro/ , czym-sa-rabaty-na-zamowienia-allegro-jak-ustawic-rabat/
  - obsluga-brakow-magazynowych-podczas-zbierania-w-sellasist-wms/ (2026-10-27)
  - jak-dokonac-zwrotu-produktow-i-platnosci-w-zamowieniach-z-allegro/
- API spec: https://api.sellasist.pl/api.yaml (OpenAPI 3.0.1, v1.92.8). Tag "Produkty - Zestawy produktowe":
  `GET/POST/PUT /sets/{main_product_id}`, `GET/PUT /sets_bulk`, `DELETE /sets_items/{id}`; product flag `as_set`;
  order cart lines (`carts_response`) carry no set/parent/gift marker.
- Blog: https://sellasist.pl/blog/zestawy-allegro-nowa-funkcja-w-twoim-sellasist/ (2024-03-20),
  https://sellasist.pl/blog/poznaj-zastosowanie-zestawow-produktow-statyczne-dynamiczne-a-moze-allegro/
- Pricing: https://sellasist.pl/cennik/ (row "Zestawy produktowe: Statyczne i dynamiczne", also in the free package),
  https://sellasist.pl/manager-produktow/
- Ideas board https://pomysly.sellasist.pl/ (Frill): ideas load client-side; could not read them without a session. Thin/no signal.
- Third-party reviews: web search returned nothing Sellasist-specific on bundles/gifts. Thin signal.

## Vocabulary (Polish UI labels)
- Asortyment -> Zestawy; button "Dodaj zestaw produktowy"; tabs Informacje podstawowe / Produkty / Kategorie / Opis / Galeria / Promocje / Powiązane / Pozycjonowanie.
- Column "Cena produktu w zestawie" with checkbox "Auto. Synchronizacja".
- Product card: "Przekształć w zestaw"; section "Znajduje się w zestawie".
- "Zestaw statyczny" (fixed variant per slot), "Zestaw dynamiczny" (at least one variant attribute left unselected -> buyer chooses).
- Orders settings: "Automatycznie rozbijaj zestaw na produkty"; automation condition "Zestaw nierozbity na produkty", effect "Rozbij zestaw na produkty".
- Dynamic: notification "Wybierz wariant", conditions "Zestaw dynamiczny", "Wariant/produkt w zestawie dynamicznym: nie został wybrany"; order info "Klient nie wybrał jeszcze produktu z grupy produktów zestawu".
- Allegro: "Zestawy promocyjne" (= Allegro "Kup razem"), "Zestawy Allegro" (experimental, Administracja -> Funkcje eksperymentalne -> Zestawy Allegro), import option "Twórz produkty z zestawem Allegro", offer sync "Elementy zestawu".
- Gift effect "Dodaj produkt" with "Dodaj pozycję rabatującą" (default name "Rabat"), "Ustawiaj ilość produktów gratisowych proporcjonalnie do ilości produktu w zamówieniu", "Ignoruj stan magazynowy dodawanego produktu"; product flags "Nie pokazuj w trybie zbierania", "Nie pokazuj w trybie pakowania", "Ukryj na dokumentach sprzedaży".
- Integration order settings: "Sposób naliczania rabatów" = "Odejmuj od ceny produktów" | "Utwórz nowy pusty produkt „Rabat”"; "Wyrównaj rozbieżności w kwocie do zapłaty"; "Źródło stawki VAT / Symbol/SKU / EAN / wagi produktu w zamówieniach".

## Model in one paragraph
A Sellasist set is a product with `as_set=1` plus a list of component lines (product, variant, quantity, price-in-set).
It has no stock of its own: availability = min over components. Its price is the sum of the components' "price in set";
its purchase cost is the sum of component purchase costs (not editable). It is listed on any channel as one ordinary
offer/product. An order line for the set stays a single "Zestaw" line until an automation effect "Rozbij zestaw na
produkty" replaces it with component lines (by default immediately; operator can delay it to a status, e.g. after the
invoice). Stock of components changes only when the split happens. Gifts are not a concept; they are ordinary products
added by an automation effect "Dodaj produkt", optionally balanced by one "Rabat" line per VAT rate.

## Use cases

| ID | Status | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Asortyment -> Zestawy -> "Dodaj zestaw produktowy"; tab Produkty -> "Dodaj produkt" -> choose product + exact variant, set quantity and "Cena produktu w zestawie". Or "Przekształć w zestaw" on an existing product. API `/sets/{main_product_id}`. | A product that is already a component cannot be turned into a set ("Nie możesz utworzyć zestawu z tego produktu, ponieważ jest częścią składową zestawu") - copy it first. So no nested sets (inferred). Description and gallery are not inherited. | pomoc/zestawy-produktow-w-panelu-sellasist/ ; pomoc/informacje-o-zestawach-w-karcie-produktu/ ; api.yaml |
| B-02 | Full | Stock of set computed: "3 szale + 80 kurtek -> 3 zestawy". Dynamic sets: worked example 4 pairs from 100/100/99 -> 24. Component stays a normal product; card shows "Znajduje się w zestawie" with set ids. Allegro set offer auto-disabled when a component is out of stock ("po skonfigurowaniu ustawień"). | Publish latency for sets not stated (prices sync to channels "do 10 minut", unverified for set stock). | pomoc/zestawy-produktow-w-panelu-sellasist/ ; pomoc/zestawy-dynamiczne-2/ ; manager-produktow |
| B-03 | Partial | Only virtual sets documented. A pre-built kit would be a plain product with its own stock; no assembly/disassembly flow tied to sets found. | No BOM build documents for sets found (RW exists in documents module but not linked to sets). (unverified) | pomoc/zestawy-produktow-w-panelu-sellasist/ ; pomoc/dokumenty-sprzedazowe-i-magazynowe-nowy-modul-w-sellasist/ |
| B-04 | Full | Channel offer is linked to the set product (linking by ID/EAN/symbol/catalogue no., or Allegro offer->set import). Order arrives with the set as one line; split rule expands it. Allegro productSet offers can be imported as Sellasist sets ("Twórz produkty z zestawem Allegro", match by productisation or EAN, comparing composition and quantities). | Allegro set import is experimental. If an Allegro set offer matches a plain product, no set is created. | pomoc/jak-zaimportowac-asortyment-i-oferty-z-allegro/ ; pomoc/laczenie-po-produktach-allegro/ |
| B-05 | None / Unknown | No documented handling of channels that send parent + children lines (Woo bundle plugins, Shoper). Cart lines in the API carry no parent marker. | Risk of double counting not addressed in docs. | api.yaml (`carts_response`); Woo/Shoper integration articles |
| B-06 | None / Unknown | No grouping concept on order lines. | - | api.yaml |
| B-07 | Partial | Operator can create/import/edit Allegro "Zestawy promocyjne" (= "Kup razem") from Oferty -> Allegro -> Zestawy promocyjne: pick main offer, move others with arrows, set discount. Incoming orders: N lines; how the discount lands depends on Allegro discount handling ("nowa obsługa rabatów", details not documented). | Needs >=2 active offers. Inbound discount allocation for these sets not documented. | pomoc/jak-stworzyc-zestawy-promocyjne-allegro/ ; pomoc/zarzadzanie-ofertami/ ; blog Q2 2025 summary |
| B-08 | Partial (unverified) | Sellasist set allows quantity per component, and "Zestawy Allegro" publishes a Sellasist set as an Allegro product-set offer; a single-product quantity-N set seems possible. | Not explicitly documented for multipack; experimental. | blog/zestawy-allegro-nowa-funkcja-w-twoim-sellasist/ ; pomoc/zestawy-dynamiczne-2/ |
| B-09 | Full | "Zestaw dynamiczny": leave >=1 variant attribute unselected. After purchase the buyer gets e-mail/SMS "Wybierz wariant" with a link to a mobile page and picks. Until then the order shows "Klient nie wybrał jeszcze produktu z grupy produktów zestawu"; operator can pick manually; automation reminders (e.g. after 20 min). Default notification only for Allegro; other channels need an automation. Also mix-and-match quantities (4 pairs any colours). | Stock of components updates only after the choice; if never chosen, the set is not split and stock is not updated. Price auto-sync does not apply to dynamic sets. On Allegro listed as a standard offer, not an Allegro set. | pomoc/zestawy-dynamiczne-2/ ; pomoc/wariant-produkt-w-zestawie-dynamicznym-warunek-automatyzacji-dla-zamowien/ |
| B-10 | None / Unknown | No mention of freezing set contents on the order. Split can happen hours later (status-driven), so a definition edit in between would presumably apply (unverified). | Risk. | pomoc/zestawy-produktow-w-panelu-sellasist/ |
| B-11 | Partial | After split, pick and pack see component lines. Packing view option "Wyświetlaj informacje o produkcie z zestawu". Invoice can still show the set if split runs after invoicing. | Exact rendering of "info about product from set" not documented. No evidence of a slip showing set + components together. | pomoc/jak-skonfigurowac-widok-trybu-pakowania/ |
| B-12 | Partial (generic) | No set-specific policy. Generic WMS shortage flow ("Braki w zamówieniach"): picker reports missing units, order goes to a queue, BOK decides ship partial / substitute / cancel; label lists collected and missing items. Allegro set offer auto-disabled when a component is at 0. | Not set-aware. | pomoc/obsluga-brakow-magazynowych-podczas-zbierania-w-sellasist-wms/ |
| B-13 | Unknown | Not documented for sets. | - | - |
| B-14 | Partial | Operator chooses "one line vs components" by WHEN the split runs: split after invoice -> invoice shows "Zestaw" as one line; split before -> components. Price split per component is defined up front in "Cena produktu w zestawie" (set price = sum of these). | No documented mixed-VAT handling for a one-line set; the set is a product with one VAT rate (inferred). No rule like "never above component's own price". | pomoc/zestawy-produktow-w-panelu-sellasist/ |
| B-15 | None | Returns/refunds work per product line (Allegro refund: tick products, "Zwróć wpłatę", stock auto-restored). Nothing on lost bundle discount. | - | pomoc/jak-dokonac-zwrotu-produktow-i-platnosci-w-zamowieniach-z-allegro/ |
| B-16 | Full | Purchase price of a set is computed from components' purchase prices; manual edit disabled. | - | pomoc/zestawy-produktow-w-panelu-sellasist/ |
| B-17 | Full | Set is listed like any product (shop, Allegro as one offer, other marketplaces). Allegro: experimental "Zestawy Allegro" publishes an Allegro product-set offer (icon, filter, mass action, import); offer sync "Elementy zestawu" pushes composition changes. | Help text says Sellasist sets cannot be linked with sets created on Allegro (2025) - conflicts with the newer import article. | pomoc/zestawy-produktow-w-panelu-sellasist/ ; pomoc/jak-dodac-i-skonfigurowac-szablon-ustawien-oferty-allegro/ ; blog/zestawy-allegro-nowa-funkcja-w-twoim-sellasist/ |
| B-18 | Partial | File import: column "Zestaw" (1/0) converts product<->set; separate "Import powiązań produktów z zestawami" links components by EAN/symbol/catalogue no./ID with insert/update/skip rules. Allegro set offers import (experimental). XML B2B export carries `as_set` and component list. | No documented import of PrestaShop packs, Shoper/IdoSell sets, Erli product sets or Subiekt komplety. | pomoc/jak-utworzyc-zestaw-produktow-podczas-importu-w-sellasist/ ; pomoc/jak-wykonac-import-powiazan-produktow-z-zestawami-2/ ; pomoc/obsluga-zestawow-w-pliku-xml-b2b/ |
| B-19 | None | No per-channel setting for which line carries price/VAT. Only discount mode and VAT/SKU/EAN source per integration. | - | integration articles |
| B-20 | Unknown | Not documented. Sellasist is stock master pushing to shops ("Głównym źródłem stanów magazynowych i cen są produkty"). | - | pomoc/jak-uruchomic-nowy-modul-integracji-sellasist-z-prestashop/ |
| B-21 | Partial (generic) | Multi-parcel orders ("Wielopaczkowość") exist; not set-specific. | - | sellasist.pl/wielopaczkowosc/ |
| G-01 | None / Unknown | No channel gift flag is read. Coupon codes can be stored in an order additional field (PrestaShop, Shopify, Sky-Shop, shopGold). | - | integration articles |
| G-02 | Partial | Per integration "Sposób naliczania rabatów": subtract from product prices or add separate "Rabat" line. A full-price item + 100% discount would become either a 0-priced line or a "Rabat" line. | Not gift-aware. | pomoc/instrukcja-konfiguracji-integracji-sellasist-i-shopgold/ ; pomoc/temu-konfiguracja-integracji/ |
| G-03 | Partial | "Wyrównaj rozbieżności w kwocie do zapłaty": Sellasist corrects the difference between line sum and amount to pay, using the discount line or changing the price of the first unit of one product. | Not gift-aware; correction lands on "first piece". | pomoc/instrukcja-konfiguracji-integracji-sellasist-i-shopgold/ |
| G-04 | Full | Automation adds the promised gift: conditions such as "Źródło zamówienia", product additional field (e.g. "Próbka"), comment phrase, location. | Rule maintenance per promotion. | pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/ ; pomoc/akcje-dla-zamowien-lista-warunkow-i-efektow-omowienie-wraz-z-zastosowaniem/ |
| G-05 | Full | Manual order edit / `POST /orders_lines`; order field "Dodaj gratis" triggers a packer notification; notes templates remind packer. | No explicit "gift shipped" proof beyond pack scan (unverified). | pomoc/pola-dodatkowe-zamowienia-warunek-automatyzacji-akcji-dla-zamowien/ ; pomoc/szablony-notatek/ |
| G-06 | Full | Administracja -> Automatyzacja -> Akcje dla zamówień: condition (e.g. "Wartość zamówienia >= 1000 PLN", "Źródło zamówienia", "Data złożenia", product field) + effect "Dodaj produkt": product, variant, quantity, optional special price, several products per effect, "proportional" quantity per qualifying unit. Action can run only on chosen days/hours. | Once-per-order guarantee and campaign end-date semantics not stated (unverified). | pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/ |
| G-07 | Partial (unverified) | Component price in set is editable, so a 0-priced component is possible. | Not documented as a gift. | pomoc/zestawy-produktow-w-panelu-sellasist/ |
| G-08 | Partial | Effect has "Ignoruj stan magazynowy dodawanego produktu", which implies stock is checked by default. Behaviour when out of stock (skip? fail? log?) not stated. No substitute. | Silent skip risk (unverified). | pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/ |
| G-09 | Full | Product flags "Nie pokazuj w trybie zbierania" / "Nie pokazuj w trybie pakowania"; documented pattern: gift hidden at picking, shown at packing; packing statuses like "Pakowanie z gratisem", "PromocjaABC - dodaj Gratis". | - | pomoc/jak-dodac-opcje-ukrycia-produktu-w-trybie-zbierania-i-pakowania/ ; pomoc/asystent-pakowania-sellasist/ ; pomoc/jak-wlaczyc-tryb-pakowania-w-sellasist-wms/ |
| G-10 | Partial | "Dodaj pozycję rabatującą": gift at its price + one "Rabat" line (-100%), one discount line per VAT rate; name/symbol/EAN of the discount line configurable. Alternative: gift product flagged "Ukryj na dokumentach sprzedaży". | No typed reason (discount-in-goods vs gift), no country policy, no zero-VAT refusal. | pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/ |
| G-11 | None | Not documented. | - | - |
| G-12 | None / Partial | Discount line symbol/EAN usable for further automation; no gift report found. | - | pomoc/dodaj-produkt-efekt-automatyzacji-dla-zamowien/ |
| G-13 | Partial | Product "Opcje" (no stock) can hold "gratisy do wyboru"; dynamic-set choice page could serve as gift choice (inferred). | Options have no stock. | pomoc/czym-sa-opcje-w-produktach-sellasist/ |
| G-14 | Partial | Order field "Pakuj na prezent" or comment phrase "prezent" -> status/notification to packing; Allegro additional services condition. | No first-class gift-wrap entity. | pomoc/pola-dodatkowe-zamowienia-warunek-automatyzacji-akcji-dla-zamowien/ ; pomoc/akcje-dla-zamowien-... |
| G-15 | None | Not documented. | - | - |
| X-01 | Partial | Per integration "Sposób naliczania rabatów": rewrite prices or add "Rabat" line; eBay splits product vs delivery discount and can sum all into one "Rabat"; discount info into comment or a field; rounding differences warned. | Not a neutral list price + reduction per line; the original price is lost in "subtract" mode. | pomoc/instrukcja-konfiguracji-nowego-modulu-integracji-sellasist-i-ebay/ ; pomoc/temu-konfiguracja-integracji/ |
| X-02 | Unknown | Not documented. | - | Kaufland integration article |
| X-03 | Partial | Each integration has "Ustawienia zamówień": discount mode, VAT/SKU/EAN/weight source, default sales document type, auto-link products by identifier, auto-import missing products, which statuses still accept updates. Nothing set- or gift-specific. | - | PrestaShop/Shoper/Kaufland/IdoSell integration articles |

## Integration normalisation
- Sets are normalised at the PRODUCT layer, not the order layer: any channel offer is linked to a Sellasist product; if that product has `as_set=1`, the order line is a set and the split rule turns it into components. The channel never needs to know about components.
- Discounts are normalised per integration with one switch, "Sposób naliczania rabatów" (rewrite line prices vs separate "Rabat" line), plus "Wyrównaj rozbieżności w kwocie do zapłaty" to force line sum = paid amount.
- Line data sources are configurable per integration ("Źródło stawki VAT / Symbol/SKU / EAN / wagi w zamówieniach"), plus default VAT rate and forced document type.
- Imported orders are frozen: after download, cart changes in the shop are not synced (stated in Woo/Shoper/Erli/Magento/... articles). Only payment/buyer/delivery data update, and only in chosen statuses.
- Allegro is special-cased: experimental "Zestawy Allegro" maps Sellasist sets to Allegro product-set offers and back (import matches composition and quantities); "Kup razem" promotional sets are managed separately; dynamic sets go to Allegro as plain offers.
- Gifts are fully OMS-side (automation), independent of channel encoding.

## UX patterns worth copying
- Per-component "price in set" with the set price derived as their sum, and a per-component "Auto. Synchronizacja" toggle to follow the component's list price. This gives a document price split for free.
- "Znajduje się w zestawie" panel on the component card (where-used), with a clear error when an action is impossible.
- Post-purchase variant choice page for the buyer, with an explicit "not chosen yet" order state, reminder automation and manual override.
- Gift line with an automatic balancing "Rabat" line, one per VAT rate, with configurable name/symbol/EAN.
- Separate flags to hide a line from picking and from packing; gifts appear only at the pack station.
- Proportional gift quantity (one sample per qualifying unit) and an explicit "ignore stock" option.

## Anti-patterns
- Split timing doubles as stock timing: component stock changes only when the set is split, and docs encourage delaying the split until after the invoice. Components can be oversold meanwhile (inferred from "Stan magazynowy zmieniają się w momencie rozbicia zestawu").
- Dynamic set never chosen = never split = stock never decremented (stated).
- Gift logic is generic "add product" automation: no gift type, no reason code, no out-of-stock policy, no return handling, no reporting.
- "Subtract from product prices" discount mode destroys the original list price; correction goes to the "first piece".
- Docs contradict each other (see below), and key Allegro set features stay "experimental" for 2+ years.

## Conflicts / open questions
- Static-set article (modified 2025-11-08): "Zestawów utworzonych na Sellasist nie możesz powiązać z zestawami utworzonymi na Allegro." Allegro import article (2026-05-04) offers "Twórz produkty z zestawem Allegro" and "oferta z zestawem Allegro" (experimental). The newer text probably wins; not resolvable without an account.
- Blog (2024) says component prices in a set do not follow later component price changes; help (2024-12) adds "Auto. Synchronizacja".
- "Elementy zestawu" sync is described in opposite ways in jak-dodac-i-skonfigurowac-szablon-ustawien-oferty-allegro/ and jak-wystawic-oferte-allegro-na-licytacje/.
- Automation delay minimum: 5 min in one article, 1 min in another.
- Whether a set has its own VAT rate on a one-line invoice, and whether split lines carry component VAT: not documented.

## Confidence assessment
- High: static/dynamic set model, availability, cost, split automation, gift effect with discount line per VAT rate, pick/pack hide flags, per-integration discount mode.
- Low: Allegro product-set publishing/import details, multipack, mixed VAT on set invoices, out-of-stock gift behaviour.
- Unverified: B-05/B-06/B-10/B-13/B-20/X-02 (no documentation found = Unknown, not proven absent).

## New use cases
- N1 Split as a configurable lifecycle step (keep one line until invoice, explode for picking), separate from stock reservation.
- N2 Buyer chooses variant AFTER purchase via link (choice page), with reminders and an operator override; mix-and-match quantities across variants.
- N3 Set price derived from per-component prices, optionally auto-following component list prices.
- N4 Where-used panel and a rule forbidding nested sets / converting a component into a set.
- N5 Auto-disable a listing when any component hits zero.
- N6 Gift quantity proportional to qualifying units.
- N7 Gift that ignores stock (virtual/backorder samples).
- N8 Hide non-physical or gift lines separately from pick and from pack.
- N9 Order cart frozen after import: a later change in the source (added gift, extra discount) is not reflected.
- N10 Reconcile line sum to amount paid, with a chosen correction strategy.
- N11 Manage marketplace-native bundle promotions (Allegro "Kup razem") from the OMS.
- N12 Import channel bundle offers and match them to OMS bundles by composition and quantities.
