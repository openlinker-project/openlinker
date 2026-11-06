# PrestaShop live probe: gifts, packs, gift wrapping

Run on 2026-11-04 against a throwaway shop. Every order below was created through
PrestaShop's own order path, never by writing order rows.

## Environment

| Item | Value |
|---|---|
| Image | `prestashop/prestashop:9.0.2-2.0-classic-8.4` (PrestaShop **9.0.2**, `PS_VERSION_DB = 9.0.2`) |
| PHP | 8.4.15 (CLI, inside the container) |
| Database | `mysql:8.4` (8.4.11) |
| Compose project | `spike-ps-probe`, own network, ports 127.0.0.1:18580 (shop) and 127.0.0.1:18306 (MySQL) |
| Install | image auto-install (`PS_INSTALL_AUTO=1`, `PS_COUNTRY=PL`, demo data) |
| Rounding | `PS_ROUND_TYPE = 2`, `PS_PRICE_ROUND_MODE = 2` (install defaults) |
| Teardown | `docker compose down -v` at the end; no other container or project was touched |

Setup notes:

- The first boot failed with `The admin folder could not be renamed into admin…/`. The image renames
  the admin folder during install, and that rename fails on the image's overlay filesystem. Mounting a
  named volume on `/var/www/html` (as the other local stacks do) fixed it.
- The auto-install with `PS_COUNTRY=PL` created **no taxes at all** (`ps_tax`, `ps_tax_rule` and
  `ps_tax_rules_group` were empty), even though every demo product had `id_tax_rules_group = 1`. The
  probe created `PL VAT 23%` (group 1) and `PL VAT 5%` (group 2), each with one tax rule for Poland, set
  every product to group 1, and added a Polish address (id 7) for demo customer 2.
- Webservice: `PS_WEBSERVICE = 1`, key `PROBEKEY…` with every method on every resource. Requests must use
  `Host: localhost:18580`; `127.0.0.1` gets a 302 to the shop domain.

## How orders were made

`boot.php` loads `config/config.inc.php`, boots `FrontKernel('prod')` and sets
`Context::container` (without it `PaymentModule::validateOrder` dies in `Tools::getContextLocale` with
`Kernel Container is not available`). Then, per order:

```php
$cart = new Cart(); /* customer 2, address 7, currency 1, carrier 1 (Click and collect, free) */ $cart->add();
$cart->updateQty($qty, $idProduct);
$cart->addCartRule($idCartRule);                 // cart rules carry a code, so nothing auto-applies
$cart->setDeliveryOption([7 => '1,']); $cart->update();
Module::getInstanceByName('ps_wirepayment')->validateOrder(
    $cart->id, Configuration::get('PS_OS_BANKWIRE'), $cart->getOrderTotal(true, Cart::BOTH), …);
```

Products used: 6 "Mug The best is yet to come", 7 "Mug The adventure begins", 8 "Mug Today is a good day",
all standard products at 11.90 net, 23% (14.637 gross). All orders are in state 10 "Awaiting bank wire
payment".

Note: order 6 is a leftover of the first, crashed run. `validateOrder` had already written `ps_orders`
and two `ps_order_detail` rows when it threw, but **no `ps_order_cart_rule` row** and
`current_state = 0`. `validateOrder` is not transactional, so a crash mid-way leaves a half-written
order. It is excluded from every result below.

## Q1. Gift product G (not otherwise bought)

Cart rule 2 `GIFT8`: `gift_product = 8`, no reduction. Cart: product 6 x1. Order **7**.

`ps_order_detail` (same over the webservice, `order_details` and `orders/7` `order_rows`):

| id_order_detail | product_id | qty | unit_price_tax_excl | unit_price_tax_incl | total_price_tax_incl | reduction_percent / amount |
|---|---|---|---|---|---|---|
| 10 | 6 | 1 | 11.900000 | 14.637000 | 14.640000 | 0 / 0 |
| 11 | **8** | **1** | **11.900000** | **14.637000** | **14.640000** | 0 / 0 |

`ps_order_cart_rule` / webservice `order_cart_rules/1`:

```xml
<id_order>7</id_order><id_cart_rule>2</id_cart_rule><name>probe GIFT8</name>
<value>14.637000</value><value_tax_excl>11.900000</value_tax_excl><free_shipping>0</free_shipping>
```

`ps_orders` 7: `total_products_wt 29.28`, `total_discounts_tax_incl 14.64`, `total_paid_tax_incl 14.63`.

**Answer:** the gift is its own `order_detail` row at **full catalogue price** and quantity 1; nothing on
the row says it is a gift. The giveaway is only the order-level cart rule (`value` = one gross unit price
of G). The only link between that discount and product 8 is `cart_rules/2.gift_product = 8`, read from
the cart rule itself (which an operator can edit or delete later). Stock of product 8 was decremented
like any sold line.

Rounding: rows minus discount = 29.28 - 14.64 = 14.64, but the order is 14.63.

## Q2. Gift product P, and the buyer also buys one P

Cart rule 3 `GIFT7`: `gift_product = 7`. Cart: product 7 x1. Order **8**.

| id_order_detail | product_id | qty | unit_price_tax_incl | total_price_tax_incl |
|---|---|---|---|---|
| 12 | 7 | **2** | 14.637000 | 29.270000 |

`order_cart_rules/2`: `value 14.637000`, `value_tax_excl 11.900000`. `ps_cart_product` for that cart also
holds one row, product 7, quantity 2. Order totals: `total_products_wt 29.27`, discount 14.64, paid 14.63.

**Answer:** **one merged row, quantity 2, at full price**; the free unit exists only as the order-level
cart-rule amount. From the order alone it is impossible to tell that one of the two units was free.

## Q3. 100% reduction on a specific product (no gift_product)

Cart rule 4 `FREE6`: `reduction_percent = 100`, `reduction_product = 6`. Cart: 6 x1 + 7 x1. Order **9**.

| id_order_detail | product_id | qty | unit_price_tax_incl | total_price_tax_incl | reduction_percent |
|---|---|---|---|---|---|
| 13 | 6 | 1 | 14.637000 | 14.640000 | 0.00 |
| 14 | 7 | 1 | 14.637000 | 14.640000 | 0.00 |

`order_cart_rules/3`: `value 14.640000`, `value_tax_excl 11.900000` (note 14.64, not 14.637 as for the
gift rules). Order totals: 29.28 / discount 14.64 / paid 14.63.

**Answer:** same shape as a gift - both rows at full price, the reduction only in `order_cart_rule`.
Product-specific cart-rule reductions are **not** written onto the row's `reduction_percent` /
`reduction_amount` (those are for catalogue specific prices). The rule's target product is only on the
cart rule (`reduction_product = 6`).

## Q4. Pack of two products with different tax rules

Created product 20 "Probe book 5pct" (10.00 net, group 2 = 5%, stock 100) and pack 21
"Probe pack mug+book" (`product_type = pack`, 20.00 net, group 1 = 23%, `pack_stock_type = 1`,
items: product 6 x1 + product 20 x1, own stock 10). Order **10**, pack x1.

`ps_order_detail` / `orders/10` `order_rows`:

| id_order_detail | product_id | product_name | qty | unit_price_tax_excl | unit_price_tax_incl | tax_rate | id_tax_rules_group |
|---|---|---|---|---|---|---|---|
| 15 | 21 | Probe pack mug+book | 1 | 20.000000 | 24.600000 | 23.000 | 1 |

`ps_order_detail_tax`: one row, `id_tax 1` (23%), `unit_amount 4.60`. Order: total 20.00 net / 24.60 gross.

- **One row for the pack**, taxed entirely at the **pack's own** rule (23%). The 5% component is not
  reflected anywhere: no split, no second tax row.
- The pack's items appear **nowhere** in the order: not in `order_detail`, not in the webservice
  `order_rows`, and not in `ps_stock_mvt` (it held only the two initial stock movements; no movement
  carries `id_order` for this order in the awaiting-payment state). The only table naming pack items is
  `ps_pack`.

Then the pack's composition was changed (`Pack::deleteItems(21)`, `Pack::addItem(21, 7, 2)`):

- `orders/10` `order_rows` re-read: **byte-identical** to before (`diff` clean). Still one row for
  product 21, no items.
- `products/21` now returns only the new composition:

```xml
<product_bundle nodeType="product" api="products">
  <product><id>7</id><id_product_attribute>0</id_product_attribute><quantity>2</quantity></product>
</product_bundle>
```

So the historical composition (6 + 20) of order 10 is **not recoverable** from PrestaShop afterwards:
reading the order's pack through the product gives today's contents. Also on `products/21`:
`<type>pack</type>`, `<product_type>pack</product_type>`, `<cache_is_pack>1</cache_is_pack>`,
`<pack_stock_type>1</pack_stock_type>`, `<quantity>0</quantity>` (the deprecated product-level field).

## Q5. pack_stock_type and a webservice write to the pack's stock row

Fresh packs, each: product 6 x1 + product 7 x2, price 18 net, own stock row set to 10.
"Sellable" = `Pack::getQuantity()` / `Product::getQuantity()`, which the shop uses.

**Type 1 (decrement products only), pack 22, stock row id 61**

| Step | p6 row | p7 row | pack row | Pack/Product::getQuantity |
|---|---|---|---|---|
| Before order | 296 | 297 | 10 | **148** |
| After order 11 (pack x1) | 295 | 295 | **10** (unchanged) | 147 |
| After webservice PUT row 61 quantity 3 | 295 | 295 | 3 | **147** |
| After webservice PUT row 61 quantity 0 | 295 | 295 | 0 | **147** |

The PUT (GET the full row, overlay `quantity`, PUT it back, which is what the OpenLinker adapter does)
answered 200 and wrote the pack row only. **Components did not change, and the pack's availability did
not change** - it is computed from components only (`min(295/1, 295/2) = 147`) and ignores the own row.
With the own row at 0 a cart still accepted 5 packs (`updateQty(5, 22) = true`,
`checkQuantities() = true`, `PS_ORDER_OUT_OF_STOCK = 0`, row `out_of_stock = 2`). So for a type-1 pack a
stock write to the pack row is accepted and has **no effect** on what the shop sells.

Also: after the order the pack row read `quantity 10, physical_quantity 11, reserved_quantity 1`; after
the PUT `quantity 3` but `physical_quantity` still 11. The PUT only writes `quantity`;
`physical_quantity` is not kept consistent.

The webservice read of the three rows after the PUT (`stock_availables?filter[id_product]=[6|7|22]`):
`6 -> 295`, `7 -> 295`, `61 (product 22) -> 3`.

**Type 0 (decrement pack only), pack 23, row 62**

| Step | p6 | p7 | pack row | getQuantity |
|---|---|---|---|---|
| Before | 295 | 295 | 10 | 10 |
| After order 12 | 295 | 295 | 9 | 9 |
| After PUT 3 | 295 | 295 | 3 | **3** |

Components untouched by the sale; availability = own row; the PUT takes effect.

**Type 2 (decrement both), pack 24, row 63**

| Step | p6 | p7 | pack row | getQuantity |
|---|---|---|---|---|
| Before | 295 | 295 | 10 | 10 |
| After order 13 | 294 | 293 | 9 | 9 |
| After PUT 3 | 294 | 293 | 3 | **3** |

Sale decrements the pack row and the components (x1, x2). Availability = min(own row, components); the
PUT lowers it, components unchanged by the PUT.

In no type did a PUT on the pack row propagate to the components. The shop default is
`PS_PACK_STOCK_TYPE = 0`, and the demo pack 15 uses type 3 ("use default").

## Q6. Gift wrapping

Set `PS_GIFT_WRAPPING = 1`, `PS_GIFT_WRAPPING_PRICE = 2`, `PS_GIFT_WRAPPING_TAX_RULES_GROUP = 1`; cart
`gift = 1`, `gift_message = 'probe gift message'`; product 6 x1. Order **14**.

```xml
<recyclable>0</recyclable>
<gift>1</gift>
<gift_message>probe gift message</gift_message>
<total_paid_tax_incl>17.100000</total_paid_tax_incl>
<total_products_wt>14.640000</total_products_wt>
<total_wrapping>2.460000</total_wrapping>
<total_wrapping_tax_incl>2.460000</total_wrapping_tax_incl>
<total_wrapping_tax_excl>2.000000</total_wrapping_tax_excl>
```

`order_detail`: one row, product 6. **`orders.gift` means "gift-wrap this order"** (the checkout
gift-wrapping box): a flag plus a free-text message and a paid wrapping amount at order level. It has
nothing to do with free products and does not create a line.

## Surprises

1. A free product is indistinguishable from a sold one on the order: full price on the row, the discount
   only at order level. When the gift is the same product the buyer bought, the two units merge into one
   row (Q2).
2. `order_cart_rule.value` differs by rule type: 14.637 (gift rules) vs 14.640 (percentage rule), and in
   Q1 and Q3 the rows minus the discount (14.64) do not equal `total_paid_tax_incl` (14.63).
3. Packs: one row taxed at the pack's own rate whatever the components' rates; components never appear on
   the order; changing the pack rewrites history as seen through `products/{id}`.
4. Type-1 packs: writing the pack's `stock_availables` row is accepted (200) but changes nothing the shop
   sells - not even 0 stops the pack being added to a cart.
5. Installing with `PS_COUNTRY=PL` left the shop with no taxes at all.
6. `validateOrder` is not atomic: a crash left order 6 with lines but no cart-rule row and state 0.

## Files

Scripts are in the session scratchpad only (`ps-probe/`: `boot.php`, `setup.php`, `ws-setup.php`,
`s123.php`, `s45.php`, `s6.php`, `sell.php`, `q.sh`, `ws.sh`, `docker-compose.yml`), not in the
repository. The containers, network and volumes were removed with `docker compose down -v`.
