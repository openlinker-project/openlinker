# Use-case catalogue v2 (run 2, built only from run-2 problem research)
Same IDs as v1 where the meaning is the same; new IDs are marked NEW.

## Bundles (B)
B-01 Define a bundle (components + quantities).
B-02 Bundle availability = min over components, published at once; a component shared by several bundles and sold alone.
B-03 Pre-built kit with its own stock vs virtual bundle.
B-04 Order arrives as PARENT ONLY (PrestaShop pack, Allegro productSet offer, Erli/Amazon/Kaufland own SKU) -> expand.
B-05 Order arrives as PARENT + CHILDREN (WooCommerce bundle plugins, Shoper) -> no double counting.
B-06 Order arrives as CHILDREN ONLY, grouped (Shopify lineItemGroup, IdoSell bundleId).
B-07 Offer bundles = N lines with a proportional discount (Allegro flexible bundles, also auto-created by the marketplace).
B-08 Multipack: one offer = N units of one product (Allegro productSet quantity N; replaces MULTIPACK promotion from 2027-01-12).
B-09 Bundle with buyer choice of variant per slot.
B-10 Contents snapshot at order time (PrestaShop does not freeze pack contents).
B-11 Pack bench: show bundle and components, scan each, packing slip shows both.
B-12 Component out of stock: hold / substitute / split / back-order.
B-13 Components in different warehouses.
B-14 Documents: one line vs components; mixed VAT split by component reference prices (DE BFH 2025: by individual selling prices, never above a component's own price).
B-15 Return of one component: refund incl. lost bundle discount, restock that component.
B-16 Bundle cost/margin = sum of component costs.
B-17 Publish an OMS-defined bundle as a listing.
B-18 Import bundle definitions from master/shop/ERP (PrestaShop pack, Shoper/IdoSell sets, Erli productSets, Subiekt komplety).
B-19 NEW Which line carries price and VAT (parent or children) varies per channel/plugin.
B-20 NEW Master already decrements components itself on a pack sale (avoid double decrement).
B-21 NEW Split shipment of one bundle across parcels and how the channel is told "shipped".

## Gifts (G)
G-01 Gift FLAGGED by the channel (IdoSell, Woo plugin meta, Mirakl FREE_ITEMS offered_quantity).
G-02 Gift UNFLAGGED: 0.00 / 0.01 line or full price + 100% discount (Shopify, eBay, Amazon promotions).
G-03 Gift folded into a paid line (PrestaShop cart rule merged row at full price + order-level discount; Allegro multipack 0.01; Amazon BOGO).
G-04 Gift promised only in the listing description, not in the order -> must be added in the OMS.
G-05 Operator adds a gift to an order/parcel (proof it shipped).
G-06 Rule adds a gift (threshold, SKU in basket, channel, campaign dates, once per order).
G-07 Gift as a bundle component.
G-08 Gift runs out mid-promotion: stop / swap to declared substitute / skip with notice (never silent).
G-09 Gift visible on pack bench and packing slip.
G-10 Gift on receipt/invoice (list price + line rebate; zero-VAT-bucket refusal; typed reason discount-in-goods vs gift, per country policy).
G-11 Gift and returns (threshold lost on partial return; gift must come back on withdrawal).
G-12 Gift reporting (cost of gifts, who received what; national small-gift records).
G-13 Buyer chooses the gift.
G-14 Gift wrap / "is a gift" order (not a free item).
G-15 NEW Per-customer gift limit that survives repeat orders / changed email.

## Cross-cutting (X)
X-01 Each channel encodes discounts differently -> one neutral list price + reduction on the line.
X-02 Kaufland one unit per order_unit -> merge.
X-03 NEW Per-integration settings: how the OMS lets the operator or the integration say "this channel sends children / prices on parent / gift flag field".
