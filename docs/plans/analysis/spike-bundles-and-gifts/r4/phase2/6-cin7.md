# R4 phase 2 - Competitor: Cin7 Core and Cin7 Omni (primary sources only)

Date: 2026-11-04. Method: official help centres read through the public Zendesk JSON API
(`https://help.core.cin7.com/api/v2/help_center/en-us/articles/{id}.json`,
`https://help.omni.cin7.com/api/v2/help_center/en-us/articles/{id}.json`). All quotes below are verbatim from
those official articles (primary source: vendor's own product documentation; articles carry `updated_at`
2026-11-03). No blogs, forums or third-party material used. No live account was used, so nothing below is
a live test. The Core "Bill Of Materials endpoint" and "Sale GET/POST" articles are Cin7's own API reference
(primary). The Omni API was not inspected beyond one statement in the promotions article.

Two different products:
- **Cin7 Core** (ex DEAR Inventory): Assembly BOM + `Auto-assembly` checkbox, Product Deals, per-integration
  `Process auto-assembly as`, `Add a discount as`.
- **Cin7 Omni**: BOM Master (`Make` / `Addon`), product Order Type `Kit` / `Made to Order`, Virtual stock,
  per-integration `Automatically Load BOMs for Kits`, promotional matrix.

Where the two differ, the row says which.

## Source index (all primary, official vendor help centre)
| # | Title | URL |
|---|---|---|
| C1 | Bill of materials (Core) | https://help.core.cin7.com/hc/en-us/articles/9034450446479 |
| C2 | Bill of materials (assembly) (Core) | https://help.core.cin7.com/hc/en-us/articles/9034480629647 |
| C3 | Auto-assembly (Core) | https://help.core.cin7.com/hc/en-us/articles/11952177561743 |
| C4 | Picking for kitting (Core) | https://help.core.cin7.com/hc/en-us/articles/10848200365711 |
| C5 | Multi-level Assembly (Core) | https://help.core.cin7.com/hc/en-us/articles/9034476129295 |
| C6 | Out of Stock Components for Auto-Assembly Report (Core) | https://help.core.cin7.com/hc/en-us/articles/9034518480527 |
| C7 | Product Deals (Core) | https://help.core.cin7.com/hc/en-us/articles/9034519918095 |
| C8 | Discounts (Core) | https://help.core.cin7.com/hc/en-us/articles/9034464989327 |
| C9 | Shopify settings (Core) | https://help.core.cin7.com/hc/en-us/articles/11797034961039 |
| C10 | Download orders from Shopify (Core) | https://help.core.cin7.com/hc/en-us/articles/11796986460431 |
| C11 | Shopify Integration FAQs (Core) | https://help.core.cin7.com/hc/en-us/articles/9034569866639 |
| C12 | Duplicate SKUs in Shopify (Core) | https://help.core.cin7.com/hc/en-us/articles/9034481333775 |
| C13 | Bill Of Materials endpoint (Core API) | https://help.core.cin7.com/hc/en-us/articles/9034480650127 |
| C14 | Sale POST (Core API) | https://help.core.cin7.com/hc/en-us/articles/9034512161423 |
| C15 | Sale GET (Core API) | https://help.core.cin7.com/hc/en-us/articles/9034512071951 |
| C16 | Sale process customization (Core) | https://help.core.cin7.com/hc/en-us/articles/11073350145935 |
| C17 | Backorders and Split Orders (Core) | https://help.core.cin7.com/hc/en-us/articles/9034480522511 |
| C18 | Pick items for a sale (Core) | https://help.core.cin7.com/hc/en-us/articles/10848183141519 |
| C19 | Phantom BOM (Core) | https://help.core.cin7.com/hc/en-us/articles/9034491863567 |
| C20 | Disassembly (Core) | https://help.core.cin7.com/hc/en-us/articles/9034497989135 |
| C21 | Magento 2.0 product catalog (Core) | https://help.core.cin7.com/hc/en-us/articles/13318763015567 |
| C22 | Magento 2.0 customers, sales, refunds (Core) | https://help.core.cin7.com/hc/en-us/articles/17129809392655 |
| C23 | Amazon integration (Core) | https://help.core.cin7.com/hc/en-us/articles/9034459874703 |
| C24 | Specify alternative products (Core) | https://help.core.cin7.com/hc/en-us/articles/9034587409935 |
| C25 | WooCommerce Integration FAQs (Core) | https://help.core.cin7.com/hc/en-us/articles/9034588353295 |
| O1 | Create a bill of materials (BOM) (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9052640971791 |
| O2 | Virtual stock with BOM (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9052704682511 |
| O3 | Shopify settings (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9128597367439 |
| O4 | WooCommerce settings (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9128599574031 |
| O5 | Amazon Seller settings (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9128540257167 |
| O6 | Magento 2 settings (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9128568343823 |
| O7 | Order settings, B2B store (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9052718288527 |
| O8 | Promotions overview (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9052674054799 |
| O9 | Customize document templates (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9052641487247 |
| O10 | ShipStation settings (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9128597282831 |
| O11 | Download sales orders from Shopify (Omni) | https://help.omni.cin7.com/hc/en-us/articles/9128559368847 |

## Ratings

### Bundles (B)

**B-01 Define a bundle - Full (both).**
Core: Inventory > Products > `Bill of materials` dropdown = `Assembly BOM` -> `Bill of materials` tab, add components with `Quantity`, `Wastage %`, `Disassembly cost %`, `Labor and overheads`. C2: "Assembly BOM is intended to be used for simple assembly operations such as joining together multiple items in a pack or kit". Also CSV import/export and API (`PUT /BillOfMaterials`, C13: "you always need to supply the full BOM for each product, otherwise if some BOM line is not provided then these BOM components will be deleted").
Omni: Products > Custom Links > `BOM` -> `BOM Master`, type `Make` or `Addon`. O1: "A bill of materials (BOM) lists the items that create a product. A BOM is like a recipe."
Limit: components must exist as products first (C2: "You must have already created the component products before they can be added to an assembly BOM."). Cycles refused (C20: "If Product A is listed as a component of Product B, Product B cannot be listed as a component of Product A.").

**B-02 Availability = min over components, published - Full (both), with stated exceptions.**
Core C3: "With auto-assembly, you keep only the component products in stock... Stock availability for the finished product is calculated as what could be assembled from available components." C11: "When auto-assembly is enabled, stock levels pushed to Shopify accurately reflect how many assemblies can be assembled from the number of components as well as available assembled units."
Omni O2: "For each component, Cin7 Omni calculates the Stock Available (in the same branch) divided by the Qty in the bill of materials. The lowest result of these calculations equals the virtual stock." and "Virtual stock can be pushed to your ecommerce and marketplace integrations".
Shared component sold alone: C3: "you can see that both the components on hand, and the assembled product available."
Exceptions: C11 (Advanced Manufacturing): "stock levels of finished products that could be produced from available components will not be pushed to Shopify." C11 (batch + auto-assembly): "it is not possible to change a line of the order without undoing the sale and voiding all the related auto-assemblies... Users in this situation generally disable this setting and update stock levels manually." O2: the OTS view "does not need the components to be in the same branch", all other calculations do, so the operator can see two different numbers.

**B-03 Pre-built kit vs virtual - Full (both).**
Core: manual assembly (stocked finished good) vs `Auto-assembly` (C3: "Manual assembly keeps components in your inventory until you create an assembly order"); hybrid "Picking for kitting" (C4: "If the assembled item is in stock, WMS will direct picker to pick the assembled product... If there are not enough units... the system will split the remaining items into their components."). Omni: Order Type `Kit` / `Made to Order` (O2) vs production job.

**B-04 Order arrives as parent only -> expand - Full (both, via catalogue mapping).**
Core: the channel SKU maps to a Cin7 product with Assembly BOM + Auto-assembly; authorizing the sale creates the assembly order. C3: "When a sale for an auto-assembled product comes in, this triggers an assembly order for the finished product." Applies to channel orders (C3 "This can also be a sale order from an e-commerce channel"; C23 "Dropshipping, Kitting and other important scenarios are implemented in the same way as the Cin7 Core UI").
Omni: per integration `Automatically Load BOMs for Kits` = Yes. O3: "The line item's BOM will expand; each component of the finished product will be shown as a separate line item... Only products with the Order Type of Kit will have their BOMs load." B2B store O7: "Expand BOMs on order download".

**B-05 Parent + children -> no double counting - Unknown.**
No primary statement on de-duplicating plugin parent+child lines. The only hint: C22 (Magento) maps "Items including prices, taxes, quantities respecting type of Magento2 order: Bundle, family, Configurable and so on" - this says Magento bundle orders are read, not how parent/child lines are counted.

**B-06 Children only, grouped - Unknown.** No mention of Shopify `lineItemGroup` or any grouping id in Core or Omni order-download articles (C10, O11).

**B-07 Offer bundles = N lines with proportional discount - Unknown.** No primary source.

**B-08 Multipack - Partial.**
No marketplace-multipack concept, but two mechanisms do the stock maths: Additional units of measure (C19: "Adding additional units of measure to an SKU enables auto-assembly/disassembly automatically."; C20 recommends it for "Single Wine Bottle, 6-pack, 12-pack") and a 1-component BOM with quantity N (C13 `AutoAssembly` "Can be used to implement unit conversion.").

**B-09 Buyer chooses variant per slot - Partial (Core, manufacturing only).**
C1: "Make-to-order BOM... allows your customers to select different configuration options... This BOM requires Advanced Manufacturing module subscription." Not described for channel-imported bundle orders.

**B-10 Contents snapshot at order time - Partial.**
Core: auto-assembly produces an assembly order per sale (record of what was consumed), but its contents cannot be edited: C2 "For auto-assembled products, it is not possible to change the BOM components during assembly." Re-authorisation re-runs it (C3 "If you undo and reauthorize a sale, auto-assembly date uses the new sale authorization date."). Omni: the BOM is copied into the order and is editable - O1: "Select Make New BOM from Master BOM. The products that make the finished product will appear. You can then edit the BOM". Whether a later BOM edit changes open orders: no primary source.

**B-11 Pack bench shows bundle + components - Partial.**
Core: C18 "Use the Expanded pick list to pick components for items with a bill of materials."; WMS kitting pick (C4). Omni document template switch (O9): "Hide all BOM components - Hides BOM components if you have expanded BOMs in your transaction." 3PL/shipper choice (O10): "Set Include BOM 'Use' Items to Yes and the components in an expanded bill of material (BOM) will each become an item in the order in ShipStation; otherwise... only the finished BOM product". Scan-each-component on a pack screen: no primary source.

**B-12 Component out of stock - Partial.**
Core: no partial kit (C3 "Auto-assembly will never create a partial assembly."); backorder components + report (C6: "The trigger for adding components to the report is a sale order authorization where auto-assembly failed due to out-of-stock components."); retry is manual (C3: "Undo the sale order, then Authorize the sale order again."). Split: C16 `Split auto-assembly products in sale orders` "Enable this setting to create partial assembly orders when you split a sale order." Substitution: Alternative products exist for sale lines and production (C24 "can be substituted during a sale or during production if the original product is out of stock") - not documented for auto-assembly components (it is explicitly not editable, C2).

**B-13 Components in different warehouses - None (explicitly not supported).**
C3: "Auto-assembly limits picking to the same location of the sale, regardless of your pick settings." O2: "All other virtual stock calculations require all components to be in the same branch location."

**B-14 Documents: one line vs components; mixed VAT split - Partial (display only), VAT split None/Unknown.**
Omni can hide expanded components on documents (O9, above). No primary source on allocating price or tax across components; the BOM has only a cost split (`Disassembly cost %`, C2: "Indicates what percentage cost each component product makes up of the parent product.") - a cost split, not a revenue/VAT split.

**B-15 Return of one component - Unknown.** Credit-note articles (C15 SaleCreditNote `Restock` list) allow restocking any SKU, but nothing says how a kit return maps to components or to lost bundle discount.

**B-16 Bundle cost/margin - Full (Core).**
C2: "The actual cost of finished goods will be calculated using the costing method of each individual component and can vary from 'Total' cost displayed in the BOM. Actual costs associated with finished goods can be seen using the Finished Goods Analysis Report". Labour/overhead lines included. Omni O1: "BOM Master shows the average cost of each product."

**B-17 Publish an OMS bundle as a listing - Partial.**
Listed as a simple product with derived stock (B-02). Core/Magento: C21 "Cin7 Core products can only be synced as a simple product (not a bundle) in Magento even if it has a bill of material in Cin7 Core."

**B-18 Import bundle definitions - Partial.**
CSV and API import of BOMs (C2, C13; Omni "Import bill of materials (BOM)"). Importing bundle definitions from a shop/channel: no primary source.

**B-19 Which line carries price/VAT varies per channel - Unknown.**

**B-20 Master already decrements components - Unknown / not applicable.** Cin7 is itself the stock master; no article covers a downstream system that also decrements. Nearest: C25 (Woo) "They are linked by auto-assembly for stock calculations... make sure to first remove the bill of materials and auto-assembly from the WooCommerce SKUs."

**B-21 Split shipment of one bundle - Unknown.** Omni expanded kits are dispatched per component (O3 "you must dispatch each component separately"), but how the channel is told "shipped" for a partially dispatched kit is not documented. Core split setting (C16) is about partial kit quantity, not one kit in several parcels.

### Gifts (G)

**G-01 Gift flagged by channel - Unknown.** No primary source on reading gift flags from any channel.

**G-02 Gift unflagged (0.00 / 100% discount) - Partial.**
A line with 100% discount is the documented "free item" shape: C14/C15 field `Discount` "Value between 0 and 100. For free items discount is 100." Shopify discounts arrive as line price reductions or as additional-charge lines (C10). Nothing types the line as a gift.

**G-03 Gift folded into a paid line - Unknown.**

**G-04 Gift promised in listing only - Unknown.** Product Deals auto-apply on authorisation (C7: "if the Automatically Apply Discounts setting is set to Yes, any applicable product discounts will be added automatically when the sale quote or sale order is authorized"), but no article shows a deal adding a free item to a channel-imported order; C10 says for Shopify "Cin7 Core does not perform any discount calculations, it simply captures the discount amount".

**G-05 Operator adds a gift - Partial.**
Core: add a line, `Discount` 100 (C14). Omni O8: "we cannot set 100% discounts using the promotional matrix. The maximum discount you can assign in a promotional matrix is 99.9999%. However you can set a 100% discount at a sales order level."

**G-06 Rule adds a gift - Partial (Core, own sales/B2B), None for Omni sales orders.**
Core C7 "Example 2: Free gift - a fixed free item (a book) is given to the customer when the customer buys 3 items from the same category"; options: dates (`Effective From/To`), customers/tags, coupons. Scope limits: "Free Shipping discounts and deals are only applicable to B2B orders and orders from Cin7 Core, it is not applied to orders captured from eCommerce channels such as Shopify." (stated for free shipping; for product deals on channel orders: no primary source). Omni O8: "Buy X get X free (for example, buy 2 get 1 free) promotions can not be used with Sales Orders or Legacy B2B." and "You cannot use promotions with the Cin7 Omni API."

**G-07 Gift as bundle component - Partial (implicit).** Any product can be a BOM component; there is no "free component" flag. No primary source on pricing a free component.

**G-08 Gift runs out mid-promotion - Unknown.**

**G-09 Gift visible on pack bench/slip - Unknown.**

**G-10 Gift on receipt/invoice (list price + rebate) - Partial.**
The 100%-discount line keeps list price + discount (C14 `Total = ROUNDUP(ROUNDUP(Price (100 - Discount)/100, 4)Quantity, 2)`); display setting C8: "Updating the sale price will cause discounts to automatically reduce the unit cost and sale price. Updating discount % will display the total percentage discount of the order line." Zero-VAT-bucket / typed reason: no primary source. Related: C11 "We don't create zero cost lines in Cin7 Core because Xero will reject whole invoices with zero costs" (shipping context).

**G-11 Gift and returns - Unknown.**

**G-12 Gift reporting - Unknown (coupon usage only).** C7: "You can use the Report tab to see which coupon codes have been used by your customers."

**G-13 Buyer chooses the gift - Unknown.**

**G-14 Gift wrap / gift order - Partial.**
C23 (Amazon): "Shipping, gift wrapping and discounts are also saved as additional charges in the sales invoice." C22 (Magento) maps `ExtensionAttributes.GiftMessage.Message` into the sale. Omni has POS "Print a gift receipt" (title only seen; not read in full).

**G-15 Per-customer gift limit surviving repeat orders - Partial.**
C7: "Coupons allow you to limit a discount or deal to a certain quantity per customer"; "Single Coupon Code Usage... the coupon can only be used once." Limit tied to a coupon code, not to a customer identity across emails.

**G-16 Failed gift rule has visible status - Unknown for gifts.** The kit analogue exists (C6 report of failed auto-assemblies), not for promotions.

### Cross-cutting (X)

**X-01 Neutral list price + reduction per line - Partial (Core Shopify).**
C9 `Add a discount as`: "Add discounts as price reduction to order lines or as additional charges." C10: "Discounts applied to the entire order will be proportionally applied to the order lines as a price reduction on each line." and for additional charges "Discounts applied to the order are applied proportionally to each order line, with an additional charge created for each line, showing the order line's tax rule. This ensures that discount tax is correctly calculated for your accounting records and in the event of a refund." Amazon: order-level discounts as additional charges (C23). Omni Shopify: header-level `Discount (description and value)` (O11).

**X-02 Kaufland one unit per order_unit - Unknown.**

**X-03 Per-integration settings - Partial (good coverage of stock side).**
Core, on each integration's Setup page: `Process auto-assembly as` (C3 "You can find the Process auto-assembly as setting on the Setup page of each integration"), `Add a discount as`, `Bring discount codes from Shopify`, `Import duplicate SKUs from Shopify` (C9). Omni: `Automatically Load BOMs for Kits` on Shopify/Woo/Magento/eBay/Amazon (O3-O6), `Expand BOMs on order download` (O7), ShipStation `Include BOM 'Use' Items` (O10). Amazon FBA exclusion (O5): "the 'Automatically Load BOMs...' setting ignores the Amazon Fulfilled Orders (FBA)". Nothing declares "channel sends children" or "price on parent".

**X-04 Line added after order exists - Partial.**
Core: undo + re-authorise re-runs auto-assembly (C3). Omni O8: "If you decrease the quantity of an item in the order, all discounts are removed and will need to be reapplied." Core C8 adding discount after invoice -> credit note route ("see Customer Credit Notes and Refunds - Discount applied to Order").

**X-05 Non-goods lines - Partial.**
Gift cards to a liability account (C9: "Sale orders containing gift certificates will stay in Pending orders without processing until a gift card liability account is mapped here."); duties as additional charges (C10); service / non-inventory products; Omni `Non Stock` products. Points / deposit: Unknown.

**X-06 Promotion audit trail per line - Partial.**
Discount code names kept as additional-charge description with the SKU as comment (C10: "the additional charge Description is Discount OFFER10. The additional charge Comment is the discounted product SKU, AA00."); deal % written to memo fields (C7: "Discount percentage will be displayed in the quote memo, sale order memo, and sale invoice memo fields"). Before/after values per line and "who applied": no primary source.

## Integration normalisation (how Cin7 deals with each channel encoding things differently)
- **Catalogue linking is the bundle mechanism.** A channel listing is mapped to one Cin7 product; if that product has a BOM (Core: `Auto-assembly` on; Omni: Order Type `Kit`), the kit logic runs on the Cin7 side. The channel's own bundle structure is not read in any documented way (B-05/B-06 Unknown); Magento bundles cannot be published (C21).
- **Per-integration Setup switches**, repeated on Shopify, WooCommerce, BigCommerce, eBay, Amazon, Magento, ShipStation (Core: `Process auto-assembly as` with `For ordered quantity` / `For minimum quantity required for picking`; Omni: `Automatically Load BOMs for Kits` Yes/No). The decision "expand or not" is per connection, not per order.
- **Channel-specific exclusions are encoded in the connector**: Omni Amazon BOM expansion skips FBA orders (O5).
- **Alias kits for channel identity problems**: Core creates hidden `KitProduct`s (SKU = Shopify VariantID) with a 1-component BOM to the real product so several Shopify listings with one SKU share stock (C12: "KitProducts are flagged as Not for Sale, so it will be auto-assembled from MainProduct").
- **Discounts are captured, never recomputed** for channel orders (C10: "Cin7 Core does not perform any discount calculations, it simply captures the discount amount from Shopify"); operator picks line price reduction vs additional-charge lines per connection; order-level discounts are spread proportionally to lines with the line's tax rule.
- **Taxes are mapped, not recalculated**, per connection (Woo: actual tax amount kept, tax names mapped to Cin7 tax rules; "Orders will be skipped on download if tax rules are not mapped.").
- **Downstream (3PL/shipper) shape is a separate setting**: ShipStation gets components or finished good (O10).

## UX patterns worth copying
1. Per-connection dropdown for kit handling with plain-language outcome per option (`Process auto-assembly as`; `Automatically Load BOMs for Kits` with "No: ... Existing units of the finished product can be dispatched. Yes: ... each component... shown as a separate line item").
2. Availability formula stated in the UI docs and shown as a column (`Virtual Stock` column; min(stock/qty) worked example in O2) - operator can audit the published number.
3. A dedicated queue/report for kits that could not be built (C6 "Out of Stock Components for Auto-Assembly Report": location, kit SKU, component SKU, allocated, needed) - failure is visible, not silent.
4. Separate choices for "how the order stores it" and "how documents/3PL show it" (`Hide all BOM components` on templates; ShipStation `Include BOM 'Use' Items`).
5. Discount import mode per connection with proportional allocation and per-line tax kept for refunds (C10).
6. Prefer pre-built kit stock, fall back to components at pick time (C4 picking for kitting).

## Anti-patterns
1. Retry by "undo and re-authorise the sale" after components arrive (C3) - manual, and with batches it voids assemblies (C11).
2. Hard same-location restriction for kits (C3, O2) with a second view that ignores it (O2 OTS view) - two numbers for one kit.
3. Free item = plain `Discount 100` on a line; no gift/promo type, no reason (C14). Omni matrix cannot even do 100% (O8).
4. Promotion engines do not apply to channel orders (Omni Buy-X-get-free not on Sales Orders, no promotions via API, O8; Core free shipping excluded for eCommerce, C7) - gift rules only work in own sales channels.
5. Lowering quantity silently drops all discounts (O8 "all discounts are removed and will need to be reapplied").

## New use cases (not in catalogue v3)
- **N-1 Assemble-ahead policy on sale**: kit build quantity = order qty / order qty + keep minimum / shortfall only (C16 `On order authorization auto-assemble`).
- **N-2 Alias kit**: several channel listings that are the same physical item mapped via a 1-component kit to one stock record (C12).
- **N-3 Unit-of-measure kit**: case -> singles auto-disassembly on goods receipt (C19 Additional units of measure).
- **N-4 Multi-level kits with per-level build mode** changing what is picked (sub-kit as stock vs exploded) (C5).
- **N-5 Fulfilment-channel exclusion**: marketplace-fulfilled orders (FBA) must not expand/decrement kit components (O5).
- **N-6 Downstream shape per 3PL/shipper**: send kit as one item or as components (O10).
- **N-7 Kit cost split for disassembly** (`Disassembly cost %`) when a returned/opened kit is broken back into components (C2, C20).

## Confidence
- High: B-01/02/03/04/13/16, X-01, X-03 (multiple consistent official articles, both products).
- Low: everything rated Unknown - absence of a help article is not proof the feature is missing; no live tenant checked.
- Note: Omni "Kit" vs "Made to Order" semantics beyond BOM expansion and virtual stock were not found in a primary source.
