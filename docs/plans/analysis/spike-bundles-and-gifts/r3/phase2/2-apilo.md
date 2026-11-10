# R3 phase 2 / competitor 2: Apilo (apilo.com), bundles and gifts

Round 3, blind replication. Inputs read: briefs/common.md, briefs/r3-blind.md, briefs/competitor-task.md, use-cases-v3.md. Nothing else under docs/plans/analysis/ was read.
Research date: 2026-11-04.

## Sources consulted (kind in brackets)

| # | Source | Kind | What it gave |
|---|---|---|---|
| S1 | https://apilo.com/pl/help/zestaw-produktow-do-czego-sluzy-i-jak-utworzyc/ | official help (primary for UI) | The whole bundle feature: create, use, split on order, stock = min, 15 min recompute, proportional price |
| S2 | Screenshots in S1: developer.apilo.com/uploads/media/help/zestaw/zestaw1.png, zestaw3.png | official help screenshots | Form columns ("Ilość w zestawie", "Cena brutto produktu", "Cena brutto w zestawie", "Stan"); order lines after split with own VAT; icon "Produkty na podstawie zestawu" |
| S3 | https://developer.apilo.cloud/api (OpenAPI 2.0.0.13, embedded JSON) | API spec (primary) | Order item schemas, `productSet`, `orderDiscounts`, item `type`, product schemas without components |
| S4 | https://apilo.com/pl/funkcje-apilo/zadania-automatyczne/ | feature page (vendor marketing, but lists literal UI items) | Full list of 21 events, 39 conditions, 18 actions incl. "Dodaj produkt do zamówienia", "Czy w zamówieniu istnieje zestaw?" |
| S5 | https://apilo.com/pl/help/zadania-automatyczne/ + screenshots | official help | Automation editor (Zdarzenie / Warunki / Wykonaj akcję), ordering of actions, "last minute" re-check |
| S6 | https://apilo.com/pl/help/relacje-produktow-do-czego-sluza-i-jak-korzystac/ | official help | Offer to warehouse-product linking (SKU, then EAN, then name; manual "Połącz") |
| S7 | https://apilo.com/pl/help/asystent-zbierania/ , /asystent-pakowania/ | official help | Picking/packing assistants, global "Komunikat dla okna zbierania" e.g. "dodaj gratis" |
| S8 | https://apilo.com/pl/help/konfiguracja-modulu-fakturowania-paragonow/ | official help | VAT source on invoices, "Domyślny VAT na pozycjach zamówienia", proportional shipping folding |
| S9 | https://apilo.com/pl/help/polaczenie-z-shopify/ , /polaczenie-z-tiktok-shop/ (+ screenshot), /integracja-z-inpost-von-halsky/ | official help (connector pages) | Per-integration settings: discount strategy, "Strategia importu przedmiotów zamówienia" |
| S10 | Changelog posts: marzec-2024, maj-2026, lipiec-2026, wrzesien-2026 (apilo.com/pl/...) | vendor changelog | Per-channel discount handling added over time (WooCommerce, eBay, PrestaShop) |
| S11 | https://apilo.com/pl/tworzenie-zestawow-produktow-w-apilo-czyli-jak-rozkrecic-sprzedaz-allegro-i-na-innych-kanalach-sprzedazy/ (2019-03-15) and a 2019-09-24 sibling | vendor blog | Feature launch date and same behaviour as S1 |
| S12 | https://apilo.com/pl/help/dodawanie-produktow-do-magazynu-manualnie/ | official help | Product types: towar / usługa / wysyłka / zestaw produktów |
| S13 | https://www.shoper.pl/aplikacje/apilo | partner marketplace (marketing) | Bundle claim repeated by Shoper |

Searches of Społeczność Allegro and general review sites found **no independent merchant reports** on Apilo bundles or gifts. All behaviour below rests on Apilo's own docs, screenshots and API spec. There was no hands-on test (no signup, per the rules).

## How Apilo models bundles and gifts (summary)

- A bundle ("Zestaw produktów") is a **product type** in the Apilo warehouse (Towary i usługi > Produkty > +Dodaj > Zestaw produktów). It has its own name, SKU (required), EAN and weight, plus a table of components with quantity and an **in-bundle gross price per component**. S1/S2: "w tabeli produktów znajdujących się w zestawie możesz zmienić ilość i cenę."
- An offer on a channel is linked to the bundle through **Relacje produktów** (offer to warehouse product). When an order arrives, Apilo **replaces the bundle line with its component lines**. S1: "System Apilo automatycznie rozdzieli produkt zestawowy. Na liście pozycji zamówienia będą widoczne pojedyncze produkty wchodzące w skład zestawu". The bundle survives only as a marker: an icon per line (S1: "ikonka 2 kwadratów") and an integer `productSet` on the read DTO of an order item (S3).
- Price: S1: "jeśli cena zestawu w pozycji zamówienia różni się od ceny zestawu w magazynie Apilo to zostanie ona proporcjonalnie przeliczona, by odpowiadała pozycji w zamówieniu".
- Stock: S1: "stan magazynowy zestawu produktów będzie obliczany na podstawie dostępności najniższego stanem produktu" and "jest przeliczany co 15 minut".
- **Gifts have no entity of their own.** Apilo offers three mechanisms: (1) a bundle that contains the gift (S1 examples "Czapka + szalik gratis", "plecak szkolny" + "piórnik"); (2) the automation action "Dodaj produkt do zamówienia" behind conditions (S4: "Ustaw warunki (np. wartość zamówienia > 200 zł), które muszą być spełnione, aby system automatycznie dodał do zamówienia określony produkt (np. gratis)"); (3) a static picker message (S7: "komunikat, który ma zostać wyświetlony osobie zbierającej zamówienie np. "dodaj gratis do zamówienia"").

## Rating per use case

Ratings: Full / Partial / None / Unknown. "None" here means the primary docs and the API spec describe the relevant screen or schema and the capability is absent from it. "Unknown" means no source covers it either way.

### Bundles

| ID | Rating | How it works for the operator | Evidence |
|---|---|---|---|
| B-01 | Full | Towary i usługi > Produkty > "+Dodaj > Zestaw produktów". Name and SKU are required, Typ = "Zestaw produktów". In "Produkty w zestawie" the operator clicks "Dodaj", searches, clicks the green "+", then sets "Ilość w zestawie" and "Cena brutto w zestawie". | S1: "Obowiązkowo uzupełnij nazwę oraz SKU. Wybierz produkty zestawowe: w obszarze „produkty w zestawie" kliknij przycisk „dodaj"". S2 screenshot shows the columns |
| B-02 | Partial | Bundle stock = minimum over components and is pushed to linked offers. Components are ordinary warehouse products, so they can sell alone and belong to several bundles. **Recompute every 15 min, not at once**, which leaves an oversell window. The S2 form also shows "Stan" per component and the bundle total (3 = min(13,3)). | S1: "stan magazynowy zestawu produktów będzie obliczany na podstawie dostępności najniższego stanem produktu", "przeliczany co 15 minut" |
| B-03 | Partial | Only virtual bundles are documented. A pre-built kit is just an ordinary product. There is no assemble/disassemble flow. The bundle stock is derived, not held. | S1, S12 (product types: "towar, usługa, wysyłka lub zestaw produktów"). No kitting doc found |
| B-04 | Full (mechanism) / Unknown (per channel) | The operator links the channel offer to the bundle via Relacje produktów. Any order line for that offer is then split into components. This is channel-agnostic. Allegro productSet or Erli productSets specifics are **not documented**. | S1: "Wariant 1: Użyj zakładki Towary i usługi > Relacje produktów, aby podłączyć zestaw pod istniejącą aukcję/ofertę." S6 for linking rules |
| B-05 | Unknown | No doc on Woo bundle plugins or Shoper parent+children lines. Risk: if each child line is linked to its warehouse item AND the parent is linked to a zestaw, stock would double-decrement. No setting found to prevent this. | none found |
| B-06 | Unknown | No doc on Shopify lineItemGroup or IdoSell bundleId. | none found |
| B-07 | Partial | There is no Allegro-bundle specific doc. Discounts are imported per channel with different code over time: WooCommerce negative line = discount (2024), Shopify "Rabat rozbijany jest tylko na przedmioty", eBay and PrestaShop discounts improved in 2026. The API has only order-level `orderDiscounts` {type 1 product / 2 shipment, note, discountValue}. | S10: "Apilo x WooCommerce – traktowanie ujemnej kwoty pozycji zamówienia jako rabat". S9 Shopify FAQ. S3 `RestOrderDiscountDTO` |
| B-08 | Full | Multipack = bundle of N units of one component. | S1: "Możesz utworzyć zestaw „Kabel RJ-45 5m", który będzie składał się z 5 sztuk „Kabel RJ-45"" |
| B-09 | None | Composition is a fixed list of products. There is no slot or choice concept in the form. | S2 form |
| B-10 | Full (by construction) | Splitting at intake writes component lines into the order, so contents are frozen in the order. Not verified: whether later edits of the definition leave old orders untouched (very likely, since they are separate rows). | S1 split text; S2 zestaw3.png |
| B-11 | Partial | The pick and pack assistants work on component lines (EAN scan, photos, locations). The parent appears only as an icon "Produkty na podstawie zestawu". Name display can follow the order line or the warehouse item. Nothing documents a packing slip showing parent + children. | S2 zestaw3.png; S7: "Nazwa produktu – pozwala na wybór wyświetlanej nazwy wg pozycji zamówienia lub pozycji magazynowej" |
| B-12 | Partial | The "Brak stanu" event and the "Stan magazynowy produktu" condition can drive automations (status, tag, e-mail). There is no substitute, split or back-order flow. | S4 events list ("Brak stanu", "Nie zebrano produktów w zamówieniu") |
| B-13 | Unknown | Apilo has product locations (S7), but no multi-warehouse bundle logic is documented. | none |
| B-14 | Partial | The document is built from component lines, each with its own VAT (screenshot: per-line "Stawka VAT"). The bundle price is spread across components in proportion to the configured "Cena brutto w zestawie". There is no "never above the component's own price" check. VAT comes from the channel line or from the product card if the channel sends none, and can be overridden globally ("Domyślny VAT na pozycjach zamówienia"). There is no option to invoice the bundle as ONE line. | S1 proportional text; S2; S8: "Jeśli kanał sprzedaży przy pozycjach zamówienia nie zwróci VAT, podatek pobierany jest z karty produktu" |
| B-15 | Unknown | "Apilo Zwroty" is a return-label portal (Alsendo). No doc on refund or lost-discount calculation per component. | https://apilo.com/pl/help/apilo-zwroty/ |
| B-16 | Unknown | No purchase-cost field in the product API schemas. Reports not checked for margin. | S3 `ProductModel` |
| B-17 | Partial | "Wariant 3: Użyj Managera aukcji Allegro lub Shoper aby wystawić produkt zestawowy" (blog adds eBay). Other channels are not documented. | S1, S11 |
| B-18 | None (import) | Bundle definitions are **not imported**. The operator can only convert an imported product into a bundle by hand ("Zmień Produkt na zestaw") and add components manually. The REST API product schemas carry no component list, so bundles cannot be created through the API either. | S1: "Kliknij przycisk „Zmień Produkt na zestaw". Dodaj produkty do zestawu."; S3 ProductModel/ProductPut |
| B-19 | Partial | Handled per connector in code (changelog items), with a few operator-visible settings (Shopify discount strategy, VAT default). No setting says "price on parent vs children". | S9, S10, S8 |
| B-20 | Unknown | Apilo can use an external ERP or shop as the stock source. No doc on pack-sale double decrement. Related fact: orders exported to Shoper are "jednorazowe" and do not decrement Shoper stock unless linked. | https://apilo.com/pl/help/eksport-zamowien-z-apilo-do-shoper/: "pozycje w zamówieniach wgranych do Shoper są 'jednorazowe', to oznacza, że nie są podłączone pod magazyn Shoper i nie odejmują ilości" |
| B-21 | Unknown | Not documented. | none |

### Gifts

| ID | Rating | How | Evidence |
|---|---|---|---|
| G-01 | Unknown | No gift flag in the order item schema (`type` is only 1 Product / 2 Shipment / 3 service). No doc on reading channel gift flags. | S3 `RestOrderItemsDTO.type` |
| G-02 | Unknown | No doc on 0.00/0.01 lines. Only a negative WooCommerce line is turned into a discount. | S10 |
| G-03 | Partial | If the paid offer is linked to a bundle that includes the gift ("Czapka + szalik gratis"), the order gets the gift as its own line. Note that the gift gets a **non-zero proportional price**, not 0. | S1 examples + proportional rule |
| G-04 | Full | Documented exactly: an Allegro offer "plecak szkolny" with a promised "piórnik" is converted into a bundle so the gift appears on orders and is decremented. | S1: "Przekształć produkt na zestaw, a nie dojdzie do sytuacji w której sprzedajesz za dużo piórników lub plecaków niż masz na stanie." |
| G-05 | Full | Manual order editing adds any position (including a bundle). The pick and pack scan acts as proof. | S1: "Tworząc nowe zamówienie lub edytując istniejące skorzystaj z edycji/dodawania pozycji w zamówieniu." |
| G-06 | Partial | Automation: Zdarzenie (e.g. "Utworzenie/pobranie zamówienia") + Warunki ("Wartość zamówienia", "Źródło kanału sprzedaży", "Produkty na zamówieniu z EAN", "Metody na zamówieniu z SKU", "Data złożenia zamówienia", "Czy wykorzystano kupon rabatowy?") + Akcja "Dodaj produkt do zamówienia". Not documented: once per customer, campaign window as a first-class field, and the price/qty fields of the action. | S4 lists; S5 editor |
| G-07 | Full | A gift as a bundle component is the documented headline use case. | S1: "stwórz zestaw z gratisem" |
| G-08 | Partial | The rule could include the condition "Stan magazynowy produktu", and "Brak stanu" fires during picking. There is no swap to a substitute and no explicit "skipped" notice. | S4 |
| G-09 | Partial | A gift is an ordinary line, so it is scanned like any other. The picking assistant has one **global** acknowledged message ("dodaj gratis do zamówienia"), not per order. Nothing marks a line as a gift. | S7 |
| G-10 | Partial | Gift-in-bundle carries a proportional price, so the receipt/invoice is not 0.00. For rule-added gifts the price is not documented. There is the action "Modyfikacja stawki VAT". There is no typed gift reason. | S1, S4 |
| G-11 | Unknown | No doc. | none |
| G-12 | None (inferred) | There is no gift entity, so gifts can only be reported via tags or product reports. | S3, S4 |
| G-13 | Unknown | No doc. | none |
| G-14 | Partial | A condition exists for service lines: "Pozycje na zamówieniu o typie "Usługa"" with the example "usługa - zapakuj na prezent w Allegro". This can drive tag/status/print actions. | S4 |
| G-15 | Unknown | No per-customer condition found among the 39. | S4 |
| G-16 | Unknown | No documented failure status for an automation action. There is an option to "wymusić ponowne sprawdzenie, czy warunki zadania pozostają spełnione bezpośrednio przed wykonaniem". | S5 |

### Cross-cutting

| ID | Rating | How | Evidence |
|---|---|---|---|
| X-01 | Partial | Line prices + order-level `orderDiscounts` (type product/shipment, `idExternal`, `note`, `discountValue`). There is no per-line list price + reduction pair. Per-channel conversion happens in connector code. | S3 |
| X-02 | Partial | Per-integration setting "Strategia importu przedmiotów zamówienia": "Importuj pozycje pojedynczo" / "Grupuj pozycje na podstawie oferty" (TikTok Shop, InPost Von Halsky). Kaufland is not shown. | S9 screenshot; "Inpost Von Halsky domyślnie rozdziela każdą pozycję osobno" |
| X-03 | Partial | A few operator settings per connection (item import strategy, Shopify discount strategy, delivery mapping strategy). No setting tells Apilo "this channel sends children" or names a gift-flag field. | S9 |
| X-04 | Full | Editing an existing order and adding a bundle splits it the same way. Changes in the shop back office after import are not documented. | S1 Wariant 2 |
| X-05 | Partial | Item types Product / Shipment / Service. Shopify gift cards are handled via status. No deposit or points types. | S3; S9 Shopify FAQ: "karta zostaje wysłana mailem, a status zamówienia automatycznie jest zmieniany na "Zrealizowane"" |
| X-06 | Unknown | The discount has a `note` and `idExternal` only. No audit trail is documented. | S3 |

## Integration normalisation (how Apilo copes with per-channel encoding)

- **Catalogue linking is the normalisation layer.** Each channel offer is linked to one warehouse item in "Relacje produktów". Matching tries SKU first, then EAN, then name, and the operator can link by hand ("Połącz"); the "Rodzaj połączenia" column shows auto vs manual (S6). Bundle behaviour is purely a property of the linked warehouse item: if it is a "Zestaw produktów", the line is expanded. The channel's own bundle encoding is not interpreted.
- **Expansion replaces the line.** The order keeps component lines plus a `productSet` integer and an icon. The original channel line is not kept as its own row (S1, S2, S3). This simplifies pick/pack and stock, but it loses the "what the channel sold" view needed for writeback or returns against the channel line.
- **Discounts are fixed per connector in code**, visible only as changelog entries: WooCommerce negative lines (2024), eBay discount codes (2026-07), PrestaShop discounts (2026-09, announced 2026-05 as "pełną obsługę kodów rabatowych naliczanych w sklepie"). Shopify has a seller-side strategy field, and "Rabat rozbijany jest tylko na przedmioty". The output is order-level `orderDiscounts` with type 1 product / 2 shipment (S3, S9, S10).
- **Per-connection settings exist but are narrow**: "Strategia importu przedmiotów zamówienia" (single vs grouped by offer), "Strategia metod dostawy", import of completed orders. There are no bundle or gift declarations (S9).
- **VAT normalisation is at document time, not intake**: S8 says "większość kanałów sprzedaży nie zwraca podatku VAT przy pozycjach zamówienia". The fallback is the product card VAT or a global override. Because bundle lines are already split, mixed-VAT bundles work when the component cards carry the right VAT.
- **Bundle definitions are always OMS-owned**: they are not imported from PrestaShop packs, Shoper/IdoSell sets, Erli productSets or Subiekt komplety (S1, S3). The operator rebuilds each one by hand.

## UX patterns worth copying

1. **"Change product into bundle" ("Zmień Produkt na zestaw")** on an imported item. The offer link stays intact and the item gains components. This is a cheap path for offers whose listing promises a gift (G-04) (S1).
2. **A bundle form that shows each component's own price, its in-bundle price and its stock**, with a computed total, discount % and bundle stock in the footer row (S2: "80.64 PLN / 40.96 PLN -49.21% / 3"). The price allocation and availability are visible while editing, so they need no separate explanation.
3. **A line-level marker "derived from bundle"** on expanded lines (icon + `productSet` id), so the operator sees provenance without losing the flat pick list (S2, S3).
4. **Ordered rule actions with a "last-minute" re-check** of conditions before running ("możesz wymusić ponowne sprawdzenie, czy warunki zadania pozostają spełnione") plus prebuilt templates ("Popularne") (S5). This suits gift rules that must not fire on stale stock.
5. **A per-connection import strategy dropdown** ("Importuj pozycje pojedynczo" / "Grupuj pozycje na podstawie oferty") as an explicit, operator-visible normalisation choice (S9).
6. **A mandatory acknowledged picker message** ("osoba zbierająca będzie musiała ją zatwierdzić") is a usable pattern if made per order or per rule rather than global (S7).

## Anti-patterns

1. **15-minute bundle stock recompute** ("przeliczany co 15 minut") is an oversell window on the last unit of a shared component (S1).
2. **Destructive expansion**: the channel's bundle line is replaced by components. Writing back per-line shipment, refunds or returns against the channel's own line has nothing to refer to (S1, S3). Inference, not observed.
3. **A gift gets a proportional share of the price** inside a bundle. A "free" item then shows a price on the invoice, and returning only the gift refunds part of the paid item. The model has no 0-price or "rebate" representation (S1). Inference about consequences.
4. **No gift concept at all**: gift handling is spread over bundles, a generic "add product" action and a global picker message. Gifts cannot be reported, limited per customer, or shown with a failure status (S3, S4, S7).
5. **Discount semantics live in per-connector code** that changes in changelogs, with an order-level-only API shape. Integrators cannot see or override how a given channel's discounts land (S3, S10).

## New use cases (with source)

- **N-1 Convert an existing imported listing product into a bundle in place**, keeping the offer link and stock sync. Source: S1 "Stwórz zestaw Apilo z aukcji/oferty/produktu".
- **N-2 Unit-of-measure multipack**: bundle = N units of a component sold by length or weight (cable sold per metre, offer "5m"). Source: S1 "ilość sztuk na magazynie to metry".
- **N-3 Gift rule conditioned on "a discount coupon was used"** (condition "Czy wykorzystano kupon rabatowy?") or on "the order contains a bundle" ("Czy w zamówieniu istnieje zestaw?"). Source: S4.
- **N-4 Gift-wrap service line as a trigger** (Allegro "zapakuj na prezent" arriving as a Usługa line) to drive pack-bench instructions. Source: S4.
- **N-5 Exporting orders to a downstream shop/ERP where lines are "one-off" and do not decrement stock unless linked**. This is a double/no decrement hazard for bundles pushed downstream. Source: https://apilo.com/pl/help/eksport-zamowien-z-apilo-do-shoper/.
- **N-6 Shipping cost folded proportionally into item lines on the invoice** ("Dodaj cenę proporcjonalnie"). This is the same allocation question as bundle price splitting, so one allocation rule could serve both. Source: S8.

## Confidence and gaps

- High: B-01, B-02 (incl. 15-min lag), B-04 mechanism, B-08, B-14 proportional allocation, G-04, G-07, the automation vocabulary, and the API shapes. All rest on primary docs, screenshots or the spec.
- Low or unknown: anything about channel-specific bundle encodings (Allegro productSet, Woo bundle plugins, Shopify groups, IdoSell, Kaufland), returns, cost, and gift fallbacks. No merchant-voice evidence was found for Apilo bundles or gifts. Apilo's help pages are the only source, and they may lag the product.
