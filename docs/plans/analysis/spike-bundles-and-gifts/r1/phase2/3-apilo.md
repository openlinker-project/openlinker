# Phase 2 / competitor 3: Apilo (apilo.com) - bundles ("Zestaw produktów") and gifts ("gratis")

Researched 2026-11-04. Read-only: public help centre, marketing pages, public REST API spec, one forum thread.
Nothing here comes from a logged-in panel; anything inferred is marked (unverified).

## Sources consulted
- S1 Help: "Zestaw produktów – do czego służy i jak utworzyć" https://apilo.com/pl/help/zestaw-produktow-do-czego-sluzy-i-jak-utworzyc/
  + screenshots https://developer.apilo.com/uploads/media/help/zestaw/zestaw1.png , zestaw2.png , zestaw3.png (viewed)
- S2 Help: "Asystent Pakowania" https://apilo.com/pl/help/asystent-pakowania/
- S3 Help: "Asystent Zbierania" https://apilo.com/pl/help/asystent-zbierania/
- S4 Help: "Relacje produktów – czyli jak włączyć synchronizacje?" https://apilo.com/pl/help/relacje-produktow-do-czego-sluza-i-jak-korzystac/
- S5 Help: "Konfiguracja modułu Fakturowania / Paragonów" https://apilo.com/pl/help/konfiguracja-modulu-fakturowania-paragonow/
- S6 Help: "Paragony – podłączenie drukarki fiskalnej" https://apilo.com/pl/help/paragony-podlaczenie-drukarki-fiskalnej/
- S7 Help: "Połączenie z KSeF" https://apilo.com/pl/help/polaczenie-z-ksef/
- S8 Help: "Zadania automatyczne" https://apilo.com/pl/help/zadania-automatyczne/
- S9 Help: "Zdarzenia własne" https://apilo.com/pl/help/zdarzenia-wlasne/
- S10 Marketing: "Zadania automatyczne" (full list of 21 events / 39 conditions / 18 actions + templates) https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/
- S11 Marketing EN: https://apilo.com/en/apilo-functions/automatic-tasks/ ("Add products to order automatically")
- S12 Help: "Jak często Apilo synchronizuje dane?" https://apilo.com/pl/help/jak-czesto-erpbox-synchronizuje-dane/
- S13 Help: "Apilo Zwroty" https://apilo.com/pl/help/apilo-zwroty/
- S14 Help: "Zamówienie ręczne z innego źródła" https://apilo.com/pl/help/zamowienie-reczne-z-innego-zrodla/
- S15 Help: "Magazyn Apilo – jak dodać produkt" https://apilo.com/pl/help/magazyn-apilo-jak-dodac-produkt/
- S16 REST API 2.0.0.13 (OpenAPI embedded in page) https://developer.apilo.cloud/api/2.0.0.13 ; changelog https://developer.apilo.cloud/api/2.0.0.13-changelog ; 3.0.0.0 alpha listed but body not rendered statically
- S17 Shoper app page for Apilo https://www.shoper.pl/aplikacje/apilo
- S18 Allegro community thread "Opinie o Apillo" https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/opinie-o-apillo/m-p/983203
- Not found: any help article on gifts specifically, on returns of set components, on reports/margin for sets, on how channel-side bundles (Allegro zestaw ofert, Shoper/Woo parent+children) are imported. Google-style site: search returned nothing from apilo.com; Apilo help is only reachable by crawling the sidebar of help pages. Thin signal on gifts.

## Key findings (with Polish UI labels)

### 1. Set definition (S1 + screenshot zestaw1.png)
- Path: Towary i usługi > Produkty > "+Dodaj" (top right) > "Zestaw produktów". Product form has "Typ*" dropdown with value "Zestaw produktów" (S15: "Wybierz typ produktu").
- Required: "Nazwa*", "SKU*", "Typ*", "Status produktu*". Optional EAN, Waga, Kategorie, attachments.
- Right panel "Produkty w zestawie" with blue "Dodaj" button -> modal "Znajdź produkt" (search "Nazwa produktu, EAN/SKU/KOD", Kategorie, Marka, Status produktu, "Szukaj"), each result row shows Brutto + Stan and a green "+" to add.
- Component table columns: "Lp.", image, "Nazwa, ean/sku", "Ilość w zestawie" (spinner), "Cena brutto produktu" (read-only list price), "Cena brutto w zestawie" (editable, PLN), "Stan", red "x" remove.
- Footer row: sum of list prices (80.64 PLN), sum of in-set prices (40.96 PLN) with discount shown as "-49.21%", and the set's resulting stock (3, = the scarcer component).
- => The price split across components (and therefore per-VAT-rate split) is set explicitly by the operator at definition time.
- Convert in place: open an imported product > button "Zmień Produkt na zestaw" > add components > save. Components must already exist as stock items ("Ważne: jeśli w Towary i usługi > Produkty nie znajdują się pojedyncze pozycje magazynowe...").
- Stated uses (quote): "stwórz zestaw z niższą/wyższą ceną niż zakup pojedynczych produktów", "stwórz zestaw z gratisem (np. produkt „Czapka” oraz „Szal” połącz w zestaw „Czapka + szalik gratis”)", "sprzedawaj większą ilość tego samego produktu (np. ... zestaw „Kabel RJ-45 5m”, który będzie składał się z 5 sztuk „Kabel RJ-45”)".

### 2. Set stock (S1, S12)
- "stan magazynowy zestawu produktów będzie obliczany na podstawie dostępności najniższego stanem produktu"; "stan magazynowy zestawu produktów jest przeliczany co 15 minut".
- Channel push of quantities: "synchronizacja stanów magazynowych odbywa się w standardzie co 4h lub co 2h (w zależności od abonamentu)"; faster "co 1h" or "na żywo" is a paid add-on (Administracja > Menedżer usług). Must be switched on per offer in Relacje produktów ("Aktualizacja stanu magazynowego – Włącz").
- Forum (S18, 18-08-2026): sync frequency in standard plan and paying for faster sync is a complaint.
- Shoper app page (S17): "tworzenie dowolnych zestawów produktów, działających niezależnie i synchronizujących się ze stanem magazynowym".

### 3. Linking a set to channels (S1, S4)
- Option 1: Towary i usługi > Relacje produktów - attach the set to an existing offer (manual "Połącz", or auto match by SKU/"Sygnatura" -> EAN -> name).
- Option 2: add the set as a line when creating/editing an order manually.
- Option 3: list it via "Manager aukcji" Allegro or Shoper.

### 4. Order with a set (S1 + screenshot zestaw3.png)
- Quote: "System Apilo automatycznie rozdzieli produkt zestawowy. Na liście pozycji zamówienia będą widoczne pojedyncze produkty wchodzące w skład zestawu".
- Screenshot "Pozycje 2": two component lines each with Nazwa, SKU/EAN, Ilość, Cena netto, Stawka VAT, Cena brutto, Suma, and a two-squares icon labelled in the help image "Produkty na podstawie zestawu". No parent/set line is visible -> the set line is replaced by components (inferred from screenshot).
- Price: "jeśli cena zestawu w pozycji zamówienia różni się od ceny zestawu w magazynie Apilo to zostanie ona proporcjonalnie przeliczona, by odpowiadała pozycji w zamówieniu".
- API (S16): read DTO RestOrderItemsDTO2 has "productSet" (integer, nullable, description "Product Set") - presumably the set id a component line came from; "productId"; "type" enum 1-Product, 2-Shipment, 3-service. No warehouse endpoint exposes set components (Products/ProductDetailModel have no component field). Write DTO: "originalPriceWithTax" minimum 0.01.
- Automation condition exists: "Czy w zamówieniu istnieje zestaw?" (S10).

### 5. Picking / packing (S2, S3, S9)
- "Asystent Zbierania" (picking, carts "koszyki", locations, multi-order) and "Asystent Pakowania" (packing). Opened via "Zbieraj"/"Pakuj" buttons, or by scanning order/parcel/invoice barcode, or cart barcode.
- Shows photo, required qty, SKU/EAN, location; scan EAN = +1; "+ / –" buttons, type quantity, or mark whole line packed; sounds on errors ("dla wprowadzonej ilości większej niż w zamówieniu, dla niepoprawnego produktu").
- Setting "Nazwa produktu – ... wg pozycji zamówienia lub pozycji magazynowej".
- Picking setting "Komunikat dla okna zbierania - komunikat, który ma zostać wyświetlony osobie zbierającej zamówienie np. “dodaj gratis do zamówienia” ... osoba zbierająca będzie musiała ją zatwierdzić" (configured in settings, appears global, not per order - unverified).
- Events for automation: "rozpoczęto pakowanie", "zakończono pakowanie", "brak stanu" / "Brak stanu", "Nie zebrano produktów w zamówieniu".
- Two pickers can pick the same order; quantities summed.
- Nothing specific about sets in the packing UI: components arrive as normal lines (set icon presumably visible, unverified). Packing slip / "lista kompletacyjna" content for sets: not documented.
- "Zdarzenia własne" (custom events): operator-defined buttons / hotkeys / barcodes shown on order list, order details, and inside Asystent Pakowania/Zbierania, which fire an automatic task.

### 6. Gifts (S1, S3, S10, S11)
- No gift object/flag. Gift is modelled three ways:
  a) Set component: "Przykład 2: na allegro znajduje się aukcja „plecak szkolny”. Jako promocję chcesz dołączyć do każdego sprzedanego plecaka piórnik. Przekształć produkt na zestaw, a nie dojdzie do sytuacji w której sprzedajesz za dużo piórników lub plecaków"; also "kwiatek + doniczka gratis".
  b) Automatic task action "Dodaj produkt do zamówienia". Template text (S10): "Dodanie produktów do zamówienia - Ustaw warunki (np. wartość zamówienia > 200 zł), które muszą być spełnione, aby system automatycznie dodał do zamówienia określony produkt (np. gratis)". EN (S11): "Define rules so the system adds selected products to order when certain conditions are met."
     Events (21) incl. "Utworzenie/pobranie zamówienia", "Zmiana statusu płatności", "Spakowano zamówienie", "Brak stanu".
     Conditions (39) incl. "Źródło kanału sprzedaży", "Wartość zamówienia", "Produkty na zamówieniu z EAN", "Metody na zamówieniu z SKU" [sic], "Produkty na zamówieniu - ilość sztuk na pozycji", "Stan magazynowy produktu", "Czy wykorzystano kupon rabatowy?", "Czy w zamówieniu istnieje zestaw?", "Kraj zamówienia", "Pozycje na zamówieniu o typie "Usługa" (np. usługa - zapakuj na prezent w Allegro)".
     Option "wymusić ponowne sprawdzenie, czy warunki zadania pozostają spełnione bezpośrednio przed wykonaniem zadania".
     The action's own fields (which product, qty, price, warehouse) are NOT documented publicly. (Competitor Base.com's equivalent asks catalogue, warehouse, product ID, name, quantity, price - not Apilo.)
  c) Picker message "dodaj gratis do zamówienia".
- Not found: per-customer limits, "once vs repeat", gift-out-of-stock handling, buyer choice, gift reporting, flagged gift import.

### 7. Documents (S5, S6, S7)
- Built-in invoicing + receipts (Administracja > Księgowość konfiguracja), series per channel; or external (wFirma, Fakturownia, inFakt, iFirma, Subiekt via integratory.pl, etc.).
- VAT: "Domyślny VAT na pozycjach zamówienia" either fixed or "Taki sam jak na zamówieniu" (channel VAT, else product card VAT via Relacje produktów); OSS option. Action "Modyfikacja stawki VAT".
- "Uwzględnij przesyłkę" / "Dodaj cenę proporcjonalnie": hides shipping line and spreads its cost proportionally over item lines (example 3x10 + 10 shipping -> 2x13.33 + 1x13.34).
- Since a set is expanded into component lines with own VAT before invoicing, the invoice/receipt shows components (inferred from S1 screenshot + S5; no option to show the set as one line found).
- Correction: Zamówienia > Dokumenty księgowe > "Faktura korygująca"; per line edit; "jeśli chcesz anulować sprzedaż wybranej pozycji – zmień ilość na 0".
- Fiscal printer: via third-party Inspigo connector ("Serwer urządzeń zewnętrznych", "InspigoFiscalForErpBox.exe" + editing a .config file with API keys); receipt series "Czy fiskalny: TAK", "czy imienny: Nie"; status icons grey-with-clock / green. FAQ: "Kwota podatku VAT jest liczona od kwoty netto, a nie brutto".
- KSeF: only for Apilo's own invoicing module; one integration per NIP; per-series; auto or manual send; offline cert supported; payment-method mapping.
- How a 0.00 gift line or a 100% rebate prints on receipt/invoice: not documented.

### 8. Returns (S5, S13)
- "Apilo Zwroty": buyer return portal (zwrotyapilo.com) on apaczka/Alsendo, buyer enters order no + last 4 phone digits, picks point/courier; "Lista zwrotów".
- No doc on restocking a single set component, or on recomputing lost set discount.

### 9. API summary (S16)
- Order item: id, idExternal, ean, sku, originalName, originalCode, originalPriceWithTax/WithoutTax (min 0.01 on create), quantity, tax, unit, type (1 product/2 shipment/3 service), status (0/1, undocumented), productId, productSet (int, nullable).
- Order-level "orderDiscounts": idExternal, type (1 product, 2 shipment), note (<=64), discountValue. No per-line discount/list price.
- Warehouse product endpoints: no set/component fields.

## Per-use-case table
| ID | Coverage | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Produkty > +Dodaj > "Zestaw produktów"; "Produkty w zestawie" > Dodaj > "Znajdź produkt" > green +; per component "Ilość w zestawie" + "Cena brutto w zestawie"; footer shows sum, -% and set stock. Or "Zmień Produkt na zestaw" on an existing item. | Components must exist first; nested sets unknown | S1 |
| B-02 | Partial | Set stock = scarcest component, auto; pushed to every linked offer by Relacje produktów sync. | Recalc every 15 min + channel push 4h/2h (1h/live paid) -> oversell window on shared components | S1, S12, S18 |
| B-03 | Partial | Pre-built kit = ordinary product with own stock; virtual = "Zestaw produktów". | No assembly/disassembly flow found (Unknown) | S1 |
| B-04 | Full | Offer linked to a set -> order line auto-split into component lines with icon "Produkty na podstawie zestawu"; set price spread proportionally. | Parent line seemingly not kept (inferred) | S1 screenshot |
| B-05 | Unknown | - | Double-count risk if parent offer linked to set and children also arrive (unverified) | - |
| B-06 | Unknown | - | - | - |
| B-07 | Partial | Order-level "orderDiscounts" (product/shipment) via API; condition "Czy wykorzystano kupon rabatowy?". | No Allegro offer-bundle handling documented | S16, S10 |
| B-08 | Full | Set of N x same product (RJ-45 5 m = 5 x 1 m). | - | S1 |
| B-09 | None (unverified) | Set content is a fixed list. | - | S1 |
| B-10 | Full (inferred) | Components written as order lines at import, so later edits of the set do not touch old orders. | unverified | S1 |
| B-11 | Partial | Picking/packing assistants show components as ordinary lines (photo, SKU/EAN, location, scan +1); set icon on order. | No grouping under set header; packing slip content unknown | S2, S3, S1 |
| B-12 | Partial | "Brak stanu" event in picking/packing -> automatic task (status/tag/email). | No substitute/split/partial flow | S2, S10 |
| B-13 | Unknown | Multi-warehouse exists. | Set across warehouses not documented | S17 |
| B-14 | Partial | Invoice/receipt built from component lines, each with own VAT; component price from "Cena brutto w zestawie" scaled to actual price; VAT from channel or product card. | No "set as one line" option found; tax computed from net | S1, S5, S6 |
| B-15 | Partial | Return portal "Apilo Zwroty"; "Faktura korygująca" per line (qty 0). | Component restock and lost-discount recalculation undocumented | S13, S5 |
| B-16 | Unknown | - | - | - |
| B-17 | Partial | List set via Manager aukcji Allegro / Shoper, or attach to existing offer in Relacje produktów. | Other channels not documented | S1, S4 |
| B-18 | None | No import of shop/ERP set definitions found; manual "Zmień Produkt na zestaw". | - | S1 |
| G-01 | Unknown | - | - | - |
| G-02 | Unknown | - | API create requires price >= 0.01 | S16 |
| G-03 | Unknown | - | - | - |
| G-04 | Full | (a) turn the listing's product into a set with the gift ("plecak + piórnik"); (b) rule "Dodaj produkt do zamówienia"; (c) picker message "dodaj gratis do zamówienia". | Message appears global, not per order (unverified) | S1, S10, S3 |
| G-05 | Partial | Edit order > add line (search product); or a "Zdarzenie własne" button/barcode (also in Asystent Pakowania) firing "Dodaj produkt do zamówienia" (combination unverified). | - | S1, S9, S10 |
| G-06 | Partial | Template "Dodanie produktów do zamówienia" e.g. order value > 200 zł; conditions on channel, SKU/EAN, qty, coupon, country, "Stan magazynowy produktu", "Czy w zamówieniu istnieje zestaw?". | No per-customer limit / once-vs-repeat / global cap found; action fields undocumented | S10, S11 |
| G-07 | Full | Gift as set component (examples "Czapka + szalik gratis", "kwiatek + doniczka gratis"). | - | S1 |
| G-08 | Partial | As component: stock is in the min(); as rule: can gate on "Stan magazynowy produktu". | Gift-ran-out behaviour undocumented | S1, S10 |
| G-09 | Partial | Gift is an ordinary line, scanned; acknowledged picker message. | - | S2, S3 |
| G-10 | Unknown | Component price editable in set; how 0 zł/rebate prints unknown. | - | S1 |
| G-11 | Unknown | - | - | - |
| G-12 | Unknown | - | - | - |
| G-13 | None (unverified) | - | - | - |
| G-14 | Partial | Allegro gift wrap arrives as a "Usługa" (type 3) line; condition "Pozycje na zamówieniu o typie "Usługa" (np. usługa - zapakuj na prezent w Allegro)" -> tag/status; "Wyświetlaj komentarz dla zamówienia" in packing. | Whether service lines show in packing assistant unknown | S10, S16, S2 |
| X-01 | Partial | Line prices + order-level "orderDiscounts" (product/shipment). | No list price + per-line discount | S16 |
| X-02 | Unknown | Event "Połączono zamówienia" exists (order merge), not unit merge. | - | S10 |

## UX patterns worth copying
1. Set editor = one table with "Ilość w zestawie" + editable "Cena brutto w zestawie" per component and a footer showing list sum, set price, discount % and resulting set stock. The price split is fixed at definition, so documents with mixed VAT are reproducible.
2. Provenance icon on expanded lines ("Produkty na podstawie zestawu") so the operator sees which lines came from a set.
3. "Zmień Produkt na zestaw": convert an already-linked imported product into a set in place, offers stay linked.
4. Gift rule shipped as a ready template ("Popularne" > "Dodanie produktów do zamówienia ... np. gratis") with event/condition/action and "re-check conditions before executing".
5. Operator-defined buttons/hotkeys/barcodes ("Zdarzenia własne") usable inside the packing assistant.
6. Mandatory-acknowledge message to the picker.

## Anti-patterns / complaints
1. Set line replaced by components (inferred): no way found to print the set as one line, return/discount logic per component is undocumented.
2. Stock latency: set recalc every 15 min + channel push every 4h/2h on standard plans; faster sync is paid; forum users complain about sync frequency.
3. Gift = generic "add product" action: no gift flag, no per-customer limit, no gift-out-of-stock policy, action fields undocumented; global picker message not tied to the order.
4. API gaps: no set definitions in API, order line price min 0.01 (0 zł gift line probably impossible via API), discounts only at order level.
5. Fiscal printer needs a third-party connector and hand-editing a .config file; support quality criticised (forum, 2025/2026).

## New use cases not in the catalogue
- N1 Proportional re-pricing of components when the channel's actual set price differs from the defined set price.
- N2 Shipping cost spread proportionally into item lines on the invoice ("Dodaj cenę proporcjonalnie") - interacts with component/gift price split.
- N3 Convert an existing imported product/offer into a set in place.
- N4 Rule condition "order contains a set" (route sets to a separate queue/status).
- N5 Several pickers collecting the same order line, quantities summed.
- N6 Operator-defined action buttons/barcodes on the pack bench (e.g. "add gift").
- N7 Gift-wrap service line used as an automation trigger.
