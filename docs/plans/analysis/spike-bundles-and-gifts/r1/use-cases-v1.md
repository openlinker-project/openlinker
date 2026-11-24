# Use-case catalogue v1 (after phase 1: channels + merchant voice)

Sources: phase1/1-allegro.md, 2-own-shops.md, 3-pl-saas-shops.md, 4-other-marketplaces.md, 5-merchant-voice.md

## Bundles / kits (B)
B-01 Define a bundle (components + quantities) in the OMS.
B-02 Bundle availability = min over components, re-published to all channels at once; a component is shared by several bundles AND sold on its own (top merchant pain: oversell / phantom out-of-stock).
B-03 Pre-built kit with its own stock (sealed gift box; PrestaShop "pack only") vs virtual bundle assembled at packing.
B-04 Order arrives as PARENT ONLY (PrestaShop pack, Allegro productSet offer, Erli/Amazon/Kaufland own-SKU set, Sky-Shop) -> OMS must expand to components.
B-05 Order arrives as PARENT + CHILDREN (Shoper children[], WooCommerce bundle plugins container + 0-price children) -> must not double-count stock/picking.
B-06 Order arrives as CHILDREN ONLY, grouped (Shopify lineItemGroup, IdoSell bundleId rows) -> recognise the group.
B-07 "Offer bundle" = N separate lines with a proportional discount (Allegro zestaw ofert / flexible / cross-multipack, also auto-created by Allegro) -> discount group, not a kit.
B-08 Multipack: one offer = N units of one product (Allegro "wielopak") -> quantity multiplier.
B-09 Bundle with buyer choice (size/colour per slot: Allegro flexible, IdoSell, Woo configurable) -> contents differ per order.
B-10 Contents snapshot at order time (definition may change later).
B-11 Pack bench: show bundle AND its components, scan components, packing slip shows both.
B-12 Component out of stock: hold / substitute / split shipment / partial fulfil.
B-13 Components in different warehouses (routing).
B-14 Documents: bundle as one line vs per-component lines; mixed VAT rates need a reproducible price/discount split.
B-15 Return of one component: refund amount incl. lost bundle discount, restock that component, correction invoice.
B-16 Bundle cost/margin = sum of component costs.
B-17 Publish an OMS-defined bundle as a listing/offer on channels.
B-18 Import bundle definitions from the master/shop (PrestaShop pack, Shoper/IdoSell sets, Subiekt komplety) - D3 currently says no.

## Gifts (G)
G-01 Gift arrives FLAGGED by the channel (IdoSell orderSalesMode=gift, Woo free-gift plugin meta).
G-02 Gift arrives UNFLAGGED: 0.00 / 0.01 line, or full price + 100% discount (Shopify allocation, Amazon PromotionDiscount, Mirakl offered_quantity, Erli rebate).
G-03 Gift folded into a paid line's quantity (Allegro multipack 0.01, PrestaShop cart rule merged row, Amazon BOGO same ASIN).
G-04 Gift promised in the listing description, NOT in the order (dominant on Allegro) -> must be added in the OMS.
G-05 Operator adds a gift to an order/parcel (proof it shipped).
G-06 Rule adds a gift automatically (cart threshold, SKU in basket, channel, while stocks last, per-customer limit, repeat or once).
G-07 Gift as a bundle component.
G-08 Gift stock: reserve + decrement; gift runs out -> stop / swap / skip, never silently drop.
G-09 Gift visible on pack bench + packing slip, scanned.
G-10 Gift on receipt/invoice: list price + 100% line rebate; a VAT-rate bucket summing to 0 is refused by e-receipt hubs; 0.01 kept as is.
G-11 Gift and returns: partial return drops below threshold; withdrawal vs complaint.
G-12 Gift reporting: total gift cost, who got what (PL small-gift limit 100 zl/customer/year with records), promotion ROI.
G-13 Buyer chooses the gift (Shoper app, IdoSell threshold gifts).
G-14 Gift wrapping / "is a gift" order (Allegro GIFT_WRAP service, Amazon IsGift, PrestaShop orders.gift) - NOT a free item, but must reach the packer.

## Cross-cutting (X)
X-01 Each channel encodes discounts differently (before/after price, discount value, free quantity, type-only) -> one neutral "list price + discount" on the order line.
X-02 Kaufland sends N units as N order units -> merge for bench/documents.
