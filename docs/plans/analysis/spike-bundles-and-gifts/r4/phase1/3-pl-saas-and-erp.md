# R4 / phase 1 / 3 - PL SaaS shops and ERP: Shoper, IdoSell, Sky-Shop, Subiekt GT / nexo

Round 4, primary sources only. Researched 2026-11-04.

Question: how do bundles (zestawy / komplety) and free gifts (gratisy) appear in orders, how is composition exposed, and what does "stock of a komplet" mean on each platform? What does OpenLinker read today?

## Sources consulted (all primary unless marked)

| # | Source | Kind | What it gave |
|---|---|---|---|
| S1 | `github.com/dreamcommerce/shoper-sdk-php` @ `d8552e7827e273d6257bbd1d5019e3f53c5b1d53` (2026-10-22), "Shoper REST API SDK for php - auto-generated from OpenAPI spec" | Official SDK, generated from Shoper's OpenAPI | `OrderProduct.type`, `children`, `OrderProductChildrenItem`, `Product.type`, `ProductChildrenItem` |
| S2 | `https://www.shoper.pl/learn/artykul/zestawy-produktow` (upd. 3 Jun 2026) | Official Shoper help | bundle stock, price, variants, order display |
| S3 | `https://storefront.developers.shoper.pl/object-api/objects/products/bundle/`, `.../bundle-item/`, `.../js-models/models/product/bundle-child/` | Official Shoper storefront dev docs | storefront bundle object model |
| S4 | `https://www.shoper.pl/learn/artykul/gratis-w-sklepie-internetowym-jak-legalnie-i-madrze-go-oferowac` (15 Oct 2026) | Official Shoper help | gifts are App Store apps |
| S5 | `https://idosell.readme.io/reference/ordersorderssearchpost` (+ `ordersordersget`, `ordersorderspost`, `productsproductssearchpost`, `productsbundlesbundlespost`, `productscollectionspost`, `productsbundlesproductsquantityput`) downloaded 2026-11-04 | Official IdoSell Admin API reference (OpenAPI embedded in page) | `orderSalesMode`, `bundleId`, `productFree`, `productBundleItems`, `productType` |
| S6 | `https://pomoc.idosell.com/towary/zestawy-kolekcje-grupowanie-towarow` | Official IdoSell help | set/collection stock, document split, price split |
| S7 | `https://pomoc.idosell.com/marketing-i-promocje/rabaty-i-promocje/rabaty-progowe-i-towary-gratisowe`, `.../oferty-specjalne` | Official IdoSell help | gift marking, gift constraints |
| S8 | `https://sky-shop.pl/pomoc-faq/produkty/zarzadzanie-produktami/jak-dodac-zestaw-produktow/` (mod. 2025-07-15), `.../jak-tworzyc-gratisy-w-sklepie/` (mod. 2025-03-07), `.../integracje/wlasny-kod-i-api/jak-uzyskac-klucz-web-api-sklepu/` (mod. 2024-08-28) | Official Sky-Shop help | set config, gift rules, API docs are in-panel only |
| S9 | InsERT e-Pomoc GT: `.../1022,subiekt-gt-jak-stworzyc-komplet-w-programie.html` (08.03.2023), `.../3694,...jak-zmontowac-komplet-z-kompletu.html` (26.03.2024), `.../3933,...jak-rozmontowac-komplet.html` (17.12.2021) | Official InsERT help | GT komplet stock semantics |
| S10 | InsERT e-Pomoc nexo: `.../2659,co-to-jest-komplet-...-subiekt-nexo.html`, `.../2660,jak-zmontowac-komplet-w-programie-subiekt-nexo.html` (25.06.2024), `.../2661,jak-rozmontowac-komplet-...-subiekt-nexo.html` | Official InsERT help | nexo komplet stock semantics |
| S11 | `/home/nor/projekty/blocky/sfera-api-main/tools/SferaInspect/api-dump-api.txt` - reflection dump of InsERT `InsERT.Moria.API.dll` (Sfera for nexo). Local only, NOT redistributable (InsERT EULA) | Vendor binary surface (names and signatures only; no semantics) | Sfera nexo type/method names for komplety |
| S12 | OpenLinker code: `libs/integrations/shoper/**`, `libs/integrations/subiekt/**`, `libs/integrations/subiekt-nexo/**` (this worktree, branch `zestawy-gratisy-rekonesans-c15354`, HEAD 9e35aec9d) | Own code | what OL reads today |
| S13 | `openlinker-subiekt-bridge` repo @ `21f909cf2f2f66c0fa9b21a3444790391e232e9d` (local companion bridge) | Own companion code | which Subiekt columns the bridge reads |

No primary source found (rated Unknown): Sky-Shop WebAPI order/product schema (behind panel login), Shoper REST behaviour of child rows in `GET /order-products`, IdoSell whether a set's own row appears in `productsResults`, Subiekt GT automatic assembly on sale.

---

## 1. Shoper

### 1.1 Bundle in an order: `type` + `children` on the order line

S1 `src/Rest/Types/OrderProduct.php`:

- line 15-18: `@var ?array<OrderProductChildrenItem> $children an associative array with product bundle children info` / `#[JsonProperty('children')...]`
- line 186-193: `line item type: <code>0</code> - a regular product, <code>1</code> - a product bundle whose components are returned in the \`children\` array.` / `#[JsonProperty('type')]`
- `src/Rest/Types/OrderProductType.php`: `case Zero = "0"; case One = "1";` - the enum has exactly two values. There is NO gift value.

S1 `src/Rest/Types/OrderProductChildrenItem.php` - JSON properties of a child (verbatim list): `bundle_child_id`, `code`, `delivery_time`, `discount_perc`, `file_options`, `id`, `is_digital`, `name`, `option`, `order_id`, `pkwiu`, `price`, `quantity`, `stock_id`, `tax`, `tax_value`, `text_options`, `unit`, `unit_fp`, `unit_id`, `weight`. Doc lines:
- line 12: `@var int $bundleChildId bundle child identifier`
- line 45: `@var ?string $id order product identifier`
- line 81: `@var ?string $price child price`
- line 93-97: `[product stock](#tag/ProductStocks) identifier. Value <code>0</code> means the product has never existed in catalog ...`

Observations:
- A child carries its own `stock_id`, `quantity`, `price`, `tax`, `tax_value`, `pkwiu`. It does NOT carry `product_id` (the catalogue Product carries it, the order child does not).
- A child carries `id` described as "order product identifier" and its own `order_id`. That suggests children are themselves `order-products` records. Whether `GET /order-products?filters[order_id]=X` ALSO returns the children as separate top-level rows (double-count risk) is **Unknown - no primary source**; the documentation page is behind a login (developers.shoper.pl answered 403/login to automated fetch).
- What `price` on the parent means relative to children prices (sum? bundle price with children re-priced?) is **Unknown**. "child price" is the only description.
- Write side: `OrderProductInsert` and `OrderProductUpdate` also accept `children` (`src/Rest/OrderProducts/Requests/OrderProductInsert.php:16`: `@var ?array<OrderProductInsertChildrenItem> $children an associative array with product bundle children info`).

### 1.2 Bundle in the catalogue: `Product.type` + `Product.children`

S1 `src/Rest/Types/Product.php`:
- line 120: `@var ?array<ProductChildrenItem> $children an array with product bundle components; returned only for bundles (product type 1)`
- line 340-346: `type of product: <ul> <li>0 - product,</li> <li>1 - bundle,</li> </ul>`

S1 `src/Rest/Types/ProductChildrenItem.php`: `bundle_id` ("product bundle identifier"), `id` ("child identifier"), `order` ("child order"), `product_id`, `stock` ("quantity of this component in a single bundle"), `stock_id`.
Note the naming trap: in the catalogue child, the field called `stock` is the per-bundle QUANTITY, not a stock level.

Storefront model (S3) adds what the admin REST does not show:
- ProductBundle: "The ProductBundle object represents a bundle type of product." Fields `items`, `originalItemsPrice` ("Original items price represented by a Price Object"), `hasItemWithNotStockOption` ("Indicates if bundle has item with options without warehouse control (non-stock options).")
- ProductBundleItem: "The ProductBundleItem object represents a children's of a bundle." Fields `quantity` (float, "Quantity of the bundle item."), `variant`, `stockProductOptions`, `notStockProductOptions`.
- BundleChild (JS model): "`BundleChild` represents a single child product within a bundle, as returned by the product API." with `quantity: string`, `bundleStockId: string`.

### 1.3 Bundle stock semantics

S2 (official help), verbatim:
- "Funkcjonalność pozwala na łączenie wielu produktów w jedną ofertę z określoną, własną ceną."
- "Stany magazynowe pojedynczych produktów wchodzących w skład zestawu zostają automatycznie zaktualizowane"
- "Gdy któryś z produktów z zestawu zostanie wyprzedany, zestaw również przestaje być dostępny w sprzedaży."
- "każdy wariant dodany do zestawu jest traktowany jak pojedynczy produkt z listy asortymentu" ... "będzie osobnym zestawem na liście asortymentu"
- "Możesz również wpływać na to ile sztuk zestawów maksymalnie może zostać sprzedane."
- "Funkcjonalność zestawów nie jest objęta możliwością utworzenia standardowej promocji na produkt"
- "widoczna jest informacja na temat zamówionego zestawu oraz produktów składowych zestawu"

Reading: component stock is the physical truth and is decremented on sale (Full). The bundle has a sell cap ("ile sztuk zestawów maksymalnie"). Whether the bundle's own `product-stocks.stock` value returned by REST is a derived min-of-components number or a manually set cap is **Unknown** (no primary source states it).

### 1.4 Gifts

- No gift value anywhere in the order-line schema (S1: `OrderProductType` is `0|1`; no `gift`/`free` flag in `OrderProduct`). The only "free" concept is a **free line item** = a line created without `product_id` and `stock_id` (S1 `OrderProduct.php:45-48`: "Empty string when the line item is not linked to an existing stock - for example a free line item created without `product_id` and `stock_id`"). "Free" there means "not linked to the catalogue", NOT "price 0".
- S4: "W Shoper App Store dostępne są aplikacje, które pomagają przygotować i obsługiwać promocje z gratisami." Gifts are third-party apps, not core. How an app's gift lands in `order-products` (price 0 line? discount?) is **Unknown** per app.

### 1.5 What OpenLinker reads today (Shoper)

- `libs/integrations/shoper/src/domain/types/shoper-api.types.ts:533-546` - `ShoperOrderLineRow` declares `id, order_id, product_id, stock_id, price, quantity, name, code, ean, tax, tax_value`. **No `type`, no `children`.**
- `libs/integrations/shoper/src/infrastructure/adapters/order-source/shoper-order-source.adapter.ts:549` - reads `/order-products` filtered by `order_id`, every row becomes a line.
- `libs/integrations/shoper/src/infrastructure/mappers/shoper-incoming-order.mapper.ts:273-286` (`lineRef`): `stock_id > 0` -> `{ type: 'variant' }`, else `product_id` -> `'product'`, else SKU. `:288-302` (`mapLine`): `price` = gross unit, `quantity`, no parent/child or gift fields. `:368`: `items: lines.map(mapLine)`.
- Consequence: a type-1 bundle line is ingested as ONE line pointing at the BUNDLE's own stock row; its `children` are silently dropped. If Shoper also lists the children as separate rows (Unknown, see 1.1), they would be ingested as extra priced lines.
- Write side: `shoper-api.types.ts:362-375` `ShoperOrderProductCreateRequest` = `order_id, stock_id, price, quantity, name, tax, tax_value`; never sends `children`.
- Catalogue: `ShoperProduct` (`shoper-api.types.ts:145-163`) has no `type`/`children`; bundles are read as ordinary products, so a bundle's own `stock.stock` (`:93`) is fed to InventoryMaster as if it were physical stock.

---

## 2. IdoSell

OL has no IdoSell adapter (`ls libs/integrations` = ai, allegro, dpd-polska, eparagony, erli, fx, infakt, inpost, ksef, prestashop, shoper, subiekt, subiekt-nexo, woocommerce).

### 2.1 Order line fields (orders search / orders get)

S5 `orders/orders/search` response `productsResults[]` (full field list): `productId, productName, productCode, versionName, sizeId, sizePanelName, productSizeCodeExternal, stockId, productSerialNumber, productQuantity, productWeight, productVat, productVatFree, productPanelPrice, productPanelPriceNet, productOrderPrice, productOrderPriceNet, productOrderPriceBaseCurrency, productOrderPriceNetBaseCurrency, orderAdditionalList, remarksToProduct, label, orderSalesMode, bundleId, productSerialNumbers, productOrderAdditional, basketPosition, productPriceLog, priceFormulaParameters`.

Verbatim definitions:
- `"orderSalesMode":{"type":"string","description":"Product selling mode. Available values: \"money\", \"gift\", \"points\".", ..."enum":["money","gift","points"]}`
- `"bundleId":{"type":"integer","description":"A set's ID."}`
- `"label":{"type":"string","description":"Label for grouping products."}`
- `"basketPosition":{"type":"integer","description":"Item in basket."}`

`orders/orders` GET carries the same `orderSalesMode` and `bundleId` (S5 `ordersordersget`).

Not in the read schema: `productBundleItems` (0 hits on the search page). Whether the SET ITSELF appears as a row (with components carrying `bundleId`) or only components appear is **Unknown** from the schema; S6 says the cart adds the components ("Dodając do koszyka zestaw, doda wszystkie produkty, które sprzedawca określił jako składowe"), which suggests component rows tagged by `bundleId` (unverified - needs a live order).

### 2.2 Order create (write side) is asymmetric

S5 `orders/orders` POST `products[]`: `productFree` (`"type":"boolean","description":"Free product."`), `forceLoyaltyPoints`, and `productBundleItems` (`"List of components if a products is a set or collection."` with `productId, sizeId, sizePanelName, productIndex`). Read uses `orderSalesMode`+`bundleId`; write uses `productFree`+`productBundleItems`.

### 2.3 Catalogue

S5 products search:
- `productType`: `"Product type. Allowed values: \"product_item\" - Goods, \"product_packaging\" - packaging, \"product_bundle\" - set. \"product_collection\" - collection. \"product_service\" - service. \"product_virtual\" - virtual product. \"product_configurable\" - configurable product."`
- `productBundleItems[]`: `productId` ("Product IAI code"), `bundledId` ("Product ID in a set or collection"), `bundleQuantity` ("Number of products in a set or collection"), `isBundleShown`, `bundledAvailableSizes`, `bundledAllSizes`, `bundledAvailableSizesInAuctions`.
- `bundledIds`: "Identifiers of the sets, to which the goods are assigned".
- `products/bundles/bundles` POST: "createBundle method allows to create a new product with a type: set and to assign existing products as a set components."

### 2.4 Set vs collection, stock, documents, price split (S6 verbatim)

- "Stany magazynowe wyliczane są na podstawie stanów magazynowych poszczególnych składowych."
- "Jeśli jedna ze składowych nam się skończy, zestaw z automatu będzie niedostępny."
- "Klient, żeby skorzystać ze specjalnej ceny, musi kupić cały zestaw." vs collection: "klient sam decyduje, jakie składowe kupuje"
- Toggle "Pokazuj zestaw jako jedną pozycję na dokumentach sprzedaży": TAK -> "zestaw będzie traktowany jako jedna pozycja"; NIE -> "każdy składowy towar w zestawie zostanie umieszczony na fakturze"
- "Na dokumentach WZ (Wydanie zewnętrzne) zestawy zawsze będą rozbijane na towary składowe."
- "Rozdzielając cenę zestawu na składowe zgodnie z tym, jak dużą częścią sumy cen stanowiła cena danej składowej" (example: set 10 zł from components 20 and 30 -> 4 and 6), rounding residue goes to single-unit components first; "ceny jednostkowe tej samej pozycji (np. na dokumentach) muszą być identyczne".
- Variants: "Wybór odpowiedniego wariantu i rozmiaru możesz pozostawić klientowi."
- Marketplaces: "W przypadku integracji z Empik Marketplace, zestaw musi być jednoelementowy."; "Obecnie pozostałe zintegrowane marketplaces nie obsługują zestawów." (Allegro, eBay, Amazon do.)

### 2.5 Gifts (S7 verbatim)

- "Towary w zamówieniach zawsze będą oznaczone jako gratis."
- "w zakładce Ustawienia wydruków dokumentów sprzedaży możesz określić sposób prezentacji gratisów na fakturach VAT i paragonach."
- "Towar Gratisowy nie może być zestawem."
- Gift must be "widoczny na stronie sklepu, posiadać stan magazynowany oraz nadaną cenę"; the help advises giving it its "realną" price.
- "Klient po przejściu do koszyka będzie miał możliwość wybrania towaru gratisowego."

Price of a gift line in `productOrderPrice` (0 or real price) is **Unknown** from the schema.

---

## 3. Sky-Shop

OL has no Sky-Shop adapter. The WebAPI spec is only reachable in the shop panel: S8 "Pod przyciskiem “Dokumentacja API” (2) możesz znaleźć całą specyfikację API" (inside "Integracje -> Web API sklepu"). **No public primary source for order/product API fields -> Unknown.**

Help (S8, verbatim):
- Sets: "Zestawy pozwalają połączyć wiele produktów w jeden komplet." / "Zestawy mogą posiadać własne ceny, różne od sumy cen produktów" / product "Typ: Zestaw" / "Ilość w zestawie" per component / in "Konfiguracja zestawu" choose "z jakiego źródła ma być pobierany stan magazynowy (4) oraz ewentualnie, czy chcesz ignorować stany magazynowe produktów (5)" / price: "zsumowana cena składników zestawu ma zostać ustawiona jako cena zestawu lub cena przekreślona".
- Gifts: rules by "producenci", "produkty" or "kwoty zamówień"; "Wybrany gratis pokaże się w PDF’ie z zamówieniem, lecz nie będzie wyświetlany na fakturze VAT."; "zdefiniowany gratis będzie dostępny w koszyku po spełnieniu narzuconych warunków."

Stock semantics: configurable per set (source of stock + "ignore stock"), so neither "derived" nor "own" can be assumed. Exact options **Unknown**.

---

## 4. Subiekt GT and Subiekt nexo (komplety)

### 4.1 GT: a komplet is a catalogue item WITH ITS OWN stock, created by manual assembly

S9 verbatim:
- "Aby tak zdefiniowany komplet pojawił się w magazynie, należy jeszcze go zmontować." (1022)
- Zmontuj: the program "automatycznie pobierze odpowiednią ilość składników" (1022)
- "Składnikiem kompletu może być dowolny typ kartoteki, także komplet." / "Jeżeli w skład kompletu wchodzi inny komplet, należy najpierw zmontować komplet, który jest składnikiem innego." / "Aby zmontować komplet (przyjąć na stan), wszystkie składniki tego kompletu muszą być dostępne w magazynie." (3694)
- "Wciśnięcie przycisku Wykonaj spowoduje stworzenie dokumentu RW na komplet oraz PW na jego składniki." (3933, dismantling)

Selling a komplet in GT therefore sells from the komplet's own (assembled) stock. Automatic assembly at the moment of sale: **Unknown - no primary source** (the 1022 article describes only the manual step).

### 4.2 nexo: same model, assembly is a production order

S10 verbatim:
- "Po stworzeniu kompletu w module Asortyment będzie on miał stan zerowy." (2660)
- assembly = "zwiększenie stanu magazynowego kompletu poprzez wygenerowanie dokumentu Przychód wewnętrzny (PW)" and "zmniejszenie stanu magazynowego składników kompletu poprzez wygenerowanie dokumentu Rozchód wewnętrzny (RW)" (2660)
- dismantling: "Zlecenie produkcyjne rozmontowania", RW komplet + PW składniki (2661)
- components may be "Towar, Opakowanie, lub Usługa" (2659)

### 4.3 Sfera (nexo) API names (S11, reflection dump; names only, semantics are inferences)

- `[enum] InsERT.Moria.Asortymenty.PodrodzajAsortymentu = Komplet | Opakowanie | Towar` (dump l.2307-2311)
- `[interface] InsERT.Moria.Asortymenty.IAsortyment ... prop ISkladnikiKompletu Skladniki { get; }` (l.1660, 1688)
- `ISkladnikiKompletu`: `SkladnikKompletu Dodaj(String symbolAsortymentu, Decimal ilosc)`, `prop IEnumerable<SkladnikKompletu> Wszystkie` (l.1914-1927)
- `IRaportKompletow.Wylicz()` -> `RaportKompletowDane` with `IloscSkladnika`, `Symbol`, `Cena`, `Wartosc` (l.1887-1888, 2393-2422)
- `IZlecenieProdukcyjneMontowania`: `Montuj(Asortyment)`, `PodajMaksymalnaIloscKompletu()`, `WypelnijnaPodstawieZK(PozycjaDokumentu pozycjaZK)`, `prop IPozycjeSkladniki PozycjeSkladniki` (l.13023-13042) - an assembly order can be filled from a customer-order (ZK) line.
- `IParametryDokumentow.ZamienKompletyNaSkladniki(IKonfiguracjaObowiazujaca)` (l.11990) and `[enum] ...Logistyka.ZamienKompletyNaSkladniki = NieZamieniaj | ZamienWszystkieNaSkladniki` (l.17132-17135) - a document-level setting to replace komplety by their components on documents. Which document types it governs is Unknown.
- Homonym: `IZamowienieOdKlienta.KompletujZamowienie(DateTime ...)` -> `IEnumerable<IPozycjaKompletacji>` with `AktualnaIloscSkompletowana`, `AktualnyProcentKompletacji` (l.12102-12108, 12913-12915). This "kompletacja" is order fulfilment progress, NOT kit assembly.

### 4.4 What OpenLinker reads today (Subiekt)

- `libs/integrations/subiekt/src/bridge/subiekt-bridge-products.types.ts:43-104` - `BridgeProduct` has `symbol, nazwa, ceny, waluta, opis, kodKreskowy, jednostkaMiary, waga, stawkaVat, zdjecia, grupaId/Nazwa, modelId/Nazwa`. **No kind/rodzaj, no komplet flag, no składniki.**
- `libs/integrations/subiekt/src/bridge/subiekt-bridge-inventory.types.ts:34-41` - stock per symbol per warehouse: `stan` ("`tw_Stan.st_Stan` - current quantity"), `stanRez`. For a komplet symbol this is the komplet's own assembled stock (per S9/S10), not component availability.
- `libs/integrations/subiekt/src/bridge/subiekt-bridge-orders.types.ts:19-45` - ZK line = `symbol, ilosc, wartoscBrutto, wartoscBruttoPoRabacie?, nazwa?`; `:167-172` order-detail line = `symbol, nazwa, ilosc, wartoscBrutto`. No parent/child, no gift flag.
- `libs/integrations/subiekt/src/infrastructure/adapters/subiekt-order-processor.adapter.ts:180-214` (`resolveTowarSymbol`) - one OL line -> one towar symbol; refuses an unmapped line rather than create a service line.
- Companion bridge (S13): `bridge/Subiekt.Bridge.Infrastructure.Sql/SqlProductCatalogReader.cs:14` (nexo) comments `Rodzaj_Id: 2 = towar, 1 = usługa, 4 = komplet, 3 = opakowanie.` and filters only `Rodzaj_Id <> 3` (komplety ARE listed, not flagged downstream). The value mapping is the bridge author's comment, not an InsERT source (unverified). `bridge-gt/Program.cs:304` selects `t.tw_Rodzaj` into `Row.Kind` (`:1493`) but nothing reads `.Kind`.
- `libs/integrations/subiekt-nexo/src` - invoicing only; no komplet handling.

---

## Use cases (condensed)

| ID | Platform | Scenario | Exact fields | Source + verbatim |
|---|---|---|---|---|
| PLS-01 | Shoper | Buyer orders a bundle | `order-products.type="1"`, `children[]{bundle_child_id, stock_id, quantity, price, tax, tax_value, pkwiu, unit...}` | S1 OrderProduct.php:186 "`1` - a product bundle whose components are returned in the `children` array" |
| PLS-02 | Shoper | Bundle defined in catalogue | `products.type="1"`, `children[]{bundle_id, product_id, stock_id, stock(=qty per bundle), order}` | S1 Product.php:120 "returned only for bundles (product type 1)"; ProductChildrenItem "quantity of this component in a single bundle" |
| PLS-03 | Shoper | Bundle sold, stock moves | component stock decremented; bundle unavailable when a component sells out; max-sellable cap | S2 "Gdy któryś z produktów z zestawu zostanie wyprzedany, zestaw również przestaje być dostępny w sprzedaży." |
| PLS-04 | Shoper | Bundle with variant / non-stock options | each variant combo = separate bundle; storefront item has `stockProductOptions`, `notStockProductOptions` | S2 "będzie osobnym zestawem na liście asortymentu"; S3 "hasItemWithNotStockOption" |
| PLS-05 | Shoper | Gift with order | none in core schema (type is 0/1 only); gifts via apps; "free line item" = unlinked line | S4 "W Shoper App Store dostępne są aplikacje..."; S1 OrderProduct.php:47 "a free line item created without `product_id` and `stock_id`" |
| PLS-06 | Shoper (OL) | OL ingests a bundle order | OL reads no `type`/`children`; bundle -> single variant line on the bundle's stock_id | shoper-api.types.ts:533-546; shoper-incoming-order.mapper.ts:273-302 |
| PLS-07 | IdoSell | Gift line in order | `productsResults[].orderSalesMode = "gift"` (also `"points"`) | S5 "Product selling mode. Available values: \"money\", \"gift\", \"points\"." |
| PLS-08 | IdoSell | Set in order | `productsResults[].bundleId`; cart adds all components | S5 "A set's ID."; S6 "Dodając do koszyka zestaw, doda wszystkie produkty..." |
| PLS-09 | IdoSell | Invoice / WZ for a set | merchant toggle one line vs components; WZ always split; proportional price split | S6 "Na dokumentach WZ ... zestawy zawsze będą rozbijane na towary składowe." |
| PLS-10 | IdoSell | Collection (pick-some) | `productType = product_collection`; `productBundleItems[].bundleQuantity` | S6 "klient sam decyduje, jakie składowe kupuje" |
| PLS-11 | IdoSell | Set stock | derived from components | S6 "Stany magazynowe wyliczane są na podstawie stanów magazynowych poszczególnych składowych." |
| PLS-12 | IdoSell | Gift rules + write API | gift cannot be a set, needs stock + price; write uses `productFree` boolean | S7 "Towar Gratisowy nie może być zestawem."; S5 `"productFree":{"type":"boolean","description":"Free product."}` |
| PLS-13 | Sky-Shop | Set definition | "Typ: Zestaw", "Ilość w zestawie", configurable stock source + "ignore stock" | S8 "wybierz z jakiego źródła ma być pobierany stan magazynowy" |
| PLS-14 | Sky-Shop | Gift | rule by producer/product/order amount; on order PDF, NOT on VAT invoice | S8 "Wybrany gratis pokaże się w PDF’ie z zamówieniem, lecz nie będzie wyświetlany na fakturze VAT." |
| PLS-15 | Subiekt GT | Komplet stock | own stock after manual "Zmontuj"; nested komplety; dismantle = RW komplet + PW składniki | S9 "Aby tak zdefiniowany komplet pojawił się w magazynie, należy jeszcze go zmontować." |
| PLS-16 | Subiekt nexo | Komplet assembly | stock 0 until assembly order: PW komplet + RW składniki; assembly order fillable from ZK line | S10 "Po stworzeniu kompletu ... będzie on miał stan zerowy."; S11 `WypelnijnaPodstawieZK(PozycjaDokumentu pozycjaZK)` |
| PLS-17 | Subiekt nexo | Documents replace komplety | doc parameter `ZamienKompletyNaSkladniki {NieZamieniaj, ZamienWszystkieNaSkladniki}` | S11 l.17132-17135 (semantics unverified) |
| PLS-18 | Subiekt (OL) | OL syncs a komplet | no rodzaj in `BridgeProduct`; `stan` is komplet's own stock; ZK line = symbol only | subiekt-bridge-products.types.ts:43-104; subiekt-bridge-inventory.types.ts:38 "`tw_Stan.st_Stan` - current quantity" |

## Cheat-sheet

| | Bundle marker on order line | Composition exposed in order | Composition in catalogue | Bundle stock | Gift marker on order line |
|---|---|---|---|---|---|
| Shoper | `type` 0/1 (Full) | `children[]` nested in the parent line (Full; whether also flat rows: Unknown) | `products.type`, `children[]` (`stock`=qty) | components decremented; bundle unavailable if any out; REST value of bundle stock Unknown | None in core (apps; Unknown) |
| IdoSell | `bundleId` on line (Partial: tags components) | component lines tagged `bundleId` (shape of parent row Unknown) | `productType`, `productBundleItems[]` | derived from components | `orderSalesMode="gift"` (Full) |
| Sky-Shop | Unknown (API docs behind login) | Unknown | "Typ: Zestaw" + qty per component (UI) | configurable source / ignore | Unknown on API; not on VAT invoice |
| Subiekt GT | none: komplet is just a towar symbol | none on the document line | składniki on the kartoteka (no OL read) | OWN stock, manual assembly | no concept |
| Subiekt nexo | none on line; `PodrodzajAsortymentu.Komplet` on the item | none on line (doc option to replace by components) | `IAsortyment.Skladniki` | OWN stock, zero until assembly order | no concept |

## Adapter can / cannot derive

Can:
- Shoper: detect a bundle line (`type=="1"`) and its components with per-component `stock_id`, `quantity`, `price`, tax - from the order alone, no catalogue read.
- Shoper: catalogue-level composition (`products.type`, `children[].stock` as qty per bundle).
- IdoSell: gift lines (`orderSalesMode=="gift"`), points-paid lines (`"points"`), set membership (`bundleId`), catalogue composition (`productBundleItems`).
- Subiekt nexo (via Sfera): komplet kind and składniki list, max assemblable quantity; can create an assembly order from a ZK line.

Cannot (or Unknown):
- Shoper: whether children are also returned as flat `order-products` rows; how parent price relates to child prices; any gift signal (core has none; app-dependent).
- IdoSell: whether the set itself is a separate priced row; whether the gift line price is 0.
- Sky-Shop: anything at API level (no public spec).
- Subiekt GT: whether a ZK/FS for a komplet auto-assembles or blocks on komplet stock 0 (no primary source); the current OL bridge exposes no rodzaj/składniki, so the adapter cannot tell a komplet from a towar today.
- Any platform: a gift "reason" (threshold, coupon) at line level.

## Surprises

1. Shoper's catalogue component field `stock` means QUANTITY PER BUNDLE, not stock level (S1 ProductChildrenItem). Easy to mis-map.
2. Shoper order children have an `id` called "order product identifier" and their own `order_id` - they may be real `order-products` rows. OL's flat `/order-products` read could double-count. Needs a live test before anything else.
3. Shoper has no core gift concept at all; "free line item" means "not linked to the catalogue", not "free of charge".
4. IdoSell read and write disagree: read gives `orderSalesMode`/`bundleId`, write takes `productFree`/`productBundleItems`.
5. IdoSell price split for documents is a fixed proportional rule with rounding to single-unit components, and the merchant chooses one-line vs split per set; WZ is always split. A downstream invoicing system must not re-split.
6. Sky-Shop shows the gift on the order PDF but explicitly NOT on the VAT invoice.
7. Subiekt GT and nexo komplety are NOT virtual kits: they carry their own stock, which is 0 until a human assembles them (PW/RW). An OL order for a komplet symbol reserves/sells the komplet's own stock, so "kit available because components are in stock" is false in Subiekt unless someone assembles first.
8. "Kompletacja" in Sfera nexo also names ORDER fulfilment (`KompletujZamowienie`), unrelated to kits. Search by word is a trap.
9. Sfera nexo has a document setting to replace komplety with components (`ZamienKompletyNaSkladniki`), i.e. the same "one line vs components" choice IdoSell exposes, but on the ERP side.
