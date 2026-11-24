# Phase 2 / Competitor: Apilo (apilo.com) - bundles ("zestawy") and gifts ("gratisy")

Researched 2026-11-04 from primary sources only (Apilo help centre, feature pages, REST API spec 2.0.0.13,
help-page screenshots). Nothing signed up for, no contact made. Points not stated by a source are marked
**(unverified)**. Community signal is thin: no forum/review thread discussing Apilo bundles or gifts was found
(searched Społeczność Allegro and the open web) - thin signal, so findings below are documentation-based.

## Sources consulted
- S1 Help: "Zestaw produktów - do czego służy i jak utworzyć" https://apilo.com/pl/help/zestaw-produktow-do-czego-sluzy-i-jak-utworzyc/
  + screenshots https://developer.apilo.com/uploads/media/help/zestaw/zestaw1.png (set form), zestaw3.png (order lines)
- S2 Help: "Relacje produktów" https://apilo.com/pl/help/relacje-produktow-do-czego-sluza-i-jak-korzystac/
- S3 Feature page: "Zadania automatyczne" (full list of 21 events / 39 conditions / 18 actions) https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/
- S4 Help: "Zadania automatyczne" https://apilo.com/pl/help/zadania-automatyczne/
- S5 Help: "Asystent zbierania" https://apilo.com/pl/help/asystent-zbierania/
- S6 Help: "Asystent pakowania" https://apilo.com/pl/help/asystent-pakowania/
- S7 Help: "Konfiguracja modułu fakturowania/paragonów" https://apilo.com/pl/help/konfiguracja-modulu-fakturowania-paragonow/
- S8 REST API 2.0.0.13 (Redoc, embedded OpenAPI) https://developer.apilo.cloud/api/2.0.0.13 ; changelog https://developer.apilo.cloud/api/2.0.0.13-changelog ; v3 alpha https://developer.apilo.cloud/api/3.0.0.0
- S9 Help: Shopify connection (discount FAQ) https://apilo.com/pl/help/polaczenie-z-shopify/
- S10 Help: TikTok Shop connection ("Strategia importu przedmiotów zamówienia" + screenshot https://apilo.com/wp-content/uploads/2026/05/2026-05-25_08h58_06.png) https://apilo.com/pl/help/polaczenie-z-tiktok-shop/
- S11 Help: Amazon connection ("Pobieranie zamówień bez kwot") https://apilo.com/pl/help/polaczenie-z-kontem-amazon/
- S12 Help: WooCommerce connection ("Ceny z podatkiem") https://apilo.com/pl/help/polaczenie-z-woocommerce/
- S13 Help: Moduł cenników https://apilo.com/pl/help/modul-cennikow/ ; Allegro konfiguracja dodatkowa https://apilo.com/pl/help/allegro-konfiguracja-dodatkowa/
- S14 Help: Shoper / PrestaShop / IdoSell / Erli / Allegro / Kaufland connection pages (https://apilo.com/pl/help/polaczenie-z-shoper/, .../polaczenie-z-prestashop/, .../polaczenie-z-idosell/, .../polaczenie-z-erli-pl/, .../polaczenie-z-kontem-allegro/, .../polaczenie-z-kaufland-global-marketplace/) - checked for bundle/gift/discount settings: none found
- S15 Help: Manager zamówień 3.0 https://apilo.com/pl/help/manager-zamowien-3-0-organizacja-pracy/ ; wFirma/Subiekt pages (master-warehouse switches) https://apilo.com/pl/help/polaczenie-z-wfirma-pl-faktury-i-paragony/
- S16 Społeczność Allegro "opinie o Apillo" https://spolecznosc.allegro.pl/t5/pocz%C4%85tkuj%C4%85cy-sprzedawcy/opinie-o-apillo/td-p/983203 (generic opinions only, nothing on sets)

## How Apilo models it (one paragraph)
Apilo has ONE internal catalogue ("Towary i usługi > Produkty"). Every channel offer is linked to a catalogue item
through "Relacje produktów" (auto-match by SKU -> EAN -> name, or manual "Połącz"). A catalogue item has a type;
type "Zestaw produktów" holds a component table. When an order line resolves (via the relation) to a set, Apilo
**replaces the line with its component lines** ("System Apilo automatycznie rozdzieli produkt zestawowy"),
each marked with a two-squares icon "Produkty na podstawie zestawu"; if the order's set price differs from the set
price in Apilo, component prices are **re-scaled proportionally**. Gifts have no data type at all: they are either a
component of a set (e.g. "Czapka + szalik gratis") or a product appended by an automatic-task action
"Dodaj produkt do zamówienia". Normalisation is therefore catalogue-centric, not channel-centric: there are no
per-channel bundle or gift-flag settings.

## Per-use-case table

| ID | Support | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Towary i usługi > Produkty > "+Dodaj" > "Zestaw produktów" (form field "Typ*: Zestaw produktów"). Required "Nazwa*", "SKU*". Panel "Produkty w zestawie" > "Dodaj" > search > green "+". Table columns: Lp., image, "Nazwa, ean/sku", "Ilość w zestawie", "Cena brutto produktu", "Cena brutto w zestawie", "Stan", delete "x"; footer shows sum of component prices, set price and the implied discount % (e.g. 80.64 PLN -> 40.96 PLN, -49.21%) and set stock. Alternative: open an imported product > "Zmień Produkt na zestaw". | Components must already exist in Produkty ("Ważne:"). No nested sets documented. No API to create/read set definitions (warehouse product schemas have no type/components). | S1, zestaw1.png, S8 |
| B-02 | Partial | Set stock is derived: "obliczany na podstawie dostępności najniższego stanem produktu" and pushed to every related offer by the normal stock sync. Shared components work implicitly (each component is an ordinary product sold elsewhere). | Recalculated only "co 15 minut" (oversell window). Whether "Ilość w zestawie" > 1 divides the component stock is not stated (unverified; screenshot only shows qty 1). | S1, S2 |
| B-03 | Partial | Only virtual sets are modelled (no own stock). A pre-built kit can only be an ordinary product with its own stock. | No hybrid (own stock first, then build from components); no assembly/kitting document. (unverified that none exists) | S1 |
| B-04 | Full | Channel sends one line (offer SKU); relation maps it to a set; Apilo explodes it into component lines at import. Works for any channel because it hinges on the relation, not the channel payload. | Parent line is no longer shown as a line (only icon on children). | S1, zestaw3.png, S2 |
| B-05 | None (unverified) | Nothing documented for channels that send parent + children (Woo bundle plugins, Shoper sets). If the parent SKU is related to an Apilo set, children would be counted twice. | No per-channel "this channel already sends children" switch. | S14 |
| B-06 | None (unverified) | No grouping concept for Shopify lineItemGroup / IdoSell bundleId documented; lines imported as plain lines. | - | S9, S14 |
| B-07 | Unknown | Allegro flexible bundles are not mentioned. Order discounts are imported into `orderDiscounts` (see X-01), so the discount may land there, not on lines. | - | S8 |
| B-08 | Partial | Multipack = set with one component and "Ilość w zestawie" N (help example "Kabel RJ-45 5m" = 5 x "Kabel RJ-45"), linked to the offer via Relacje. | No mention of Allegro productSet multipack offers in the listing manager. | S1 |
| B-09 | None | Fixed component table only; no slot/choice. | - | S1 |
| B-10 | Partial | Because the set is exploded into real order lines at import, the order keeps the components that applied then (implicit snapshot). | Not stated; behaviour if the order is re-imported/updated after the set definition changes is undocumented (Shoper orders re-sync positions: "Zmiany wprowadzone w produktach w zamówieniu w Shoper, powodują automatyczną aktualizację pozycji w Apilo") (unverified). | S1, S14 (Shoper) |
| B-11 | Partial | Picking ("Asystent zbierania") and packing ("Asystent pakowania") work on the component lines; each EAN scan +1, sound on error; component lines carry the set icon. | Bundle name/parent not shown as a header; no "this set = these parts" grouping on bench or slip (unverified). | S1, S5, S6 |
| B-12 | Partial | Picker can mark a line "Brak stanu" (icon "X"); events "Brak stanu" / "Nie zebrano produktów w zamówieniu" can trigger automatic tasks (status, email, tag). | No substitute, no split-shipment, no back-order logic. | S5, S3 |
| B-13 | None (unverified) | One Apilo warehouse with shelf locations ("Lokalizacja"); FBA/FBM split for Amazon only. | - | S5, S3 |
| B-14 | Partial | Documents are issued from order lines, so a set appears as its components, each with its own VAT ("Domyślny VAT na pozycjach zamówienia": fixed value / "Taki sam jak na zamówieniu" -> channel VAT, else product-card VAT / OSS). Revenue split = proportional to operator-entered "Cena brutto w zestawie". | No option to print the set as one line. Allocation basis is the operator's in-set prices, not individual selling prices; no cap at a component's own price. (unverified that no one-line option exists) | S7, S1 |
| B-15 | Partial | Correction invoice: Dokumenty księgowe > "Faktura korygująca", edit a line, quantity 0 to cancel a position. | No bundle-discount recalculation, no restock rule; returns module ("Apilo Zwroty", Alsendo/apaczka) is shipping-only. | S7, https://apilo.com/pl/help/apilo-zwroty/ |
| B-16 | None (unverified) | Price lists can use purchase price as base, but no set cost roll-up is documented. | - | S13 |
| B-17 | Partial | "Wariant 3: Użyj Managera aukcji Allegro lub Shoper aby wystawić produkt zestawowy." | Only Allegro and Shoper listing managers named. | S1 |
| B-18 | None | Sets are built by hand in Apilo (or by converting an imported product). No import of PrestaShop packs, Shoper/IdoSell sets or Subiekt komplety documented; API has no set endpoints. | - | S1, S8, S14 |
| B-19 | Partial | Line price from the channel is kept on the set, then redistributed to components proportionally. VAT precedence: channel line VAT, else product card; can be overridden globally per document series. | No per-channel "price is on parent/children" setting. | S1, S7 |
| B-20 | Partial (unverified) | "Platforma nadrzędna" / "Aktualizacja cen i stanów" direction (Shoper, wFirma, Subiekt) makes the master the stock source; how that interacts with sets is not documented. | Risk of double decrement if the master also explodes packs (unverified). | S14, S15 |
| B-21 | Partial | "Obsługa multi-paczek" (Allegro multi-parcel) exists; no component-to-parcel assignment or per-component "shipped" message. | - | S14 (Allegro "wysylam-z-allegro") |
| G-01 | None | No gift flag. Order items have only `type` 1-Product / 2-Shipment / 3-service. | Channel gift flags (IdoSell, Mirakl) are not carried (unverified). | S8 |
| G-02 | Partial | Amazon: "Pobieranie zamówień bez kwot" - orders without prices are imported with value "0". Zero-price lines are therefore possible on import. | API write rejects 0.00 lines (`originalPriceWithTax` minimum 0.01). No detection of "0.01 / 100% discount = gift". | S11, S8 |
| G-03 | Unknown | Nothing documented. | - | - |
| G-04 | Full | Documented pattern: offer "kwiatek + doniczka gratis" or "plecak szkolny" + piórnik -> open the imported product > "Zmień Produkt na zestaw" and add the gift as a component; every order then contains the gift line and decrements its stock. Or an automatic task adds it (G-06). | Gift becomes a permanent set component (no campaign end, no "gift" marker). | S1 |
| G-05 | Full | Order detail > edit ("edytować") > add a position; manual orders "Zamówienia > Lista zamówień > Dodaj zamówienie". Order history logs who packed. | Added line is an ordinary product line. | S15, S1 |
| G-06 | Partial | Administracja > Zadania automatyczne > "Dodaj": event "Utworzenie/pobranie zamówienia"; conditions e.g. "Wartość zamówienia", "Produkty na zamówieniu z SKU", "Produkty na zamówieniu z EAN", "Źródło kanału sprzedaży", "Data złożenia zamówienia", "Czy wykorzystano kupon rabatowy?", "Stan magazynowy produktu"; action "Dodaj produkt do zamówienia". Feature page: "Ustaw warunki (np. wartość zamówienia > 200 zł) ... aby system automatycznie dodał do zamówienia określony produkt (np. gratis)". Template library "Popularne". | Price/quantity of the added product, once-per-order guarantee and date-range semantics are not documented (unverified). No per-customer limit. | S3, S4 |
| G-07 | Full | Set component as gift ("stwórz zestaw z gratisem (np. Czapka + Szal ... 'Czapka + szalik gratis')"); its in-set price is editable. | Whether in-set price may be 0.00 is unverified. | S1, zestaw1.png |
| G-08 | Partial | A gift-adding task can be gated by condition "Stan magazynowy produktu" (unverified semantics); picker "Brak stanu" event can notify. | No declared substitute; no buyer notice. | S3, S5 |
| G-09 | Partial | Global setting "Komunikat dla okna zbierania" e.g. "dodaj gratis do zamówienia"; "Po dodaniu wiadomości osoba zbierająca będzie musiała ją zatwierdzić". A gift line itself is picked/packed like any line. | Message is global (Administracja > Asystent zbierania), not per order/product/rule. No gift badge. | S5 |
| G-10 | Partial | Gift lines go onto the invoice like any line with their VAT. | No list price + rebate, no zero-VAT-bucket check, no typed reason. | S7 |
| G-11 | None | - | - | - |
| G-12 | None (unverified) | No gift report; gifts are indistinguishable from paid lines. | - | - |
| G-13 | None | - | - | - |
| G-14 | Partial | Condition 'Pozycje na zamówieniu o typie "Usługa"' with the example "usługa - zapakuj na prezent w Allegro" -> route/tag such orders. | Gift wrap is just a service line. | S3 |
| G-15 | None | - | - | - |
| X-01 | Partial | Order read API carries `orderDiscounts[]` {type 1-product / 2-shipment, discountValue, note, idExternal} - order-level, not on lines. Shopify: "Rabat rozbijany jest tylko na przedmioty" (depends on a Shopify-side strategy field). Invoice option "Dodaj cenę proporcjonalnie" folds shipping into item prices. Condition "Czy wykorzystano kupon rabatowy?". | No neutral list price + line reduction; discounts not writable via API. | S8, S9, S7, S3 |
| X-02 | Partial | TikTok per-channel setting "Strategia importu przedmiotów zamówienia": "Importuj pozycje pojedynczo" / "Grupuj pozycje na podstawie oferty". | Kaufland per-unit lines: no such setting documented. | S10, S14 |
| X-03 | Partial | Per-channel settings exist (Cennik, Minimalny/Maksymalny stan magazynowy, Woo "Ceny z podatkiem", "Strategia metod dostawy", TikTok item strategy, Amazon "Pobieranie zamówień bez kwot"), but none about bundle encoding or gift flags - sets are resolved channel-agnostically through Relacje. | - | S9-S14 |

## Integration normalisation (how Apilo makes channels look alike)
- **Catalogue-centric**: offer -> relation ("Relacje produktów", auto by SKU, then EAN, then name; or "Połącz") -> catalogue item. If that item is a set, the order line is exploded into components. The channel never needs to know about the set; no per-channel bundle configuration exists.
- **Price recalculation**: "jeśli cena zestawu w pozycji zamówienia różni się od ceny zestawu w magazynie Apilo to zostanie ona proporcjonalnie przeliczona" - the channel price wins, split across components in the ratio of their configured "Cena brutto w zestawie".
- **Per-channel price differences** are handled before the sale by "Moduł cenników" (one price list per channel: markup/margin rules, manual individual price, currency conversion), not by order-time mapping.
- **Discounts** are kept as an order-level list `orderDiscounts` (product vs shipment) plus channel-specific splitting (Shopify spreads onto items); shipping can be folded into lines only on the document ("Dodaj cenę proporcjonalnie").
- **VAT** precedence is a document-template setting: fixed rate / channel line VAT with product-card fallback / OSS by buyer country.
- **Line shape quirks** get small per-channel switches (TikTok group-by-offer, Amazon import orders without amounts as 0, Woo price-with-tax) rather than a general model. API exposes `productSet` (integer id) on each order item so integrators can trace a component back to its set.

## UX patterns worth copying
1. Set editor table with "Ilość w zestawie" + "Cena brutto produktu" + "Cena brutto w zestawie" + live "Stan" per component and a footer that shows the set's implied discount % and resulting set stock.
2. One-click "Zmień Produkt na zestaw" on an already imported channel product - turns "offer promising a gift" into a stock-controlled set without re-listing.
3. Set-origin icon on exploded order lines ("Produkty na podstawie zestawu") so staff see why the line exists.
4. Event x condition x action rule builder with a prebuilt "Popularne" template library, ordered actions (slider "Wykonaj akcję"), and a condition "Czy w zamówieniu istnieje zestaw?".
5. Acknowledge-to-continue message for the picker ("osoba zbierająca będzie musiała ją zatwierdzić") - good primitive, if scoped to the order/rule.
6. Per-channel import strategy dropdown for line shape (TikTok "Importuj pozycje pojedynczo" vs "Grupuj pozycje na podstawie oferty").

## Anti-patterns
1. Parent line is replaced by components: the sold product (what the buyer and channel know) disappears from the order view; channel line ids and per-line write-back become ambiguous.
2. Set stock recomputed only every 15 minutes - oversell window on shared components.
3. Revenue/VAT split by operator-typed in-set prices, not by individual selling prices, with no cap - legally fragile for mixed-VAT bundles.
4. Gifts have no type: a gift is just another product line (or a permanent set component), so documents, reports, returns and analytics cannot tell gift from sale; no campaign end, no substitute.
5. Picker gift reminder is one global message for all orders; no set-definition import from shops/ERP and no API for set definitions (sets are re-keyed by hand).

## New use cases (not in v2 catalogue)
- N-A: Convert an already-listed, already-imported product into a bundle retroactively (B-01/G-04 variant), keeping the existing channel relation.
- N-B: Bundle stock freshness - the delay between a component sale and the bundle's published quantity must be bounded (Apilo: 15 min).
- N-C: Orders imported with no price at all (Amazon) - how a bundle/gift is split when the parent price is 0.
- N-D: Shipping folded into item prices on the document (proportional) interacting with bundle/gift allocation.
- N-E: Channel re-sends/edits order positions after the bundle has been exploded (Shoper position re-sync) - re-explode or keep.
- N-F: Gift-wrap/service lines as routing conditions (Allegro "zapakuj na prezent" service line) - related to G-14.
- N-G: Picker-acknowledged instruction attached to an order by a rule (gift reminder) rather than an added line.

## Confidence
- High: set creation UI, explode-on-import, proportional price recalculation, min-stock with 15-min recompute, automatic-task action "Dodaj produkt do zamówienia" and its condition list, API item types and `orderDiscounts` shape, TikTok/Amazon/Shopify settings quoted.
- Low / unverified: B-05/B-06/B-07 behaviour, whether "Ilość w zestawie" divides stock, whether a set component or added product may be priced 0.00 in the UI, price/qty of products added by a rule, absence of a one-line-set document option, interaction with master-warehouse platforms.
