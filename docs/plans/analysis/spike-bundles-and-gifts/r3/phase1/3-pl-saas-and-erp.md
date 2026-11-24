# R3 / phase 1 / 3 - PL SaaS shops (Shoper, IdoSell, Sky-Shop) and Subiekt GT / nexo as product master

Round 3, blind replication. Written without reading earlier rounds, the use-case catalogue or the spike plan.
Date of research: 2026-11-04.

Source kinds used: [API] official API spec, [HELP] official help centre / knowledge base, [VEND] vendor marketing or
app-store page, [3P] third-party (forum, partner, freelance post), [CODE] OpenLinker / bridge source, [SDK] vendor
SDK help file shipped with the product (gta.chm, Sfera API dump).

## Sources consulted

| # | Source | Kind | What it gave |
|---|---|---|---|
| S1 | https://www.shoper.pl/learn/artykul/zestawy-produktow | HELP | Shoper set definition, stock, own cap, variants, panel display |
| S2 | https://www.shoper.pl/help/artykul/stany-magazynowe-zestawow/ | VEND (Appstore, Maxsote) | set stock = min of components, hourly, paid app |
| S3 | https://www.shoper.pl/learn/?p=1108 ("Zestawy produktów w sklepie Shoper, a faktury w Shoper Faktury i Magazyn") | HELP | set name on invoice, components on WZ |
| S4 | https://storefront.developers.shoper.pl/object-api/objects/products/bundle/ and /bundle-item/ | API (storefront) | ProductBundle / ProductBundleItem fields |
| S5 | https://www.shoper.pl/aplikacje/produkt-gratisowy-w-koszyku | VEND (Maxsote app) | gift = a product variant at promo price, 0 / 0.01 / 1 zł |
| S6 | https://www.shoper.pl/aplikacje/growgift-progi-gratisow-per-marka | VEND (GrowCommerce app) | placeholder cart line swapped for the real gift after the order |
| S7 | developers.shoper.pl (REST API reference) | API | NOT readable: login wall ("Invalid email or password"); field-level order-products / products schema for bundles is Unknown |
| S8 | github.com/dreamcommerce/shop-appstore-lib (official PHP SDK, last commit 2021-10-22) | SDK | resource list: no `Bundle` resource; resource classes carry no field docs |
| S9 | https://idosell.readme.io/reference/ordersordersget (spec `/branches/8.0/apis/api-admin.json`) | API | order lines: `bundleId`, `orderSalesMode` money/gift/points |
| S10 | https://idosell.readme.io/reference/productsproductsget | API | `productType` product_bundle / product_collection, `productBundleItems`, `productIsGratis` |
| S11 | https://idosell.readme.io/reference/ordersorderspost | API | order create: `productFree`, `productBundleItems` |
| S12 | https://idosell.readme.io/reference/productsbundlesbundlespost, ...productsbundlesproductspost | API | set creation, `addType` (who picks sizes) |
| S13 | https://pomoc.idosell.com/towary/zestawy-kolekcje-grupowanie-towarow | HELP | set vs collection, computed stock, document presentation switch, WZ always split |
| S14 | https://pomoc.idosell.com/sprzedaz/zwroty-i-reklamacje/zwroty-i-reklamacje-instrukcja-konfiguracji | HELP | component return only if set was NOT shown as one line at sale time |
| S15 | https://www.idosell.com/pl/tysiace-gotowych-do-uzycia-funkcji/baza-produktow-w-idosell/zestawy-towarow-i-konfiguratory/ | VEND | set stock not settable, 2+1 gratis inside a set |
| S16 | https://sky-shop.pl/pomoc-faq/produkty/zarzadzanie-produktami/jak-dodac-zestaw-produktow/ | HELP | set type, stock source choice, ignore component stock, VAT on invoice, no Allegro, no nesting |
| S17 | Sky-Shop WebAPI docs, served by every store at `/api` (fetched from https://labuna.pl/api -> `/api/dbdata/1`, 71 kB markdown) | API | function list; zero mentions of set / gratis / bundle; response fields undocumented |
| S18 | gta.chm (Sfera GT help, local copy `/mnt/c/Users/42zer/gtspike/gta.chm`, extracted to scratchpad) | SDK | `TowarRodzajEnum` (komplet = 8), `Towar.Skladniki`, `TwSkladnik.Ilosc`, `SuPozycje.Dodaj` + linked assortment, `PominAsortymentPowiazany` |
| S19 | `/home/nor/projekty/blocky/sfera-api-main/tools/SferaInspect/api-dump-api.txt` (Sfera nexo public API dump) | SDK | `ISkladnikiKompletu`, `PodrodzajAsortymentu.Komplet`, `WyliczCeneKompletuJakoSumeCenSkladnikow`, gift-related document errors |
| S20 | https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/1022,subiekt-gt-jak-stworzyc-komplet-w-programie.html | HELP (InsERT) | komplet must be assembled ("Zmontuj") to appear in the warehouse |
| S21 | https://forum.insert.com.pl/index.php?/topic/71628-... (2 Nov 2021) | 3P (forum, partner installers) | komplet on paragon = one line with the komplet's own VAT rate |
| S22 | https://useme.com/pl/jobs/subiekt-nexo-pro-sfera-pro-dodatek-automatyczny-montaz-kompletow-przy-zapisie-wz,135569/ | 3P (merchant job post) | nexo: kit stock goes down on sale, component stock does not |
| S23 | `libs/integrations/shoper/**`, `libs/integrations/subiekt/**`, `libs/integrations/subiekt-nexo/**`, bridge at `/home/nor/projekty/blocky/openlinker-subiekt-bridge` (HEAD 21f909c, 2026-09-29) | CODE | what OpenLinker reads and writes today |

## Findings per platform

### Shoper

Bundle definition. Native "zestaw" is its own product type with its own card and a "Produkty w zestawie" tab.
- S1 [HELP]: "pozwala na tworzenie zestawów produktów" ... "które produkty mają być elementami zestawu oraz ile sztuk danego produktu ma być oferowane w zestawie"; price: "łączenie wielu produktów w jedną ofertę z określoną, własną ceną".
- S4 [API storefront]: "The ProductBundle object represents a bundle type of product." Fields `product`, `items` (ProductBundleItemsList), `originalItemsPrice`, `hasItemWithNotStockOption` ("Indicates if bundle has item with options without warehouse control (non-stock options)."). ProductBundleItem: `id`, `order`, `quantity` (float), `bundle`, `variant` (ProductVariant), `stockProductOptions`, `notStockProductOptions`.

Variants. A component is pinned to one stock variant; a different variant = a different set.
- S1: "każdy wariant dodany do zestawu jest traktowany jak pojedynczy produkt z listy asortymentu" ... "będzie osobnym zestawem na liście asortymentu". But S4 `notStockProductOptions` + `hasItemWithNotStockOption` imply the buyer can still choose NON-stock options (e.g. engraving text) per component.

Bundle stock. Computed from components at sale, with an optional own cap; set-level stock number is not native.
- S1: "Stany magazynowe pojedynczych produktów wchodzących w skład zestawu zostają automatycznie zaktualizowane"; "Gdy któryś z produktów z zestawu zostanie wyprzedany, zestaw również przestaje być dostępny w sprzedaży."; "Możesz również wpływać na to ile sztuk zestawów maksymalnie może zostać sprzedane."
- S2 [VEND, paid Maxsote app]: "stan magazynowy zestawu staje się najniższym stanem jego składowego produktu" ... "Aplikacja co godzinę aktualizuje automatycznie wszystkie zestawy w sklepie." => without the app the set's own stock figure is not the min of components. Conflict: S1 says availability follows components natively; S2 sells a fix for the stock NUMBER. Both trusted; they describe different things (availability vs displayed/exported number).

Promotions. S1: "Funkcjonalność zestawów nie jest objęta możliwością utworzenia standardowej promocji na produkt"; S1 lists as a use case "Produkt X gratis przy zamówieniu 2 sztuk produktu Y" (a gift modelled AS a set).

Order with bundle. Admin panel shows both the set and its components (S1: "widoczna jest informacja na temat zamówionego zestawu oraz produktów składowych zestawu"). REST `order-products` shape for a set: **Unknown** - developers.shoper.pl is behind a login (S7), the official SDK documents no fields (S8), and the OL test fixtures (captured from live orders 2 and 7) contain no set. Whether a set arrives as one row, a parent + child rows, or children only, and how the set price is split, cannot be stated.

Documents. S3 [HELP, Shoper Faktury i Magazyn]: "To na fakturze będzie widniała nazwa zestawu produktów np. zestaw świąteczny dla niej." / "Z kolei na dokumencie WZ będą widniały produkty wchodzące w skład zestawu." => invoice at SET level (one VAT rate on the set line), WZ at component level.

Gifts. No native gift flag found. Gifts are apps:
- S5 [VEND, Maxsote "Produkt gratisowy w koszyku"]: "Prezent może być darmowy lub kosztować na przykład 1 grosz, czy też symboliczną złotówkę."; the gift is a product VARIANT - if the app is removed the "wariant będzie pojawiał się na karcie produktu i klienci będą mogli dodać go do koszyka w cenie promocyjnej." Conditions: order value, category, producer ("Dowolne łączenie warunków").
- S6 [VEND, GrowGift]: "GrowGift wykorzystuje izolowaną pozycję koszykową, a po zamówieniu przypisuje właściwy prezent w tej samej cenie"; price "To Ty ustawiasz jego jawną cenę, widoczną i płaconą przez klienta." (min 0.01 zł per vendor page).
=> A Shoper gift reaches the order as an ordinary line (some special stock variant or a placeholder), price 0.00 - 1.00, no flag. (Order-line shape itself unverified.)

What OL reads today [CODE]: `ShoperOrderLineRow` = `id, order_id, product_id, stock_id, price, quantity, name, code, ean, tax, tax_value` (`libs/integrations/shoper/src/domain/types/shoper-api.types.ts:533-546`). `lineRef` maps `stock_id` -> variant, else `product_id` -> product, else `code` (`libs/integrations/shoper/src/infrastructure/mappers/shoper-incoming-order.mapper.ts:273-286`). No bundle, parent or gift field is read. `ShoperProduct` has no type/bundle field (`shoper-api.types.ts:145-163`).

### IdoSell

Bundle definition. `productType` enum includes "product_bundle" - set and "product_collection" - collection (S10). Set vs collection (S13): "klient sam decyduje, jakie składowe kupuje" for a collection; "W przypadku zestawu nie ma takiej możliwości." Product read exposes composition: `productBundleItems` "List of components if a products is a set or collection." with `productId`, `bundledId` ("Product ID in a set or collection"), `bundleQuantity`, `isBundleShown`, `bundledAvailableSizes`, `bundledAvailableSizesInAuctions`; and on a component `bundledIds` "Identifiers of the sets, to which the goods are assigned" (S10). Created via `products/bundles/bundles`: "createBundle method allows to create a new product with a type: set and to assign existing products as a set components" (S12).

Variants. Size choice can be left to the buyer: `addType` "selectedSizes" | "selectedSizesAsSeparateItems" | "allSizes" - "Add entire products and leave size selection to customers" | "allSizesWithVariants" (S12). S13: "Wybór odpowiedniego wariantu i rozmiaru możesz pozostawić klientowi."

Bundle stock. Computed, never own. S13: "Stany magazynowe wyliczane są na podstawie stanów magazynowych poszczególnych składowych."; "zestawów i kolekcji nie przyjmujemy na magazyn tak jak zwykłych towarów." S15: "Stanu magazynowego zestawu nie można ustawić".

Price. S13: fixed or "System może wygenerować cenę na podstawie sumy cen brutto sprzedaży towarów składowych." minus "np. 10 zł lub 10%".

Order with bundle. Order line field `bundleId` integer "A set's ID." and `orderSalesMode` "Product selling mode. Available values: "money", "gift", "points"." (S9). Also per line: `productOrderPrice` / `productOrderPriceNet`, `productVat`, `basketPosition`, `label` "Label for grouping products.", `productPacked`. Create: `products[].productFree` boolean "Free product." and `products[].productBundleItems` (componentes with `sizeId`) (S11). Whether a set arrives as one row with `bundleId`, or as component rows each carrying the set's `bundleId`, or both: **Unknown** (spec gives no example, no public sample found).

Documents (S13): switch "Pokazuj zestaw jako jedną pozycję na dokumentach sprzedaży" - on: "zestaw będzie traktowany jako jedna pozycja"; off: "każdy składowy towar w zestawie zostanie umieszczony na fakturze" "a jego cena zostanie proporcjonalnie zmniejszona, jeżeli cena zestawu jest niższa od sumy cen towarów składowych." WZ: "Na dokumentach WZ (Wydanie zewnętrzne) zestawy zawsze będą rozbijane na towary składowe."

Component return (S14): "System umożliwia zwrot lub reklamację pojedynczej składowej zestawu." only if "Zestaw musi mieć wyłączoną opcję „Pokazuj zestaw jako jedną pozycję na dokumentach”" and "Zwrot lub reklamacja składowych jest możliwy tylko dla tych zestawów, które w momencie sprzedaży miały odznaczoną opcję". => the document-presentation flag is frozen per sale and decides returnability.

Gifts. Native selling mode `gift` on the line (S9), catalogue flag `productIsGratis` "The product is free of charge" (S10), order-create `productFree` (S11). Help-centre description of gift rules: not found (only marketing bullets "Gratisowy produkt przy zakupach powyżej 300 zł" on https://idosell.com/en/shop/marketing/special-offers). Gift inside a set: S15 "Możesz zbudować z kilku towarów zestaw, do którego dodasz produkt/y gratis, np. (2+1 Gratis)". Gift stock / limits / VAT treatment: Unknown.

OL today: no IdoSell adapter exists (`ls libs/integrations` -> ai, allegro, dpd-polska, eparagony, erli, fx, infakt, inpost, ksef, prestashop, shoper, subiekt, subiekt-nexo, woocommerce).

### Sky-Shop

Bundle definition (S16): "Wybierz “Typ: Zestaw”"; components with "Ilość w zestawie"; "Zestaw posiada własne pola opisu, kategorii oraz zdjęć"; no nesting: "Nie, zestaw produktów nie może zostać dodany jako składnik do innego zestawu."

Bundle stock (S16): "wybierz z jakiego źródła ma być pobierany stan magazynowy" and "czy chcesz ignorować stany magazynowe produktów" => configurable; both own and computed possible. Options not enumerated in the help (Unknown which sources exist).

Price (S16): "Zestawy mogą posiadać własne ceny, różne od sumy cen produktów"; sum can be set as price or strike-through price.

Documents/VAT (S16): "Na fakturze nie będą wyświetlać się składniki zestawu ze swoimi stawkami VAT." => one set line, one rate.

Listing: "Nie, nie ma możliwości wystawienia zestawu produktów jako aukcji na Allegro." Dropshipping: components from different wholesalers block auto-forwarding.

API (S17): WebAPI functions include getOrders, getProductData, getProducts, getProductOptions, orderAdd, orderUpdate, addToReceipt, setProductAmount ...; the doc text contains 0 occurrences of "zestaw", "gratis", "bundle", "komplet", "prezent", and response fields are not documented. Order shape for sets/gifts: **Unknown**. Gift feature ("Produkty gratisowe" in plan feature lists) - (unverified), from a search summary only.

OL today: no Sky-Shop adapter.

### Subiekt GT (product master + ZK/FS/PA via bridge)

Bundle definition [SDK S18]: `TowarRodzajEnum` "gtaTowarRodzajKomplet 8 Oznacza kartotekę: Komplet" (towar 1, usługa 2, opakowanie zwrotne 4, opłata 16); `Towar.Skladniki` "Zwraca kolekcję składników kompletu typu TwSkladniki"; `TwSkladniki.Dodaj(skladnikId)` "Dodaje składnik do kompletu"; `TwSkladnik.Ilosc`. Components are other towary (InsERT e-pomoc title S20-related: a komplet can contain a komplet, per search summary - unverified quote).

Variants: none at komplet level; GT "variants" are models (`sl_ModelTw`, CODE `subiekt-product-master.adapter.ts:25-41`), and the adapter docblock already notes `DodajKomplet` is "a kit of DIFFERENT towary rather than an axis on one" (line 27).

Bundle stock: OWN stock produced by assembly. S20 [HELP InsERT]: "Aby tak zdefiniowany komplet pojawił się w magazynie, należy jeszcze go zmontować." ... "kliknąć opcję Zmontuj" ... "program automatycznie pobierze odpowiednią ilość składników potrzebnych do zmontowania danej ilości kompletów." Which documents assembly writes (PW/RW?) - not stated officially (3P sources say PW for kit, RW for components - unverified). Sfera GT `SubiektDokumentEnum` has no kompletacja document type (S18).

Order/document with komplet: `SuPozycje.Dodaj(val)` accepts "Identyfikator towaru, kompletu, usługi lub opakowania zwrotnego" (S18) => a komplet is ONE document position. `SuPozycja.TowarRodzaj` read-only tells the kind. Paragon (S21, 3P): "podczas sprzedaży na paragonie występuje nazwa zestawu ale bez stawki vat" and partner reply: komplet is "osobny towar, ale zmontowany z innych" - its own VAT rate applies. No VAT split per component.

Linked assortment (relevant to gifts) [SDK S18]: `SuPozycje.Dodaj` - "W przypadku dodania towaru, który ma zdefiniowany asortyment powiązany, standardowo po wykonaniu metody Dodaj do dokumentu zostaną dodane dwie (lub więcej) pozycje ... W takim przypadku zwracany obiekt SuPozycja będzie wskazywał na ostatnią dodaną pozycję (zawierającą asortyment powiązany)." Switch `SuDokument.PominAsortymentPowiazany` (default False, since GT 1.48).

What OL/bridge reads today [CODE]:
- Product list SELECT includes `t.tw_Rodzaj` into `Row.Kind` (`bridge-gt/Program.cs:304,332,1494`) but nothing consumes it (grep: no other `Kind` use). Stock = `SUM(st_Stan)` from `tw_Stan` (`Program.cs:317`) => for a komplet that is assembled stock only.
- ZK/FS/PA writes add each line with `d.Pozycje.Dodaj(symbol)` and then set `IloscJm`, `WartoscBruttoPrzedRabatem`, `WartoscBruttoPoRabacie` on the RETURNED position (`bridge-gt/Sfera.cs:335-350`, `Invoicing.cs:515-529`, also `FiscalizationEndpoints.cs:161`, `Invoicing.cs:397`, `InventoryEndpoints.cs:253`). `PominAsortymentPowiazany` is not set anywhere (grep: 0 hits). If a towar has a linked assortment, quantity and buyer price land on the LINKED item and the main item keeps catalogue price/qty 1 (inference from S18 + code; not live-tested).
- ZK order-source reads lines `tw_Symbol, tw_Nazwa, ob_Ilosc, ob_WartBrutto` from `dok_Pozycja` (`bridge-gt/OrdersEndpoints.cs:562-565`) - no kind, no parent.

### Subiekt nexo

Bundle definition [SDK S19]: `PodrodzajAsortymentu` = Komplet | Opakowanie | Towar; `ISkladnikiKompletu.Dodaj(symbolAsortymentu, Decimal ilosc, String jednostkaMiary)`; errors `NieZdefiniowanoSkladnikowKompletuBlad`, `SkladnikKompletuZawieraObecnyKompletBlad`, `KompletZawieraUsunieteAsortymentyBlad`. Price list: `WyliczCeneKompletuJakoSumeCenSkladnikow`, `SzacujKosztKompletuJakoSumeKosztuSkladnikow`. `IRaportKompletow.Wylicz()` returns per-component rows (`IloscSkladnika`, `Cena`, `Wartosc`).
Bridge reader comment [CODE]: "Rodzaj_Id: 2 = towar, 1 = usługa, 4 = komplet, 3 = opakowanie." (`bridge/Subiekt.Bridge.Infrastructure.Sql/SqlProductCatalogReader.cs:14`) - note: nexo numbering differs from GT's enum (komplet 8). Source of the nexo numbers is a code comment, unverified against InsERT docs.
Stock: S22 [3P merchant]: kit (KT) stock goes down on sale while component (TW) stock does not, unless assembled - merchant wants an add-on that assembles on WZ. => own-stock kit, same as GT.
Gifts: nexo document layer knows gifts: `KolorowanieGratisow`, `NieMoznaWydacWiecejGratisowNizNaZaliczkowejBlad`, `NaglowekKosztGratisow` (S19). How a gift position is flagged on a document (field name): Unknown (entity model DLL not in the dump).
Note: nexo "Kompletacja" in `KompletujZamowienie(...)` / `IPozycjaKompletacji.AktualnyProcentKompletacji` is ORDER completion (fulfilment percentage), not kit assembly - easy to confuse.

## Checklist (one line each)

| Item | Shoper | IdoSell | Sky-Shop | Subiekt GT | Subiekt nexo |
|---|---|---|---|---|---|
| bundle definition | Native set type, components + qty (S1, S4) - Full | `product_bundle` + `product_collection` (S10) - Full | "Typ: Zestaw", no nesting (S16) - Full | Komplet = rodzaj 8 + Skladniki (S18) - Full | Podrodzaj Komplet + ISkladnikiKompletu (S19) - Full |
| variants | Component pinned to a stock variant; other variant = other set; non-stock options buyer-chosen (S1, S4) - Partial | Buyer may pick size/variant (`addType`) (S12) - Full | Unknown | No (models are a separate axis) | Unknown |
| bundle stock | Availability from components + optional cap; numeric min only via paid app (S1, S2) - Partial | Computed, never own (S13) - Full | Choosable source / ignore components (S16) - Full | OWN, after "Zmontuj" (S20) - Full | OWN; sale decrements kit not components (S22, 3P) - Partial |
| listing | Storefront components; no standard promo on sets (S1) | Sets usable for auctions (S15); sizes for marketplaces (S10) | Set cannot go to Allegro (S16) | n/a | n/a |
| order with bundle | Panel shows set + components; REST shape Unknown (S1, S7) | Line `bundleId`; parent/child layout Unknown (S9) | Unknown (S17) | One position per komplet (S18) | Unknown (likely same) |
| packing | WZ lists components (S3) | WZ always components (S13) | Unknown | Komplet line only; components only via assembly | Unknown |
| component return | Unknown | Only if set not shown as one line at sale (S14) - Partial | Unknown | Unknown | Unknown |
| return with gift | Unknown | Unknown | Unknown | Unknown | Unknown |
| VAT split | Invoice shows set name (one line) (S3) | Off-switch: components on invoice with proportional price (S13) | No per-component VAT on invoice (S16) | Komplet's own rate (S21, 3P) | Unknown |
| gift source | Apps: special variant or post-order swap (S5, S6) | Native `orderSalesMode=gift`, `productIsGratis`, `productFree` (S9-S11) | Feature listed (unverified) | Linked assortment auto-added (S18) - used as gift mechanism (inference) | Native gift concept on documents (S19) |
| gift stock | Normal variant stock (inference from S5) | Unknown | Unknown | Linked towar's own stock | Unknown |
| gift on documents | Ordinary line at 0-1 zł (S5, S6; unverified on doc) | Unknown | Unknown | Separate position | "Koszt gratisów" header (S19) |
| gift limits | Per-app conditions; per-order limit not stated (S5) | Unknown | Unknown | n/a | "cannot issue more gifts than on advance invoice" error (S19) |

## Use cases (PLS)

See the condensed table in the hand-back; the same rows:

PLS-01 Shoper | merchant | sells a native set | order-products rows: stock_id/product_id/code/price/qty - set layout Unknown | OL cannot tell set from component; may double-decrement or miss | S1 "widoczna jest informacja na temat zamówionego zestawu oraz produktów składowych zestawu", S7 login wall
PLS-02 Shoper | merchant on "Produkt gratisowy w koszyku" | gift added by order value | an ordinary line, price 0 / 0.01 / 1 zł, a dedicated stock variant | no flag; OL creates a new variant mapping, stock taken from a gift variant | S5 "Prezent może być darmowy lub kosztować na przykład 1 grosz"
PLS-03 Shoper | merchant on GrowGift | gift swapped after the order | placeholder line, later replaced server-side | OL may ingest the placeholder; line edits do not bump order status_date (live note) so the swap may never be polled | S6 "po zamówieniu przypisuje właściwy prezent w tej samej cenie"
PLS-04 Shoper | merchant | set stock shown wrong to channels | set has own stock number unless paid app | OL (as ProductMaster reader) publishes a set stock that is not min(components) | S2 "stan magazynowy zestawu staje się najniższym stanem jego składowego produktu" (paid app)
PLS-05 Shoper | accountant | invoice set vs WZ components | invoice: set name; WZ: components | a single set line has one VAT rate even if components differ | S3
PLS-06 IdoSell | merchant | sells set, buyer picks sizes | `productBundleItems` with sizeId on create; `bundleId` on read lines | need the chosen component sizes to reserve right stock | S12 addType "leave size selection to customers"
PLS-07 IdoSell | merchant | flags a gift line | `orderSalesMode: "gift"` | adapter can map to neutral gift flag; price 0 likely | S9 enum money/gift/points
PLS-08 IdoSell | merchant | points-paid product | `orderSalesMode: "points"` | not money, not gift; neutral model needs a third mode or price-0 + reason | S9
PLS-09 IdoSell | customer | returns one component of a set | allowed only if set not shown as one line at sale | return rules depend on a per-sale document-presentation flag the order API does not expose (Unknown) | S14
PLS-10 IdoSell | accountant | set split on invoice with proportional prices | switch per set | OL invoicing must replicate the proportional allocation or show one line | S13 "cena zostanie proporcjonalnie zmniejszona"
PLS-11 Sky-Shop | merchant | set with own stock or component stock | configurable per set | stock owner differs per set; API does not say which | S16 "z jakiego źródła ma być pobierany stan magazynowy"
PLS-12 Sky-Shop | merchant | wants set on Allegro via OL | platform forbids | OL could list it from its own catalogue - conflicting source of truth | S16 "nie ma możliwości wystawienia zestawu produktów jako aukcji na Allegro"
PLS-13 Subiekt GT | merchant | komplet in master, sold on marketplace | stock = assembled kits only | OL publishes 0 for an unassembled komplet even with components on hand | S20 "należy jeszcze go zmontować"
PLS-14 Subiekt GT | OL bridge | writes ZK/FS with a towar that has linked assortment | Dodaj returns the LAST (linked) position | buyer price and quantity land on the linked item | S18 SuPozycje.Dodaj; CODE Sfera.cs:335-350
PLS-15 Subiekt GT | accountant | paragon for a komplet | one line, komplet's own VAT | mixed-rate components taxed at one rate | S21 (3P)
PLS-16 Subiekt nexo | merchant | sells kit, components not decremented | own kit stock | component stock drifts unless assembled | S22 (3P)
PLS-17 Subiekt nexo | OL bridge | reads assortment list | Rodzaj_Id (4 = komplet per code comment) | numbering differs from GT (8) | CODE SqlProductCatalogReader.cs:14

## Conflicts / open questions

- Shoper: native help (S1) says set availability follows components; Maxsote app (S2) sells a computed set stock number. Both can be true (availability gate vs exported stock figure). Cannot resolve without the REST schema or a live set.
- Subiekt komplet kind code: GT Sfera says 8 (S18); the nexo bridge comment says 4 for nexo `Asortymenty.Rodzaj_Id`. Different products, different tables; the nexo value is only a code comment.
- IdoSell `bundleId` semantics (on component rows, on the set row, or both): spec does not say.
- Shoper REST order-products for sets: Unknown (login wall). A live read-only test on the existing trial shop with a panel-made set would settle it.

## Confidence

- High: IdoSell fields (`bundleId`, `orderSalesMode`, `productType`, `productBundleItems`, `productFree`, `productIsGratis`) - read from the published OpenAPI. GT komplet model and `SuPozycje.Dodaj` linked-assortment behaviour - vendor SDK help. Shoper set rules and document behaviour - official help.
- Low: Sky-Shop anything beyond the help page; nexo stock behaviour (one merchant post); GT paragon VAT (partner forum).
- Unverified hypotheses: GrowGift swap not reaching OL by poll; linked-assortment price misplacement in the bridge.
