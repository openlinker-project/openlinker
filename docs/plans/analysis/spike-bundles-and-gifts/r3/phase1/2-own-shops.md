# R3 / phase 1 / 2 - Own shops: PrestaShop, WooCommerce (+plugins), Shopify

Round 3, blind replication. Written without reading earlier rounds. Date of research: 2026-11-04.

## Method and sources

Primary sources were read as code or official docs. Downloaded copies sit in the session scratchpad (not in the repo).

| Source | Kind | Version / date |
|---|---|---|
| PrestaShop `classes/Pack.php`, `Cart.php`, `CartRule.php`, `PaymentModule.php`, `order/Order.php`, `order/OrderDetail.php`, `order/OrderCartRule.php`, `stock/StockAvailable.php`, `Product.php` from github.com/PrestaShop/PrestaShop | source code | tag `1.7.8.11`, branches `8.2.x`, `9.2.x` (fetched 2026-11-04) |
| PrestaShop `src/Core/Stock/StockManager.php`, `src/Adapter/Order/CommandHandler/AbstractOrderCommandHandler.php`, `src/Adapter/Order/QueryHandler/GetOrderProductsForViewingHandler.php`, `classes/order/OrderHistory.php`, `src/Adapter/Product/Pack/Update/ProductPackUpdater.php`, `src/Adapter/Product/Combination/Create/CombinationCreator.php`, `classes/webservice/WebserviceRequest.php`, `pdf/*.tpl` | source code | `8.2.x` (StockManager also `9.2.x`) |
| WooCommerce core `includes/class-wc-form-handler.php`, `includes/wc-stock-functions.php`, REST `class-wc-rest-orders-v2-controller.php` | source code | `trunk`, 2026-11-04 |
| WooCommerce Product Bundles (official, paid) via GPL mirror github.com/pronamic/woocommerce-product-bundles | source code (mirror) | 6.17.3, mirror last pushed 2022-11-08 - OLD, current version may differ |
| Product Bundles docs woocommerce.com/document/bundles/... | vendor docs | live 2026-11-04 |
| WPC Product Bundles (`woo-product-bundle`, 30k installs) | source code (wordpress.org zip) | 8.7.8, 2026-10-26 |
| iThemeland Free Gifts (`ithemeland-free-gifts-for-woo`, 2k installs) | source code | 4.6, 2026-10-29 |
| WPC Free Gift Coupons (`wpc-free-gift-coupons`, 400 installs) | source code | 1.1.9 |
| Woo Discount Rules (`woo-discount-rules`, 100k installs) | source code (skimmed only) | 2.6.18 |
| Free Gift Coupons (official Woo marketplace, paid) | vendor docs only | live |
| Shopify `shopify.dev` bundles docs (markdown), `LineItem`, `LineItemGroup`, `DiscountAllocation` GraphQL objects | official API docs | API 2026-10 |
| Shopify Help Center: bundles eligibility, Buy X get Y | official help docs | live |
| OpenLinker `libs/integrations/prestashop/src/domain/types/prestashop-pack.types.ts` | repo code | current worktree |

Install counts come from the wordpress.org plugin API (`active_installs`), 2026-11-04.

---

## 1. PrestaShop 1.7 / 8 / 9

### 1.1 Bundle ("pack") definition

- A pack is a product whose components live in table `pack` (`id_product_pack`, `id_product_item`, `id_product_attribute_item`, `quantity`). `Pack::addItem` writes exactly those columns and flips the product to `product_type = pack` - `classes/Pack.php:509-519` (8.2.x): `'id_product_pack' => (int) $id_product, 'id_product_item' => (int) $id_item, 'id_product_attribute_item' => (int) $id_attribute_item, 'quantity' => (int) $qty`.
- A component may be a specific combination (`id_product_attribute_item`), but it is FIXED per pack: the buyer does not choose a component variant. If none is given, the component's default combination is used: `Pack.php:511` `$id_attribute_item = (int) $id_attribute_item ? (int) $id_attribute_item : Product::getDefaultAttribute((int) $id_item);`.
- No nested packs (8.x+): `ProductPackUpdater.php:114-118` - `'Product #%d is a pack itself. It cannot be packed'` (`CANNOT_ADD_PACK_INTO_PACK`).
- A pack cannot have its own combinations (8.x+): combinations can only be created on a `combinations`-type product - `CombinationCreator.php:134-135` `if ($product->product_type !== ProductType::TYPE_COMBINATIONS) { throw new InvalidProductTypeException(...)`. For 1.7 this is (unverified) - only the legacy UI was not checked.
- Pack price is its own product price. `Pack::noPackPrice` (sum of component prices) is only used to show the saving; nothing distributes the pack price over components (`Pack.php:132-165`).
- Exposed over the webservice as `associations.product_bundle` on the product (the existing OL adapter already reads it - `prestashop-pack.types.ts:50`).

### 1.2 Stock modes (`pack_stock_type`)

Constants (`src/Core/Domain/Product/Pack/ValueObject/PackStockType.php:21-36`, 9.2.x): `STOCK_TYPE_PACK_ONLY = 0`, `STOCK_TYPE_PRODUCTS_ONLY = 1`, `STOCK_TYPE_BOTH = 2`, `STOCK_TYPE_DEFAULT = 3` (3 = use shop setting `PS_PACK_STOCK_TYPE`).

Code comment, `Pack.php:305-307` (8.2.x):
> `STOCK_TYPE_PACK_ONLY - pack 1pcs + product A 10pcs + product B 20pcs = 1pcs`
> `STOCK_TYPE_PRODUCTS_ONLY - pack 1pcs + product A 10pcs + product B 20pcs = 10 pcs`
> `STOCK_TYPE_PACK_BOTH - pack 1pcs + product A 10pcs + product B 20pcs = 1 pcs`

Decrement on sale (`src/Core/Stock/StockManager.php:63-93`, 8.2.x; identical logic in 9.2.x):
- modes 1 and 2: every component row decremented by `delta * pack_quantity` (`:75`).
- the pack's OWN `stock_available` row is only written in modes 0 and 2 (`:84-93`). In mode 1 the pack row is left stale.
- Selling a component on its own lowers the pack row ONLY in mode 2 ("Decrement both") and only down to what components can still build (`:118-134`, comment: `Decrease stocks of the pack only if pack is in linked stock mode (option called 'Decrement both')`).

**Version difference (bug, verified in code):** in 1.7.8.11 and 8.2.x `Pack::getQuantity` resolves the mode with `if (empty($packStockType) || $packStockType == self::STOCK_TYPE_DEFAULT)` (`Pack.php:311`, 8.2.x). PHP `empty(0)` is true, so a pack explicitly set to mode 0 ("pack only") is READ as the shop default, while `StockManager` (which uses `==`) DECREMENTS it as mode 0. Availability and decrement can disagree. Fixed in 9.2.x (`Pack.php:293-294`): `// Avoid using empty(), because it would treat STOCK_TYPE_PACK_ONLY (0) as STOCK_TYPE_DEFAULT`; commit `06ce18086` "Fix Pack::getQuantity ignoring 'Decrement pack only' stock type", 2026-07-25. Note: the OL adapter's comment (`prestashop-pack.types.ts:28-34`) states "verified against PrestaShop 9.0.2" that `0` defers to shop default - true for <= 9.1, false for 9.2.x. The rule must become version-dependent.

### 1.3 Pack in the ORDER payload

- One `order_detail` row per cart product; the pack is ONE row with the pack's own `product_id`, name, reference, EAN, weight (`OrderDetail.php:749-776`). There is no component row, no parent/child link, and no field anywhere in `Order.php`, `OrderDetail.php`, `OrderReturn.php`, `OrderSlip.php`, `HTMLTemplateInvoice.php`, `HTMLTemplateDeliverySlip.php` or the two `pdf/*.product-tab.tpl` templates that mentions packs (grep for `pack`, excluding "package"/license text, returned nothing).
- Tax: the row gets ONE tax rule group, the pack's own: `OrderDetail.php:590` `$this->id_tax_rules_group = (int) Product::getIdTaxRulesGroupByIdProduct((int) $product['id_product'], $this->context);`. A pack of a 5% book + 23% toy is taxed at whatever rate the pack product carries. No VAT split. Same in 1.7.8.11 (`:568`) and 9.2.x (`:567`).
- Webservice `orders` -> `associations.order_rows` exposes `product_id, product_attribute_id, product_quantity, product_name, product_reference, product_ean13, product_isbn, product_upc, unit_price_tax_incl, unit_price_tax_excl` (`Order.php:1734-1757`). No tax rate. Resource `order_details` hides tax: `OrderDetail.php:256` `'hidden_fields' => ['tax_rate', 'tax_name']`; rate only via the `taxes` association.
- The BO order screen expands the pack from the CURRENT catalogue, not from the order: `GetOrderProductsForViewingHandler.php:155` `$pack_items = $product['cache_is_pack'] ? Pack::getItemTable($product['id_product'], ...)`. If the pack composition is edited after the sale, the order screen shows the new composition.
- Delivery slip (packing document) prints only the pack line (no `pack` reference in `HTMLTemplateDeliverySlip.php` / `delivery-slip.product-tab.tpl`). The packer must know the contents.

### 1.4 Returns / refunds of a pack

- Merchandise returns and slips are per `order_detail` row, i.e. per pack. A single component cannot be returned as a quantity.
- Restock on refund puts back ALL components of the pack (current composition): `AbstractOrderCommandHandler.php:92-107` - `if (Pack::isPack((int) $product->id)) { ... foreach ($products_pack as $product_pack) { ... $product_pack->pack_quantity * $quantityToReinject`.
- On order cancel, `OrderHistory.php:283-302`: `// if the product is a pack, we restock every products in the pack using the last negative stock mvts`.

### 1.5 Free gift (cart rule `gift_product`)

- A cart rule has `gift_product` + `gift_product_attribute` (`CartRule.php:98-99`). When applied, PrestaShop adds ONE unit to the normal cart table: `Cart.php:1348-1352` `if ((int) $cartRule->gift_product) { $this->updateQty(1, $cartRule->gift_product, $cartRule->gift_product_attribute, ...`. Always quantity 1 per rule.
- Stock is respected: that call passes `$skipAvailabilityCheckOutOfStock = false`, and `updateQty` returns `-1` for an out-of-stock product without backorders (`Cart.php:1589`, `:1633-1640`). Reading the code, an out-of-stock gift is silently not added (behaviour not live-tested).
- **Merged, not a separate row.** `cart_product` is keyed by product+combination+customization+address, so if the buyer already has the same product, the gift just adds +1 to that row. Separation exists only for display: `getProductsWithSeparatedGifts()` (`Cart.php:5234-5241`) sets a split flag; the default `getProducts()` used by `getPackageList()` (`Cart.php:2571`) and by order creation is merged. `is_gift` is never written to `order_detail`.
- In the order: the gift appears as a normal `order_detail` row at FULL price (or as +1 on an existing row), and the giveaway is an `order_cart_rule` row with `name, value, value_tax_excl, free_shipping` (`OrderCartRule.php`, fields). The gift value is `price_wt` of the gift product (`CartRule.php:1494-1505` `$reduction_value += Tools::ps_round($use_tax ? $product['price_wt'] : $product['price'], ...)`).
- One cart rule may also carry `reduction_percent`, `reduction_amount`, `free_shipping` (`CartRule.php:86-88`): all lumped into ONE `order_cart_rule.value`. The gift's share cannot be told apart from the order alone.
- Tax: PrestaShop spreads ALL order discounts (gift included) pro rata across every line when it stores per-line tax (`OrderDetail.php:413-416`): `$ratio = ... ($this->unit_price_tax_excl / $order->total_products) ...; $order_reduction_amount = ($order->total_discounts_tax_excl - $shipping_tax_amount) * $ratio;`. A 23% gift given with a 5% book reduces tax on BOTH lines; the per-line tax table does not reflect "this item was free".
- Cart rules are hard-deleted (`CartRule.php:227-247`), so reading `cart_rules/{id}` later to find `gift_product` can fail.

### 1.6 Checklist - PrestaShop

| Item | Answer |
|---|---|
| bundle definition | `pack` table, components with fixed qty and fixed combination; own price, own tax class; no nesting (8+). Full |
| variants | pack has no combinations (8+); components pinned to one combination; buyer cannot choose. Partial |
| bundle stock | 4 modes 0/1/2/3; mode 1 leaves pack row stale; 1.7/8.x `empty(0)` bug fixed in 9.2.x. Full but inconsistent |
| listing | pack is an ordinary product in catalogue / webservice (`type`, `product_bundle`). Full |
| order with bundle | ONE row, no components, no link. None (components) |
| packing | delivery slip shows only pack; BO order view shows CURRENT composition. Partial/misleading |
| component return | not possible as quantity; refund restocks all components. None |
| return with gift | gift row (or merged +1) at full price, discount on order level; no gift marker. None |
| VAT split | pack: single rate of pack product. Gift: discount spread pro rata over all lines. None |
| gift source | cart rule `gift_product` (auto-added, 1 unit) | 
| gift stock | normal stock; out-of-stock gift not added (code reading) |
| gift on documents | normal product line at full price + discount line from `order_cart_rule` (template not checked: unverified) |
| gift limits | 1 unit per rule; rule quantity/quantity_per_user/minimum/conditions; one gift product per rule |

---

## 2. WooCommerce

### 2.1 Core

- No bundle type and no gift in core. "Grouped product" is a listing grouping only: each child is added to the cart on its own, `class-wc-form-handler.php:1349` `WC()->cart->add_to_cart( $item, $quantity )` - no parent data, so the order has independent lines and no trace of the group.
- Coupons only discount; they cannot add a product.
- Stock is reduced per order line item: `wc-stock-functions.php:185-215` loops `$order->get_items()`, uses filter `woocommerce_order_item_quantity`, and marks `_reduced_stock` on each item. Any plugin that wants a bundle to reduce component stock must make components real line items (or hook this filter).
- REST order `line_items[].meta_data` is built from `get_all_formatted_meta_data( null )` (`class-wc-rest-orders-v2-controller.php:284`), i.e. includes `_`-prefixed plugin meta (inferred from method name; not live-tested).
- Each line has its own `tax_class`, `taxes[]`, `subtotal`, `total`, so per-line VAT exists natively.

### 2.2 WooCommerce Product Bundles (official, Woo.com, paid)

Order shape (source mirror 6.17.3, `includes/class-wc-pb-order.php`):
- Parent ("container") line + one line per bundled item. Child meta: `_bundled_by` (parent cart key), `_bundled_item_id`, `_stamp`, `_bundled_item_priced_individually` (`yes|no`), `_bundled_item_needs_shipping`, `_bundled_item_hidden`, `_bundled_item_title` (`:1042-1063`, `:275-311`). Parent meta: `_bundled_items` (child keys), `_bundle_cart_key`, `_stamp`, `_bundle_group_mode`, `_bundle_weight` (`:1001-1037`, `:341-347`).
- REST adds top-level fields to order line items (`includes/api/class-wc-pb-rest-api.php:1236-1316`): `bundled_by` and `bundled_items` (as ORDER ITEM IDs, resolved from keys). Docs: `bundled_by` "Item ID of parent line item, applicable if the item is part of a bundle."; `bundled_items` "Item IDs of bundled line items, applicable if the item is a bundle container item." (woocommerce.com/document/bundles/bundles-rest-api-reference/, vendor docs).
- Price: if a bundled item is NOT priced individually its cart price is forced to 0 - `class-wc-pb-cart.php:906-912` `if ( false === $bundled_item->is_priced_individually() ) { ... set_regular_price( 0 ); ... set_price( 0 );`. Docs: "The order item subtotals of both products included in it are zero" and "Be aware that a static bundle price limits you to a single tax rate." (bundles-use-case-simple-product-kits). With "priced individually" each child line carries its own price and tax class; a bundle discount is a percentage on children.
- Stock: both the container and children can hold stock: "you can set the Stock Status and Stock Quantity of a bundle independently"; "every time you sell a product bundle, the stock quantity of its contents is reduced as well" (bundles-configuration, vendor docs).
- Variants: bundled variable products with filtered variations and default selections; optional items; min/max bundle size ("pick-and-mix") (bundles-configuration).
- Shipping: Assembled vs Unassembled; "Shipped Individually does not mean "split across different shipments"" (bundles-configuration).
- Returns: core refunds are per line item, so a child line can be refunded by quantity; but a 0-priced child has no money to refund (inference from core line refund model; not live-tested).

### 2.3 WPC Product Bundles (WPClever, free, 30k installs)

`includes/class-woosb.php` (8.7.8):
- Parent line meta `_woosb_ids`, `_woosb_price`, `_woosb_bundle`; child line meta `_woosb_parent_id` (`:1242-1259`).
- **`_woosb_parent_id` is the bundle PRODUCT id, not a line id**: `:723` `'woosb_parent_id' => $product_id,` while `woosb_parent_key` (the cart key) is NOT saved on the order item. Two instances of the same bundle with different picks in one order cannot be reliably re-paired to their parents from the order.
- Fixed price mode: children set to price 0, parent keeps bundle price (`:944-948` `// Fixed Price: child items are free (price 0), parent maintains bundle price`). Single tax rate (parent's).
- Auto price mode: parent price 0 and tax status forced `none`, children carry prices (`:958-968`). VAT split works.
- Stock: children are line items, so core reduces them; bundle own stock optional (`includes/class-product.php:478-506`).

### 2.4 Gift plugins

| Plugin | Gift line | Marker on order item | Source |
|---|---|---|---|
| iThemeland Free Gifts (2k) | separate cart line, price set from rule (normally 0) | `_free_gift = yes`, `_free_gift_method`, `_free_gift_type`, `_rule_id_free_gift`; order meta `gift_set` | `frontend/classes/cart_hook.php:94-103`, `:133`, `:145-148`; admin add: `admin-order.php:226-235` sets `_line_total 0`, `_line_tax 0` |
| WPC Free Gift Coupons (400) | separate cart line; subtotal and total forced 0 | **none persisted** (cart data `wpcfg_used_coupon` not saved); only coupon in `coupon_lines` | `includes/class-frontend.php:228-234` `$item->set_subtotal( 0 );`, `:210-226` |
| Free Gift Coupons (official, paid) | gift "listed as free"; multiple gifts per coupon; variable gifts since 3.0 | (unknown) | woocommerce.com/document/free-gift-coupons/ (vendor docs) |
| Woo Discount Rules (100k) | per-item discount stored in `_wdr_discounts` meta; BOGO "buy X get Y" is in Pro (unverified) | `_wdr_discounts`, `_advanced_woo_discount_item_total_discount` | `v2/App/Controllers/ManageDiscount.php:2042-2057` |

Common Woo pattern: the gift is a real line item at 0 (so it reduces stock through core) and its tax is 0 because the line total is 0.

### 2.5 Checklist - WooCommerce

| Item | Answer |
|---|---|
| bundle definition | core: none (grouped = listing only). Plugins: Product Bundles, WPC, YITH, Composite. Plugin-dependent |
| variants | PB: variable bundled items, buyer chooses, filtered variations. WPC: similar. Partial-Full per plugin |
| bundle stock | PB: container stock AND component stock both reduce; no reserved share. Plugin-dependent |
| listing | bundle is a product type of the plugin |
| order with bundle | parent + child lines; link: PB = `bundled_by`/`bundled_items` (item ids in REST); WPC = product id only (ambiguous) |
| packing | children are visible lines; `_bundled_item_needs_shipping` / `_bundle_weight` tell assembled vs not |
| component return | per child line by core refund; 0-priced children have no money value |
| return with gift | gift line at 0; refund nothing; restock is per line |
| VAT split | static price -> one rate on parent; priced individually / auto price -> per child line rate |
| gift source | plugin rules or coupon-triggered |
| gift stock | normal line item stock reduction |
| gift on documents | 0-value line; marker depends on plugin (iThemeland `_free_gift`, WPC FGC none) |
| gift limits | plugin config (max per coupon, picks) |

---

## 3. Shopify (storefront)

### 3.1 Bundles

From `shopify.dev/docs/apps/build/product-merchandising/bundles/start-building` (official, comparison table, lines quoted verbatim):
- Pricing: "The bundle price is allocated across components in the checkout, cart, and orders using a weighted price algorithm."
- Discounts: "Discount calculated on the parent then allocated on the components."
- Taxes: "Taxes will be computed on the components."
- Stock (fixed bundles): "Shopify maintains sellable quantities on the parent bundle variant. The parent inventory quantity is the minimum of the component's inventory quantities."
- Order lines: "Components, with reference to parent through groupings"
- Returns: "Operates at the component level"; reports: "Sales reporting at the component level".
- Fixed bundles = `productBundleCreate`; customized bundles = Cart Transform function (expand / merge), where the buyer picks component variants and "App is responsible for its own variant picker".

`LineItemGroup` (GraphQL Admin 2026-10): "When a bundle is purchased, each component line item references its LineItemGroup through the lineItemGroup field". Fields: `id, quantity, title, productId, variantId, variantSku, customAttributes`. **No price field on the group** - the bundle total must be summed from components.

Help Center (eligibility-and-considerations): "Bundles can't contain other bundles."; "Bundles in orders display as a nested group of line items."; "Bundles can't be used in exchanges even when exchanging for an identical bundle"; "Bundles are assigned a SKU that's separate from individual products SKUs."; "If a component's SKU changes, then you need to delete and recreate the entire bundle."; "Bundles aren't compatible with purchase options, which includes subscriptions, pre-orders, and try-before-you-buy."

### 3.2 Gifts / Buy X Get Y

Help Center buy-x-get-y: "The free or discounted 'get' item is never automatically added to the cart." / "Customers must add all items to their cart manually." / per-order cap "maximum number of times that this promotion can apply to each order" / "If the inventory of free products drops to zero, then the products display as being sold out."

In the order the "get" item is an ordinary `LineItem` with `originalUnitPriceSet` at list price and a `discountAllocations` entry: "The discounts that have been allocated to the line item by discount applications, including discounts allocated to refunded and removed quantities." Tax via `taxLines`. Whether BXGY on the SAME product merges into one line with a partial allocation: (unverified). Auto-add gift apps exist (unverified, out of scope).

### 3.3 Checklist - Shopify

| Item | Answer |
|---|---|
| bundle definition | parent variant with components (fixed) or Cart Transform (customized); no nesting |
| variants | fixed: parent variants map to component variants; customized: buyer picks |
| bundle stock | fixed: parent sellable = min of components; components decremented |
| listing | parent product with own SKU |
| order with bundle | ONLY component lines, each with `lineItemGroup` (no parent line, no group price) |
| packing | components are the lines; grouping via `lineItemGroup.id` |
| component return | supported, component level |
| return with gift | gift line has its own discount allocation; returnable per line |
| VAT split | per component (weighted price allocation) |
| gift source | discount (BXGY), buyer adds item manually |
| gift stock | normal; sold out when 0 |
| gift on documents | full-price line + discount allocation |
| gift limits | uses per order, combination rules |

---

## 4. Order-shape cheat-sheet

| Platform | Bundle in order | Link parent-child | Price/VAT carrier | Gift in order | Gift marker |
|---|---|---|---|---|---|
| PrestaShop 1.7/8/9 | 1 row (pack only) | none (composition only in catalogue, current) | pack row, pack's tax rate | full-price row, maybe MERGED with paid units; `order_cart_rule` discount | none on row; only `id_cart_rule` -> `cart_rules.gift_product` (live, deletable) |
| Woo + Product Bundles | parent + children | `bundled_by` / `bundled_items` = order item ids | static: parent (1 rate), children 0; individually: children | - | - |
| Woo + WPC Bundles | parent + children | `_woosb_parent_id` = bundle PRODUCT id (ambiguous) | fixed: parent; auto: children (parent tax none) | - | - |
| Woo + iThemeland gifts | - | - | - | separate 0-line | `_free_gift=yes`, rule id |
| Woo + WPC Free Gift Coupons | - | - | - | separate 0-line | none (only coupon_lines) |
| Shopify bundles | components only | `lineItemGroup{id,productId,variantId,variantSku,quantity}` | components, weighted allocation, per-component tax | - | - |
| Shopify BXGY | - | - | - | full-price line + `discountAllocations` | discount application reference only |

## 5. Adapter can / cannot derive

**Can:**
- PS: that a row is a pack (`product.type`/`cache_is_pack`) and its CURRENT components with qty and combination (`product_bundle`); the pack stock mode (`pack_stock_type`, resolve 3 via shop config; resolve 0 version-dependently).
- PS: which cart rules hit the order (`order_cart_rules` filter by `id_order`) and, while the rule still exists, its `gift_product`/`gift_product_attribute`.
- Woo PB: exact parent/child tree from REST `bundled_by`/`bundled_items`; whether a child is priced individually and needs shipping (meta).
- Woo iThemeland: gift lines by `_free_gift`.
- Shopify: component lines grouped by `lineItemGroup.id`, bundle SKU/variant from the group; gift value from `discountAllocations`.

**Cannot (from the order alone):**
- PS: the pack composition AS SOLD (only current); per-component price or VAT; which unit of a merged row is the gift; the gift's share of a combined cart rule; per-line tax as an attribute of `order_rows` (hidden).
- Woo WPC: which parent a child belongs to when the same bundle appears twice.
- Woo static-price bundles: a value per component (children are 0).
- Woo WPC Free Gift Coupons: that a 0-line is a gift (no marker) - only a heuristic (price 0 + coupon present).
- Shopify: the bundle's own price (group has no money field; sum of components after allocation).

## 6. Use cases

| ID | Platform | Who | Scenario | What arrives (fields) | Pain | Source + quote |
|---|---|---|---|---|---|---|
| SHOP-01 | PrestaShop | warehouse | Pack sold, packer needs contents | 1 `order_rows` row: pack `product_id`, name, qty | no components in order; slip prints pack only | `OrderDetail.php:749-776`; grep: no `pack` in order/slip classes |
| SHOP-02 | PrestaShop | merchant | Pack composition changed after order | same single row | BO and any re-read show NEW composition | `GetOrderProductsForViewingHandler.php:155` `Pack::getItemTable(...)` |
| SHOP-03 | PrestaShop | accountant | Pack of 5% + 23% items | one row, one `id_tax_rules_group` (pack's) | no VAT split | `OrderDetail.php:590` `getIdTaxRulesGroupByIdProduct((int) $product['id_product']` |
| SHOP-04 | PrestaShop | merchant/OMS | Stock mode 1 ("products only") | pack `stock_available` row | pack row never written, stale number | `StockManager.php:84-93` writes pack row only for modes 0/2 |
| SHOP-05 | PrestaShop 1.7/8 vs 9.2 | OMS | Pack set to mode 0 | `pack_stock_type=0` | read as shop default in <=9.1, as pack-only in 9.2 | `Pack.php:311` `empty($packStockType)`; 9.2 `:293` "Avoid using empty()" |
| SHOP-06 | PrestaShop | buyer/warehouse | Buyer returns one item of a pack | return per `order_detail` | cannot return a component; restock returns all components | `AbstractOrderCommandHandler.php:92-107` `$product_pack->pack_quantity * $quantityToReinject` |
| SHOP-07 | PrestaShop | OMS | Cart-rule free gift, buyer also bought same product | one row qty n+1 at full price; `order_cart_rule.value` | gift unit indistinguishable; split exists only for display | `Cart.php:1348-1352` `updateQty(1, $cartRule->gift_product`; `:5234` `getProductsWithSeparatedGifts` |
| SHOP-08 | PrestaShop | accountant | Rule = gift + 10% off | one `order_cart_rule` with lumped `value` | gift value not separable | `CartRule.php:86-88`, `:1494-1505` |
| SHOP-09 | PrestaShop | accountant | 23% gift with 5% product | discount spread pro rata in tax table | gift's free value hits both rates | `OrderDetail.php:413-416` `$order_reduction_amount = (... ) * $ratio` |
| SHOP-10 | PrestaShop | OMS | Cart rule deleted later | `id_cart_rule` on `order_cart_rule` | `cart_rules/{id}` gone; gift identity lost | `CartRule.php:227-247` hard delete |
| SHOP-11 | Woo + Product Bundles | accountant | Static-price kit, items in two VAT rates | parent line priced; children `subtotal 0` | single rate; per-component value 0 | docs: "a static bundle price limits you to a single tax rate"; `class-wc-pb-cart.php:906-912` |
| SHOP-12 | Woo + Product Bundles | warehouse | Assembled kit | parent + children, `bundled_by`/`bundled_items`, `_bundled_item_needs_shipping` | must not ship children separately | REST api `:1236-1316`; docs: "Shipped Individually does not mean "split across different shipments"" |
| SHOP-13 | Woo + Product Bundles | merchant | Bundle with own stock + component stock | both reduced | double bookkeeping; "does not allow you to reserve part of a product's stock" | bundles-configuration (vendor docs) |
| SHOP-14 | Woo + WPC Bundles | OMS | Same bundle twice in one order, different picks | children with `_woosb_parent_id` = product id | cannot pair children to parent line | `class-woosb.php:723` `'woosb_parent_id' => $product_id,` |
| SHOP-15 | Woo + WPC Free Gift Coupons | OMS/accountant | Coupon gift | 0-value line, coupon in `coupon_lines` | no gift marker on line | `class-frontend.php:233` `$item->set_subtotal( 0 );` |
| SHOP-16 | Woo + iThemeland | OMS | Rule gift | 0-value line, `_free_gift=yes`, `_rule_id_free_gift` | VAT/doc value of gift is 0 | `cart_hook.php:145-148` |
| SHOP-17 | Shopify | OMS | Fixed bundle sold | component lines + `lineItemGroup` (no price) | bundle price only as sum; returns per component | shopify.dev: "Components, with reference to parent through groupings"; LineItemGroup fields |
| SHOP-18 | Shopify | buyer | BXGY free item | full-price line + `discountAllocations` | buyer must add it; never auto-added | Help: "The free or discounted 'get' item is never automatically added to the cart." |

## 7. Surprises

1. PrestaShop never stores pack contents on the order; the admin order screen reconstructs them from the catalogue at view time, so history rewrites itself when a pack is edited (`GetOrderProductsForViewingHandler.php:155`).
2. PrestaShop free gifts are not separate rows: the gift merges into an existing paid row; the "separated gifts" view is display-only (`Cart.php:5234-5241` vs `:2571`). The giveaway lives only as an order-level discount whose tax is spread over all lines (`OrderDetail.php:413-416`).
3. `pack_stock_type = 0` meant two different things in 1.7/8.x (read vs decrement), fixed only in 9.2.x on 2026-07-25 - OpenLinker's own comment claims the old behaviour is current.
4. WPC Product Bundles (30k installs) links children to a bundle PRODUCT id, not a line - ambiguous with repeated bundles (`class-woosb.php:723`).
5. Shopify is the cleanest model (components carry price + tax + returns), but the group itself has no money and Shopify never auto-adds a BXGY gift.

## 8. Open / unverified

- PrestaShop 1.7 legacy BO: pack with combinations allowed? (unverified)
- PS invoice template rendering of gift cart rule (unverified).
- Woo REST: `_`-prefixed meta returned on line items - inferred from `get_all_formatted_meta_data( null )`, not live-tested.
- Woo Product Bundles current version vs 6.17.3 mirror (2022) - meta keys may have changed.
- Official Free Gift Coupons order meta (paid plugin, no source) - Unknown.
- Shopify BXGY on same product merging into one line - Unknown.
