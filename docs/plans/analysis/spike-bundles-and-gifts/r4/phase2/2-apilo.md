# R4 phase 2 - Competitor: Apilo (bundles and gifts), primary sources only

Accessed 2026-11-04. Method: downloaded the full help sitemap (`https://apilo.com/help-sitemap.xml`, 166 articles), every help article body, all 20 feature pages (`https://apilo.com/function-sitemap.xml`), the embedded OpenAPI documents of REST API 2.0.0.9 / 2.0.0.11 / 2.0.0.12 / 2.0.0.13 and 3.0.0.0-alpha from `https://developer.apilo.cloud/api/<version>`, and the 2.0.0.13 changelog. The three screenshots of the bundle article were downloaded and viewed. Text was searched for `zestaw`, `gratis`, `komplet`, `rabat`, `zniżk`, `promocj`, `bundle`, `set`, `gift`, `discount`, `0,01`.

## Sources (all primary, Apilo-owned)

| ID | Source | Kind | Last modified (from page JSON-LD) |
|---|---|---|---|
| S1 | https://apilo.com/pl/help/zestaw-produktow-do-czego-sluzy-i-jak-utworzyc/ | official help article | 2025-07-25 (published 2022-03-25) |
| S1-img1/2/3 | https://developer.apilo.com/uploads/media/help/zestaw/zestaw1.png, zestaw2.png, zestaw3.png | official screenshots in S1 | - |
| S2 | https://apilo.com/pl/help/relacje-produktow-do-czego-sluza-i-jak-korzystac/ | official help | 2025-11-27 |
| S3 | https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/ | official feature page | 2026-05-27 |
| S4 | https://apilo.com/pl/help/zadania-automatyczne/ | official help | - |
| S5 | https://apilo.com/pl/help/asystent-zbierania/ | official help | 2026-05-15 |
| S6 | https://apilo.com/pl/help/asystent-pakowania/ | official help | 2026-05-15 |
| S7 | https://developer.apilo.cloud/api/2.0.0.13 (embedded OpenAPI 3.0.0, `info.version` 2.0.0.13) | official API spec | - |
| S8 | https://developer.apilo.cloud/api/3.0.0.0 (v3 alpha, 6 paths) | official API spec | - |
| S9 | https://apilo.com/pl/help/konfiguracja-modulu-fakturowania-paragonow/ | official help | 2026-04-01 |
| S10 | https://apilo.com/pl/help/dodawanie-produktow-do-magazynu-manualnie/ | official help | 2025-03-13 |
| S11 | https://apilo.com/pl/help/polaczenie-z-shopify/ | official help (FAQ) | 2026-03-04 |
| S12 | https://apilo.com/pl/help/polaczenie-z-shoper/ | official help (FAQ) | 2026-11-02 |
| S13 | https://apilo.com/pl/help/polaczenie-z-tiktok-shop/ | official help | 2026-06-15 |
| S14 | https://apilo.com/pl/help/integracja-z-inpost-von-halsky/ | official help | 2026-07-06 |
| S15 | https://apilo.com/pl/help/jak-dodac-nowego-uzytkownika-z-wlasnym-haslem-i-uprawnieniami/ | official help | - |
| S16 | https://apilo.com/pl/help/apilo-zwroty/ | official help | - |
| S17 | https://apilo.com/pl/tworzenie-zestawow-produktow-w-apilo-czyli-jak-rozkrecic-sprzedaz-allegro-i-na-innych-kanalach-sprzedazy/ | vendor's own blog (first-party, marketing tone; used only to date the feature) | published 2019-03-15 |

Weighting: S1-S16 are first-party documentation. S17 is first-party but marketing; it only repeats S1 and is used for dating (sets "od początku tego miesiąca dostępne", March 2019). No third-party material used.

## How Apilo models bundles and gifts (summary of evidence)

1. **A set ("Zestaw produktów") is a product type in the Apilo warehouse.** S10: "W prawym górnym rogu +Dodaj →  Towar, Wysyłkę, Usługę lub Zestaw Produktów" and "Typ produktu – Domyślną wartością jest wcześniejszy wybór – towar, usługa, wysyłka lub zestaw produktów". Screen S1-img1 (Towary i usługi > Produkty > Dodaj produkt): fields Nazwa*, EAN, SKU*, Waga, Typ* = "Zestaw produktów", Status produktu, Kategorie; right panel "Produkty w zestawie" with button "Dodaj" and a table: Lp., image, "Nazwa, ean/sku", "Ilość w zestawie" (spinner), "Cena brutto produktu" (read-only, e.g. 64.32 PLN), "Cena brutto w zestawie" (editable, e.g. 32,64 PLN), "Stan" (13 / 3), remove "x". Footer row shows sum 80.64 PLN vs 40.96 PLN "-49.21%" and set stock 3 (= min of 13 and 3).
2. **At order processing the set line is replaced by component lines.** S1: "System Apilo automatycznie rozdzieli produkt zestawowy. Na liście pozycji zamówienia będą widoczne pojedyncze produkty wchodzące w skład zestawu". Origin marker: S1 "Informacja o tym, że pozycja zamówienia została utworzona na podstawie zestawu widnieje jako ikonka 2 kwadratów na liście produktów zamówienia." Screen S1-img3 (order "Pozycje 2"): columns Lp., Nazwa, SKU / EAN, Ilość, Cena netto, Stawka VAT, Cena brutto, Suma; both lines carry the two-squares icon labelled "Produkty na podstawie zestawu", each with its own VAT 23% and own price.
3. **Price split rule.** S1: "jeśli cena zestawu w pozycji zamówienia różni się od ceny zestawu w magazynie Apilo to zostanie ona proporcjonalnie przeliczona, by odpowiadała pozycji w zamówieniu". The split basis is the operator-entered "Cena brutto w zestawie" per component (S1-img1).
4. **Stock.** S1: "stan magazynowy zestawu produktów będzie obliczany na podstawie dostępności najniższego stanem produktu" and "stan magazynowy zestawu produktów jest przeliczany co 15 minut."
5. **Linking channel offers to a set** goes through the generic "Relacje produktów" screen (S1 "Wariant 1: Użyj zakładki Towary i usługi > Relacje produktów, aby podłączyć zestaw pod istniejącą aukcję/ofertę."), auto-matched by SKU then EAN then name (S2 "kodu produktu / SKU. W Allegro SKU to Sygnatura Aukcji", "kodu EAN (jeśli powiązanie po kodzie SKU nie zostanie znalezione)", "nazwy (jeśli powiązanie po kodzie SKU i EAN nie zostanie znalezione)") or manually ("Połącz").
6. **Gift = a set component, or a product added by an automation rule.** S1 "stwórz zestaw z gratisem (np. produkt „Czapka” oraz „Szal” połącz w zestaw „Czapka + szalik gratis”)". S3 action: "Dodanie produktów do zamówienia ... Ustaw warunki (np. wartość zamówienia > 200 zł), które muszą być spełnione, aby system automatycznie dodał do zamówienia określony produkt (np. gratis)". No gift flag exists anywhere in the API order-item schema (S7, below).
7. **API exposure.** S7 `RestOrderItemsDTO2` (used by `GET /rest/api/orders/{id}/` -> `RestOrderDetailDTO.orderItems`) has `"productSet": {"description": "Product Set", "type": "integer", "nullable": true}` and `"type": ... "Order item type (`1-Product`, `2-Shipment`, `3-service`)"`. `productSet` is absent from the list DTO (`RestOrderItemsDTO3`) and from the write DTO (`RestOrderItemsDTO`). Order-level discounts: `RestOrderDiscountDTO` `"type": "Discount type. 1 - product, 2 - shipment"`, `"discountValue": "Discount value"`, `"note": "Additional information about discount"` (maxLength 64), no link to a line. Warehouse product schemas (`ProductDetailModel`, `Products`, `ProductPut`) carry no type and no component list, so set definitions are not readable or writable through API 2.0.0.13 (searched all 53 paths). v3 alpha (S8) has only token, events, bulk order status, version, whoami.

## Rating per use case

Vocabulary: Full / Partial / None / Unknown. "Unknown" = no primary source found after searching the whole help corpus and API spec.

### Bundles

| ID | Rating | How it works for the operator | Evidence |
|---|---|---|---|
| B-01 | Full | Towary i usługi > Produkty > +Dodaj > "Zestaw produktów"; name + SKU required; add components via "Znajdź produkt" modal (S1-img2: search by "Nazwa produktu, EAN/SKU/KOD", Kategorie, Marka, Status, green "+"); edit "Ilość w zestawie" and price per component. | S1: "W prawym górnym rogu +Dodaj > Zestaw produktów." / "w tabeli produktów znajdujących się w zestawie możesz zmienić ilość i cenę." |
| B-02 | Partial | Set stock = minimum over components, then pushed to all linked offers via Relacje sync. Shared components work implicitly (each component is an ordinary warehouse item). Not "at once": recomputed every 15 minutes, so a component sale is reflected in set stock with up to 15 min lag (oversell window). Min is not divided by component quantity in the docs wording (screenshot only has qty 1). | S1: "obliczany na podstawie dostępności najniższego stanem produktu" / "przeliczany co 15 minut". S2: "modyfikacja ilości/ceny w Apilo ... = zmiana na wszystkich platformach". |
| B-03 | Partial | Virtual set has no stock of its own (computed). A pre-built kit with its own stock is simply a normal "Towar". No documented assembly/disassembly between the two. | S1 stock quotes above; S10 product types. No source for kitting. |
| B-04 | Full | Any channel: offer linked (SKU/EAN/name or manual) to a set product; on import the set line is replaced by components. Retrofit path: "Zmień Produkt na zestaw" on an already-imported product. | S1: "System Apilo automatycznie rozdzieli produkt zestawowy." / "Kliknij przycisk „Zmień Produkt na zestaw”." |
| B-05 | Unknown | No documentation of parent+children orders (Woo bundle plugins, Shoper) or de-duplication. | No primary source. |
| B-06 | Unknown | No documentation of grouped child lines (Shopify lineItemGroup, IdoSell bundleId). | No primary source. |
| B-07 | Unknown | Allegro flexible bundles not documented. Only order-level discounts in API, typed product/shipment, not linked to lines. | S7 `RestOrderDiscountDTO` "Discount type. 1 - product, 2 - shipment". |
| B-08 | Partial | Multipack = set with one component and quantity N (example: cable sold in metres, "Kabel RJ-45 5m" = 5 x component). Mapping to Allegro productSet quantity N not documented. | S1: "Możesz utworzyć zestaw „Kabel RJ-45 5m”, który będzie składał się z 5 sztuk „Kabel RJ-45”". |
| B-09 | Unknown | No buyer-choice slots. | No primary source. |
| B-10 | Partial | Components are written as order lines at processing time, which is a de-facto snapshot (inferred, not stated). Set definition changes after import are not documented either way. | S1 "Na liście pozycji zamówienia będą widoczne pojedyncze produkty". Snapshot semantics (unverified). |
| B-11 | Partial | Order shows only component lines with a two-squares icon; picking/packing assistants scan component EANs line by line. The parent set (name, qty) is not shown as a line. No packing-slip documentation. | S1 "ikonka 2 kwadratów"; S1-img3 label "Produkty na podstawie zestawu"; S6 "Skanowanie kodu kreskowego produktu podnosi ilość spakowanych towarów o +1." |
| B-12 | Partial | Generic only: picking/packing raise a "Brak stanu" event usable in automation (tag/status). No bundle-specific hold/substitute/split. | S3 event list "Brak stanu"; S6 "zdarzenia: „rozpoczęto pakowanie”, „zakończono pakowanie” lub „brak stanu”." |
| B-13 | Unknown | No multi-warehouse bundle documentation. | No primary source. |
| B-14 | Partial | Documents are built from order lines, so a set appears as component lines each with its own VAT (S1-img3). Price split = operator's "Cena brutto w zestawie", scaled proportionally to the actual paid set price. Not by individual selling prices, no cap at a component's own price. VAT falls back to product card when channel sends none. | S1 "zostanie ona proporcjonalnie przeliczona"; S9 "Jeśli kanał sprzedaży przy pozycjach zamówienia nie zwróci VAT, podatek pobierany jest z karty produktu". Link "invoice from component lines" is inferred from S9 + S1. |
| B-15 | Unknown | Returns are an external module (Alsendo/apaczka panel); corrections are manual per invoice line ("zmień ilość na 0"). No lost-bundle-discount logic. | S16 "Dzięki integracji z Alsendo..."; S9 "jeśli chcesz anulować sprzedaż wybranej pozycji – zmień ilość na 0". |
| B-16 | Unknown | No cost price / margin per set documented (Moduł cenników is selling-price markup, not cost). | No primary source. |
| B-17 | Partial | A set can be listed via Manager Allegro or Shoper as a product. Other channels: link an existing offer via Relacje. | S1 "Wariant 3: Użyj Managera aukcji Allegro lub Shoper aby wystawić produkt zestawowy." |
| B-18 | Unknown | Only manual: create set or convert an imported product. Import of PrestaShop packs / Shoper/IdoSell sets / Subiekt komplety not documented. | S1 "Ważne: jeśli w Towary i usługi > Produkty nie znajdują się pojedyncze pozycje ... musisz dodać nowe produkty". |
| B-19 | Unknown | No per-channel parent/child price handling. | No primary source. |
| B-20 | Unknown | ERP/accounting-as-master setups (Subiekt, Fakturownia, wFirma) are documented without any mention of sets. | No primary source. |
| B-21 | Unknown | No split-shipment-of-bundle documentation. | No primary source. |

### Gifts

| ID | Rating | How | Evidence |
|---|---|---|---|
| G-01 | None (in API) | Order item has no gift flag; only `type` product/shipment/service. UI not documented. | S7 `type` "Order item type (`1-Product`, `2-Shipment`, `3-service`)". |
| G-02 | Unknown | Not documented. | No primary source. |
| G-03 | Unknown | Not documented. | No primary source. |
| G-04 | Full | Convert the listing's product into a set and add the promised gift as a component, so the gift is added to every order and its stock is controlled. | S1: "na allegro znajduje się aukcja „plecak szkolny”. Jako promocję chcesz dołączyć do każdego sprzedanego plecaka piórnik. Przekształć produkt na zestaw". |
| G-05 | Partial | Operator edits an order and adds a line (or adds a set). Line is not marked as a gift. | S1 "Wariant 2: Tworząc nowe zamówienie lub edytując istniejące skorzystaj z edycji/dodawania pozycji w zamówieniu." |
| G-06 | Partial | Automation (Administracja > Zadania automatyczne): event (e.g. "Utworzenie/pobranie zamówienia") + conditions (e.g. "Wartość zamówienia", "Produkty na zamówieniu z EAN", "Metody na zamówieniu z SKU", "Źródło kanału sprzedaży", "Data złożenia zamówienia", "Czy wykorzystano kupon rabatowy?") + action "Dodaj produkt do zamówienia". Once-per-order and campaign windows are not documented as such; no gift marker. | S3: "aby system automatycznie dodał do zamówienia określony produkt (np. gratis)". |
| G-07 | Full | Gift as a set component. | S1: "stwórz zestaw z gratisem (np. produkt „Czapka” oraz „Szal” połącz w zestaw „Czapka + szalik gratis”)". |
| G-08 | Unknown | No substitute/stop logic; set stock goes to 0 when the gift component runs out, which ends the offer (side effect, not a gift policy). | S2 "jeśli ilość ... wynosi 0 = wycofanie produktów ze sprzedaży". |
| G-09 | Partial | Gift component is a normal line on picking/packing. Separately a static picker message with forced acknowledgement, example "dodaj gratis do zamówienia" (global setting, not per order or per rule). | S5: "Komunikat dla okna zbierania- komunikat, który ma zostać wyświetlony osobie zbierającej zamówienie np. “dodaj gratis do zamówienia” itp. Ważne! Po dodaniu wiadomości osoba zbierająca będzie musiała ją zatwierdzić". |
| G-10 | Unknown | In-set price can be edited per component (could be set low), but zero-price/rebate representation on invoice/receipt is not documented. An automation action "Modyfikacja stawki VAT" exists. | S3 action list "Modyfikacja stawki VAT". |
| G-11 | Unknown | Not documented. | No primary source. |
| G-12 | Unknown | Reports documented by days and channels only. | No primary source. |
| G-13 | Unknown | Not documented. | No primary source. |
| G-14 | Partial | Automation condition on service lines, example "zapakuj na prezent w Allegro". | S3: "Pozycje na zamówieniu o typie "Usługa" np. usługa - zapakuj na prezent w Allegro". |
| G-15 | Unknown | Not documented. | No primary source. |
| G-16 | Unknown | Not documented. | No primary source. |

### Cross-cutting

| ID | Rating | How | Evidence |
|---|---|---|---|
| X-01 | Partial | Order-level discounts list (product/shipment) without line link. Shopify: discount distributed across items, shipping excluded. Set price differences distributed proportionally across components. | S7 RestOrderDiscountDTO; S11: "Rabat rozbijany jest tylko na przedmioty."; S1 proportional rule. |
| X-02 | Partial | Some channels have a per-integration "Strategia importu przedmiotów zamówienia" (TikTok Shop, InPost Von Halsky). Kaufland not documented. | S13: "Strategia importu przedmiotów zamówienia– Wybierz strategię importowania pozycji zamówienia. TikTokShop dostarcza pozycje oddzielnie"; S14: "Inpost Von Halsky domyślnie rozdziela każdą pozycję osobno". |
| X-03 | Partial | Per-channel settings exist (item import strategy, VAT default "Taki sam jak na zamówieniu" with product-card fallback, Shopify discount strategy, linking identifier for Empik), but none declares "this channel sends children / prices on parent / gift flag". | S13, S14, S9, S11. |
| X-04 | Partial | Operator edits lines in Apilo; Shoper back-office line edits sync into Apilo. Whether a set added after import is expanded is not documented. | S1 Wariant 2; S12: "Zmiany wprowadzone w produktach w zamówieniu w Shoper, powodują automatyczną aktualizację pozycji w Apilo." |
| X-05 | Unknown | Not documented (Shopify gift-card orders only: fetched if "Pobieraj zamówienia zrealizowane" = Tak). | S11: "W przypadku kart podarunkowych ... status zamówienia automatycznie jest zmieniany na "Zrealizowane"." |
| X-06 | Partial | Order "Historia Zmian" lists users who edited an order; no per-line before/after discount trail documented. | S15: "w zakładce Historia Zmian widoczna jest lista użytkowników, którzy zajmowali się obsługą i edycją tego zamówienia." |

## Integration normalisation

- **One normalisation point: the Apilo warehouse product.** Every channel offer is mapped to a warehouse item in "Relacje produktów"; a set is just a warehouse item of type "Zestaw produktów", so expansion is channel-agnostic. (S2, S1 Wariant 1.)
- **Matching cascade SKU -> EAN -> name, then manual "Połącz"**, with filter "Czy powiązano" and column "Rodzaj połączenia" (automatic vs manual). Name fallback is explicitly a source of wrong links (S2: "Dobrą praktyką jest porównanie nazw ... wyśledzisz ewentualne błędne połączenia").
- **No connector-declared bundle/gift capabilities.** No help article for any channel (Allegro, Shopify, WooCommerce, PrestaShop, Shoper, IdoSell, Erli, Kaufland, Amazon, Empik) mentions how that channel encodes bundles or gifts. Channel-specific behaviour is only implied by generic settings.
- **Per-channel settings that touch line shape:** "Strategia importu przedmiotów zamówienia" (TikTok Shop S13, InPost Von Halsky S14); "Strategia metod dostawy" (Shopify S11); Shopify discount distribution "tylko na przedmioty" (S11); "Domyślny VAT na pozycjach zamówienia" with fallback to product card (S9); Empik "Domyślny identyfikator łączenia ofert" (help polaczenie-z-empik: "Według wybranego identyfikatora Apilo będzie dokonywać aktualizacji ofert w platformie zewnętrznej, zalecamy użycie kodu EAN").
- **Catalogue linking, not order-time detection.** If an offer is not linked to a set, nothing expands; and new offers are not discovered automatically (S2: "Apilo nie pobiera informacji czy w platformie sprzedaży pojawiły się nowe oferty").
- **API consumers see only components** plus a nullable `productSet` integer on the detail read (S7); there is no way to read set definitions or to create an order line as "set" explicitly.

## UX patterns worth copying

1. **Set editor table with both prices side by side**: "Cena brutto produktu" (read-only list price) vs "Cena brutto w zestawie" (editable) per component, totals row showing sum, set price and the discount percentage ("-49.21%"), and the computed set stock (min) in the same table (S1-img1). This directly feeds the price split.
2. **"Zmień Produkt na zestaw"** button on an existing, already-linked product: retrofits a bundle/gift onto a live listing without relinking offers (S1).
3. **Line-origin icon on component lines** ("Produkty na podstawie zestawu", two-squares icon) so staff know a line came from a set (S1-img3).
4. **Automation as event x condition x ordered actions**, with a "re-check conditions just before execution" switch and a ready-made "Popularne" template list; gift-adding is one action among others (S3, S4: "możesz wymusić ponowne sprawdzenie, czy warunki zadania pozostają spełnione bezpośrednio przed wykonaniem zadania").
5. **Condition "Czy w zamówieniu istnieje zestaw?"** to route bundle orders (tag/status) (S3).
6. **Acknowledge-required picker message** (S5): staff must confirm reading it.

## Anti-patterns

1. **Parent line is replaced, not kept.** After expansion only component lines and an icon remain; set name, set quantity and set price are not shown as a line (S1, S1-img3). Hard to reconcile with the channel (shipping confirmation, returns, refunds per set).
2. **Set stock recomputed on a 15-minute batch** (S1). Shared components can oversell within that window.
3. **Price split from operator-typed in-set prices, scaled proportionally** (S1), not from individual selling prices and with no cap at a component's own price; mixed-VAT allocation therefore depends on a manual field.
4. **No gift flag anywhere**: gifts are components or rule-added products; the picker "gratis" message is a global free-text setting for all orders (S5), not tied to the rule that added the gift. No out-of-stock fallback for a gift.
5. **Name-based auto-linking fallback** can attach an offer to the wrong set/product silently (S2 warns operators to compare names manually).

## New use cases (with source)

- **NEW-A1 Bundle availability recompute trigger/latency**: define whether set availability is recomputed on every component change or on a schedule, and the oversell window that follows (S1 "przeliczany co 15 minut").
- **NEW-A2 Retrofit a live listing into a bundle**: convert an already-linked catalogue item into a bundle (adding a gift or second item) without breaking channel links (S1 "Zmień Produkt na zestaw", Przykład 1/2).
- **NEW-A3 Re-scale component prices to the price actually paid** when the channel price differs from the catalogue set price (S1 "proporcjonalnie przeliczona").
- **NEW-A4 Multipack by unit conversion**: set of N base units of a product stocked in another unit (metres -> "5m" cable) (S1 RJ-45 example).
- **NEW-A5 Route or tag orders that contain a bundle** (automation condition) (S3 "Czy w zamówieniu istnieje zestaw?").
- **NEW-A6 Gift rule conditioned on coupon use** (S3 condition "Czy wykorzystano kupon rabatowy?").
- **NEW-A7 Expose bundle origin to API consumers** per component line (S7 `productSet`), including on list endpoints (absent from `RestOrderItemsDTO3`).

## Conflicts / limits of this research

- The `productSet` field meaning is inferred from its name; the spec only says "Product Set" (S7). Unverified that it holds the set's warehouse product ID.
- "Invoice lines = component lines" is inferred from S1 (order lines are components) + S9 (documents built from order lines); no article states it explicitly.
- Screenshot S1-img1 shows "Cena brutto produktu" 64.32 PLN for "Czapka zimowa" while S1-img2 shows 32.16 PLN for the same product; the screenshots were made at different times. Not material to the ratings.
- Absence of documentation is rated Unknown, not None, except G-01 where the API schema itself shows no gift field.
- No live account was used (task forbids sign-up), so UI behaviour beyond help text and screenshots is unverified.
