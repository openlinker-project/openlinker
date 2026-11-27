# Research: bundles ("zestawy", "komplety") and free gifts ("gratisy") in Polish SaaS shops (Shoper, IdoSell, Sky-Shop) and Subiekt GT / nexo as product master

Researcher 3 of 5, PROBLEM phase. Read-only. Date 2026-11-04.
Confidence markers: (confirmed) = read in a primary source; (secondary) = third-party/search summary; (unverified) = inference or not found.

## Sources consulted
- Shoper official PHP SDK, generated from the REST schema: github.com/dreamcommerce/shoper-sdk-php
  - `src/Raw/Types/OrderProduct.php` - `type` ("0 - a regular product, 1 - a product bundle whose components are returned in the `children` array"), `children[]`, `special_offer_price`, `loyalty`, `stock_id`, `price`, `tax`, `tax_value`
  - `src/Raw/Types/OrderProductChildrenItem.php` - `bundle_child_id`, `product_id`? (via stock), `stock_id`, `price` ("child price"), `quantity`, `tax`, `tax_value`, `option`, `code`, `pkwiu`, `is_digital`
  - `src/Raw/Types/Product.php` - `type` (0 product, 1 bundle), `children[]` ("returned only for bundles (product type 1)")
  - `src/Raw/Types/ProductChildrenItem.php` - `bundle_id`, `product_id`, `stock_id`, `stock` ("quantity of this component in a single bundle"), `order`
- Shoper Storefront Object API, ProductBundle: storefront.developers.shoper.pl/object-api/objects/products/bundle/ - `product`, `items`, `originalItemsPrice`, `hasItemWithNotStockOption`; event `product.bundleStockChanged`
- Shoper help: "Zestawy produktów" shoper.pl/learn/artykul/zestawy-produktow ; "Dodawanie zestawu" shoper.pl/learn/?p=18834 ; app "Stany magazynowe zestawów" shoper.pl/learn/artykul/stany-magazynowe-zestawow/ ; app "Produkt gratisowy w koszyku" shoper.pl/aplikacje/produkt-gratisowy-w-koszyku ; GrowGift shoper.pl/aplikacje/growgift-progi-gratisow-per-marka ; gift article shoper.pl/learn/?p=68759
- IdoSell API typings from a generated TS SDK (github.com/ltung7/idosell, `dist/responses.d.ts`, `dist/reqparams.d.ts`) + idosell.readme.io/reference/ordersordersget
- IdoSell product-sets page: idosell.com/en/tysiace-gotowych-do-uzycia-funkcji/.../product-sets-configurators ; idosell.com/pl/zaawansowany-system-rabatowy/
- Sky-Shop help: sky-shop.pl/pomoc-faq/produkty/zarzadzanie-produktami/jak-dodac-zestaw-produktow/ ; .../jak-tworzyc-gratisy-w-sklepie/ ; WebAPI note sky-shop.pl/brak-twojego-erp-zintegruj-sie-po-api-sky-shop/
- InsERT e-pomoc: insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/3694,subiekt-gt-czy-mozna-zmontowac-komplet-z-kompletu.html
- Subiekt GT add-ons: strefalicencji.pl/kompletacja-dla-subiekt-gt-p-417.html ; netsetup.pl (Auto Kompletacja)
- Sfera nexo public API surface dump (local, /home/nor/projekty/blocky/sfera-api-main/tools/SferaInspect/api-dump-api.txt): `ISkladnikiKompletu`, `PodrodzajAsortymentu.Komplet`, `IMontaz`/`IDemontaz`, `ParametryPrzetwarzaniaZKWZD.UwzglednijMontaz`, config `ZamienKompletyNaSkladniki`, `WyliczCeneKompletuZeSkladnikow`, `KolorowanieGratisow`, `NieMoznaWydacWiecejGratisowNizNaZaliczkowejBlad`
- OpenLinker code (read-only): libs/integrations/shoper/src/domain/types/shoper-api.types.ts ; libs/integrations/subiekt/...subiekt-product-master.adapter.ts ; local GT bridge `openlinker-subiekt-bridge/bridge-gt/Program.cs`, nexo `SqlProductCatalogReader.cs`
- Secondary: SellIntegro "Subiekt Nexo PRO do Shoper" PDF (via search summary only - PDF text not extractable)

## Findings

### Shoper
- Bundle = product of `type: 1` with `children[]` (component product_id + stock_id + `stock` = qty per bundle). (confirmed, SDK)
- Component VARIANTS: a variant is fixed per bundle - "każdy wariant dodany do zestawu jest traktowany jak pojedynczy produkt"; each variant combination = a separate bundle in the catalogue. Non-stock options (`optionsNonStock`) can remain choosable (`hasItemWithNotStockOption`). (confirmed help + storefront API)
- Bundle price: own price, set by merchant; optional "Cena poza zestawem" display; standard product promotions cannot be applied to a bundle. (confirmed help)
- Stock: help says components are decremented automatically when a bundle sells and the bundle becomes unavailable when any component sells out. (confirmed help) A paid Appstore app (Maxsote) exists to set the bundle's stock field = min(component stock) hourly - suggests the bundle's own `stock.stock` number is NOT natively recomputed (unverified; the existence of the app is the evidence).
- Order API: an `order-products` row with `type: "1"` and `children[]`; each child has its own `price` ("child price"), `quantity`, `stock_id`, `tax`, `tax_value`, `code`. So the price split and VAT split per component are delivered by the platform. (confirmed SDK) How child prices relate to the parent price (sum? proportional?) is not documented (unverified).
- Documents: secondary summary of a Shoper help page claims the invoice shows the bundle name and the WZ shows components (secondary, not re-confirmed on fetched page).
- Gifts: NO native gift feature; done by Appstore apps. "Produkt gratisowy w koszyku" (Maxsote) implements a gift as a dedicated product VARIANT (stock) priced 0 zł, 1 gr or 1 zł; the gift product must have no variants; conditions: cart value, category, producer, combinable; no gift limit. (confirmed app page) GrowGift: customer chooses, thresholds, gift price from 0.01 zł, up to 30 products; "rechecks threshold/stock after purchase" (secondary vendor page). Neither flags the line as a gift in the order API: the order shows an ordinary `order-products` row with a special stock_id and a low price (inferred from mechanism; unverified on a live order). `special_offer_price` is write-only and not returned. `loyalty` object marks points-exchanged lines (confirmed SDK).
- Returns with gift: Shoper's own guidance: refund must not automatically deduct gift value; partial return below threshold has no automatic rule. (confirmed help ?p=68759)
- OpenLinker today: `ShoperOrderLineRow` reads neither `type` nor `children`, and `ShoperProduct` reads neither `type` nor `children`. A bundle reaches OL as one plain line / one plain product with the bundle's own stock row. (confirmed code)

### IdoSell
- Product types: `product_item | product_free | product_packaging | product_bundle | product_collection | product_service | product_virtual | product_configurable`. (confirmed API typings)
- Set (`product_bundle`) vs collection (`product_collection`): set must be bought whole; collection = pick items, extra discount. (confirmed IdoSell site)
- Composition: `productBundleItems[] { productId, bundledId, bundleQuantity, isBundleShown, bundledAvailableSizes[], bundledAllSizes[] }`; reverse `bundledIds[]` on component. (confirmed typings)
- Variants (sizes): four modes - fixed sizes as separate entries, sizes chosen by customer, all sizes, all sizes and variants. So the chosen component size is decided AT CHECKOUT. (confirmed site)
- Stock: cannot be set; computed = lowest component availability. (confirmed site)
- Price: fixed, or sum of components; component share PROPORTIONAL to standalone price (100 zł set of 60/100/40 -> 30/50/20); rounding/discounts can shift by 1 gr. (confirmed site)
- Documents: per-set switch "Pokazuj zestaw jako jedną pozycję na dokumentach sprzedaży"; off -> components listed with proportionally reduced prices; WZ ALWAYS split into components. (confirmed site)
- Listing: sets visible on marketplace auctions (Allegro) (confirmed site, wording "widoczne na aukcjach").
- Order API `productsResults[]`: per line `bundleId` ("A set's ID"), `orderSalesMode: "money" | "gift" | "points"`, `basketPosition`, `label` ("Label for grouping products"), `productOrderPrice/Net`, `productVat`, `sizeId`, `stockId`. (confirmed typings) Whether the set itself is also a line, or only components carrying `bundleId`, is not documented and I found no sample payload (unverified - needs a live probe). The document switch suggests the stored order carries components.
- Gifts: `orderSalesMode: "gift"` on an order line (confirmed); product flag `productIsGratis: "y"|"n"` ("The product is free of charge") and type `product_free` ("free product") (confirmed); order-create param `productFree: boolean` (confirmed); shop setting `product_free_invoices` = "Defines how to include complimentary products on VAT invoices and receipts" (confirmed, values not documented). Gift rules ("Gratisowy produkt przy zakupach powyżej 300 zł", "upominki dla stałych klientów") exist in the discount system (confirmed marketing page). The "1,00 zł / 0,01 zł on documents" behaviour named in the brief: not found in public docs (unverified).

### Sky-Shop
- Set: product "Typ: Zestaw", components with "Ilość w zestawie"; own price or sum as price/crossed-out price; stock source selectable ("pobierany stan magazynowy"), option to ignore component stock; set cannot be a component of another set; description/photos not inherited. (confirmed help)
- Sets cannot be listed on Allegro. Auto supplier order forwarding only if all components come from one supplier. (confirmed help) Dropshipping-heavy merchant base -> mixed-supplier sets are a real pain.
- Invoice: components' VAT rates are NOT shown ("nie będą wyświetlać się") - the set is one line with one rate. (confirmed help) Mixed-VAT kit therefore invoiced at one rate.
- Gifts: native "Produkty -> Gratisy" rules by order amount / product / producer; gift appears in cart when conditions met. "Wybrany gratis pokaże się w PDF'ie z zamówieniem, lecz nie będzie wyświetlany na fakturze VAT." (confirmed help) Stock of gift: not described (unverified).
- WebAPI: per-shop docs at `{shop}/api` with a test environment; field names for sets/gifts not public (unverified).

### Subiekt GT (product master)
- Komplet is a kartoteka type ("Komplet"); components may be any type, including another komplet. (confirmed InsERT)
- A komplet has its OWN stock: "Aby zmontować komplet (przyjąć na stan), wszystkie składniki tego kompletu muszą być dostępne w magazynie"; nested kits must be assembled first. (confirmed InsERT) Assembly ("Zmontuj") consumes components and receives komplety (PW-like). Selling a komplet therefore decrements the komplet's stock, not the components (inferred from the assembly model; unverified that GT never auto-assembles on sale).
- Third-party add-ons exist precisely to (a) show "available" komplety computed from components for online shops via a virtual warehouse, (b) auto-assemble the quantities needed by open ZK orders. (confirmed vendor pages) -> native GT does not do this.
- OL GT bridge reads stock as `SUM(st_Stan)` from `tw_Stan` for every non-deleted towar incl. komplety, so a never-assembled komplet publishes 0 (confirmed code + inference).

### Subiekt nexo (product master)
- `PodrodzajAsortymentu = Komplet | Opakowanie | Towar`; `ISkladnikiKompletu.Dodaj(asortyment, ilosc, jm)`; `CzyKomplet`. (confirmed Sfera surface)
- Warehouse executor has `IMontaz` / `IDemontaz` (assembly/disassembly); ZK->WZ processing parameter `UwzglednijMontaz` (include assembly when turning an order into WZ). (confirmed surface) A freelance job "automatyczny montaż kompletów przy zapisie WZ" implies auto-assembly is not default for directly-saved WZ (secondary).
- Document config `ZamienKompletyNaSkladniki` - replace komplet lines with their components on documents (confirmed surface; exact semantics unverified).
- Price config `WyliczCeneKompletuZeSkladnikow`, `SzacujKosztKompletuJakoSumeKosztuSkladnikow`. (confirmed surface)
- Gifts exist as a document concept: `KolorowanieGratisow`, `NaglowekKosztGratisow`, error "NieMoznaWydacWiecejGratisowNizNaZaliczkowej" (confirmed surface) - nexo has its own promotion engine producing gratis lines.
- SellIntegro (Shoper<->nexo) offers three komplet-stock modes: assembled count, count assemblable from components, or both. (secondary)

## Checklist (one line per platform)

| Item | Shoper | IdoSell | Sky-Shop | Subiekt GT | Subiekt nexo |
|---|---|---|---|---|---|
| Bundle definition | product type 1 + children (product,stock,qty) | product_bundle + productBundleItems; also product_collection | Typ: Zestaw + components with qty; no nesting | kartoteka Komplet, nesting allowed | Asortyment podrodzaj Komplet, ISkladnikiKompletu |
| Variants in bundle | fixed; each variant combo = separate bundle | customer picks size at checkout (4 modes) | not documented (unverified) | components are towary (models are separate) | components are asortymenty |
| Bundle stock | components decremented on sale; bundle number via app (min, hourly) | computed = min components, not settable | selectable source / ignore components | OWN stock after montaż | own stock + montaż/demontaż; ZK->WZ can include montaż |
| Bundle as listing | yes (own product) | yes, incl. auctions | NOT on Allegro | n/a | n/a |
| Order with bundle | line type 1 + children[] with own price/tax | lines with bundleId (+ maybe header) (unverified) | API unknown | sold as komplet line | komplet line, optionally replaced by components |
| Packing | WZ shows components (secondary) | WZ always components | not documented | assembled komplet picked as one item | depends on montaż |
| Component return | not documented | not documented | not documented | demontaż? not documented | IDemontaz exists |
| Return with gift | Shoper guidance: no auto deduction | not documented | not documented | n/a | n/a |
| VAT split | per child tax in API | per component on docs if switch off; proportional | invoice shows no component VAT | komplet line rate | config-dependent |
| Gift source | Appstore apps only | native (orderSalesMode gift, product_free) | native "Gratisy" rules | n/a (manual) | promotion engine (gratis lines) |
| Gift stock | gift variant with own stock (app) | real product stock (unverified) | not documented | n/a | n/a |
| Gift on documents | ordinary line at 0/0.01/1 zł | governed by `product_free_invoices` setting | NOT on VAT invoice, only order PDF | n/a | gratis lines + "koszt gratisów" |
| Gift limits | none described (Maxsote); GrowGift item limits | not documented | not documented | n/a | can't issue more gratisy than on advance invoice |

## Conflicts / open questions
- Shoper: help says component stock is decremented natively, yet a paid app exists to sync bundle stock = min(components). Reconciling: probably the bundle's own displayed number is not recomputed. Needs a live test on the trial shop (sklep729770).
- IdoSell: does `productsResults` contain the set as its own line plus components, or only components with `bundleId`? Not in docs; needs a live order.
- IdoSell `product_free_invoices` values (omit gift / show at 0 / show at 0.01) unknown.
- Subiekt GT: does a sale of an un-assembled komplet fail, go negative, or auto-assemble? InsERT docs silent; add-on market suggests "no auto-assembly".
- Two meanings of "kompletacja" collide: in Subiekt and Polish WMS talk it also means order PICKING (nexo `KompletujZamowienie`, ProstaPaczka "kompletacja na kolektorach") - vocabulary hazard for OL docs/UI.

## Use cases

| ID | Platform | Who | Scenario | What arrives and how | Pain | Source |
|---|---|---|---|---|---|---|
| PLS-01 | Shoper | merchant selling gift boxes | Buyer orders a "zestaw świąteczny" | one `order-products` row `type:"1"` with `children[]` (each child: stock_id, qty, price, tax) | OL adapter ignores `type`/`children` -> kit arrives as one unmapped line; components never reserved | SDK OrderProduct.php; OL shoper-api.types.ts |
| PLS-02 | Shoper | merchant | Kit of T-shirt in sizes S/M/L | merchant must create one bundle per size (variant fixed in bundle) | catalogue explosion; mapping N bundles to the same components | Shoper help zestawy-produktow |
| PLS-03 | Shoper | merchant | Last unit of a component sells standalone | components decremented natively, bundle "unavailable", but bundle stock number needs a paid app (hourly) | stale bundle stock pushed to marketplaces between syncs (unverified) | Maxsote app page |
| PLS-04 | Shoper | merchant running "gratis od 200 zł" | Gift added by Appstore app | ordinary line, gift-variant stock_id, price 0 / 0.01 / 1 zł, no gift flag | adapter cannot tell gift from a 1 zł product except by stock_id/price heuristics | Produkt gratisowy w koszyku |
| PLS-05 | Shoper | buyer | Returns part of order, falls below gift threshold | nothing automatic | refund rules for gift are legal, not system, decisions | Shoper learn ?p=68759 |
| PLS-06 | IdoSell | apparel merchant | Set with size chosen at checkout | lines carry `bundleId`, chosen `sizeId`, proportional `productOrderPrice` | need live sample to know if header line also present | IdoSell typings + sets page |
| PLS-07 | IdoSell | merchant, mixed-VAT kit (book 5% + toy 23%) | Set switch "show as one item" ON | documents show one line | one VAT rate for mixed-rate kit unless switch OFF | IdoSell sets page |
| PLS-08 | IdoSell | merchant | Set packed in warehouse | WZ always split into components | packer sees components, invoice may show set: two views of one line | IdoSell sets page |
| PLS-09 | IdoSell | merchant with "gratis powyżej 300 zł" | Gift added by discount system | line `orderSalesMode: "gift"`; product may be type `product_free` / `productIsGratis:"y"` | how it prints is a shop setting `product_free_invoices` (values unknown) | typings; zaawansowany-system-rabatowy |
| PLS-10 | IdoSell | merchant with loyalty | Item bought with points | `orderSalesMode: "points"` | not a gift, not money: third mode a neutral model must keep | typings |
| PLS-11 | Sky-Shop | dropshipper | Set built from two wholesalers | set ordered; auto-forwarding to supplier refused | manual split of supplier orders | Sky-Shop help zestaw |
| PLS-12 | Sky-Shop | merchant | Wants set on Allegro | not possible | kit sold only in own shop | Sky-Shop help zestaw |
| PLS-13 | Sky-Shop | merchant | Native gift by order amount | gift in cart and order PDF | gift NOT on VAT invoice -> order/invoice mismatch, packer vs accountant | Sky-Shop help gratisy |
| PLS-14 | Sky-Shop | merchant, mixed-VAT set | Invoice for set | one line, component VAT rates not shown | possibly wrong VAT on mixed kits | Sky-Shop help zestaw |
| PLS-15 | Subiekt GT | ERP-first merchant | Kit defined as komplet; shop sells it | komplet has own stock only after "Zmontuj" | never-assembled komplet = 0 stock; OL GT bridge publishes 0 | InsERT e-pomoc 3694; OL bridge-gt |
| PLS-16 | Subiekt GT | merchant | Wants "sellable kits from components" | needs paid add-on (virtual warehouse PW / auto-assembly for ZK) | OL would need to compute available-to-assemble itself | strefalicencji, netsetup |
| PLS-17 | Subiekt nexo | merchant | ZK from shop converted to WZ | `UwzglednijMontaz` can assemble on the fly; documents may swap komplet for components (`ZamienKompletyNaSkladniki`) | behaviour depends on config OL cannot see | Sfera nexo surface |
| PLS-18 | Subiekt nexo | merchant with promotions | nexo promo adds gratis line to document | gratis lines + "koszt gratisów" header | a document issued by OL may double a gift a shop already added (unverified) | Sfera nexo surface |

## Order shape cheat-sheet
- Shoper: `order-products` row: `type` "0"/"1"; if "1", `children[] {bundle_child_id, stock_id, quantity, price, tax, tax_value, code, option}`. Gift = plain row (app-created variant, low price). Points = `loyalty{}`.
- IdoSell: `productsResults[] {productId, sizeId, stockId, productQuantity, productOrderPrice(Net), productVat, bundleId, orderSalesMode money|gift|points, basketPosition, label}`. Set header vs components: unverified.
- Sky-Shop: WebAPI per shop at `/api`; fields unknown. Help: set is one product/one invoice line; gift in order but not on invoice.
- Subiekt GT/nexo (master side, not order source here): komplet = own SKU with own stock; composition readable (GT `Składniki` tab; nexo `ISkladnikiKompletu`).

## What an adapter can / cannot derive
Can:
- Shoper: kit vs plain line (`type`), component SKUs, per-component qty/price/VAT from `children`; kit composition from product `children`.
- IdoSell: kit membership per line (`bundleId`), chosen size, proportional price, gift (`orderSalesMode:"gift"`), points sale, product gratis flag/type, composition (`productBundleItems`).
- Subiekt: komplet flag + composition + komplet's own stock.
Cannot (reliably):
- Shoper: whether a 0/0.01/1 zł line is a gift (no flag), which promotion produced it, threshold; how child prices were derived.
- IdoSell: (without live probe) whether a set header line exists; how gift prints (`product_free_invoices` values).
- Sky-Shop: anything structural from public docs; gift absent from invoice by design.
- Subiekt: whether stock means "assembled" or "assemblable"; whether a sale will auto-assemble (config + add-ons).
- Everywhere: gift limits/per-customer caps, and the return rule for a gift (contract terms, not data).

## Surprises
1. In Subiekt GT (and nexo by default) a komplet is a PRE-ASSEMBLED stock item, not a virtual bundle: stock exists only after montaż. Marketplace "bundle = min(components)" semantics is a different model; an add-on market exists to bridge it.
2. Shoper is the cleanest source: order lines carry `type:1` + `children[]` with per-component price and VAT - but OpenLinker's current Shoper adapter drops both fields.
3. Shoper has no native gifts; gift apps fake a gift as a cheap product variant, so a gift is indistinguishable in the API from a 1 gr product.
4. IdoSell has a third sale mode `points` beside money/gift; and its proportional price split rounds to 1 gr differences.
5. Sky-Shop deliberately omits the gift from the VAT invoice (only order PDF) and shows no component VAT on set invoices; sets cannot go to Allegro.
