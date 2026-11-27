# R4 / Phase 1 / 2 - Own shops: how a bundle and a gift look in the order payload

Round 4, primary sources only. Date: 2026-11-04.
Scope: PrestaShop core, WooCommerce core, WPC Product Bundles (WordPress.org SVN), GIFTiT Free Gifts (WordPress.org SVN), WooCommerce Product Bundles (official REST docs, plugin source is not public), Shopify Admin GraphQL docs + Shopify developer docs + Shopify help center.

## Sources (all primary)

| Id | Source | Version pinned | Kind |
|---|---|---|---|
| PS | github.com/PrestaShop/PrestaShop | tag `9.0.3` = commit `fc96d0d4eae383e8c6f1f54f19cf592c221a62e3` | source code |
| WC | github.com/woocommerce/woocommerce `plugins/woocommerce/` | tag `10.9.4` | source code |
| WOOSB | plugins.svn.wordpress.org/woo-product-bundle (WPC Product Bundles) | tag `8.7.8` | source code |
| GIFTIT | plugins.svn.wordpress.org/ithemeland-free-gifts-for-woo (GIFTiT - Free Gifts for WooCommerce) | tag `4.6` | source code |
| WCPB | https://woocommerce.com/document/bundles/bundles-rest-api-reference/ | page as fetched 2026-11-04 | official vendor doc (plugin is closed source) |
| SHOP-API | https://shopify.dev/docs/api/admin-graphql/latest/objects/{LineItemGroup,LineItem,DiscountAllocation} | API 2026-10 | official API reference |
| SHOP-DEV | https://shopify.dev/docs/apps/build/product-merchandising/bundles and /start-building | as fetched | official developer docs |
| SHOP-HELP | https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y | as fetched | official help center |

Paths below are relative to the repo root at the pinned tag.

---

## 1. PrestaShop 9.0.3

### 1.1 Pack (native bundle)

**Order payload: one `order_detail` row for the pack itself. Components are not in the order.**

- `classes/order/OrderDetail.php:759` - `$this->product_id = (int) $product['id_product'];` and `:766` - `$this->product_quantity = (int) $product['cart_quantity'];` - one row per cart product row; a pack is one cart product row, so one order row with `product_id` = the pack's own id.
- `classes/order/OrderDetail.php:819-833` (`createList`) - `foreach ($product_list as $product) { $this->create($order, $cart, $product, ...); }` - no expansion of pack items anywhere in order-detail creation (grep for `Pack::` / `isPack` in `OrderDetail.php` and `PaymentModule.php` returns nothing).
- Webservice `orders` association `order_rows` (`classes/order/Order.php:274-290`) exposes only: `id, product_id, product_attribute_id, product_quantity, product_name, product_reference, product_ean13, product_isbn, product_upc, product_price, id_customization, unit_price_tax_incl, unit_price_tax_excl`. No pack flag, no component list.
- Price on the row: `OrderDetail.php:678-681` - `$this->unit_price_tax_incl = (float) $product['price_wt']; $this->product_price = $this->unit_price_tax_excl = (float) $product['price'];` i.e. the pack's own price.

**Where the composition lives: the product, read live.**
- `classes/Product.php:677-685` - association `'product_bundle' => ['resource' => 'product', 'api' => 'products', 'fields' => ['id' => ['required' => true], 'id_product_attribute' => [], 'quantity' => []]]`.
- `classes/Product.php:7783-7785` - `getWsProductBundle()` = `SELECT id_product_item as id, id_product_attribute_item as id_product_attribute, quantity FROM pack WHERE id_product_pack = ...`.
- `classes/Product.php:7747-7754` - `getWsType()` returns `'simple' | 'pack' | 'virtual'` (field `type` on `/api/products/{id}`).
- Consequence: an adapter can resolve components only by reading `/api/products/{product_id}` at ingestion time. The composition is the CURRENT catalogue composition, not a snapshot frozen with the order (no order-side table carries it). If the merchant edits the pack later, a re-read yields a different composition. (Inference from the code paths above; no primary source states it in words.)

**Stock semantics (`pack_stock_type`).**
- `src/Core/Domain/Product/Pack/ValueObject/PackStockType.php:41-56` - `STOCK_TYPE_PACK_ONLY = 0; STOCK_TYPE_PRODUCTS_ONLY = 1; STOCK_TYPE_BOTH = 2; STOCK_TYPE_DEFAULT = 3;`
- `classes/Pack.php:307-309` - "STOCK_TYPE_PACK_ONLY - pack 1pcs + product A 10pcs + product B 20pcs = 1pcs / STOCK_TYPE_PRODUCTS_ONLY - ... = 10 pcs / STOCK_TYPE_PACK_BOTH - ... = 1 pcs".
- `classes/Pack.php:313-314` - `if (empty($packStockType) || $packStockType == self::STOCK_TYPE_DEFAULT) { $packStockType = Configuration::get('PS_PACK_STOCK_TYPE'); }` - value 3 means "ask the shop-wide config".
- Decrement at order time: `src/Core/Stock/StockManager.php:65-81` - for PRODUCTS_ONLY / BOTH (or DEFAULT with config > 0): `$productStockAvailable->quantity = $productStockAvailable->quantity + ($delta_quantity * $product_pack->pack_quantity);` per component; `:86-95` the pack's own `stock_available` is only updated for PACK_ONLY / BOTH.
- `pack_stock_type` is on the product resource: `classes/Product.php:524` - `'pack_stock_type' => ['type' => self::TYPE_INT, 'shop' => true, ...]` (shop-scoped, so it can differ per shop in multistore).

### 1.2 Gift product (cart rule "Send a free gift")

**Mechanism: the gift is a real cart line at full price, and the discount sits on the order, not on the line.**
- Adding the rule adds a unit to the cart: `classes/Cart.php:1370-1383` - `if ((int) $cartRule->gift_product) { $this->updateQty(1, $cartRule->gift_product, $cartRule->gift_product_attribute, false, 'up', ...); }`.
- The order is built from the UNSPLIT product list: `classes/Cart.php:2475` (`getPackageList`) - `$product_list = $this->getProducts($flush);` (default `$shouldSplitGiftProductsQuantity = false`, `Cart.php:642`), passed on as `$package['product_list']` in `classes/PaymentModule.php:354` and into `OrderDetail::createList` at `PaymentModule.php:1117`.
- Splitting gifts out is display-only: `Cart.php:632` - "@param bool $shouldSplitGiftProductsQuantity When true, gifts will be displayed separately."
- Discount value of the gift: `classes/CartRule.php:1555-1566` - "// Free gift ... $reduction_value += Tools::ps_round($use_tax ? $product['price_wt'] : $product['price'], ...)" - the rule's value equals the gift's unit price.
- Persisted on the order: `classes/PaymentModule.php:1260` - `$order->addCartRule($cartRule->id, $cartRule->name, $values, 0, $cartRule->free_shipping);` -> `classes/order/Order.php:1207-1222` writes `order_cart_rule` with `id_order, id_cart_rule, name, value (tax incl), value_tax_excl, free_shipping`.
- `classes/order/OrderCartRule.php` definition fields: `id_order, id_cart_rule, id_order_invoice, name, value, value_tax_excl, free_shipping, deleted` - no product id, no line id. Exposed as webservice resource `order_cart_rules` (`classes/webservice/WebserviceRequest.php:300` - `'order_cart_rules' => ['description' => 'The Order cart rules', 'class' => 'OrderCartRule']`).
- To learn WHICH product was the gift you must read `cart_rules/{id_cart_rule}` -> `gift_product`, `gift_product_attribute` (`classes/CartRule.php:145-146`).
- PrestaShop itself recovers gift units after the fact by exactly that join: `classes/Cart.php:4347` - `SELECT cr.gift_product, cr.gift_product_attribute FROM cart_rule cr LEFT JOIN order_cart_rule ocr ... WHERE ocr.deleted = 0 ...` and `:4408` - `$product['quantity'] = (int) $product['quantity'] - 1;` (in `Cart::duplicate`, i.e. "order again").

**Same-product gift merges into the paid line.** Because the cart holds one `cart_product` row per product/attribute/customization and the gift is added with `updateQty(1, ...)` on that same key, a gift that is the same product as a paid line produces ONE `order_detail` row with `product_quantity` = paid + 1 at the full unit price (`OrderDetail.php:766`, `:678`). The split logic at `Cart.php:857-873` only runs in display mode. Confirmed by PS's own reorder code subtracting 1 from the merged row (`Cart.php:4408`).

**Rule mixing gift + reduction.** A single cart rule can carry `gift_product` together with `reduction_percent` / `reduction_amount` (all are fields of `CartRule::$definition`, `CartRule.php:136-146`), and the gift value is added to the same `$reduction_value` accumulator (`CartRule.php:1565`). `order_cart_rule.value` is therefore the SUM; the gift part is not separable from the order payload.

**Naming trap: `gift` on Order means gift wrapping.** `classes/PaymentModule.php:1020-1021` - `$order->gift = (bool) $cart->gift; $order->gift_message = $cart->gift_message;` and `Cart.php:69` - "/** @var bool True if the customer wants a gift wrapping */". Unrelated to free products.

---

## 2. WooCommerce core 10.9.4

### 2.1 Line item money fields
- `includes/class-wc-order-item-product.php:45-56` - `extra_data`: `product_id, variation_id, quantity, tax_class, subtotal, subtotal_tax, total, total_tax, taxes {subtotal, total}`. No coupon reference, no parent reference, no gift flag in core.
- REST schema `includes/rest-api/Controllers/Version2/class-wc-rest-orders-v2-controller.php:1532-1550`: `subtotal` "Line subtotal, excluding tax (before discounts)."; `subtotal_tax` "Line subtotal tax (before discounts)."; `total` "Line total, excluding tax (after discounts)."; `total_tax` "Line total tax (after discounts)."
- `price` is DERIVED, after discount: same file `:233` - `$data['price'] = $item->get_quantity() ? $item->get_total() / $item->get_quantity() : 0;`.
- `class-wc-order-item-product.php:144-146` - "// Subtotal cannot be less than total. if ( '' === $this->get_subtotal() || $this->get_subtotal() < $this->get_total() ) { $this->set_subtotal( $value ); }" - a 0-priced line ends up with subtotal = total = 0; the regular price is not kept.
- Checkout copies cart amounts verbatim: `includes/class-wc-checkout.php:541-549` - `'subtotal' => $values['line_subtotal'], 'total' => $values['line_total'], ...` - whatever a plugin did via `set_price()` in the cart becomes the line price.
- Coupons appear as `coupon_lines` (`code`, `discount`, `discount_tax`, plus since REST v2 enrichment `discount_type`, `nominal_amount`, `free_shipping`: `:291-296`). A 100% product coupon yields a line with `subtotal` = regular, `total` = 0 - the only "free item" shape core can produce, and the line does not say which coupon zeroed it.
- Line `meta_data` includes underscore-prefixed keys: `includes/abstracts/abstract-wc-data.php:330-331` - `get_data()` merges `'meta_data' => $this->get_meta_data()`, and `:371-373` `get_meta_data()` returns all non-null meta. The leading underscore only hides meta from templates (core itself stores `_reduced_stock` this way, `includes/wc-stock-functions.php:209`).

### 2.2 Grouped product (core "bundle-like" type)
- `includes/class-wc-form-handler.php:931-957` (`add_to_cart_handler_grouped`) - `foreach ( $items as $item => $quantity ) { ... WC()->cart->add_to_cart( $item, $quantity ) ... }` - each child is added as an independent cart item. The order has no parent line and no link between children. A grouped product is invisible in the order payload.

---

## 3. WPC Product Bundles (`woo-product-bundle` 8.7.8, ~WordPress.org)

**Shape: one parent line + one line per component, linked by meta. Pricing lives on the parent OR on the children depending on a per-bundle setting.**

- Child cart data `includes/class-woosb.php:720-738`: `'woosb_qty' => $_qty, 'woosb_parent_id' => $product_id, 'woosb_parent_key' => $cart_item_key, ... 'woosb_bundle' => ['version' => '2.0', 'role' => 'child', 'bundle_id' => $bundle_id, 'parent_id' => $product_id, 'qty_per_bundle' => $_qty, 'pricing_mode' => $fixed_price ? 'fixed' : 'auto', 'discount_amount' => ..., 'discount_percent' => ...]`.
- Persisted to order line meta `class-woosb.php:1242-1260`: children get `_woosb_parent_id` (product id of the bundle, NOT the parent order item id) and `_woosb_bundle`; parent gets `_woosb_ids` (component id/qty string) and `_woosb_price`. Comment: "// use _ to hide the data".
- Fixed price mode `class-woosb.php:944-948`: "// Fixed Price: child items are free (price 0), parent maintains bundle price ... ->set_price( 0 )".
- Auto price mode `class-woosb.php:958-966`: parent price default 0, and "if ( apply_filters( 'woosb_ignore_tax_for_bundles', $parent_price > 0 ? false : true, ...) ) { $parent_item['data']->set_tax_status( 'none' ); }" -> parent line is 0 with no tax; children carry discounted prices (`:1020-1032`, bundle discount allocated proportionally by "Largest Remainder Method", `:1001-1007`).
- `hide_bundled_order` is display only: `class-woosb.php:1169-1176` filters item visibility in templates; the child lines still exist in the order and in REST.
- Child-to-parent link uses product id + cart key, not order item id. Two identical bundles in one order are distinguishable only by order of lines (cart key is not persisted on order items - only `_woosb_parent_id` and `_woosb_bundle.bundle_id` are). Whether `bundle_id` is unique per instance: Unknown (not traced).

## 4. WooCommerce Product Bundles (official, woocommerce.com) - doc only

Source: WCPB REST reference (official vendor doc; plugin source not public, so rated from docs).
- Line item `bundled_by`: "Item ID of parent line item, applicable if the item is part of a bundle."
- Line item `bundled_items`: "Item IDs of bundled line items, applicable if the item is a bundle container item."
- `bundled_item_title`: "Title of the bundled product to display in order/e-mail templates instead of the original product title."
- Bundled item `priced_individually`: "Indicates whether the price of this bundled item is added to the base price of the bundle." -> child lines are 0-priced unless priced individually.
- `order_visibility` (`visible|hidden`) controls templates only (per doc). Rating: Partial (no source to verify).

## 5. GIFTiT - Free Gifts for WooCommerce (`ithemeland-free-gifts-for-woo` 4.6)

- Gift is an ordinary cart item with extra data: `frontend/classes/front-order.php:694-704` - `'it_free_gift' => array( 'method' => ..., 'type' => 'manual', 'rule_id' => $uid, 'rule_gift_key' => $gift, 'product_id' => $id_product, 'price' => $_price_for_gift, 'base_price' => $itfreegift_pr_price, ...)`.
- The "free" price is configurable and NOT necessarily 0: `front-order.php:686-690` - `$_price_for_gift = get_post_meta($id_product, '_price_for_gift', true); ... if ($_price_for_gift == '') { $_price_for_gift = 0; }`; applied in `frontend/classes/cart_hook.php:190-204` via `$value['data']->set_price($price);`.
- Order line meta `cart_hook.php:145-148`: `_free_gift = 'yes'`, `_free_gift_method`, `_free_gift_type` (`auto`/`manual`), `_rule_id_free_gift`. `base_price` (the regular price) is NOT written to the order.
- Order-level meta `cart_hook.php:133`: `$order->add_meta_data('gift_set', 'yes');`.
- Gift is always its own line (separate cart item key because cart item data differs), so it never merges with a paid line of the same product (inference from WC cart keying by cart item data; not traced in code here).

## 6. Shopify (Admin GraphQL 2026-10 + developer docs)

### 6.1 Bundles
- SHOP-API LineItemGroup: "The information for line items that are part of a bundle." "When a bundle is purchased, each component line item references its LineItemGroup through the lineItemGroup field". Fields: `id`, `title`, `quantity` ("Quantity of the line item group on the order."), `productId`, `variantId`, `variantSku`, `customAttributes`.
- SHOP-DEV /bundles: "Order lines return bundle components, with a reference to the bundle parent."
- SHOP-DEV /start-building: "The bundle price is allocated across components in the checkout, cart, and orders using a weighted price algorithm."; returns/refunds "Operates at the component level."; discounts "Discount calculated on the parent then allocated on the components."; fixed bundles inventory "The parent inventory quantity is the minimum of the component's inventory quantities."
- So: no parent line exists; components are real lines whose prices are already allocated; parent identity is only in `lineItemGroup`.

### 6.2 Gifts (Buy X Get Y)
- SHOP-HELP: "Customers must add all items to their cart manually." "The free or discounted 'get' item is never automatically added to the cart."
- SHOP-API discountAutomaticBxgyCreate example: `"discountOnQuantity": { "quantity": "1", "effect": { "percentage": 1 } }` (percentage 1 = free is implied by example titles, not stated).
- SHOP-API LineItem: `originalUnitPriceSet` "the unit price of the line item when the order was created", `discountAllocations` "The discounts that have been allocated to the line item by discount applications", `discountedTotalSet`, `totalDiscountSet`.
- SHOP-API DiscountAllocation: `allocatedAmountSet` "The money amount that's allocated to a line based on the associated discount application", `discountApplication` "The discount application that the allocated amount originated from."
- So: the free Y item is a normal line at full original price with a discount allocation equal to its value; the line itself has no gift flag; you identify it by the allocation's discountApplication (BXGY). Same-product BXGY ("free duplicate") - whether it is one line qty 2 with a partial allocation or two lines: Unknown (no primary source found).

---

## 7. Use cases

| Id | Platform | Scenario | Exact payload | Source + quote |
|---|---|---|---|---|
| SHOP-01 | PrestaShop | Native pack sold | 1 `order_rows` row: `product_id`=pack id, `product_quantity`=N, `unit_price_tax_incl/excl`=pack price; no components | `Order.php:274-290` (order_rows fields), `OrderDetail.php:759` `$this->product_id = (int) $product['id_product'];` |
| SHOP-02 | PrestaShop | Resolve pack components | `GET /api/products/{id}`: `type`=`pack`, `associations.product_bundle[{id,id_product_attribute,quantity}]` - live catalogue, not order snapshot | `Product.php:7785` `SELECT id_product_item as id, id_product_attribute_item as id_product_attribute, quantity FROM pack` |
| SHOP-03 | PrestaShop | Pack stock policy | `pack_stock_type` 0 pack-only / 1 products-only / 2 both / 3 = use `PS_PACK_STOCK_TYPE` | `PackStockType.php:41-56`; `Pack.php:307` "STOCK_TYPE_PACK_ONLY - pack 1pcs + product A 10pcs + product B 20pcs = 1pcs" |
| SHOP-04 | PrestaShop | Gift = other product | extra `order_detail` row qty 1 at FULL price; `order_cart_rule{name,value,value_tax_excl}` = gift price; no product link | `Cart.php:1372` `$this->updateQty(1, $cartRule->gift_product, ...)`; `CartRule.php:1565` `$reduction_value += ... $product['price_wt'] ...` |
| SHOP-05 | PrestaShop | Gift = same product as paid | ONE row, `product_quantity`=paid+1, full unit price | `Cart.php:2475` `$product_list = $this->getProducts($flush);`; `Cart.php:4408` `$product['quantity'] = (int) $product['quantity'] - 1;` |
| SHOP-06 | PrestaShop | Identify gift product | need `cart_rules/{id_cart_rule}.gift_product/gift_product_attribute` | `CartRule.php:145` `'gift_product' => ['type' => self::TYPE_INT, ...]` |
| SHOP-07 | PrestaShop | Rule = gift + % off | `order_cart_rule.value` = sum, gift part not separable | `CartRule.php:1565` (same accumulator) |
| SHOP-08 | PrestaShop | `order.gift=1` | gift WRAPPING, not free product | `Cart.php:69` "True if the customer wants a gift wrapping" |
| SHOP-09 | WooCommerce core | Grouped product | children as independent lines, no parent, no link | `class-wc-form-handler.php:952` `WC()->cart->add_to_cart( $item, $quantity )` in a loop |
| SHOP-10 | WooCommerce core | 100% product coupon "gift" | line `subtotal`=regular, `total`=0, `price`=0; `coupon_lines[{code,discount}]`; no line-to-coupon link | v2 controller `:1532` "Line subtotal, excluding tax (before discounts)."; `:233` `price = total / quantity` |
| SHOP-11 | WPC Bundles | Auto-priced bundle | parent line 0, tax_status none, meta `_woosb_ids`,`_woosb_price`; child lines discounted, meta `_woosb_parent_id`,`_woosb_bundle{role:child,bundle_id,parent_id,qty_per_bundle,pricing_mode:auto,...}` | `class-woosb.php:965` "// Bundle parent price is set to 0"; `:1245` `update_meta_data( '_woosb_parent_id', ... )` |
| SHOP-12 | WPC Bundles | Fixed-price bundle | parent line = bundle price; children price 0 | `class-woosb.php:944` "// Fixed Price: child items are free (price 0), parent maintains bundle price" |
| SHOP-13 | WC Product Bundles (official) | Bundle in order | container line `bundled_items:[item ids]`; children `bundled_by:<parent item id>`; children 0 unless `priced_individually` | WCPB doc: "Item ID of parent line item, applicable if the item is part of a bundle." |
| SHOP-14 | GIFTiT | Free gift | own line, price = `_price_for_gift` (default 0, can be >0); meta `_free_gift=yes`, `_free_gift_method`, `_free_gift_type`, `_rule_id_free_gift`; regular price NOT stored; order meta `gift_set=yes` | `cart_hook.php:145` `$item->add_meta_data('_free_gift', 'yes');`; `front-order.php:687` `get_post_meta($id_product, '_price_for_gift', true)` |
| SHOP-15 | Shopify | Bundle | only component lines, each `lineItemGroup{id,title,quantity,productId,variantId,variantSku}`, price pre-allocated by weight | LineItemGroup: "each component line item references its LineItemGroup through the lineItemGroup field"; start-building: "weighted price algorithm" |
| SHOP-16 | Shopify | BXGY free item | normal line, `originalUnitPriceSet`=full, `discountAllocations[{allocatedAmountSet, discountApplication}]` = full value; customer added it manually | help: "The free or discounted 'get' item is never automatically added to the cart." |

## 8. Cheat-sheet

| | Bundle shape | Bundle price location | Component link | Gift shape | Gift marker | Gift regular price available |
|---|---|---|---|---|---|---|
| PrestaShop pack | 1 line (pack) | pack line | none in order; product `product_bundle` (live) | n/a | n/a | n/a |
| PrestaShop gift rule | n/a | n/a | n/a | line at full price (may be merged with paid line) + order-level `order_cart_rule` | only via `cart_rules.gift_product` join | yes (line price) |
| WC core grouped | N lines, no parent | children | none | n/a | n/a | n/a |
| WC core 100% coupon | n/a | n/a | n/a | line subtotal>0, total=0 | none on line | yes (`subtotal`) |
| WPC Bundles | parent + children | parent (fixed) OR children (auto) | `_woosb_parent_id` = product id, `_woosb_bundle` | n/a | n/a | n/a |
| WC Product Bundles | container + children | container unless priced individually | `bundled_by` = order item id | n/a | n/a | n/a |
| GIFTiT | n/a | n/a | n/a | own line at `_price_for_gift` | `_free_gift=yes` + rule id | NO |
| Shopify bundle | components only | components (weighted) | `lineItemGroup` | n/a | n/a | n/a |
| Shopify BXGY | n/a | n/a | n/a | line full price + discountAllocation | discountApplication (BXGY) | yes (`originalUnitPriceSet`) |

## 9. Adapter can / cannot derive

Can:
- PrestaShop: that a line is a pack (`/products/{id}.type == 'pack'`), its current components and per-pack quantities, and the stock policy (`pack_stock_type`, falling back to `PS_PACK_STOCK_TYPE` via `configurations`).
- PrestaShop: the gift product id and that a gift rule was used (`order_cart_rules` -> `cart_rules.gift_product`), and the gift value (`order_cart_rule.value` when the rule is gift-only).
- WooCommerce + WPC/official bundles: parent/child grouping and per-child quantity; which side carries the money.
- WooCommerce + GIFTiT: gift flag and rule id per line.
- Shopify: bundle grouping (`lineItemGroup`), per-component allocated prices, gift value via `discountAllocations`.

Cannot:
- PrestaShop: the pack composition AS ORDERED (only the current one); which unit of a merged line is the gift (only "one unit of this product id"); the gift value when the rule also gives a % or amount reduction; a per-line discount attribution of any cart rule.
- WooCommerce core: anything about a grouped product; which coupon zeroed a line.
- WPC Bundles: a stable per-instance parent id when two identical bundles are in one order (Unknown, see section 3).
- GIFTiT: the gift's regular price (not persisted).
- Shopify: the bundle's own price as a line (only the sum of components); whether a same-product BXGY splits the line (Unknown).

## 10. Surprises

1. PrestaShop puts the gift on the order at FULL price and gives the money back at order level; a same-product gift silently becomes `qty+1` on the paid row. A line-level "is gift" field does not exist in PrestaShop at all.
2. PrestaShop order `gift` / `gift_message` / wrapping is gift WRAPPING - a name collision a mapper can easily misread as "free gift".
3. One WooCommerce plugin (WPC) produces two opposite money shapes depending on a per-bundle setting: price on the parent (children 0) or price on the children (parent 0, untaxed).
4. WPC links children to the parent by PRODUCT id, while the official WooCommerce Product Bundles links by ORDER ITEM id - two plugins on one platform, two incompatible link models.
5. A "free" gift in GIFTiT can cost money (`_price_for_gift`), and its regular price is dropped from the order, so the gift value is not recoverable from the order.
6. Shopify writes NO parent line for a bundle; and Shopify never auto-adds a BXGY gift - the customer must put it in the cart.
7. PrestaShop pack composition is not frozen with the order; it must be fetched from the catalogue and may have changed.
