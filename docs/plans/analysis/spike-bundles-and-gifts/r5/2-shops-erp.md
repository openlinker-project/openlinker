# R5 red team 2: shop platforms and ERP claims (C-011..C-022, C-060)

Date 2026-11-04. Method: re-read source code at fixed tags, official docs, OL code. Read-only; no live shop was touched.
Source kinds: [code] = upstream source at a tag, [ol] = OpenLinker repo, [doc] = vendor docs, [gen] = SDK generated from vendor OpenAPI, [issue] = upstream issue tracker.

PrestaShop files were downloaded at tags 1.7.6.9, 1.7.7.0/1.7.7.8 (Pack.php only), 1.7.8.11, 8.1.7, 8.2.1, 8.2.3/8.2.4, 9.0.2, 9.0.3, 9.1.0, 9.1.5, 9.2.0 (Pack.php), and `develop` (fetched 2026-11-04) from
`https://raw.githubusercontent.com/PrestaShop/PrestaShop/<tag>/<path>`. Line numbers below are from those copies.

## Verdict table

| Claim | Verdict | Short reason |
|---|---|---|
| C-011 PS pack = one order row | confirmed | createList makes one OrderDetail per cart product; no component rows |
| C-012 PS cart-rule gift merged into paid row | confirmed (all checked versions 1.7.8.11 - develop); OL mapper comment wrong for core PS | see section 1 |
| C-013 PS does not freeze pack composition | confirmed | issue #37423 open; no per-component stock movement either |
| C-014 pack_stock_type=0 bug versions | disputed (range wrong, close date wrong) | bug present 1.7.6.9 ... 9.1.5, fixed only in 9.2.0; issue closed 2026-08-31 |
| C-015 Woo Product Bundles container/children, 0-priced children | confirmed (code) | `_bundled_by`, `_bundled_items`, `_bundled_item_priced_individually` |
| C-016 WPC woosb meta-only link | probable (not re-tested) | R2 code read stands; not re-checked |
| C-017 Shopify bundles = component lines + lineItemGroup | probable (not re-tested) | docs say "Checkout lines present bundle products as a group of lines" |
| C-018 Shoper type 1 + children with price/tax | probable | only an auto-generated SDK; no product_id on child; semantics of child price/qty undocumented; no live sample |
| C-019 OL Shoper adapter ignores type/children | confirmed | `ShoperOrderLineRow` has neither field |
| C-020 IdoSell orderSalesMode gift, bundleId | confirmed (primary doc) | idosell.readme.io schema |
| C-021 Sky-Shop gift on PDF not on invoice; set one line | confirmed (help docs); "anti-pattern" label is opinion | |
| C-022 Subiekt GT komplet stock only after Zmontuj; bridge SUM(st_Stan) | probable | InsERT doc confirms assembly receives stock; "never auto-assembles on sale" still unverified; bridge reads tw_Rodzaj and throws it away |
| C-060 OL PS adjustInventory writes only pack's own row | confirmed, and worse than stated | see section 5 |

---

## 1. C-012: PrestaShop cart-rule gift (priority)

### What the platform does (verified-code, every checked tag)

1. Adding the gift. `Cart::addCartRule` calls `updateQty` on the cart rule's `gift_product` / `gift_product_attribute` (8.1.7 Cart.php:1344-1348; develop Cart.php:1463-1468, also when the new Discount feature flag is on). `cart_product` is keyed by product + combination + customization + delivery address, so the gift is the SAME cart row as a bought unit of the same product/combination (quantity +1), or a new row when the product was not otherwise bought.
2. Splitting is display-only. In 1.7.8.11 and 8.1.7 the split is an instance flag `protected $shouldSplitGiftProductsQuantity = false;` (8.1.7 Cart.php:174) that is turned on only inside `getProductsWithSeparatedGifts()` and turned back off right after:
   > `$products = $this->splitGiftsProductsQuantity()` ... `$this->mergeGiftsProductsQuantity();` (8.1.7 Cart.php:5217-5219)
   In 9.0.2 and develop it became a parameter, default false:
   > `bool $shouldSplitGiftProductsQuantity = false` (9.0.2 Cart.php:641; develop Cart.php:687)
   and `mergeGiftsProductsQuantity` is "@deprecated since 9.1.0 - it doesn't do anything" (develop Cart.php:5062).
3. Order creation uses the merged list. `PaymentModule::validateOrder` -> `$package_list = $this->context->cart->getPackageList();` (8.1.7 PaymentModule.php:265; 9.0.2:273; develop:261), and `getPackageList` -> `$product_list = $this->getProducts($flush);` (8.1.7 Cart.php:2559; 9.0.2:2471; develop:2749), i.e. no split. Then `$order_detail->createList($order, $cart, $id_order_state, $order->product_list, 0, true, ...)` (8.1.7:1105; 9.0.2:1110; develop:1208), which loops `foreach ($product_list as $product) { $this->create(...) }` (8.1.7 OrderDetail.php:825-826).
4. The row price is the full catalogue price:
   > `$this->unit_price_tax_incl = (float) $product['price_wt'];` / `$this->product_price = $this->unit_price_tax_excl = (float) $product['price'];` (8.1.7 OrderDetail.php:678-679; identical 9.0.2:678-679, develop:658-659)
   and `product_quantity = (int) $product['cart_quantity']` (8.1.7 OrderDetail.php:764) - the merged quantity.
5. The gift value lives only as an order-level discount (`order_cart_rule.value`, `total_discounts`), confirmed by R2 and by upstream issue #34085 ("You have only paid for one of these products, but the tax detail is prorated between the 2 products", 8.1.1, open).

Result: a core PrestaShop order never contains a separate 0-price gift row. Two shapes occur:
- gift product NOT otherwise bought: its own row, but at FULL price (not 0), indistinguishable from a paid row without joining `order_cart_rules` -> `cart_rules/{id}.gift_product`;
- gift product ALSO bought: ONE row, quantity = bought + 1, full unit price.

### Who is right

R2 is right for core PrestaShop 1.7.8.11, 8.1.7, 8.2.1, 9.0.2 and develop (9.1/9.2 line). The OL mapper comment (libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts:163-166, added in 74011260b, #2134) says:
> "a content-derived key such as `${product_id}:${product_attribute_id}` is not unique within one order (customisation, free-gift lines, warehouse splits and partial re-invoicing all produce sibling rows sharing that pair)"

The "free-gift lines" item is wrong for core PS: validateOrder never produces a sibling gift row. The CONCLUSION of the comment (use `id_order_detail`) is still right, because siblings do exist for other reasons:
- customizations (different `id_customization`, same product/attribute);
- back-office "add product" on a multi-invoice order: AddProductToOrderHandler has an explicit branch for "the added product was already in previous invoices" (8.1.7 src/Adapter/Order/CommandHandler/AddProductToOrderHandler.php:175);
- third-party gift modules (unverified, varies).
So: fix the comment (drop "free-gift lines", keep the rule). No code change needed.

### Extra cases R1/R2 missed
- BO order edit can ADD a gift row after the fact: "When a product is added some other products may be affected (because of CartRule that would add some gift for example)" (8.1.7 AddProductToOrderHandler.php:261-262). An existing row is updated (quantity += delta, line 287-295), a new one is created via `createList` (line 250-256). So gift detection must also run on order UPDATES, not only at ingestion.
- A "gift" can also be a cart rule with `reduction_product` = X and `reduction_percent` = 100 (no `gift_product`). Different evidence chain; R2 lists it as a source but the proposed standard only names the `gift_product` join.
- `order_cart_rule` keeps name and value but not `gift_product`; if the merchant edits/deletes the cart rule before OL reads it, the join is lost (R2 noted). The proposed "adapter joins order to cart rule" has no fallback.

## 2. C-013: pack composition not frozen

Confirmed. Issue #37423 (open, reported on 9.0.x): "if I change the content of it when a customer has already made an order, as a merchant I will send the updated content of the pack, instead of what the customer bought."
Additional evidence that there is no indirect snapshot either: in `StockManager::updatePackQuantity` the components are changed with a bare `$productStockAvailable->update();` (9.0.2 src/Core/Stock/StockManager.php:74-80) - no `saveMovement` with `id_order` for components (the only `saveMovement` call is line 185, in `updateQuantity`). So `stock_mvt` does not carry per-component history of a pack sale either.

Counterargument to the proposed "snapshot at ingestion": the snapshot is taken when OL reads the order, not when the buyer bought. Webhook latency is usually small, the poll backstop is 10 min, and a re-sync of an old order (reconcile, backfill) would snapshot the CURRENT composition. Cheaper and exact alternative: OL's own PrestaShop module already hooks order validation:
> `public function hookActionValidateOrderAfter(array $params)` ... `'payloadJson' => null, // Minimal payload for MVP` (apps/prestashop-module/openlinker/openlinker.php:1875, ~1918)
Capturing `Pack::getItems` + applied gift cart rules into a module table at that moment gives the at-sale truth (and solves the C-012 "rule edited later" gap too). Cost: module release + shops on old module versions fall back to ingestion snapshot; must be stored module-side and read on demand, not trusted from the webhook payload (webhook = trigger rule, #904). Whether `actionValidateOrderAfter` exists on 1.7.x: (unverified).

## 3. C-014: pack_stock_type=0 empty() bug - version range is wrong

`Pack::getQuantity` at each tag:
- 1.7.6.9, 1.7.7.0, 1.7.7.8, 1.7.8.11: `if (empty($packStockType) || $packStockType == self::STOCK_TYPE_DEFAULT)` (1.7.8.11 Pack.php:280-283; 1.7.6.9:275-278). R2's statement "1.7.8.11 uses `== STOCK_TYPE_DEFAULT` only" is FALSE.
- 8.1.7, 8.2.1, 8.2.3, 8.2.4: same (Pack.php:311).
- 9.0.2, 9.0.3: same (Pack.php:313).
- 9.1.0, 9.1.5: same (Pack.php:293). Not fixed in 9.1.x.
- 9.2.0 and develop: fixed: "// Avoid using empty(), because it would treat STOCK_TYPE_PACK_ONLY (0) as STOCK_TYPE_DEFAULT" / `if ($packStockType === null || $packStockType === '' || (int) $packStockType == self::STOCK_TYPE_DEFAULT)` (9.2.0 Pack.php:293-294).
- Issue #42079 closed 2026-08-31 (not 2026-07).

The bug is on the READ path only. The write path honours 0 exactly: `if ($product->pack_stock_type == Pack::STOCK_TYPE_PACK_ONLY || ...) { $stock_available->update(); }` (9.0.2 StockManager.php:86-94; identical in 1.7.8.11 and 8.1.7). Issue #42079 states the consequence: "placing an order decrements the pack's own stock ... but the FO product page, listings, and availability checks ... display a quantity computed from the pack's components".

Impact on OL: `packStockTypeDefersToShop` returns true for 0 (libs/integrations/prestashop/src/domain/types/prestashop-pack.types.ts:28-36), "verified against PrestaShop 9.0.2". That copies PrestaShop's buggy read path. On <=9.1.x this matches what the shop itself shows and checks (consistent, but both drift from what is actually decremented). On 9.2.0+ OL will disagree with the shop for every pack set to 0 when the shop default is 1 or 2. The adapter needs the shop version (or a module-reported effective mode), not a fixed rule.

## 4. C-018 / C-019: Shoper

Evidence is an auto-generated SDK ("Shoper REST API SDK for php - auto-generated from OpenAPI spec", github.com/dreamcommerce/shoper-sdk-php, pushed 2026-10-22) [gen]:
- `OrderProduct.type`: "line item type: 0 - a regular product, 1 - a product bundle whose components are returned in the `children` array."
- `OrderProductChildrenItem`: `bundle_child_id`, `id` ("order product identifier"), `order_id`, `price` ("child price"), `quantity` ("quantity"), `stock_id`, `tax` ("tax rate name"), `tax_value`, `discount_perc`, `code`, `pkwiu`. There is NO `product_id` on a child.
- Product side `ProductChildrenItem.stock`: "quantity of this component in a single bundle".
So "children carry stock_id, quantity, price, tax" is supported, but: (a) is child `quantity` per bundle or per line? (b) is child `price` unit or line, gross or net, and does sum(children) = parent? All undocumented. Verdict: probable, needs one live order.

Missed case (risk of double counting): each child has its own order-product `id` and `order_id`, i.e. children look like rows of the same order-products table. OL reads lines via `GET /order-products?filters[order_id]=` (libs/integrations/shoper/src/infrastructure/adapters/order-source/shoper-order-source.adapter.ts:546-563). If that list endpoint returns children ALSO as top-level rows, OL today already ingests the bundle AND its components as independent lines (double reservation, double revenue). Unknown; this is the first thing to check on the trial shop, before designing.
C-019 confirmed: `ShoperOrderLineRow` declares id, order_id, product_id, stock_id, price, quantity, name, code, ean, tax, tax_value only (shoper-api.types.ts:533-546). Child-to-product mapping would also need a stock_id -> product lookup, because `lineRef` keys on `product_id` (shoper-incoming-order.mapper.ts:273-286).

## 5. C-060: PrestaShop adjustInventory

Confirmed: `adjustInventory` resolves the product + attribute and PUTs the single matching `stock_availables` row (libs/integrations/prestashop/src/infrastructure/adapters/prestashop-inventory-master.adapter.ts:887-945); no pack branch. Worse than stated: a webservice write to `stock_available` goes through `StockAvailable::update()` -> `postSave()`, which only re-sums combinations (r2/phase1/src/StockAvailable.php:294-340); it does NOT run `StockManager::updatePackQuantity` or `updatePacksQuantityContainingProduct`. So:
- restock/correction on a pack in mode 1 (components) writes a row PrestaShop ignores for availability: the operator sees "applied", nothing changes for buyers;
- restock of a COMPONENT does not refresh packs in mode 2 (both).
This is a live defect for returns of packs (return_restock), independent of the new design.

## 6. C-022: Subiekt GT komplet

InsERT e-pomoc (last modified 26.03.2024) [doc], https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/3694,subiekt-gt-czy-mozna-zmontowac-komplet-z-kompletu.html :
> "Aby zmontować komplet (przyjąć na stan), wszystkie składniki tego kompletu muszą być dostępne w magazynie. Jeżeli w skład kompletu wchodzi inny komplet, należy najpierw zmontować komplet"
This proves assembly receives komplet stock. It does NOT prove that a sale of an unassembled komplet is impossible or never auto-assembles; I found no InsERT page either way (searches returned nothing usable). Keep "(unverified)".
Bridge [ol, /home/nor/projekty/blocky/openlinker-subiekt-bridge @21f909c]: `OUTER APPLY (SELECT SUM(st_Stan) AS stan, SUM(st_StanRez) AS rez FROM tw_Stan WHERE st_TowId = t.tw_Id) s` (bridge-gt/Program.cs:317) for every `tw_Usuniety = 0` towar. It also SELECTs `t.tw_Rodzaj` (Program.cs:304) into `Row.Kind` (Program.cs:1494) and nothing reads `Kind` afterwards (grep). So OL could already tell a komplet apart cheaply; it discards the fact. The numeric value of tw_Rodzaj for komplet in GT: (unverified). The nexo bridge maps "4 = komplet" (bridge/Subiekt.Bridge.Infrastructure.Sql/SqlProductCatalogReader.cs:14) - that is nexo, do not reuse for GT.

## 7. Other claims
- C-015 [code, pronamic 2022 mirror]: `$bundled_order_item->add_meta_data( '_bundled_by', ...)`, `'_bundled_item_priced_individually', ... 'yes' : 'no'`, `$container_order_item->add_meta_data( '_bundled_items', ...)` (r2/phase1/wcpb/class-wc-pb-order.php:275, 294, 342). Confirmed. Snapshot is 2022; current plugin not re-checked.
- C-020 [doc, primary] idosell.readme.io/reference/ordersordersget: `"orderSalesMode":{"type":"string","description":"Product selling mode. Available values: \"money\", \"gift\", \"points\"."` and `"bundleId":{"type":"integer","description":"A set's ID."`. Confirmed. Still unknown: is the set itself a line.
- C-021 [doc] sky-shop.pl/pomoc-faq/.../jak-tworzyc-gratisy-w-sklepie/: "Wybrany gratis pokaże się w PDF'ie z zamówieniem, lecz nie będzie wyświetlany na fakturze VAT." and .../jak-dodac-zestaw-produktow/: "Na fakturze nie będą wyświetlać się składniki zestawu ze swoimi stawkami VAT." Confirmed. Calling it an "anti-pattern" is a legal/tax opinion with no cited source; whether a purchase-conditional gift must appear on the invoice is not established in our evidence (unverified).

## 8. Counterarguments against the proposed design (with alternatives)

1. "Adapter joins order_cart_rules to cart_rules to find the gift" (data.ts PrestaShop gap). Fragile: rule editable/deletable; BO edits add gifts later; 100%-reduction rules have no gift_product. Alternative: OL PS module snapshots applied gift rules + gift product ids at actionValidateOrderAfter into a module table, read via the existing module client. Cost: module version, fallback path for old modules.
2. "Snapshot pack composition at ingestion" - not at-sale truth (sec. 2). Same module alternative.
3. PS pack stock mode as a static rule in core/adapter - must be version-aware (sec. 3). Alternative: module reports the effective `Pack::getQuantity` answer per pack (the shop's own answer), OL stops re-deriving PrestaShop rules. Cost: one module endpoint; removes a whole class of version drift.
4. Gift as "a separate 0-price line" in the neutral model forces the PS adapter to SPLIT a merged row (qty 2 at 4.99 -> paid 1 + gift 1 with reduction). That split is a guess when the product was also bought and returns cannot tell units apart. Alternative: model gift as a quantity-scoped reduction on an existing line (`giftQuantity` on the line) rather than a line role. Cost: every consumer (pack bench, documents) must handle a line that is partly gift.
5. Shoper: do not design the bundle mapping until one live order answers "children nested only, or also flat" (sec. 4). If flat, the current adapter is already double-counting and that is a bug fix, not a feature.
6. Subiekt komplet: the "B-03 ready-made kit with own stock" path is the native GT model; the proposed "stock = min of components" default would contradict the master. Alternative: let the product-master adapter declare per item "kit stock is own" vs "derived", starting with using `tw_Rodzaj` the bridge already reads. Cost: small bridge change.
