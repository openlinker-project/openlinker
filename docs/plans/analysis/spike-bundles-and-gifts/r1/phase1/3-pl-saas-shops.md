# Phase 1 / Area 3 - Polish SaaS shop platforms: Shoper, IdoSell, Sky-Shop
Bundles ("zestawy", "kolekcje") and gifts ("gratisy", "prezenty"). Researched 2026-11-04.
Legend: (confirmed) = stated by a cited source; (unverified) = inference or not found in any source.

## Sources consulted
- Shoper help: Zestawy produktów - https://www.shoper.pl/learn/artykul/zestawy-produktow (and creation article https://www.shoper.pl/learn/?p=18834)
- Shoper help: multi-warehouse (wielomagazynowość) - https://www.shoper.pl/learn/?p=950
- Shoper official PHP SDK (generated from the REST spec, contains field docs): https://github.com/dreamcommerce/shoper-sdk-php
  - `src/Rest/Types/OrderProduct.php`, `OrderProductChildrenItem.php`, `OrderProductType.php`, `OrderProductLoyalty.php`, `Product.php`, `ProductChildrenItem.php`
- Shoper Storefront object API (theme layer): ProductBundle https://storefront.developers.shoper.pl/object-api/objects/products/bundle and ProductBundleItem https://storefront.developers.shoper.pl/object-api/objects/products/bundle-item
- developers.shoper.pl REST reference itself requires login (could not read directly).
- Shoper apps: "Stany magazynowe zestawów" https://www.shoper.pl/aplikacje/stany-magazynowe-zestawow ; "Produkt gratisowy w koszyku" https://www.shoper.pl/aplikacje/produkt-gratisowy-w-koszyku ; GrowGift https://www.shoper.pl/aplikacje/growgift-progi-gratisow-per-marka ; Nevo Promo 2+1 https://www.shoper.pl/aplikacje/nevo-promo-21 ; Promocje 2+1 https://www.shoper.pl/aplikacje/promocje-2-plus-1 ; "W zestawie taniej" https://www.shoper.pl/help/artykul/aplikacja-w-zestawie-taniej/ ; "Dodaj cały zestaw do koszyka" https://www.shoper.pl/aplikacje/dodaj-caly-zestaw-produktow-do-koszyka
- Shoper gift legal guide (2026-10-15): https://www.shoper.pl/learn/?p=68759
- Shoper fiscal: Fiskalizator Systim https://www.shoper.pl/learn/artykul/aplikacja-fiskalizator , https://www.shoper.pl/aplikacje/fiskalizator-systim
- Merchant pain (Useme job, Shoper+BaseLinker bundle script): https://useme.com/pl/jobs/dwa-skrypty-wspopracujace-przez-api-z-baselinkerem-i-shoperem,45970/
- IdoSell: Zestawy towarów i konfiguratory https://www.idosell.com/pl/tysiace-gotowych-do-uzycia-funkcji/baza-produktow-w-idosell/zestawy-towarow-i-konfiguratory/ (EN mirror https://idosell.com/en/tysiace-gotowych-do-uzycia-funkcji/more-about-product-database-and-operations-that-can-be-performed-on-it-in-the-idosell-com/product-sets-configurators)
- IdoSell help: Rabaty progowe i towary gratisowe https://pomoc.idosell.com/marketing-i-promocje/rabaty-i-promocje/rabaty-progowe-i-towary-gratisowe
- IdoSell help: Oferty specjalne https://pomoc.idosell.com/marketing-i-promocje/rabaty-i-promocje/oferty-specjalne
- IdoSell API (official readme): https://idosell.readme.io/reference/ordersorderssearchpost (confirmed `showBundles`, `bundleId`, `orderSalesMode`)
- IdoSell API typings (unofficial SDK generated from the official spec; field descriptions match readme): https://github.com/ltung7/idosell (`dist/responses.d.ts`, `dist/reqparams.d.ts`)
- Sky-Shop help: Jak dodać zestaw produktów? https://sky-shop.pl/pomoc-faq/produkty/zarzadzanie-produktami/jak-dodac-zestaw-produktow/
- Sky-Shop help: Jak tworzyć gratisy w sklepie? https://sky-shop.pl/pomoc-faq/produkty/zarzadzanie-produktami/jak-tworzyc-gratisy-w-sklepie/
- Sky-Shop blog: https://blog.sky-shop.pl/nowosc-zestawy-produktow-w-sky-shop/
- Sky-Shop API: per-shop docs at `<shop-domain>/api` (https://sky-shop.pl/brak-twojego-erp-zintegruj-sie-po-api-sky-shop/) - no public instance found, so the Sky-Shop ORDER SHAPE IS UNVERIFIED.
- Sky-Shop invoices/receipts index: https://sky-shop.pl/pomoc-faq/zamowienia/faktury-i-paragony/
- OpenLinker repo (read-only): `libs/integrations/shoper/src/domain/types/shoper-api.types.ts` (`ShoperOrderLineRow`), `libs/integrations/shoper/src/infrastructure/mappers/shoper-incoming-order.mapper.ts`

---

## 1. SHOPER

### 1.1 Bundles - definition (confirmed)
- Native feature. Panel: Produkty > Wszystkie > Dodaj produkt > Dodaj zestaw. Bundle has its own name, price, main category; components added in tab "Produkty w zestawie" with a quantity each. Digital products allowed as components. Filter "Zestawy" on the product list. (learn/artykul/zestawy-produktow, ?p=18834)
- REST: `products.type` = `0` product / `1` bundle; bundle products carry `children[]` (`ProductChildrenItem`: `bundle_id`, `id`, `order`, `product_id`, `stock` = "quantity of this component in a single bundle", `stock_id`). (SDK Product.php, ProductChildrenItem.php)
- Standard per-product promotions cannot be applied to a bundle ("nie jest objęta możliwością utworzenia standardowej promocji na produkt"). You can show the components' summed regular price next to the bundle (tab "Promocje i oznaczenia").
- Shoper's own examples of bundle use cases include "a free product with a purchase of two units of another" and multipacks - i.e. Shoper merchants model "2+1 gratis" AS A BUNDLE.

### 1.2 Variants inside a bundle (confirmed)
- A component is a specific stock row (`stock_id`): "każdy wariant dodany do zestawu traktowany jest jako osobny produkt". A bundle of variant X of A + variant Y of B is a separate bundle per combination -> combinatorial explosion for size/colour products.
- Storefront object API: `ProductBundle { product, items, originalItemsPrice, hasItemWithNotStockOption }`; `ProductBundleItem { id, order, quantity(float), bundle, variant, stockProductOptions, notStockProductOptions }` -> a component can carry NON-stock options (e.g. engraving text) chosen by the buyer.

### 1.3 Bundle stock & availability (confirmed + one inference)
- Components' stock is decremented automatically when a bundle sells; if any component runs out the bundle becomes unavailable.
- With multi-warehouse on: "Zestaw produktów będzie możliwy do zakupu jeżeli wszystkie jego składowe będą znajdować się w całości [na jednym magazynie]" - a bundle cannot be split across warehouses. (?p=950)
- A paid App Store app "Stany magazynowe zestawów" exists that sets the bundle's stock to the minimum of its components hourly. Inference (unverified): the bundle product's own stock field (visible over REST/feeds) is NOT kept equal to min(components) natively, so anything reading the bundle SKU's stock (BaseLinker, Allegro, price comparators, OpenLinker) sees a stale number. The Useme job confirms merchants pay for scripts that do exactly this plus explode bundles into components for BaseLinker.

### 1.4 Bundle as an offer / listing / Allegro
- Allegro export of a Shoper bundle: not documented in the help articles found (unverified). Shoper's Allegro integration lists products; whether a type=1 product can be listed is unknown.

### 1.5 Order containing a bundle (confirmed - official SDK field docs)
- `order-products` row: `type` = `0` regular, `1` "a product bundle whose components are returned in the `children` array".
- `children[]` (`OrderProductChildrenItem`): `bundle_child_id`, `id` (order product id), `order_id`, `code`, `name`, `option` (stock name), `stock_id`, `price` ("child price"), `quantity`, `tax` (rate name), `tax_value`, `pkwiu`, `discount_perc`, `unit`, `unit_fp`, `unit_id`, `weight`, `is_digital`, `text_options`, `file_options`, `delivery_time`.
- So: ONE parent position (the bundle, its own price/tax) + nested children each with their own price and VAT. Whether child prices sum to the parent price, and whether child `quantity` is per bundle or total, is NOT documented (unverified).
- Admin panel shows "informacja na temat zamówionego zestawu oraz produktów składowych".
- Other line-level fields worth knowing: `loyalty {exchanged, ratio, score}` (line paid with loyalty points; null if not), `special_offer_price` (write-only), "free line item" = a line created without `product_id`/`stock_id` (ean empty, pkwiu empty, is_digital 0).
- Payload sketch (field names confirmed, values illustrative):
```json
{ "id":"55","order_id":"12","product_id":"300","stock_id":"410","type":"1",
  "name":"Zestaw kawowy","price":"149.00","quantity":"1","tax":"23%","tax_value":"23",
  "children":[
    {"bundle_child_id":1,"id":"56","stock_id":"201","name":"Kubek","price":"39.00","quantity":"2","tax":"23%","tax_value":"23"},
    {"bundle_child_id":2,"id":"57","stock_id":"202","name":"Kawa 250g","price":"71.00","quantity":"1","tax":"5%","tax_value":"5"}]}
```
- OpenLinker today: `ShoperOrderLineRow` declares only id/order_id/product_id/stock_id/price/quantity/name/code/ean/tax/tax_value - `type` and `children` are ignored, so a bundle currently ingests as one line on the BUNDLE's stock_id.

### 1.6 Packing / split parcels
- Not documented. Multi-warehouse rule means one bundle ships from one warehouse (confirmed). Split across parcels: unverified.

### 1.7 Returns
- Return of one bundle component / return with gift: not documented (unverified).

### 1.8 Mixed VAT in a bundle
- Data model allows a per-child `tax`/`tax_value` (confirmed). How Shoper's own receipts/invoices render it: unverified. Fiskalizator Systim docs mention that a line fails to print when its VAT rate or price changed (printer locks name to rate) - workaround "add a dot to the name" (search snippet of Systim doc; unverified in full text).

### 1.9 Gifts (confirmed: there is NO native gift rule engine; it is app-based)
- Shoper materials consistently implement gifts via App Store apps:
  - "Produkt gratisowy w koszyku" (Maxsote): gift pools by cart value / category / manufacturer, CUSTOMER CHOOSES the gift, price can be 0 or e.g. 1 grosz / 1 zł, gift must be a product WITHOUT variants; the app creates a variant group "Maxsote - Produkt gratisowy" on the gift product (if left behind after uninstall, customers can buy the product at the promo price). The same product can still be sold normally.
  - GrowGift: up to 8 thresholds, up to 30 products/variants to choose from.
  - Nevo Promo 2+1 / Promocje 2+1: "Kup X, otrzymaj Y" - the cheapest item automatically becomes the gift.
  - Native setting "Pozwalaj na zakup produktów bezpłatnych" (Ustawienia > Obsługa zamówień > Zamówienia i koszyk) to allow 0 zł products.
- Order shape for an app gift: no `gift`/`is_gift` field exists in `OrderProduct` (confirmed absence in SDK). It arrives as an ordinary position, likely the gift product's special variant at 0.00/0.01 (inference from the app's variant mechanism; unverified). Nevo 2+1: likely a discount on the cheapest line (unverified).
- Stock: gift is a real product with stock, so it is decremented like any line (inference; unverified).
- Limits: apps let seller set pool/thresholds; Shoper legal guide recommends announcing limits ("Poinformuj o ograniczeniach przed zakupem") and pulling messaging when the pool runs out.
- Tax note (Shoper guide): marking a product "gratis" or pricing it 0 zł does not decide its tax treatment; low-value gift exemption 20 zł net/unit; 100 zł net per recipient per year with records.

---

## 2. IDOSELL (IAI-Shop)

### 2.1 Bundles ("zestawy") vs collections ("kolekcje") (confirmed)
- Product types: `product_item`, `product_free` (free product), `product_packaging`, `product_bundle` (set), `product_collection`, `product_service`, `product_virtual`, `product_configurable`.
- SET (zestaw): customer must buy the whole set to get the special price. COLLECTION (kolekcja): customer may skip items; choosing products from the collection gives an extra discount.
- Product payload: `productBundleItems[] { productId, bundledId, bundleQuantity, isBundleShown, bundledAvailableSizes[], bundledAllSizes[], bundledAvailableSizesInAuctions[] }`; components know their sets via `bundledIds[]`. Write API: `postProductsBundles`, `postProductsBundlesProducts`, `deleteProductsBundlesProducts`, `putProductsBundlesProductsQuantity`, `putProductsBundlesRenew`.

### 2.2 Variants (sizes) inside a set (confirmed)
- Four modes when adding a component: chosen sizes with customer picking one; chosen sizes as fixed separate list items; all sizes, customer picks; "Dodaj cały towar ze wszystkimi wariantami i pozostaw wybór rozmiarów oraz wariantów klientom". So ONE set definition serves all size combinations - the size is chosen at order time.
- Separate list of sizes available for marketplaces (`bundledAvailableSizesInAuctions`).

### 2.3 Stock (confirmed)
- "Stanu magazynowego zestawu nie można ustawić, ponieważ jest on wyliczany z dostępności towarów składowych" = min over components.
- "Virtual product": several products combined into one virtual product whose stock is driven by components.

### 2.4 Listing / Allegro
- Sets appear "przy wystawianiu aukcji" and have marketplace-specific available sizes (confirmed field). Detailed Allegro behaviour of a set listing: unverified.

### 2.5 Price & documents (confirmed - the most detailed of the three)
- Set price: fixed or "Automatycznie wyliczaj cenę" (sum of components).
- Split: each component's share is PROPORTIONAL to its standalone price. Example: set 100 zł, components 60/100/40 -> 30/50/20. Rounding can leave 1 grosz differences (example: 10.01 zł split equally); discounts cause similar issues.
- Switch "Pokazuj zestaw jako jedną pozycję na dokumentach sprzedaży": ON -> set = one line on invoice/receipt; OFF -> each component on its own line with proportionally reduced price. WZ (warehouse issue) ALWAYS lists components.

### 2.6 Order containing a set (confirmed - official API)
- `orders/orders/search` request has `showBundles` = "Combine the components of the set into one item" -> default response lists COMPONENTS as separate `productsResults[]` rows; each row carries `bundleId` ("A set's ID"). Returns endpoint has `bundleAsProducts` = "Return a set as its constituent products".
- `productsResults[]` fields: `productId, productName, productCode, versionName, sizeId, sizePanelName, productSizeCodeExternal, stockId, productQuantity, productWeight, productVat, productVatFree, productPanelPrice(Net), productOrderPrice(Net), productOrderPriceBaseCurrency, productOrderPriceNetBaseCurrency, remarksToProduct, label ("Label for grouping products"), orderSalesMode ("money"|"gift"|"points"), bundleId, productSerialNumbers, productOrderAdditional, basketPosition, productPriceLog, priceFormulaParameters`.
- Payload sketch (names confirmed; values illustrative, default showBundles=false):
```json
"productsResults":[
 {"productId":1201,"productName":"Kubek","sizeId":"uniw","productQuantity":2,"productVat":23,
  "productOrderPrice":19.5,"orderSalesMode":"money","bundleId":3300,"basketPosition":1},
 {"productId":1202,"productName":"Kawa 250g","sizeId":"uniw","productQuantity":1,"productVat":5,
  "productOrderPrice":110.0,"orderSalesMode":"money","bundleId":3300,"basketPosition":1},
 {"productId":900,"productName":"Brelok","sizeId":"uniw","productQuantity":1,"productVat":23,
  "productOrderPrice":0,"orderSalesMode":"gift","bundleId":0,"basketPosition":2}]
```
  Whether components share `basketPosition`, what `bundleId` is on non-bundle lines, and whether a gift row has price 0: unverified.
- Order create (`postOrders.products[]`): `productId, sizeId, productQuantity, productRetailPrice, productFree (boolean "Free product"), productVat, productVatFree, label, productBundleItems[] {productId, sizeId, sizePanelName, productIndex}` -> an integrator pushing an order INTO IdoSell must spell out the set's chosen component sizes.
- Collection in order: unverified (likely same `bundleId` mechanism).

### 2.7 Gifts (confirmed)
- Two engines:
  1. "Rabaty progowe i towary gratisowe" (Promocje i rabaty > Rabaty i gratisy): per threshold you add loyalty points and/or gift products "spośród których będzie mógł wybrać jeden" - customer picks ONE gift per threshold in the cart; benefits can be discount only, gift only, or both. Gift must be visible in shop and have stock. A product you do not sell can be a gift - mark it gratis on the product card (`productIsGratis` = "y", type `product_free`). "Towary gratisowe w zamówieniach są zawsze oznaczane jako gratis."
  2. "Oferty specjalne": gift auto-added to cart when conditions met; requires visible + stock + a price ("nadać towarowi gratisowemu jego realną cenę"). Customer qualifying for several offers gets the most favourable one. "Towar Gratisowy nie może być zestawem." Offers MULTIPLY and this cannot be switched off ("nie ma możliwości wyłączenia zwielokrotniania ofert specjalnych"); if the gift is also in the trigger group, adding gifts can trigger more gifts.
  3. Also: "2+1 Gratis" modelled as a SET containing the free item.
- Order shape: gift row has `orderSalesMode: "gift"` (and `"points"` for loyalty-points purchases). Price on the row: unverified (probably 0).
- Gift on documents: USTAWIENIA > Dokumenty sprzedaży (EDI) > Ustawienia wydruków dokumentów sprzedaży. Option: gift always shown on documents at price 1,00 and that 1,00 is deducted from other items ("odliczana od pozostałych pozycji"); applies only when invoices are issued in IdoSell itself. System config field `product_free_invoices` = "Defines how to include complimentary products on VAT invoices and receipts" (`GET system/config`). With an external ERP, IdoSell tells merchants to check the ERP's own settings.
- Staff-created orders: offers/gifts apply to storefront customers; staff apply discounts manually.
- Gift limits: no per-order cap documented besides "choose one per threshold"; out-of-stock gift: gift must have stock to be offered (confirmed), behaviour when it runs out mid-checkout unverified.

### 2.8 Returns
- `bundleAsProducts` on returns (confirmed) -> a set can be returned/shown as components. Return of a component with a proportional price, and returns of orders with gifts: not documented (unverified).

---

## 3. SKY-SHOP

### 3.1 Bundles (confirmed from help)
- Produkty > Lista produktów > "Dodaj produkt/zestaw" > Typ: Zestaw; tab "Konfiguracja zestawu" > "Dodaj składniki zestawu"; per component "Ilość w zestawie".
- "Zestaw produktów nie może zostać dodany jako składnik do innego zestawu." (no nesting)
- Price: own price ("mogą posiadać własne ceny, różne od sumy cen produktów"); summed component price can be set as the price or as the strikethrough price; option whether extra parameters affect the bundle price.
- Stock: choose the stock source and optionally IGNORE component stock ("może przyjąć stan i cenę na bazie składników"). Exact formula not documented (unverified, probably min).
- Category/description/photos are the bundle's own; weight and manufacturer optional.
- Dropshipping: automatic forwarding to a wholesaler only when all components come from ONE wholesaler.
- Variants in a bundle: not documented (unverified).

### 3.2 Bundle on invoice (confirmed) - mixed VAT problem
- The bundle is an independent product on the invoice; "nie będą wyświetlać się składniki zestawu ze swoimi stawkami VAT" -> a bundle mixing 5% and 23% goods is invoiced at one rate (the bundle's).

### 3.3 Allegro (confirmed)
- A bundle cannot be listed as an Allegro offer.

### 3.4 Order shape
- API docs exist only per shop at `<domain>/api` (WebAPI per price list). No public instance found -> order JSON for bundles and gifts is UNVERIFIED.

### 3.5 Gifts (confirmed from help)
- Produkty > Gratisy > "Dodaj regułę gratisów"; rule types: producent (threshold on that manufacturer's products only), produkt (qualifying products + min order value), kwota zamówienia (order value). Gift product attached with "Zdefiniuj gratis".
- Gift appears in the cart when conditions met ("Wybrany gratis" - implies customer selection; unverified).
- "Wybrany gratis pokaże się w PDF'ie z zamówieniem, lecz nie będzie wyświetlany na fakturze VAT." -> gift is on the order/packing PDF but NOT on the VAT invoice. Receipt: not stated.
- Stock, limits, Allegro: not documented.

### 3.6 Fiscal/invoicing integrations
- Built-in invoicing (+KSeF), iFirma, inFakt, wFirma, "Fiscal Printer" (video guide), NIP on receipt. No documentation on bundles/gifts in these integrations found.

---

## 4. Common checklist matrix

| Topic | Shoper | IdoSell | Sky-Shop |
|---|---|---|---|
| Bundle definition | native, type=1 + children | native set + collection (product_bundle/product_collection) | native "Typ: Zestaw" |
| Variants in bundle | fixed variant per component; one bundle per combination | customer may choose sizes at order time (4 modes) | not documented |
| Bundle stock | components decremented on sale; bundle unavailable when a component is out; own stock field needs a paid app to equal min (inference) | computed = min(components), cannot be set | choose source / ignore components |
| Bundle on Allegro | not documented | sets usable "przy wystawianiu aukcji", marketplace sizes list | NOT possible |
| Order with bundle | parent line `type:"1"` + nested `children[]` with own price/VAT | component rows with `bundleId` (default); `showBundles=true` collapses | unverified |
| Packing/split | one warehouse per bundle (multi-warehouse) | WZ always lists components | dropship only if one wholesaler |
| Return of component | not documented | returns `bundleAsProducts` | not documented |
| Return with gift | not documented | not documented | not documented |
| Mixed VAT split | per-child tax in API; documents unverified | proportional split by standalone price; switch one-line vs components | NOT supported: one line, one rate |
| Gift source | App Store apps (customer picks / 2+1 cheapest free); no native engine | threshold gifts (pick one), special offers (auto-add, multiplying), set with free item, `product_free` items | rules: manufacturer / product / order value |
| Gift stock | real product (decrement unverified) | must have stock to be offered | not documented |
| Gift on receipt/invoice | not documented (Shoper guide: tax not decided by 0 zł) | configurable; option "always 1,00 deducted from other lines"; `product_free_invoices` | on order PDF, NOT on VAT invoice |
| Gift limits | app-level pools/thresholds; legal guide: announce limits | one per threshold; special offers multiply, cannot disable | not documented |
| Gift flag in order | none (`OrderProduct` has no gift field) | `orderSalesMode:"gift"` | unverified |
