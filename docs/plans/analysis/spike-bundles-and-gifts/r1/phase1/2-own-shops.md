# Research: How bundles ("zestawy") and free gifts ("gratisy") exist on own-shop platforms (PrestaShop, WooCommerce, Shopify)

Phase 1 (problem) of the zestawy/gratisy spike. Scope: self-hosted / store platforms feeding OpenLinker as an order source
or product master. Date: 2026-11-04.

Legend: (verified-code) = read in the platform's own source code; (verified-doc) = official docs; (vendor) = plugin vendor
or third-party claim; (unverified) = my inference / not confirmed by a source.

## Sources consulted

PrestaShop (source code, `develop` branch, fetched 2026-11-04):
- https://github.com/PrestaShop/PrestaShop/blob/develop/classes/Pack.php - pack stock types and pack availability calculation
- https://github.com/PrestaShop/PrestaShop/blob/develop/classes/Cart.php - gift product handling (`is_gift`, `addCartRule`, `getProducts(... $shouldSplitGiftProductsQuantity = false)`, `getPackageList`)
- https://github.com/PrestaShop/PrestaShop/blob/develop/classes/PaymentModule.php - order creation, cart-rule persistence (`gift_product` kept even with 0 tax_excl value)
- https://github.com/PrestaShop/PrestaShop/blob/develop/classes/order/Order.php - webservice `order_rows` association fields, `total_discounts`, `gift` (= gift wrapping)
- https://github.com/PrestaShop/PrestaShop/blob/develop/classes/order/OrderCartRule.php - `order_cart_rule` fields
- https://github.com/PrestaShop/PrestaShop/blob/develop/classes/order/OrderDetail.php - no pack-specific handling (pack = one row)
- https://github.com/PrestaShop/PrestaShop/blob/develop/classes/Product.php - webservice `type` (simple/pack/virtual), `pack_stock_type`, `associations/product_bundle`
- https://build.prestashop-project.org/prestashop-specs/1.7/front-office/discounts/cart-rules-free-gift.html - official spec: free gift = exactly one unit
- https://www.prestashop.com/forums/topic/389195-crazy-problem-with-a-gift-and-shipping-calculation - gift still counted as paid product for shipping
- https://www.prestashop.com/forums/topic/1027721-stock-management-issue-with-pack-products - pack components not decremented / not restored on cancel
- https://prestashop.com/forums/topic/1063532-product-pack-issue-with-stock-decrement-only-the-products-of-the-pack - pack stock not recomputed until product saved
- https://forum.thirtybees.com/topic/1693-1693/packs-and-stock-management/ - pack shows 0 stock while components in stock (fork of PS 1.6)
- https://devdocs.prestashop-project.org/8/development/page-reference/back-office/order/view-order/refunds/ - refund actions, `actionProductCancel`
- https://www.odoo-community.org/shop/prestashoperpconnect-simple-bundle-3907 - ERP connector must fetch pack composition separately
- https://webkul.com/blog/prestashop-free-gift-products-user-guide/ , https://knowband.com/prestashop-gift-the-product - third-party gift modules (vendor)
- https://amavat.pl/zestawy-i-pakiety-produktow-z-roznymi-stawkami-vat-jak-je-prawidlowo-fakturowac/ - PL VAT treatment of mixed-rate sets (vendor/advisory blog)

WooCommerce:
- https://woocommerce.com/document/bundles/bundles-rest-api-reference/ - `bundled_by`, `bundled_items`, `bundled_item_title`, `bundle_configuration`, `priced_individually`, `shipped_individually`
- https://woocommerce.com/document/bundles/bundles-configuration/ - assembled/unassembled, child stock reduction, bundle-level stock, price visibility, item grouping
- https://woocommerce.com/feature-request/product-bundles-as-separate-line-items-in-shipping-software/ - container line confuses shipping tools
- https://picqer.com/en/support/articles/woocommerce-bundle - an OMS/WMS: "components of a bundle automatically have a price of 0 euros in the store order"
- https://woocommerce.com/document/composite-products-rest-api-reference/ - `composite_parent`, `composite_children`, `composite_configuration`
- https://raw.githubusercontent.com/wix/skills/main/wix-replatform/resources/rp-source-wordpress/plugins/woo-product-bundle.json - WPC Product Bundles (woosb) data model (third-party notes)
- https://wpc.ticksy.com/ticket/3616581 , https://wpc.ticksy.com/ticket/3238679 - WPC support: `woosb_ids` format changed in v8, no API docs
- https://docs.algolplus.com/phone-orders/developers/codes-for-plugins/wpc-product-bundles-for-woocommerce/ - woosb cart keys
- https://woocommerce.com/document/cart-free-gift/ - gift line priced 0, qty 1, `_cfg_free_gift = yes` meta
- https://woocommerce.com/products/free-gifts-for-woocommerce/ - automatic/manual gifts, BOGO, limits, "$0.01 instead of 0" advice
- https://woocommerce.com/products/buy-one-get-one-free/ - BOGO with discount in item subtotal
- https://wordpress.org/support/topic/bogo-subtotal-issue/ - free item shown as struck price / 0.00
- https://community.shopify.com/t/problem-with-bundles-integrating-with-shipstation/215800 - (Shopify, but same $0 component problem in shipping tools)

Shopify:
- https://shopify.dev/docs/apps/build/product-merchandising/bundles - "Order lines return bundle components, with a reference to the bundle parent"; bundles cannot use selling plans
- https://shopify.dev/docs/apps/build/product-merchandising/bundles/start-building (= /docs/apps/bundles/getting-started) - comparison table: weighted price allocation, discounts allocated to components, tax on components, parent inventory = min of components, refunds/returns and reporting at component level
- https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItemGroup - `LineItemGroup {id, title, quantity, productId, variantId, variantSku, customAttributes}`
- https://shopify.dev/docs/storefronts/themes/product-merchandising/bundles-emails - order JSON example (components with lineItemGroup; null = standalone)
- https://shopify.dev/docs/api/admin-rest/latest/resources/order - REST Order (legacy since 2024-10-01); `price` pre-discount, `discount_allocations`, `total_discount` (deprecated in favour of allocations); no bundle-group field found in REST docs
- https://community.shopify.dev/t/how-to-recognize-the-parent-bundle-id-when-reading-the-order-query/31918 - group by lineItemGroup.id
- https://community.shopify.com/t/can-i-get-bundle-details-via-api-on-shopify/187944 - SFN: Order API returns only bundle line, not components
- https://community.shopify.com/t/report-on-sales-of-bundles-using-shopify-bundles-app/249847/1 - merchants cannot report sales per bundle
- https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountCodeBxgy - BXGY, `usesPerOrderLimit`
- https://community.shopify.com/t/buyxgety-line-item-discount-allocation/152300 - "Y" item identifiable by allocation, "X" item is not
- https://community.shopify.dev/t/duplicated-line-items-in-cart-when-discount-buy-x-get-y-applied/13265 - automatic BXGY splits lines
- https://community.shopify.dev/t/creating-order-with-buy-x-get-y-discount/25217 - orderCreate cannot reproduce BXGY; allocations read-only
- https://www.highviewapps.com/kb/how-do-i-retrieve-the-unit-price-of-each-line-item-in-a-shopify-order-before-and-after-discounts/ - `price` is pre-discount; net = price*qty - allocations
- https://intercom.help/returnlogic/en/articles/11427573-bundles-refunds-and-store-credits - returns app handling of bundle refunds (vendor)

OpenLinker repo context (read-only, for the "must not get wrong" section):
- libs/integrations/prestashop/src/infrastructure/mappers/prestashop-order.mapper.ts - maps `associations.order_rows`; comment claims free-gift lines produce sibling rows sharing `(product_id, product_attribute_id)`
- libs/integrations/woocommerce/src/infrastructure/adapters/order-source/woocommerce-order.types.ts - reads `line_items[].subtotal/total/meta_data`; no bundle/gift awareness

---

## Findings

### Theme 1: PrestaShop

#### 1.1 Pack product (bundle definition)
- A pack is a product with webservice `type = pack` (getter `getWsType`: simple / pack / virtual). Composition lives in
  `product.associations.product_bundle[]` = `{id, id_product_attribute, quantity}` (verified-code, Product.php webserviceParameters).
  So a component CAN be a specific combination (variant) with a fixed quantity. There is no "choose your variant at checkout"
  inside a core pack - the variant is fixed at pack definition (unverified that no UI exists, but the data model has one fixed
  `id_product_attribute` per component).
- `pack_stock_type` (per shop) with 4 values (verified-code, Pack.php):
  - `STOCK_TYPE_PACK_ONLY` (0) - "Only decrement pack quantity" (pack has its own stock, components untouched)
  - `STOCK_TYPE_PRODUCTS_ONLY` (1) - "Only decrement pack products quantities" (pack availability = min(component stock / pack_quantity))
  - `STOCK_TYPE_PACK_BOTH` (2) - decrement both; availability = min(pack stock, components)
  - `STOCK_TYPE_DEFAULT` (3) - fall back to `PS_PACK_STOCK_TYPE` configuration
  Source comment: "STOCK_TYPE_PACK_ONLY - pack 1pcs + product A 10pcs + product B 20pcs = 1pcs; PRODUCTS_ONLY = 10 pcs; PACK_BOTH = 1 pcs".
- Pack price: the pack is its own product with its own price and its own tax rule (unverified that PS never auto-sums;
  in PS 1.7/8 BO the pack price is entered on the pack product). One tax rule per pack product (verified-code: tax is a property of
  the Product; packs are Products).

#### 1.2 Pack in an order
- `OrderDetail.php` has no pack-specific code (grep for "pack" empty) and `orders.associations.order_rows` exposes only
  `id, product_id, product_attribute_id, product_quantity, product_name, product_reference, product_ean13, product_isbn,
  product_upc, product_mpn, product_price, id_customization, unit_price_tax_incl, unit_price_tax_excl` (verified-code, Order.php).
  => A pack arrives as ONE order row with the pack's product_id, the pack's name/reference/EAN and the pack price at the pack's
  single tax rate. Components are NOT in the order. To know what to pick, a consumer must look up `products/{pack_id}`
  -> `product_bundle` at read time (the composition may have changed since the sale).
- The Odoo PrestaShop connector confirms the pattern: pack composition is fetched from the product, it needed separate webservice
  support (forge PSCFI-6525).
- Stock: with PRODUCTS_ONLY/BOTH, PrestaShop itself decrements the components in its own `stock_available` on order validation
  (verified-code intent; forum reports of it failing: topic 1027721 says components not decremented and not restored on cancel;
  topic 1063532 says the pack's displayed stock does not refresh until the product is saved).
- Forum pain (thirtybees, PS 1.6 fork): pack shows 0 even when components are in stock.

#### 1.3 Free gift via cart rule (core "Send a free gift")
- Cart rule fields `gift_product` + `gift_product_attribute` (verified-code). Spec: "only one item (of the product selected as a gift)
  is offered"; if the customer adds more of the same product, they "should pay for n-1 items" (verified-doc, PS 1.7 spec).
- Mechanics (verified-code, Cart.php `addCartRule`): when the rule is applied, the rule is inserted into `cart_cart_rule`, then the
  gift product is added to the cart as an ordinary `cart_product` row via `updateQty(1, gift_product, gift_product_attribute, ...)`.
  The gift is a real product line at its catalogue price; the "free" part is the cart rule's discount.
- `Cart::getProducts()` has `$shouldSplitGiftProductsQuantity = false` by default; only when true does it mark `is_gift` and split
  the given-away quantity into a separate row. `Cart::getPackageList()` (used by `PaymentModule::validateOrder` to build orders)
  calls `$this->getProducts($flush)` WITHOUT splitting.
  => (verified-code reading, not observed on a live order) In `order_detail` the gift is a normal row at FULL unit price; if the
  customer also bought the same product, the paid and free units are MERGED into one row with quantity n. The gift's value appears
  as an `order_cart_rule` row (`name`, `value`, `value_tax_excl`, `free_shipping`) and in `orders.total_discounts(_tax_incl/_excl)`.
  `PaymentModule` explicitly keeps a gift cart rule even when its tax_excl value is 0 (`if (!$values['tax_excl'] && empty($cartRule->gift_product)) continue;`).
- CONFLICT: OpenLinker's own PrestaShop mapper comment says "free-gift lines ... produce sibling rows sharing that pair". Source reading
  says the order rows are built unsplit. Cannot resolve without a live order on the current PS version (and note PS versions differ;
  the split helper was introduced in 1.7.x). Needs a live check.
- Webservice exposes `order_cart_rules` as a separate resource (verified-code WebserviceRequest.php) - NOT as an association on the
  order. Getting "which line was a gift" requires an extra call and a join on product id (the cart rule names the gift product only via
  `id_cart_rule` -> `cart_rules.gift_product`).
- Gift out of stock (verified-code reading): `addCartRule` calls `updateQty(..., skipAvailabilityCheckOutOfStock = false)`, so an
  out-of-stock gift (backorders off) is simply not added, while the cart rule row is still inserted and `addCartRule` returns true.
  Exact customer-visible result not observed (unverified).
- Forum pain: gift added by cart rule is "still seen as a paid product" in shipping calculation (topic 389195).
- TRAP: `orders.gift` / `orders.gift_message` / `total_wrapping` = GIFT WRAPPING requested by the customer (Cart.php: "True if the
  customer wants a gift wrapping"), NOT a free gift. Polish "prezent" maps to wrapping here.
- Third-party "buy X get Y" / gift modules (Webkul, Knowband, many PL modules) behave module-specifically; Webkul says "the free gift
  will display on order details page to both admin & customer and invoice" (vendor). Their order shape is unknown per module
  (unverified) - some add a 0-price line, some rely on cart rules.

#### 1.4 Returns / VAT
- Returns and credit slips operate on `order_detail` rows (devdocs refunds page) => a pack can only be returned as a whole pack row;
  returning one component has no native representation (unverified beyond data model; there is no component row to return).
- A pack row carries one tax rule, so a pack mixing 23% and 8%/5% goods is taxed at a single rate on the shop invoice. Polish VAT
  advice (amavat.pl, advisory): a "set" is not automatically one supply; if components could be bought separately the set is often
  several supplies and the discount should be allocated proportionally to components per rate. (Legal reading, not a platform fact.)

### Theme 2: WooCommerce

#### 2.1 Core
- Core "Grouped product" is a display grouping only; each chosen child is added as its own ordinary line item, no parent line
  (unverified from a doc in this session; standard Woo behaviour).
- Core coupon types (percent, fixed_cart, fixed_product) cannot add a free product; "free product" coupons need an extension
  (e.g. Smart Coupons) (unverified in this session).

#### 2.2 WooCommerce Product Bundles (official, Woo.com)
- Order shape (verified-doc): a bundle produces a parent ("container") line item plus child line items. REST line item properties:
  - `bundled_by` (string, read): "Item ID of parent line item, applicable if the item is part of a bundle."
  - `bundled_items` (array, read): "Item IDs of bundled line items, applicable if the item is a bundle container item."
  - `bundled_item_title` (string, rw): title override in order/email templates.
  - `bundle_configuration` (write): needed when creating a bundle line via API so children are added.
  - Underlying meta: `_bundled_by` (hash of container cart item), `_bundled_items`, `_bundle_cart_key` (third-party/plugin docs).
- Pricing: per bundled item `priced_individually`. When OFF, the child's price is not added and the container carries the price;
  children land at 0 in the order - Picqer: "the components of a bundle automatically have a price of 0 euros in the store order ...
  keep this in mind if you're using revenue reports". When ON, the child "preserve[s] the price and tax rate of a bundled product"
  (verified-doc) and the container may still carry a base price. Per-item `discount` only with priced individually.
  => VAT: with priced_individually OFF the whole bundle is taxed at the CONTAINER's tax class; mixed-rate bundles need
  priced_individually ON to get per-rate tax (inference from doc wording; unverified on live order).
- Shipping: `shipped_individually` = "does not require assembly" - explicitly "does not mean 'split across different shipments'".
  Assembled bundle = items physically assembled in a common container (container line is the shipped thing, children have no weight
  when not shipped individually); "Virtual" bundle + all children shipped individually = pure grouping. Assembled weight Ignore/Preserve.
- Container line ALWAYS appears as a line item regardless of physical/virtual (feature request: confuses ShipStation etc.).
- Stock: child stock is reduced on sale ("the stock quantity of its contents is reduced as well"); optionally the bundle itself can
  have its own managed stock too. "The extension does not allow you to reserve part of a product's stock for use in product bundles."
  Bundled item `stock_status` = considering min quantity.
- Variants inside bundles: yes - variable bundled products; `override_variations` + `allowed_variations`, customer picks variation;
  `optional`, `quantity_min/max` (customer can choose quantities). So the same bundle SKU can produce different child sets per order.
- Item grouping "None" hides the parent in templates; hidden items still go to payment gateways.
- Returns: not covered in the docs. Refund in Woo is per line item (core), so a component can be refunded alone (unverified for bundles).

#### 2.3 Composite Products (official)
- Same shape: `composite_parent` (child -> parent item id), `composite_children` (container), `composite_configuration` (write);
  meta `_composite_parent`, `_composite_children` (verified-doc). Components are chosen by customer from scenarios.

#### 2.4 WPC Product Bundles (woosb, WPClever - very popular, free + premium)
- Bundle = product type `woosb`, composition in product meta `woosb_ids` (format changed in v8 from "id/qty" string to keyed object;
  vendor gives no API docs). Order: child lines carry `_woosb_parent_id`; parent has `woosb_ids`/keys. Pricing meta:
  `woosb_disable_auto_price`, `woosb_discount`, `woosb_discount_amount`, `woosb_shipping_fee` (third-party notes; vendor).
- How the price is split between parent and children in the order: not confirmed (unverified). Different from Woo Product Bundles,
  so a consumer must detect WHICH plugin produced the order (meta key families differ: `_bundled_by` vs `_woosb_parent_id` vs `_composite_parent`).

#### 2.5 Free gifts in WooCommerce (plugins)
- Cart Free Gift (Woo.com): gift line "priced at zero, locked to a quantity of one"; order item meta `_cfg_free_gift = yes` plus visible
  "FREE GIFT: Yes"; only in-stock simple product is auto-added; auto-removed when threshold no longer met (verified-doc).
  "a zero-price line alone doesn't identify a gift; the meta flag does" (the same product can also be a paid line).
- Free Gifts for WooCommerce (FantasticPlugins/Flintop): automatic or manual (customer picks), BOGO / Buy X Get Y, "cheapest item as gift",
  coupon-triggered gifts; completely free (0 cost) or discounted gifts; per-rule and global max gifts per order, per-user order limits;
  gift choice by "Highest/Lowest Stock Product/Variation"; FAQ advises setting $0.01 instead of 0 "to avoid payment gateway and legal
  validation issues" (vendor). => A "gift" may arrive at 0.01, not 0.
- BOGO plugins: discount "visible in the item subtotal" - i.e. line `subtotal` = full price, `total` = 0 (or reduced) (vendor; mapping
  to REST fields unverified). Smart Coupons shows a struck price.
- Line items in Woo REST carry `subtotal` (pre-discount) and `total` (post-discount, tax excl); a gift can therefore look like
  subtotal=X/total=0 (discount-style) or subtotal=0/total=0 (price-override style) depending on plugin (inference).
- Fee lines may be negative (discount-style fees) - another way plugins express "free" (OpenLinker types note `fee_lines.total` may be negative).

### Theme 3: Shopify (as storefront)

#### 3.1 Native bundles (Shopify Bundles app / fixed bundles / multipack; customized bundles via Cart Transform)
- "Order lines return bundle components, with a reference to the bundle parent" (verified-doc). In GraphQL each component
  `LineItem.lineItemGroup` -> `LineItemGroup {id, title, quantity (parent bundle qty), productId, variantId, variantSku, customAttributes}`;
  `lineItemGroup: null` = standalone. There is NO parent line item - the parent exists only as the group object.
- Doc example order (bundles-emails): component "Short Sleeve T-Shirt - Green" discountedTotal 22.0 and "Shorts - Green" 0.0 in the same
  group "Green Shirt and Shorts Bundle" - i.e. a component CAN carry 0 of the bundle price.
- Pricing: "The price is derived from the parent variant. The bundle price is allocated across components in the checkout, cart, and orders
  using a weighted price algorithm." Discounts: "calculated on the parent then allocated on the components." Taxes: "computed on the components"
  (verified-doc). => Per-component VAT works natively, but the allocated per-component prices are Shopify's weighting, not the merchant's.
- Inventory: "Shopify maintains sellable quantities on the parent bundle variant. The parent inventory quantity is the minimum of the
  component's inventory quantities" (fixed bundles). Customized bundles: app maintains parent stock; components checked in cart/checkout.
- Refund/Returns: "Operates at the component level"; Reports: "Sales reporting at the component level" (verified-doc).
  Merchant pain: cannot report sales per bundle (community thread 249847).
- Fulfilment: "No fulfillment constraint" by default -> components can be split across locations/shipments (inference from doc table).
- Limits: bundles can't be sold with selling plans (subscriptions, pre-orders). Customized bundles: `requiresComponents`.
- SFN-created bundles: Order API returns only the bundle line, not its components (community).
- REST Admin API is legacy since 2024-10-01; REST Order docs show no bundle-group field (verified-doc grep). An integration reading REST
  will see components as plain line items with no grouping (inference; "sales_line_item_group_id" not found in the REST docs - (unverified) whether it exists).
- Third-party bundle apps (pre-native era, still common): many create a single bundle line (bundle SKU) and either rely on the app to adjust
  component inventory, or "unbundle" the order post-purchase (order edit); ShipStation users report "$0 on the items sold, or the full order
  price for every item" which breaks customs values (community).

#### 3.2 Buy X Get Y / free gift
- BXGY (code or automatic) with "Free" = 100% off the Y item. On the order, the Y line keeps its normal `price` (REST `price` is pre-discount);
  the discount appears as `discount_allocations[]` on that line linked to `discount_applications[]` (verified-doc for field semantics;
  free-item shape from community). Net = price*qty - sum(allocations) = 0.
- The "Y" item is identifiable via its allocation; the "X" (qualifying) item is NOT marked (community 152300).
- Automatic BXGY may split the same variant into two cart lines (paid + discounted) (community 13265).
- `usesPerOrderLimit` caps rewards per order; only one discount per order by default unless combinations allowed (doc + guides).
- Gift-with-purchase apps instead add a separate 0-price line or a 100% line discount; Shopify cannot add a free item at checkout unless
  the customer/app adds it to cart (BXGY requires both X and Y in cart).
- orderCreate cannot reproduce BXGY; discount allocations are read-only (community) - relevant if OpenLinker ever writes orders INTO Shopify.

---

## Common checklist per platform

| Topic | PrestaShop | WooCommerce | Shopify |
|---|---|---|---|
| Bundle definition | Product `type=pack`, `product_bundle[]` {id, id_product_attribute, quantity} | Plugin-defined: Product Bundles (`bundle`), Composite, WPC `woosb`; core Grouped is not a bundle | Bundle parent variant with components (Bundles app / productVariantRelationship); customized via Cart Transform |
| Variants inside | Fixed combination per component | Yes; customer picks variation, optional items, qty min/max | Fixed bundles: variant per bundle variant; customized: chosen |
| Bundle stock | 4 modes; components optionally decremented by PS | Child stock reduced; optional own stock on bundle | Parent = min(components), Shopify-maintained |
| Bundle as listing | Pack is its own product (own EAN, price, tax) | Bundle is its own product | Parent product/variant |
| Bundle in order | ONE row (pack), no components | Container + children (`bundled_by`/`bundled_items`), children often 0 price | Components only, grouped by `lineItemGroup`; no parent line |
| Packing/split | Pack is one row - picker must expand | `shipped_individually` = packaging, not split shipments; container line always present | No fulfillment constraint; components can split |
| Return of component | No native representation (whole pack row) | Per-line refund possible (unverified for bundles) | Component level native |
| Return with gift | Gift merged with paid units in one row (code reading) + order-level discount -> ambiguous | Gift line with meta flag; plugin-specific | Y line with allocation; refund per line |
| Price across VAT rates | Single tax rule on pack | Container tax class unless priced individually | Weighted allocation, tax per component |
| Gift source | Cart rule (`gift_product`), modules | Plugins: auto/manual/BOGO/coupon; manual admin gift | BXGY (code/automatic), gift apps |
| Gift stock / runs out | Not added if OOS (code reading); rule still on cart | Auto-add only if in stock (Cart Free Gift); pick by stock | Y must be in cart; normal inventory |
| Gift on receipt/invoice | Full-price row + discount line (code reading) | 0 or 0.01 line (plugin) | Full price + discount allocation |
| Gift limits | Exactly 1 unit per rule | Per rule / global / per user | `usesPerOrderLimit`, usage limits |

---

## Use cases (SHOP-nn)

SHOP-01 | PrestaShop | merchant selling kits | Pack "Zestaw prezentowy" (PRODUCTS_ONLY) sold | one order row with pack product_id/EAN/price; no components | picker and stock reservation need composition from `product_bundle` lookup; composition can change after sale | Order.php, Pack.php
SHOP-02 | PrestaShop | merchant with own pack stock | Pack with PACK_ONLY (pre-assembled boxes on shelf) | one pack row; components untouched | OMS must NOT explode the pack for picking or stock in this mode; mode is per product per shop | Pack.php
SHOP-03 | PrestaShop | merchant | Pack mixing 23% and 5% goods | one row at the pack's single tax rule | invoice/receipt in OL either repeats the wrong single rate or must split - by what weights? | Product.php tax rule, amavat.pl
SHOP-04 | PrestaShop | merchant | Cart rule "Send a free gift" + customer also buys same product | (code reading) one row qty n at full price + order_cart_rule discount + total_discounts | line total != paid; gift not flagged on the row; OL repo comment assumes sibling rows - conflict | Cart.php, PaymentModule.php
SHOP-05 | PrestaShop | merchant | Gift product out of stock | (code reading) gift not added, rule still attached | silent gift drop; customer complaint | Cart.php addCartRule
SHOP-06 | PrestaShop | merchant | Customer ticks gift wrapping ("prezent") | `orders.gift=1`, `gift_message`, `total_wrapping` | easily confused with free gift | Cart.php, Order.php
SHOP-07 | PrestaShop | merchant | Pack cancelled/returned | return per pack row; components restock via PS (buggy) | partial component return impossible; component stock not restored (forum) | forum 1027721
SHOP-08 | WooCommerce | merchant with Product Bundles | Bundle, items not priced individually | container line with price + child lines at 0, linked by `bundled_by`/`bundled_items` | revenue/VAT on container; 0-price children break customs/reports; picker must skip container (if assembled container ships, skip children?) | Woo REST ref, Picqer
SHOP-09 | WooCommerce | merchant | Bundle with priced-individually children and container base price | price split across container and children, each with own tax | sum logic differs per item; container might be 0 | bundles-configuration doc
SHOP-10 | WooCommerce | merchant | Customer-configured bundle (variable items, optional, qty min/max) | container + whichever children chosen | same bundle SKU => different child sets; cannot pre-define composition | Woo REST ref
SHOP-11 | WooCommerce | merchant using WPC woosb or Composite | Bundle from a different plugin | children carry `_woosb_parent_id` / `composite_parent` instead of `bundled_by` | OMS must recognise 3+ meta dialects; woosb format changed in v8 | wpc ticksy, Composite REST ref
SHOP-12 | WooCommerce | merchant | Automatic free gift (Cart Free Gift / Free Gifts for Woo) | separate line price 0 (or 0.01!), qty 1, meta `_cfg_free_gift=yes` or plugin meta | gift detection needs plugin meta, not price; 0.01 gifts look paid | Woo docs
SHOP-13 | WooCommerce | merchant | BOGO plugin "buy 2 get 1" | discount inside line (subtotal > total) or separate line | free unit hidden inside a qty-3 line; return of 1 unit = what refund? | BOGO listing (vendor)
SHOP-14 | Shopify | merchant on Shopify Bundles | Fixed bundle sold | components as line items, each with lineItemGroup; no parent line; weighted price allocation; tax per component | bundle "SKU" never appears as a line; some components at 0; REST shows no grouping | shopify.dev bundles, LineItemGroup
SHOP-15 | Shopify | merchant with SFN or older bundle app | Bundle sold | single bundle line, no components (SFN) or app-specific unbundling | OMS gets nothing to pick from | community 187944, ShipStation thread
SHOP-16 | Shopify | merchant | BXGY "buy 2 get 1 free" (automatic) | Y line at full `price` with 100% `discount_allocations`; X not marked; possibly the same variant split into two lines | gift = discount, not a 0 price; partial return must re-evaluate the promo | REST order doc, community 152300, 13265
SHOP-17 | Shopify | merchant | Return of one component of a bundle | refund at component level natively | OMS mirroring returns must accept component-level returns against a group | shopify.dev table

---

## Order shape cheat-sheet
- PrestaShop - bundle: ONE `order_rows` row = the pack (pack id, name, EAN, price, single tax). Components only via `products/{id}` -> `associations.product_bundle` (+ `pack_stock_type`). Gift: (code reading) a normal row at full price, merged with paid units of the same product; the freebie lives in `order_cart_rules` (separate resource) + `orders.total_discounts`. `orders.gift` = wrapping.
- WooCommerce - bundle: container line + child lines; Product Bundles `bundled_by`/`bundled_items`, Composite `composite_parent`/`composite_children`, WPC `_woosb_parent_id`; children often `total=0` when not priced individually. Gift: plugin-specific - usually separate line `total` 0 (or 0.01) with a meta flag (`_cfg_free_gift`), or BOGO discount via `subtotal` vs `total`.
- Shopify - bundle: components only, each `lineItem.lineItemGroup {id,title,quantity,variantSku}`; price weighted across components, tax per component; no parent line (GraphQL only; REST legacy shows no group). Gift (BXGY): Y line keeps full `price`, 100% `discount_allocations`; X unmarked.

## Surprises / things OpenLinker must not get wrong
1. Three opposite bundle shapes: PS = parent only, Woo = parent + children, Shopify = children only. A single "bundle line" model must accept all three; never double-count Woo (container AND children) for stock or picking.
2. A 0-price line is neither necessary nor sufficient for "gift": PS gift is full price + order-level discount (merged row), Shopify gift is full price + allocation, Woo gifts can be 0.01. Detect gifts from the discount/rule/meta, not from price.
3. PS packs: whether components were already decremented in the shop depends on `pack_stock_type` per product per shop - reserving components in OL for a PACK_ONLY pack, or not reserving for PRODUCTS_ONLY, both cause oversell/undersell. Also composition must be snapshotted at order time.
4. VAT: a pack/container carries ONE tax rate (PS, Woo w/o priced-individually) while Shopify splits by weighted allocation. Re-issuing a document (KSeF/receipt) per component needs an explicit, auditable allocation rule; the shop's own split cannot be assumed.
5. `orders.gift` in PrestaShop is gift wrapping. And OL's PrestaShop mapper comment assumes free-gift sibling rows while PS source builds orders unsplit - verify on a live order before designing.

## Confidence assessment
- High: PS pack data model, pack stock types, order_rows fields, order_cart_rule fields (source code); Woo Product Bundles/Composite REST fields; Shopify native bundle pricing/tax/stock/returns table, LineItemGroup.
- Medium: PS gift row merged at full price (code reading, not live); Woo children at 0 price (Picqer + doc wording); Shopify BXGY free item shape (field docs + community).
- Low / unverified: WPC woosb price split in orders; PS out-of-stock gift outcome; Woo grouped/coupon behaviour stated from general knowledge; existence of REST `sales_line_item_group_id`.

## What the caller might do with this
- Decide whether OpenLinker's bundle model is "expand at ingestion" (needs composition snapshot for PS) or "keep source shape and interpret".
- Decide whether gift detection is per-source-adapter (meta/rule aware) and what OL shows when it cannot tell.
- Get a live PrestaShop order with a pack + cart-rule gift (+ same product bought) on the target PS version to settle the merged-vs-sibling-row question.
