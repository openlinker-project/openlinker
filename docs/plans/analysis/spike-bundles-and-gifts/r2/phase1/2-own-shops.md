# Research: bundles ("zestawy") and free gifts ("gratisy") on own-shop platforms
# PrestaShop 1.7 / 8 / 9, WooCommerce (+ plugins), Shopify as storefront

Researcher 2 of 5, PROBLEM phase. Read-only. Date 2026-11-04.
Legend: (verified-code) = read in source at the cited ref; (verified-docs) = vendor docs;
(unverified) = inferred or third-party, needs a test order.

## Sources consulted
PrestaShop (raw source, branch `develop` unless noted; also checked tags 1.7.8.11, 8.1.7, 8.2.1, 9.0.0, 9.0.2):
- classes/Pack.php - pack table, getQuantity, stock-type constants
  https://github.com/PrestaShop/PrestaShop/blob/develop/classes/Pack.php
- src/Core/Domain/Product/Pack/ValueObject/PackStockType.php - 0 PACK_ONLY, 1 PRODUCTS_ONLY, 2 BOTH, 3 DEFAULT
- src/Core/Stock/StockManager.php - updateQuantity / updatePackQuantity / updatePacksQuantityContainingProduct
- classes/Cart.php - addCartRule (gift auto-add), getProducts(shouldSplitGiftProductsQuantity), getSummaryDetails gift split, duplicate() gift handling
- classes/CartRule.php - gift_product / gift_product_attribute, checkValidity (out-of-stock gift), getContextualValue (gift valued at full price)
- classes/PaymentModule.php - validateOrder -> getPackageList -> OrderDetail::createList; createOrderCartRules
- classes/order/OrderDetail.php - fields, webservice params (taxes association), stock decrement per row
- classes/order/Order.php - webservice `associations.order_rows` fields
- classes/order/OrderCartRule.php - order_cart_rule fields (value, value_tax_excl, free_shipping)
- classes/Product.php - webservice `associations.product_bundle`, getWsProductBundle / setWsProductBundle, setWsType
- src/Core/Domain/Discount/ValueObject/DiscountType.php (develop) - cart_level, product_level, free_gift, free_shipping, order_level
- Issues: #34085 (gift + mixed VAT -> wrong invoice tax detail, open, 8.1.1), #40261 (PR: block gift rule when out of stock),
  #42502 (PR: apportion order discount on partial refund; reduction_product handled differently), #37423 (pack content not
  snapshotted in order, open), #23646 (pack components decremented not reserved), #42079 (empty() treats pack_stock_type 0 as
  default, closed 2026-07), #24531 (BO order edit can oversell pack), #19846 (EPIC pack stock issues)
- OpenLinker's own PS adapter (read only, for context): libs/integrations/prestashop/src/domain/types/prestashop-pack.types.ts,
  infrastructure/mappers/prestashop-order.mapper.ts, infrastructure/provisioners/prestashop-pack.resolver.ts

WooCommerce:
- Product Bundles REST reference https://woocommerce.com/document/bundles/bundles-rest-api-reference/
- Product Bundles configuration https://woocommerce.com/document/bundles/bundles-configuration/
- Product Bundles source mirror (2022 snapshot) https://github.com/pronamic/woocommerce-product-bundles
  includes/class-wc-pb-order.php, includes/class-wc-pb-cart.php
- Composite Products REST reference https://woocommerce.com/document/composite-products/composite-products-rest-api-reference/
- WPC Product Bundles (woo-product-bundle) trunk https://plugins.svn.wordpress.org/woo-product-bundle/trunk/includes/class-woosb.php
- WebToffee Smart Coupons (free gift / BOGO) trunk
  https://plugins.svn.wordpress.org/wt-smart-coupons-for-woocommerce/trunk/public/modules/giveaway-product-public/class-wt-smart-coupon-giveaway-product-public.php

Shopify:
- Bundles overview https://shopify.dev/docs/apps/build/product-merchandising/bundles
- Variant fixed bundle https://shopify.dev/docs/apps/build/product-merchandising/bundles/add-variant-fixed-bundle
- LineItemGroup https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItemGroup
- LineItem https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem
- Buy X Get Y https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y
- Cart transform weighted allocation changelog
  https://shopify.dev/changelog/developer-preview-cart-transform-api-pricing-bundles-per-component-additional-customizations
- Third-party: Pickware help https://help.pickware.com/en/articles/676172-how-do-i-use-shopify-bundles-with-pickware-for-shopify ,
  Shopify community https://community.shopify.com/t/create-invoices-with-bundles-as-one-price-not-separate-items/301765

---------------------------------------------------------------------------------------------------
## 1. PrestaShop

### 1.1 Bundle (Pack) definition (verified-code)
- A pack is a product with `product_type = 'pack'` (PS 8+) / `cache_is_pack = 1`, components in table `ps_pack`
  (`id_product_pack, id_product_item, id_product_attribute_item, quantity`). Pack::addItem.
- Components may be specific combinations (`id_product_attribute_item`). The pack itself is a single product; a pack with its
  own combinations is not a supported shape (unverified - UI prevents it; not re-checked in code). Pack-in-pack: not supported
  (unverified).
- No buyer choice: composition is fixed. No "choose 3 of 10" in core.
- Webservice product: `associations.product_bundle` -> list of `{id, id_product_attribute, quantity}`
  (Product.php getWsProductBundle: `SELECT id_product_item as id, id_product_attribute_item as id_product_attribute, quantity FROM pack`).
  `type` field on WS product = simple|pack|virtual (setWsType).
- Write asymmetry (verified-code, impact unverified): setWsProductBundle reads `$item['product_attribute_id']` while the WS
  field spec and the getter use `id_product_attribute`. A writer sending the documented name may lose the combination
  (silently writes 0). Matters only if OL ever writes packs to PS.

### 1.2 Pack stock (verified-code)
- `pack_stock_type`: 0 decrement pack only, 1 decrement components only, 2 both, 3 use shop default `PS_PACK_STOCK_TYPE`.
- Selling a pack: StockManager::updatePackQuantity decrements components by `delta * pack_quantity` (modes 1,2, or 3 with config>0)
  and/or the pack row (modes 0,2).
- Selling a component: if mode BOTH, packs containing it are reduced only when components can no longer build the pack
  (updatePacksQuantityContainingProduct).
- Pack availability in mode 1 is COMPUTED at read time: floor(component_qty / pack_quantity), min over components. The pack's own
  stock_available row is stale. (OL already handles this: PS adapter #2598.)
- VERSION DIFFERENCE: in 8.1.7, 8.2.1, 9.0.0, 9.0.2 Pack::getQuantity uses `empty($packStockType)`, so an explicit 0
  ("pack only") is treated as "shop default". develop fixed it ("Avoid using empty()") per issue #42079 (closed 2026-07).
  1.7.8.11 uses `== STOCK_TYPE_DEFAULT` only. So the meaning of pack_stock_type=0 depends on PS version.
- Pain: #23646 - components are decremented, not shown as reserved, for packs in modes 1/2.

### 1.3 Pack in the order payload (verified-code + issue)
- validateOrder -> cart->getPackageList() -> getProducts() -> OrderDetail::createList: ONE order_detail row per cart product.
  A pack is ONE row: product_id = pack id, price = pack price, tax = pack's own id_tax_rules_group. Components do NOT appear
  as order rows.
- Webservice order: `associations.order_rows[]` = `{id, product_id, product_attribute_id, product_quantity, product_name,
  product_reference, product_ean13, product_isbn, product_upc, product_mpn, product_price, id_customization,
  unit_price_tax_incl, unit_price_tax_excl}`. No pack flag, no component list.
- To explode a pack, the adapter must read `products/{id}` (`type=pack`, `associations.product_bundle`) AFTER the fact.
  Issue #37423 (open): PS does not snapshot pack content in the order - if the merchant edits the pack later, both the shop and
  any adapter reading later see the NEW composition, not what the buyer bought.
- VAT: a pack carries one tax rule group. A pack of a 5% book + 23% toy is taxed entirely at the pack's rate. No per-component VAT.

Example (constructed from field list, not a live capture):
```xml
<order_rows>
  <order_row>
    <id>1842</id><product_id>77</product_id><product_attribute_id>0</product_attribute_id>
    <product_quantity>1</product_quantity><product_name>Zestaw prezentowy kawa + kubek</product_name>
    <product_reference>SET-KAWA-KUBEK</product_reference><product_price>81.300813</product_price>
    <unit_price_tax_incl>100.000000</unit_price_tax_incl><unit_price_tax_excl>81.300813</unit_price_tax_excl>
  </order_row>
</order_rows>
<!-- products/77: <type>pack</type><pack_stock_type>3</pack_stock_type>
     <associations><product_bundle><product><id>12</id><id_product_attribute>0</id_product_attribute><quantity>1</quantity></product>
     <product><id>31</id><id_product_attribute>104</id_product_attribute><quantity>1</quantity></product></product_bundle></associations> -->
```

### 1.4 Free gift via cart rule (verified-code)
- CartRule fields: `gift_product`, `gift_product_attribute`, `free_shipping`, `reduction_product`, `reduction_percent`,
  `reduction_amount`, `reduction_exclude_special`, `quantity` (total uses), `quantity_per_user`, `minimum_amount`
  (+ tax/shipping/currency flags), product restrictions, `priority`, `highlight`, `partial_use`.
- Adding: Cart::addCartRule inserts cart_cart_rule then `updateQty(1, gift_product, gift_product_attribute, ...)`: the gift is
  added as +1 to the ordinary `cart_product` row. If the buyer already has that product in the cart, the rows MERGE (qty 2).
  One gift unit per cart rule.
- Valuing: getContextualValue adds the gift's full unit price (`price_wt` or `price`) to the rule's reduction. The gift is "free"
  because the discount equals its price, not because a 0 price is stored.
- Display split: getSummaryDetails / getProducts(shouldSplitGiftProductsQuantity=true) splits a 0-price `is_gift` line for the
  cart/summary/email ONLY. validateOrder calls getPackageList()->getProducts() with the default (no split). Since 9.1 the split
  helpers are deprecated "doesn't do anything" (9.1+ behaviour of split not re-verified).
- Result in order (all of 1.7.8 / 8.1 / 9.0 / develop, verified-code): order_detail row for the gift product at FULL unit price,
  quantity includes the gift (merged with a bought unit of the same product/combination if any); `order_cart_rule` row
  `{id_cart_rule, name, value, value_tax_excl, free_shipping}` carries the gift value as an order-level discount.
  Order totals: total_discounts_tax_incl includes it. Line `reduction_*` fields stay 0 (OL mapper comment confirms: cart-rule
  discounts never reach a line).
- Evidence for "this unit is a gift": only by joining order -> order_cart_rules -> cart_rules/{id}.gift_product +
  gift_product_attribute -> the matching order_row. The cart rule can be edited/deleted later (order_cart_rule keeps name and value,
  not gift_product). Cart::duplicate() already uses this join to subtract 1 from the gift product qty (verified-code) - the
  platform itself identifies gifts that way.
- Out of stock: checkValidity rejects the rule ("The gift product is out of stock.") only when stock <= 0 AND out-of-stock
  ordering is denied (develop, behind isDiscountFeatureFlagEnabled); PR #40261 shows older behaviour let the voucher apply anyway.
  Gift stock is decremented like any sale (same order_detail row).
- Mixed VAT (issue #34085, open, 8.1.1): with a gift rule and products of different tax rates, the invoice tax breakdown is
  prorated across all products, i.e. the gift discount is spread over the wrong VAT rates.
- Refund: PR #42502 - partial refund "excluding vouchers" deducted the whole order discount; `reduction_product` rules are
  kept whole. Gift returns are ambiguous: returning the gift unit vs a bought unit of the same row cannot be distinguished.
- PS 9.x new Discount domain (develop): DiscountType = cart_level | product_level | free_gift | free_shipping | order_level.
  An explicit `free_gift` type gives cleaner evidence once the feature flag is on (exposure through webservice unverified).

Example (constructed):
```xml
<order_rows><order_row><id>1901</id><product_id>55</product_id><product_attribute_id>0</product_attribute_id>
  <product_quantity>1</product_quantity><product_name>Brelok gratis</product_name>
  <unit_price_tax_incl>19.990000</unit_price_tax_incl></order_row></order_rows>
<total_discounts_tax_incl>19.990000</total_discounts_tax_incl>
<!-- order_cart_rules: {id_cart_rule: 9, name: "Gratis od 200 zl", value: 19.99, value_tax_excl: 16.25, free_shipping: 0}
     cart_rules/9: gift_product=55, gift_product_attribute=0, minimum_amount=200 -->
```

### 1.5 Other PS gift-like mechanics
- `reduction_product` + 100% percent on a specific product = "free item" without auto-add (buyer adds it). Discount again
  sits in order_cart_rule, not on the line.
- Third-party modules (e.g. gift/BOGO modules from Addons) add their own rows or zero-price specific prices (unverified, varies).
- "Gift wrapping" (`order.gift`, `gift_message`) is a different concept - must not be confused with a free product.

---------------------------------------------------------------------------------------------------
## 2. WooCommerce

### 2.1 Core
- No bundles in core. "Grouped product" is only a display grouping; children bought as separate lines with no parent line.
- No free gift in core. Coupons: percent / fixed cart / fixed product, `free_shipping`. Coupon discount IS apportioned to lines:
  each line has `subtotal` (pre-discount) and `total` (post-discount) + `subtotal_tax/total_tax`, `taxes[]` per rate, `tax_class`.
  So per-line VAT and per-line discount are derivable (better than PS).
- Order line item (REST v3): `id, name, product_id, variation_id, quantity, tax_class, subtotal, subtotal_tax, total, total_tax,
  taxes[], meta_data[], sku, price, image, parent_name`. `coupon_lines[]` with `code, discount, discount_tax`.

### 2.2 WooCommerce Product Bundles (official, Somewherewarm) (verified-code on 2022 mirror + verified-docs)
- Product: `type: bundle`, `bundled_items[]` with `id` (bundled_item_id), `product_id`, `quantity_min/max`, `priced_individually`,
  `shipped_individually`, `optional`, `discount`, `override_variations`, `allowed_variations`, `default_variation_attributes`,
  `order_visibility`, `order_price_visibility`. Read-only `bundle_stock_quantity`, `bundle_stock_status`. Product-level
  `bundled_by` = bundles containing this product.
- Buyer may choose: optional items, quantity in range, variation of a variable child -> composition is per order.
- Order: one container line + one child line per bundled item. REST adds `bundled_items` (child line ids) on the container and
  `bundled_by` (parent line id) on children. Meta: container `_bundled_items`, `_bundle_cart_key`, `_stamp` (configuration),
  `_bundle_group_mode`, `_bundle_weight`; child `_bundled_by` (container cart key hash), `_bundled_item_id`, `_stamp`,
  `_bundled_item_priced_individually` yes/no, `_bundled_item_needs_shipping` yes/no, `_bundled_item_hidden`,
  `_bundled_item_price_hidden`, `_bundled_item_title`.
- Price: child not priced individually -> `set_price(0)` (class-wc-pb-cart.php) -> child line total 0, tax 0; container carries
  the price at the CONTAINER's tax class. Priced individually -> child carries price at its own tax class, container carries
  base price (often 0). Mixed per item.
- Stock: children reduce their own stock as ordinary lines; the bundle may additionally have its own stock ("Manage stock" on
  the bundle).
- Shipping: assembled (not shipped individually) -> container is the physical item with aggregated weight, children
  `_bundled_item_needs_shipping=no`. Docs warn external fulfilment "may not import an assembled bundle as a single item".
- Hidden children: `order_visibility=hidden` -> child lines exist but are hidden on order screens/emails.
- Refund: Woo refunds per line item, so a child line can be refunded alone (amount 0 if not priced individually - money sits on parent).

Example (constructed from meta keys + REST fields):
```json
"line_items": [
 {"id": 501, "name": "Zestaw do kawy", "product_id": 30, "quantity": 1, "tax_class": "", "subtotal": "81.30",
  "total": "81.30", "total_tax": "18.70", "bundled_items": [502, 503],
  "meta_data": [{"key": "_bundle_group_mode", "value": "parent"}, {"key": "_bundle_cart_key", "value": "a1b2"}]},
 {"id": 502, "name": "Kawa 250g", "product_id": 8, "quantity": 2, "tax_class": "reduced-rate", "total": "0.00",
  "total_tax": "0.00", "bundled_by": 501,
  "meta_data": [{"key": "_bundled_by", "value": "a1b2"}, {"key": "_bundled_item_id", "value": "313"},
                {"key": "_bundled_item_priced_individually", "value": "no"}, {"key": "_bundled_item_needs_shipping", "value": "no"}]},
 {"id": 503, "name": "Kubek - czarny", "product_id": 114, "variation_id": 115, "quantity": 1, "total": "0.00", "bundled_by": 501}
]
```

### 2.3 Composite Products (official)
- `composite_components` with options from product ids / categories (buyer picks per component), `composite_scenarios`.
- Order: container + child lines, REST `composite_parent` (on child) / `composite_children` (on container). Same pricing/shipping
  pattern as bundles (per-component "priced individually") (unverified detail).

### 2.4 WPC Product Bundles (free, popular) (verified-code trunk)
- Order item meta: parent `_woosb_ids` (encoded child ids+qty), `_woosb_price`, `_woosb_bundle`; children `_woosb_parent_id`.
  No REST parent/child fields - adapter must read meta.
- Pricing modes: FIXED -> children `set_price(0)`, parent keeps bundle price. AUTO -> parent price 0 AND parent
  `tax_status = none` (filter woosb_ignore_tax_for_bundles), children carry (optionally discounted) prices with their own tax.
- So the parent line can be a 0.00 SKU line with no tax - an adapter treating every line as a product would create
  a 0-price line for the "bundle" SKU.

### 2.5 Free gift / BOGO plugins (Woo)
- WebToffee Smart Coupons (verified-code trunk): gift is a SEPARATE cart line (`free_product` cart key), price set to the
  discounted price (0 when 100%), order item meta `free_product` and `free_gift_coupon` (coupon code). Auto-add or "choose
  your gift". BOGO coupon type also supported. Evidence of gift: meta + 0 total + coupon line.
- Other popular plugins (Free Gifts for WooCommerce / FantasticPlugins, YITH, Discount Rules by Flycart, WPC BOGO):
  each uses its own meta and either 0-price separate line or coupon-style discount (unverified, not read).
- Implication: no Woo-wide gift marker; an adapter needs per-plugin recognisers, fallback = "line with price>0 originally
  but total 0" heuristic.

---------------------------------------------------------------------------------------------------
## 3. Shopify (storefront)

### 3.1 Bundles (verified-docs)
- Native: parent variant + `productVariantComponents` (via productVariantRelationshipBulkUpdate); up to 30 components, no nested
  bundles, up to 3 options, parent price set by parent variant, `requiresComponents` true. Inventory is DERIVED from components.
  Fixed bundles (product or variant level) and customized bundles (Cart Transform function: expand/merge).
- Order: "Order lines return bundle components, with a reference to the bundle parent." Each component LineItem has
  `lineItemGroup {id, title, quantity, productId, variantId, variantSku, customAttributes}`. The parent is NOT a line item.
- Price: bundle price allocated to component lines by a weighted algorithm (changelog); each component line has its own
  `taxLines` -> per-component VAT is native. Exact formula unverified; components' originalUnitPrice vs allocated unverified.
- Not sellable with selling plans (subscriptions/pre-order).
- Third-party bundle apps (pre-native, still common) vary: some sell a single bundle SKU line, some explode via line
  properties (`_bundle_id`), some split price proportionally (Pickware does its own split) - no single shape.
- Merchant pain (community): invoices list components instead of the bundle at one price.

### 3.2 Free gift (verified-docs)
- Buy X Get Y (automatic or code): "The free or discounted 'get' item is never automatically added to the cart." Free item is a
  normal LineItem with `discountAllocations` equal to its price; `originalUnitPriceSet` = list price; optional max uses per order.
  Out of stock -> sold out, discount unusable.
- "Auto-add free gift" requires an app / Cart Transform / Functions (line properties, app-specific).
- Gift evidence: discountAllocations -> discountApplication (title, value 100%, targetSelection EXPLICIT). The admin API does not
  directly say "BXGY" on the allocation (unverified).
- Refunds/returns per line item; `refundableQuantity`, `currentQuantity`.

---------------------------------------------------------------------------------------------------
## 4. Checklist per platform

| Topic | PrestaShop | WooCommerce | Shopify |
|---|---|---|---|
| Bundle definition | Pack product, fixed composition in ps_pack, components may be combinations | Plugin-only (PB, Composite, WPC); buyer-configurable (optional items, qty ranges, variations) | Parent variant + components (max 30, no nesting); customized via Cart Transform |
| Variants inside | Yes, specific combination per component; pack itself has no combinations (unverified) | Yes, buyer picks variation per child (allowed_variations) | Yes, component variants; parent up to 3 options |
| Bundle stock | pack_stock_type 0/1/2/3; mode 1 computed; 0 misread in 8.x-9.0.2 | Children decrement own stock; bundle optionally own stock | Derived from components |
| Bundle as listing | Pack is its own product/SKU, own EAN possible | Bundle product has own SKU | Parent product/variant listed |
| Order with bundle | 1 row (pack id); no components; composition not snapshotted (#37423) | Container + child lines, parent/child links (REST bundled_by/bundled_items; WPC meta only) | Component lines only + lineItemGroup ref; no parent line |
| Packing | Must explode via product_bundle at ingest | Children lines present; "assembled" flag via needs_shipping meta | Components present |
| Return of component | Not expressible (row is the pack) | Child line refundable alone (money may be on parent) | Component line refundable |
| Return with gift | Gift merged in row; cannot tell gift unit from paid unit | Plugin line separate (WT) -> refundable alone | Gift is own line with 100% allocation |
| VAT split | One rate per pack (pack's tax rule) | Per line if children priced individually; else container's tax class | Per component taxLines |
| Gift source | Cart rule gift_product (auto-add) or reduction_product 100% | Plugin coupon/rule | BXGY discount (manual add) or app |
| Gift stock / running out | Gift decrements like sale; rule rejected only if OOS + deny orders (develop) | Plugin-dependent | Sold out => discount unusable |
| Gift on documents | Line at full price + order-level discount; tax detail bug with mixed VAT (#34085) | 0-price line (+meta) | Line at list price with discount allocation |
| Gift limits | One unit per rule; quantity, quantity_per_user, minimum_amount | Plugin | Max uses per order; usage limits |

---------------------------------------------------------------------------------------------------
## 5. What an adapter can / cannot derive

PrestaShop
- CAN: that a line is a pack (product type) and its CURRENT composition (product_bundle, incl. combination ids, qty);
  pack stock mode (needs shop config for 3, and version-aware for 0); that a cart rule with gift_product was applied and its
  value (order_cart_rules + cart_rules); the line it most likely belongs to (product+attribute match).
- CANNOT: composition at time of sale (not snapshotted); per-component prices or VAT for a pack; which unit of a merged row is the
  gift when the buyer also bought that product; gift identity if the cart rule was deleted/edited later; discount per line.

WooCommerce
- CAN (Product Bundles/Composite): exact per-order composition incl. chosen variation and quantity, parent-child links, which
  child carries price, which lines ship. Per-line tax and per-line discount (core). Gift lines for known plugins (meta).
- CANNOT: a universal bundle or gift marker across plugins; list price of a 0-price child (needs product read); for WPC the REST
  links (meta parsing only); per-child VAT when child not priced individually (money+tax on parent).

Shopify
- CAN: components with own price share and VAT, group reference (lineItemGroup), discount allocations per line, original price.
- CANNOT: a parent line (synthesise from lineItemGroup); exact allocation rule; explicit "gift" flag (only a 100% allocation);
  bundle structure from third-party apps.

---------------------------------------------------------------------------------------------------
## 6. Use cases (condensed list in handback)

## 7. Merchant pains (evidence)
- PS pack stock: EPIC #19846, #23646 (components decremented not reserved), #24531 (BO edit oversells packs), #42079 (mode 0 ignored).
- PS pack content mutable after sale: #37423.
- PS gift + mixed VAT invoice: #34085. Partial refund vs discount: #42502.
- Woo: assembled bundles not imported as one item by external fulfilment (vendor docs warning).
- Shopify: invoices show components rather than the bundle (community thread).
