# Phase 2 / Competitor: BaseLinker (base.com), part 1 - bundles, stock, reservations, picking & packing

Researcher 1 of 8. Read-only desk research, 2026-11-04. Sources: base.com help (PL + EN), FAQ, blog,
"Spis aktualizacji" changelog, api.baselinker.com, third-party blogs. No account, no screenshots of the live
panel - everything about the live UI comes from vendor help text. Anything not confirmed by a source is marked
(unverified). Note: help-page fetches were summarised by a fetch tool; short quotes below were requested
verbatim but should be spot-checked before being cited in a public doc.

## 1. Mental model in one paragraph

A BaseLinker "zestaw" is a separate catalogue record ("karta zestawu") in Manager Produktów (BL inventory /
"Katalog") with its OWN SKU, EAN, name, descriptions, parameters, photos and price, plus a list of components
with a quantity each. It has NO stock of its own: its stock is derived as the minimum over components, computed
per warehouse and then summed. It behaves like a normal product for listing/linking (an Allegro offer or a shop
product is linked to the bundle and gets price+stock from it). When an order with a linked bundle arrives, one
global order setting decides whether the bundle line is REPLACED by its components ("rozbijanie zestawów") -
in which case the price difference becomes a discount - or kept as one line while the components still leave
stock. Packing/picking tools only know order lines; bundle awareness at the bench exists mainly through the
split (components become ordinary lines to scan).

## 2. Per-use-case table

| ID | Coverage | How it works for the operator | Limits / edge cases | Source |
|---|---|---|---|---|
| B-01 Define bundle | Full | Two entry points: (a) Produkty tab -> tick products -> "Operacje" -> "Stwórz zestaw z zaznaczonych produktów" -> name -> confirm; (b) Zestawy tab -> add -> name -> add products -> create. Bundle card holds own "opisy, parametry, zdjęcia, SKU, EAN". Per-component quantity ("Każdy zestaw może posiadać różną ilość poszczególnych elementów"). Bulk: CSV (first create the "rodzic", then a 2nd CSV with "składowe zestawu oraz numer ID wcześniej utworzonego rodzica"). Mass creator for variant products ("Przejdź do masowego kreatora zestawów" -> edit name/EAN/SKU, remove components -> "Utwórz zestawy"). API: `addInventoryProduct` `is_bundle` + `bundle_products` {product_id: pieces}. Product card "Powiązania" tab shows system relations "Zestaw" / "Część zestawu" (EN "Bundle"/"Part of the bundle"). Zestawy list filters: number of components (12/2024), "EAN elementu" = which bundles contain X (02/2026). | No bundle inside bundle: API "relationships between two bundles are not allowed". Relations of type bundle cannot be edited from the Powiązania tab, only by editing the bundle. | https://base.com/pl-PL/pomoc/wiedza/zestawy/ ; https://base.com/en-EN/help/knowledgebase/bundles/ ; https://base.com/pl-PL/pomoc/wiedza/masowe-tworzenie-zestawow/ ; https://base.com/pl-PL/pomoc/faq/magazyn-bl/ ; https://api.baselinker.com/index.php?method=addInventoryProduct ; https://base.com/en-EN/help/knowledgebase/product-relationships/ ; https://base.com/pl-PL/blog/spis-aktualizacji-grudzien-2024/ ; https://base.com/pl-PL/blog/spis-aktualizacji-luty-2026/ |
| B-02 Availability = min, republish | Full | "Stan magazynowy zestawu jest równy najniższemu stanowi produktu wchodzącego w skład zestawu." Linked offers get stock (and price) from the bundle like any product, so selling a component on its own lowers every bundle containing it on the next sync. Multi-warehouse: "obliczamy stan zestawu osobno dla każdego magazynu, a następnie to sumujemy." | Help text says "lowest stock of a component"; whether it divides by component quantity (2 pcs per kit) is not stated (unverified, almost certainly yes). Whether reserved component units reduce the bundle figure shown is not stated (unverified). | same as B-01 + https://base.com/pl-PL/pomoc/faq/magazyn-bl/ |
| B-03 Pre-built kit with own stock | None (native) | A zestaw has no stock of its own. A sealed gift box would be modelled as an ordinary product with its own stock (unverified workaround). No assembly/production document (RW components -> PW kit) found for bundles. | Operator must choose: virtual bundle OR plain product; no "both" mode found. | https://base.com/pl-PL/pomoc/wiedza/zestawy/ ; search on dokumenty magazynowe found nothing bundle-specific |
| B-04 Order arrives parent-only | Full | Marketplace offer / shop product linked to the BL bundle. Setting "Zamówienia -> Ustawienia -> Obsługa zamówień" (EN "Order -> Settings -> Order processing"): split ON -> "wszystkie składniki zestawu pojawią się w zamówieniu zamiast zakupionej oferty"; split OFF -> one bundle line, "odpowiednie składniki zestawu zejdą ze stanu". Applies to manual orders too. Price: "If the kit is broken into separate products when the order is retrieved, this difference will be displayed as a discount." API `getOrders` products carry `bundle_id` = "ID of the bundle that was split to acquire this order item" (0 if not from a split). Deferred split: automatic action "Rozbij zestawy" (09/2022) and trigger event "Zestaw został rozbity" (06/2026). | Only bundles defined in the BL catalogue ("Opcja ma zastosowanie tylko w przypadku zestawów zdefiniowanych w katalogu Baselinker"). Shop orders: split works only with correct linking AND "synchronizacja stanów z Base.com do sklepu" enabled. Global switch, not per channel (unverified whether per-source override exists). | https://base.com/en-EN/help/knowledgebase/bundles/ ; https://base.com/pl-PL/pomoc/faq/manager-zamowien/zamowienia/karta-zamowienia/ ; https://api.baselinker.com/index.php?method=getOrders ; https://budowanie-sklepu.pl/menadzer-produktow-baselinker-nowe-moduly-i-funkcje-instrukcja-z-komentarzem-2-2/ ; https://base.com/pl-PL/blog/spis-aktualizacji-czerwiec-2026/ |
| B-05 Parent + children | Unknown | Shoper/WooCommerce sets are now imported AS sets into the catalogue (07/2025, 03/2026), but how an incoming order that carries both container and child rows is de-duplicated is not documented (unverified). | Risk of double count not addressed in any source found. | https://base.com/pl-PL/blog/spis-aktualizacji-lipiec-2025/ ; https://base.com/pl-PL/blog/spis-aktualizacji-marzec-2026/ |
| B-06 Children-only grouped | Unknown | Nothing found. | | - |
| B-07 Offer bundle (discount group) | Unknown / likely None | No Base help on Allegro "zestawy ofert"; lines presumably arrive as separate products with their own prices (unverified). | | search results only Comarch eSale |
| B-08 Multipack | Full (as model) | Bundle with one component and quantity N (API value = "number of pieces"). Offer linked to that bundle. | Linking an Allegro "wielopak" specifically not documented (unverified). | https://api.baselinker.com/index.php?method=addInventoryProduct ; masowe-tworzenie-zestawow |
| B-09 Buyer choice per slot | Partial | No dynamic slots. Workaround is the mass creator: every combination becomes its own bundle ("2 produkty po 3 warianty -> 9 zestawów"), each linkable to a variant offer (unverified mapping). Price via "Bazuj na grupach cenowych" or "Zsumuj ceny produktów" + "mnożnik ceny" + "dodaj do ceny". | Combinatorial explosion of SKUs. | https://base.com/pl-PL/pomoc/wiedza/masowe-tworzenie-zestawow/ |
| B-10 Contents snapshot | Partial | With split ON the components are written into the order as lines (de facto snapshot) and keep `bundle_id`. With split OFF one line stays; whether later definition edits change what is deducted at fulfilment is not stated (unverified). | | getOrders docs |
| B-11 Pack bench | Partial | Asystent Pakowania ("Zbieraj produkty", "Pakuj", "Dobierz zamówienia"): scan order/parcel code, then EAN/SKU marks 1 unit; colours white/yellow/green, red + sound on over-pack; "Oznacz jako spakowane"; photo after last item; "Produkty domyślnie zebrane/spakowane" auto-marks non-physical lines (e.g. discount). Vendor sector page: "Skanowanie każdego elementu zestawu podczas kompletacji" and "System nie pozwala zamknąć paczki, dopóki brakuje elementu zestawu". New "Elementy zestawu" section + export tags `[element_zestawu_ean|sku|nazwa|id|ilosc|zdjecie]` (05/2026). | Bench works on lines: component scanning effectively needs split ON. Whether the packer sees "this line came from bundle X" grouping is not documented (unverified). 2018 vendor reply: scanning is EAN-based, internal-code bundles problematic, "Być może sprawa rozwiąże się w przyszłości, jeśli w BaseLinkerze pojawi się wbudowana obsługa zestawów". One order cannot be packed on two stations at once. | https://base.com/pl-PL/pomoc/wiedza/asystent-pakowania/ ; https://base.com/pl-PL/pomoc/wiedza/pakowanie-i-zbieranie-zamowien/ ; https://base.com/pl-PL/branza/dziecko/ ; https://base.com/pl-PL/blog/asystent-pakowania-kontrolowanie-procesu-pakowania/ ; https://base.com/pl-PL/blog/spis-aktualizacji-maj-2026/ |
| B-12 Component OOS | Partial (generic) | No bundle-specific shortage flow. Generic tools: "Rozdziel zamówienie" on the order card (choose products + shipping method/price per resulting order); FAQ workaround "zduplikować istniejące zamówienie i usunąć z obu zamówień wybrane pozycje"; bench refuses to close with missing component. Substitution ("podmiana na odpowiednik z zapisem w logu") was a user request, not a feature. | Hold/substitute/backorder not modelled. | https://base.com/pl-PL/pomoc/wiedza/karta-zamowien/ ; karta-zamowienia FAQ ; asystent-pakowania-kontrolowanie-procesu-pakowania |
| B-13 Components in different warehouses | Partial | Bundle stock summed per warehouse; orders deduct from the account's "magazyn źródłowy" (set in marketplace listing settings) or "w pierwszej kolejności z magazynu z największą dostępną liczbą produktów"; no fixed priority order X then Y. Order line has `warehouse_id`. | No component-level routing into separate shipments found (unverified). | https://base.com/pl-PL/pomoc/faq/magazyn-bl/ ; https://base.com/pl-PL/pomoc/faq/manager-zamowien/zamowienia/ |
| B-14 Documents | Partial | Split ON -> component lines + price difference "displayed as a discount"; split OFF -> single line. Manual discounts are added as an extra negative-price line ("Dodanie rabatu jako kolejną pozycję w zamówieniu"). | How the discount is allocated across VAT rates is not documented (unverified) - mixed-rate kits are exactly the risk. | bundles help ; karta-zamowienia FAQ |
| B-15 Return of one component | Partial (generic) | Asystent Zwrotów lets you split a return line by quantity; receiving warehouse follows the "Status pozycji zwrotu"; "Przyjęto" fires automation (correction + refund + Allegro commission claim). Component-level return realistic only if the order was split (unverified). Lost-bundle-discount recalculation: nothing found. | | https://base.com/pl-PL/pomoc/wiedza/asystent-zwrotow/ (via search) |
| B-16 Bundle cost/margin | Unknown | Base Analytics (Zamówienia -> Statystyki) reports purchase cost and gross margin per channel/product; API exposes `average_cost`, `average_landed_cost` per product. Whether a bundle's cost = sum of component costs is not documented (unverified). | | https://base.com/pl-PL/funkcje/base-analytics/ ; getInventoryProductsData |
| B-17 Publish bundle as listing | Full | "Bundles appear when picking products for listing"; a linked offer syncs price and stock from the bundle. Product export to URL can contain "produkty lub zestawy". | | bundles help ; https://base.com/pl-PL/blog/piec-mniej-znanych-funkcji-baselinkera/ |
| B-18 Import bundle definitions | Full (selected platforms) | Imported as sets: Shoper (07/2025), WooCommerce incl. components (03/2026), Upgates/VTEX with `include_bundles` (06/2026), Unas (07/2026), HostGator (08/2026), InsERT Nexo with option "traktuj jako zestawy" (off -> imported as plain products). PrestaShop packs, IdoSell, Subiekt GT komplety: not found (unverified). Pain: a third-party author says shop-card bundles had to be taken apart and rebuilt in BL ("musimy rozbijać i łączyć na nowo") to keep stock right. | | changelogs listed ; https://budowanie-sklepu.pl/scalanie-magazynow-automatyzacja-kontroli-stanow-problematyka-synchronizacji-menager-baselinker/ |
| G-07 Gift as bundle component | Partial (unverified) | Bundle price is independent of components, so a 0-value component works in the model; when split the gap shows as discount. Not documented as a gift pattern. | | bundles help |
| X-01 Neutral list price + discount | Partial | Split difference = discount; manual discount = negative line. No per-line "list price + rebate" model found. | | bundles help ; karta-zamowienia FAQ |
| X-02 Kaufland N units | Unknown | not researched in this part | | - |

## 3. Reservations (context for B-02/B-12)

- Enable per catalogue: "Produkty -> Ustawienia -> Katalogi -> edytuj -> Rezerwacja stanów". Products of an imported
  order are reserved at once; stock leaves at "moment realizacji" (default: confirmation), configurable under
  "Stany magazynowe – moment realizacji" in order settings.
- UI: reserved count shown "w nawiasie" in the "Stan" column; "Rezerwacje" tab on the product (logs + manual add);
  "Sprzedaż i magazyn" tab shows reserved per warehouse; order card says reserved vs fulfilled; advanced order
  search filters reserved/fulfilled/cancelled. Adding/removing order items updates the catalogue.
- Stocktaking: "Inwentaryzacja nie usuwa rezerwacji z zamówień, ale koryguje dostępny stan."
- Third-party: reservation auto-released if unpaid after N days (e.g. 5) - (unverified, unofficial blog).
- Strict mode "Dokumenty magazynowe – ścisła kontrola": stock changes only via documents (WZ/PZ/PW/RW).
- Bundle-specific reservation behaviour: not documented (unverified).
Sources: https://base.com/pl-PL/pomoc/wiedza/rezerwacje/ ; https://base.com/pl-PL/pomoc/faq/magazyn-bl/

## 4. Picking & packing details (context for B-11)

- Settings: "Zamówienia -> Ustawienia -> Zbieranie/Pakowanie" sections "Ustawienia ogólne, Zbieranie, Pakowanie,
  Stanowiska, Koszyki, Kartony". Options e.g. "Przechodź do następnego zamówienia automatycznie", "Przenoś zebrane
  produkty na dół listy", "Skanowanie koszyków", "Produkty domyślnie zebrane/spakowane".
- Batch picking on one shared product list; baskets/compartments with barcodes; sort by location
  (e.g. "A1-3-12"); location must be confirmed/scanned per picked item (WMS advanced mode, location priority field).
- Picking templates ("Szablony dobierania") by employee/shipping method/status; single-item orders first; own barcode per template.
- Carton suggestion from dimensions, with layout visualisation; photo of parcel saved to order history.
- Packer view intentionally hides prices (2018: "Wydawało nam się to informacją niepotrzebną dla osoby pakującej");
  order value can later be shown per role config.
- Packing log: who, when, how long.
Sources: asystent-pakowania, pakowanie-i-zbieranie-zamowien, asystent-pakowania-2-0 blog, rozbudowane-zbieranie blog,
system-zarzadzania-magazynem-wms help.

## 5. UX patterns worth copying

1. Bundle is a first-class catalogue card with its own SKU/EAN/photos/price, created from a multi-select on the product list ("Stwórz zestaw z zaznaczonych produktów") - zero navigation to start.
2. Reverse lookup: filter bundles by component EAN, and system-generated "Zestaw" / "Część zestawu" relations on every product card (read-only there, edited only on the bundle).
3. Explicit, operator-visible switch for "split into components on import" + split lines remember their parent (`bundle_id`) + a deferred "Rozbij zestawy" action and a "Zestaw został rozbity" trigger for automation.
4. Price gap between bundle and component prices becomes an explicit discount, not silently absorbed.
5. Multi-warehouse rule stated in one sentence (compute per warehouse, then sum) - avoids phantom stock from mixing warehouses.
6. Mass "every combination" bundle generator with a price formula (sum x multiplier + add) for variant products.

## 6. Anti-patterns / complaints

1. Global split switch: either the order shows the bundle (packer cannot scan components) or only components (customer-facing line and listing context lost); no "show both" model documented.
2. Shop-order splitting silently depends on enabling stock sync BL -> shop; a merchant who only wants splitting must change stock authority.
3. No own-stock / pre-assembled kit mode; no hold/substitute/partial for a missing component; order split is a manual "duplicate and delete lines" or "Rozdziel zamówienie".
4. Long history of bundles being bolted on: 2018 vendor admitted no built-in bundle support for scanning; merchants had to rebuild shop bundles in BL by hand; per-platform bundle import trickled in 2025-2026.
5. VAT/discount allocation for mixed-rate bundles and component returns are undocumented - operator has to trust or check.

## 7. New use cases not in the catalogue

- N-01 Bundle-in-bundle refused by design (API: "relationships between two bundles are not allowed") - decide our rule.
- N-02 Reverse lookup "which bundles contain component X" (filter "EAN elementu") and impact view when a component goes OOS.
- N-03 Generate bundle combinations in bulk from variant products with a price formula.
- N-04 Deferred / automation-driven split of a bundle on an existing order + an event "bundle split" for automations.
- N-05 Non-physical order lines (discount, gift note) pre-marked as packed so the bench does not wait on them ("Produkty domyślnie zebrane/spakowane").
- N-06 Bundle element fields in product exports/feeds ([element_zestawu_*] tags).
- N-07 Import of channel-defined sets with an opt-out ("traktuj jako zestawy" off -> plain product).

## 8. Source list

- https://base.com/pl-PL/pomoc/wiedza/zestawy/
- https://base.com/en-EN/help/knowledgebase/bundles/
- https://base.com/pl-PL/pomoc/wiedza/masowe-tworzenie-zestawow/
- https://base.com/pl-PL/pomoc/faq/magazyn-bl/
- https://base.com/en-EN/help/knowledgebase/product-relationships/
- https://base.com/pl-PL/pomoc/wiedza/rezerwacje/
- https://base.com/pl-PL/pomoc/faq/manager-zamowien/zamowienia/
- https://base.com/pl-PL/pomoc/faq/manager-zamowien/zamowienia/karta-zamowienia/
- https://base.com/pl-PL/pomoc/wiedza/karta-zamowien/
- https://base.com/pl-PL/pomoc/wiedza/asystent-pakowania/
- https://base.com/pl-PL/pomoc/wiedza/pakowanie-i-zbieranie-zamowien/
- https://base.com/pl-PL/pomoc/wiedza/asystent-pakowania-najczestsze-pytania/
- https://base.com/pl-PL/pomoc/wiedza/system-zarzadzania-magazynem-wms/
- https://base.com/pl-PL/pomoc/wiedza/asystent-zwrotow/ (via search snippet)
- https://base.com/pl-PL/branza/dziecko/
- https://base.com/pl-PL/blog/nowy-magazyn-przeglad-funkcji/
- https://base.com/pl-PL/blog/asystent-pakowania-kontrolowanie-procesu-pakowania/ (2018, comments)
- https://base.com/pl-PL/blog/asystent-pakowania-2-0-nowe-mozliwosci-zbierania-i-pakowania-zamowien/
- https://base.com/pl-PL/blog/rozbudowane-zbieranie-zamowien-nowosc-w-asystencie-zbierania-i-pakowania/
- https://base.com/pl-PL/blog/spis-aktualizacji-grudzien-2024/ , -lipiec-2025/ , -luty-2026/ , -marzec-2026/ , -maj-2026/ , -czerwiec-2026/
- https://base.com/pl-PL/blog/piec-mniej-znanych-funkcji-baselinkera/
- https://base.com/pl-PL/funkcje/base-analytics/
- https://api.baselinker.com/index.php?method=addInventoryProduct
- https://api.baselinker.com/index.php?method=getInventoryProductsData
- https://api.baselinker.com/index.php?method=getOrders
- https://budowanie-sklepu.pl/menadzer-produktow-baselinker-nowe-moduly-i-funkcje-instrukcja-z-komentarzem-2-2/
- https://budowanie-sklepu.pl/scalanie-magazynow-automatyzacja-kontroli-stanow-problematyka-synchronizacji-menager-baselinker/
- "Rozbij zestawy" action (09/2022) - from search snippet of a 2022 changelog, page not opened (treat as unverified detail)
