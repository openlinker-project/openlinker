# Research: Brightpearl (Sage) - bundles and free items / gifts

Researcher 8 of 8, solution phase. Date: 2026-11-04.

## Method note (read first)
help.brightpearl.com now redirects every article to a Salesforce login (`/s/login?...startURL=...`, HTTP 401 on the old `/hc/en-us/articles/...` URLs; the `/s/article/...` portal renders "Sorry to interrupt / CSS Error" without JS). All help-centre quotes below therefore come from **Wayback Machine snapshots (2019-2023)** of the public Zendesk-era articles. The behaviour may have moved since; I mark the snapshot date per source. The public API docs (api-docs.brightpearl.com) are still live and were read directly. Nothing below comes from a live account. No sign-up, no contact.

## Sources consulted
| # | Source | Snapshot | What it gave |
|---|---|---|---|
| S1 | Bundles on Sales Orders and Goods Out Notes - https://help.brightpearl.com/hc/en-us/articles/212789843 (Wayback 2019-07-21) | 2019-04 | explode-on-save, price only on bundle, fixed contents, print settings |
| S2 | Bundles, Assemblies, Packages & Customization - .../212789563 (Wayback 2019-12-09) | 2019-05 | bundles not assembled; assemblies have no BOM |
| S3 | Bundles in WMS - .../360028908311 (Wayback 2022-05-20) | 2022-02 | picking = components only; packing setting; bundle barcode; validation |
| S4 | Bundles with Amazon - .../211129046 (Wayback 2021-10-25) | 2018-12 | availability = lowest component, order download, split shipment behaviour |
| S5 | Using bundles with eBay - .../212646643 (Wayback 2022-12-08) | 2022-10 | "theoretical quantity", opt-in sync per account |
| S6 | Shopify products - .../360020598831 (Wayback 2022-11-26) | 2022 | complete bundles per warehouse only; no split shipment; no nesting |
| S7 | Importing products: creating bundles - .../360028467432 (Wayback 2021-07-23) | 2021-07 | "Bundle SKUs" column `SKU:qty,SKU:qty` |
| S8 | Bundles in Demand Planner - .../360003024297 (Wayback 2022-08-10) | 2021-08 | component replenishment includes bundle demand; pack-of-5 example |
| S9 | Catalog (Demand Planner) - .../360012031558 (Wayback 2022-06-30) | 2021-08 | produced vs non-produced bundles, "Convert Variant To Bundle" |
| S10 | Creating and editing products - .../211131066 (Wayback 2019-07-21) | 2019 | Bundles tab, "Add up to 40 different SKUs to a bundle" |
| S11 | Bundles on purchase orders - .../212789683 (Wayback 2021-09-19) | 2021-08 | parent 0 price on PO, components carry cost; CSS to hide parent/components |
| S12 | Brightpearl Automation actions overview - .../115001786563 (Wayback 2022-08-14) | 2022-08 | "Add free SKU" action |
| S13 | Brightpearl Automation conditions overview - .../115001827586 (Wayback 2023-01-28) | 2022-05 | full condition list |
| S14 | Release notes for Automation - .../115003751586 (Wayback 2022-08-14) | 2022-05 | June 2019 "Add a free SKU", always 0 cost, before fulfilment |
| S15 | Triggers in Automation (Beta) - .../360007832958 (Wayback 2020-10-23) | 2020-05 | watch list, triggers |
| S16 | Coupons - .../360028382592 (Wayback 2023-02-02) | 2021-10 | channel orders carry paid price only; coupon line |
| S17 | Accounting for sales and sales credits - .../210358086 (Wayback 2022-09-29) | - | discount types and account codes |
| S18 | Sales orders field descriptions - .../212648263 (Wayback 2023-01-28) | - | List Price / Discount % columns, irreversible setting |
| S19 | Adding sales orders - .../211131466 (Wayback 2021-09-26) | - | misc row (negative discount), zero-price clone |
| S20 | Handling returns - .../212648483 (Wayback 2020-11-29) | - | clone SO lines to Sales Credit |
| S21 | Shopify refunds, returns and cancellations - .../360003894411 (Wayback 2022-12-09) | - | auto sales credit, quarantine |
| S22 | Percentage line discounts and price breaks in POS - .../215391023 (Wayback 2022-12-08) | 2022-10 | staff max discount %, basket discount |
| S23 | API Order GET - https://api-docs.brightpearl.com/order/order/get.html | live | `composition.bundleParent/bundleChild/parentOrderRowId`; parent carries value, children 0.00 |
| S24 | API Product Bundle GET - https://api-docs.brightpearl.com/product/product-bundle/get.html | live | reverse lookup "bundles that contain this product", recursive tree |
| S25 | API Bundle Availability GET - https://api-docs.brightpearl.com/warehouse/bundle-availability/get.html | live | onHand total + per warehouse "that currently contains all the required products" |
| S26 | API Discount total/contact usage - https://api-docs.brightpearl.com/product/discount-total-usage/get.html | live | discount usage counters per contact (POS discount codes) |
| S27 | Shiptheory: Brightpearl bundle products have a value of 0 - https://support.shiptheory.com/support/solutions/articles/24000065575 | live | components arrive at 0; 3rd-party proportional allocation |
| S28 | Conjura: Handling bundles in Brightpearl data - https://help.conjura.com/en/articles/10155870-handling-bundles-in-brightpearl-data | live | revenue on parent; COGS aggregation workaround |
| S29 | Conjura: Brightpearl FAQ - https://help.conjura.com/en/articles/11969843-brightpearl-frequently-asked-questions | live | Shopify/BigCommerce discounts pre-applied proportionally |
| S30 | Perceptium "Bundles" app page - https://www.perceptium.co.uk/bundles | live | revenue on bundle, cost on components; Bundle Cost Calculator + Bundle Apportionment apps |
| S31 | Brightpearl shipping/fulfilment marketing - https://www.brightpearl.com/shipping-fulfillment-software | live | "free gifts added to orders automatically" |
| S32 | Brightpearl Shopify inventory page - https://www.brightpearl.com/shopify/inventory-management | live | bundle connected to Shopify product by same SKU |
| S33 | Software Advice reviews - https://www.softwareadvice.com/accounting/brightpearl-profile/reviews/ | live | thin: "revenue reporting on sales of products sold within bundles" concern (fragment, via search snippet) |

## Findings

### 1. Bundle definition (B-01, B-03, B-18)
- A bundle is its own product record, "always non-stock tracked and can only have a theoretical quantity based on the availability of the items within it" (S10). "Some businesses call this a 'kit'" (S2).
- UI: product screen has a **Bundles** tab - "This tab is used only when creating a bundle. All the items contained within the bundle are added here by searching for an existing product. Add up to 40 different SKUs to a bundle." (S10).
- Import: `Settings > Data/Import > Import products`, column **"Bundle SKUs"**, bundle row only, format `SKU:qty,SKU:qty`; components must exist or be listed above the bundle row (S7).
- "Brightpearl only allows a single level of bundles and does not support any nested bundles (a bundle within a bundle)" (S6). **Conflict:** API Product Bundle GET example shows bundle 391 "is itself a component of bundle 488" and describes the resource as recursive (S24). Cannot resolve without a live account.
- Pre-built kits: "Brightpearl bundles ... are not assembled" (S2). The alternative is an **assembly** (BOM) - "Brightpearl does not have built-in support for BOMs or manufacturing, but there are apps available in the App Store"; or manual stock corrections / stock-correction CSV (S2). Demand Planner (separate product) distinguishes **produced** (pre-assembled) vs **non-produced** bundles via a "produced bundle" checkbox and "Convert Variant To Bundle" button at `Catalog > Bundles components` - for forecasting only; "non-produced bundles should always be configured within Brightpearl back office" (S9).
- Bundles can't be created from a channel listing: "Brightpearl bundles need to be created and managed within Brightpearl, it is not possible to import a bundle from Shopify" (S6); same for Amazon (S4) and eBay ("Create Brightpearl product from eBay listing" not supported, S5).

### 2. Availability (B-02, B-13)
- "The key point ... the component parts are still, in principle, available for sale separately since their stock is not consumed by listing them within a bundle. This allows limited inventory of components to be available to a number of different bundles which are combined only when a bundle is sold." (S2)
- Rule: "the minimum availability in Amazon is taken from the lowest on-hand level for those items within your bundle" (S4); eBay: "The availability of a bundle is therefore the quantity of the item with the fewest items on hand" (S5) [note: the doc's wording ignores component quantity; the Amazon example with qty logic implies floor(onHand/qty) - (unverified)].
- **Warehouse-scoped**: "The bundle quantity is made up only of complete bundles within a warehouse. A bundle is not considered on-hand if the components are available at separate Brightpearl warehouses, even if all those warehouses are being synchronized with Shopify." (S6). API returns per-warehouse breakdown "for each warehouse that currently contains all the required products" (S25).
- "On hand" sent to channels = in stock minus allocated. Order download allocates components, "This in turn updates the on hand inventory levels and updates all sales channels with the new available quantity." (S4, S6)
- eBay bundle quantity sync is opt-in per account: `Settings > Brightpearl Apps > eBay` (S5).
- Reverse lookup "which bundles contain product X" exists in API (S24) - useful for re-publishing all affected bundles.

### 3. Order shape and price split (B-04, B-10, B-14, B-16)
- "When a bundle is added to an order, the items within the bundle will explode out onto their own lines once the order is saved. The sell price is taken only from the bundle record, even if the items within the bundle have their own prices" (S1).
- UI: "A bundle and its components can be identified by the blocks next to the line items" (S1, screenshot `RN_4_54_bundles.png`).
- API row model: `composition: { bundleParent: true|false, bundleChild: true|false, parentOrderRowId }`. In the example, parent row 149 "Bundle" has rowNet 12.50, tax 2.50, itemCost 5.00; child rows 150-152 have rowNet 0.0000, tax 0.00, itemCost 0.0000, `parentOrderRowId: 149` (S23). => **No price allocation to components.** Parent carries the whole price; components are 0.00.
- Third parties do the allocation themselves: Shiptheory "Bundle Products Prices & Weights" setting - components priced pro rata to their original price (e.g. £20 bundle of £9/£7.50/£12.50 -> £6/£5/£9); if all components 0 -> split equally; "calculated on a 'per-Goods Out Note' basis, so a bundle split across several notes may show different final component prices" (S27). Perceptium sells a "Bundle Apportionment App" because standard reporting attributes "income to the bundle, and the cost to the stock controlled components" (S30).
- Contents fixed: "A bundle is a fixed set of items - it is not possible to edit the bundle contents when adding it to orders. If a different item is required then a separate bundle will be needed. Alternatively the individual items can be added with a discount line" (S1).
- Snapshot: components are persisted as rows at save time, so later definition edits do not rewrite the order (inferred from explode-on-save; unverified).
- Documents: `Settings > Sales > Sales settings` chooses for quotes/invoices "bundle components can be listed below the product name, or bundles can be shown as a single line without any detail about the components" (S1). Goods-out note: "bundle components will always be shown as separate line items"; bundle line shown single or with components in the same row (S1).
- Purchase orders: parent at 0, components carry cost from cost price list; if supplier charges a different kit price, operator divides the difference manually or adds a non-stock row; PO template shows both parent and components ("can be confusing and may result in over-ordering"), hidden via CSS `tr.bundle td {display:none;}` / `tr.inventory.bundleComponent td {display:none;}` (S11).
- Margin: "the bundle has no cost of its own, it's a sum of the cost of the components" (S30) - but the API example shows itemCost on the parent (S23). Conflict (unverified which is current). Conjura sums child COGS into parent when parent has none (S28). Perceptium "Bundle Cost Calculator" posts summed component cost back to Brightpearl so the Margin Report works (S30).

### 4. Picking / packing (B-11)
- WMS: "The WMS picking list ignores the bundle item itself ... and only shows all the components" (S3).
- `Settings > Goods out` -> **"Show bundle components in packing"**: off = only components, looks like a regular note; on = only bundle lines, components hidden behind a down arrow, still scannable (S3).
- **Bundle barcodes**: "When components are rolled up into a bundle line, you can also scan the bundle. You might choose to make bundles scannable if you pre-pack them into cartons or bags with a separate label." (S3)
- **Bundle validation**: "WMS will warn you if you are trying to scan both components and a bundle. If you've already scanned a component, you'll need to continue scanning the other components for that bundle." (S3)
- **"Pack bundled items together"**: "WMS will open a pop-up as soon as any bundle component is scanned, requiring that the user scans other items in the bundle before any other line ... can be scanned." (S3)

### 5. Partial fulfilment / shipping (B-12)
- "The stock tracked items within a bundle can be allocated, fulfilled and shipped" (S1) - per component.
- Amazon: "If items within the same bundle are sent in different shipments the whole bundle on Amazon will be marked as shipped when the first item is shipped in Brightpearl." (S4). Shopify: "Split shipment of components - Not supported. Shopify limitation"; "It's recommended that complete bundles are shipped together" (S6).
- Automation "Allocate stock" / "Fulfill order": "If some of the inventory is unavailable, choose whether to partially allocate the order or whether to use an alternative warehouse"; "Create warehouse transfer" action; release notes May 2017 "Supporting allocation of bundled stock" (S12, S14). No substitution of a component.

### 6. Returns / credits (B-15, G-11)
- Generic: open the SO, "Select the lines that are being credited, or returned ... Click the Clone to Sales Credit button"; goods can go back into stock, quarantine or be written off (S20). Shopify refunds can auto-create a sales credit, received into quarantine or stock (S21).
- Nothing bundle-specific found. Since component rows are 0.00 (S23), cloning one component line yields a 0.00 credit - the operator must type a value (inference, unverified).

### 7. Discounts and channel encoding (B-07, X-01, G-02)
- "When sales are downloaded from an eCommerce channel, the price shown on the order is the price that the customer paid. There is no automated comparison with price lists kept in Brightpearl to display discounts." Coupon arrives as an extra line - either negative value or "just for reference" (S16). Reporting: "'search in orders' feature to find all orders which contain this text" (S16).
- Shopify/BigCommerce: "the total of the discount is pre-applied proportionally to the price of the line items. Therefore, we have no view of the discount amounts" (S29).
- Manual orders: optional **List Price** + **Discount %** columns, `Settings > Sales > Sales Settings` 'Show "list price" and discount columns on sale edit screen'; "Warning: This setting cannot be switched off once a sale has had a discount applied!" (S18). Misc row "could be a shipping cost or a discount (negative price)" (S19). Accounting: row % discount reduces revenue; negative row can get a dedicated discount account code (S17).
- POS: % line discount, basket discount, price breaks; per-staff "maximum percentage discount" (S22). API exposes discount usage counters per contact (S26) - POS discount codes; buy-X-get-Y not found (unverified). Third-party Voucherify integration for POS promos reported via search snippet (unverified).

### 8. Free items / gifts (G-04..G-10, G-12)
- Automation action **"Add free SKU"** - "Add a product to an order at a price of 0.00." (S12). Release note June 2019: "Add a free SKU to your Sales Orders! Lots have people have been requesting this one ... You can now choose a product to add to your Sales Orders automatically. You'll need to do this before the order is fulfulled, and the item will always be at 0 cost." (S14). Marketing: "reward your best customers with perks such as faster shipping or free gifts added to orders automatically" (S31).
- Conditions available to such a rule (S13): Channel, Contains SKU (ANY / ALL rows / NONE), Product category, Total value (>, =, <), Number of items, Number of order rows, Total order weight, Currency, Price list, Delivery country/city/postcode, Customer tag, Placed on date / Created date (date range), Payment status, Order status, Custom field, Lead source, Team, Project... Each with "is / is not".
- Per-customer limit: no native counter; workaround = action "Tag customer" + condition "Customer tag is not X" (my inference, unverified). Date-bounded campaign: "Placed on date" condition.
- Rules run reactively (minutes after order arrives) or on schedule; "Rule prioritisation" exists (S14); orders tracked in a "watch list" of orders < 6 months old (S15). "If inventory isn't available, Automation won't be able to fulfill the order. In these cases, the order goes back into the watch list" (S12) - stated for fulfilment, not for Add free SKU; what happens when the free SKU is out of stock is not documented (unverified).
- Gift accounting: "Update nominal code" action can recode "specific SKUs" or categories (S12) - usable to post free items to a promo account (inference).
- Free item is an ordinary stock-tracked row at 0.00 => allocated, appears on goods-out note and WMS pick/pack like any line (inference from S1/S3; no "gift" badge documented).
- Manual: add a product row and set price 0 (or 100% Discount %) (S18, S19).
- Gift messages: Brightpearl's Shopify integration page (search snippet) says "additional information such as gift messages and order notes will be captured in Brightpearl" (unverified - page now redirects to homepage).

## Per-use-case table
| ID | Coverage | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Product record with **Bundles** tab; search & add components with qty; or import "Bundle SKUs" `SKU:qty` | max 40 SKUs; single level (conflict with API) | S10, S7, S6 |
| B-02 | Full | Theoretical qty = lowest component on-hand (in stock - allocated), auto-synced to Amazon/Shopify/BigCommerce; eBay opt-in; component shared by many bundles and sold alone | only complete sets inside ONE warehouse | S2, S4, S5, S6, S25 |
| B-03 | Partial | Virtual bundle native; pre-built = assembly via apps or manual stock correction; WMS bundle barcode for pre-packed cartons (stock still on components) | no BOM/assembly in core | S2, S3, S9 |
| B-04 | Full | Channel listing linked to bundle by same SKU; downloaded order line explodes to components, allocated | bundles cannot be created from listings | S4, S6, S32 |
| B-05 | Unknown | not documented | - | - |
| B-06 | Unknown | not documented | - | - |
| B-07 | Partial | Coupon/discount line (negative or reference) or Shopify proportional pre-applied prices; no discount-group object | no list-price comparison on channel orders | S16, S29 |
| B-08 | Full | Bundle with one component qty N (DP example SKU BW345-X5, pack of five) | - | S8 |
| B-09 | None | "fixed set of items - not possible to edit the bundle contents"; workaround = separate bundle or items + discount line | - | S1 |
| B-10 | Partial | Components exploded to persisted rows at save (implicit snapshot) | (unverified) | S1, S23 |
| B-11 | Full | WMS picks components only; packing toggle "Show bundle components in packing"; bundle barcode; bundle validation; "Pack bundled items together" pop-up | - | S3, S1 |
| B-12 | Partial | Per-component allocate/fulfil, partial allocation or alternative warehouse in Automation; split goods-out notes | channel marks whole bundle shipped on first component; Shopify no split; no substitution | S1, S4, S6, S12 |
| B-13 | Partial | Availability per warehouse; Automation "alternative warehouse" / "Create warehouse transfer" | bundle split across warehouses = not available | S6, S12 |
| B-14 | Partial | Sales settings: invoice shows components under bundle name or single line; GON always per component | price only on parent, components 0.00 -> no VAT split; 3rd-party apps allocate | S1, S23, S27, S30 |
| B-15 | Partial | Clone selected SO lines to Sales Credit; receive to stock/quarantine | component lines are 0.00 -> manual value (inferred) | S20, S23 |
| B-16 | Partial | Cost tab/Margin Report; bundle cost = sum of components only via app | revenue on bundle, cost on components; apps needed | S30, S28, S23 |
| B-17 | Partial | Connect bundle to existing listing (Amazon, eBay, Shopify, BigCommerce); price + inventory sync | listing must exist / matched by SKU | S4, S5, S6 |
| B-18 | None | Bundles can't be imported from channels/shops; only spreadsheet import | - | S6, S4, S5, S7 |
| G-01 | None | no gift flag concept found | - | (unverified) |
| G-02 | Partial | 0.00 / discounted lines kept as paid; coupon line; no list-vs-paid comparison | gift indistinguishable from normal line | S16, S29 |
| G-03 | Unknown | - | - | - |
| G-04 | Full | Automation rule: Contains SKU / Channel -> **Add free SKU** | must run before fulfilment | S12, S14 |
| G-05 | Full | Add product row, price 0 or Discount % 100 | - | S18, S19 |
| G-06 | Partial | Conditions: Total value, Contains SKU (any/all/none), Channel, Customer tag, Placed on date, Number of items...; action Add free SKU 0.00; rule priority | no per-customer counter (tag workaround), no "while stocks last", no choice of gift | S12, S13, S14 |
| G-07 | Partial | Gift can be a bundle component (components are 0.00 anyway) | no distinction from paid component | S1, S23 |
| G-08 | Partial | Free SKU is stock-tracked -> allocated/decremented | run-out behaviour undocumented | S12 (unverified) |
| G-09 | Partial | Normal line on GON / WMS scan | no gift marker | S1, S3 (inferred) |
| G-10 | Partial | 0.00 line on invoice; list price + 100% only if Discount % columns enabled manually | Automation always 0.00 | S14, S18 |
| G-11 | None | - | - | - |
| G-12 | Partial | "search in orders" for coupon text; "Update nominal code" for gift SKUs; Tag customer | no gift-cost / per-customer report | S16, S12 |
| G-13 | None | - | - | - |
| G-14 | Partial | Gift messages/order notes captured from Shopify/BigCommerce | marketing claim | search snippet (unverified) |
| X-01 | Partial | Optional List Price + Discount % columns on manual orders; channel orders store paid price only | setting irreversible once used | S18, S16 |
| X-02 | Unknown | - | - | - |

## Conflicts / open questions
- Nesting: help (S6) says single level only; API Product Bundle GET (S24) documents recursive bundle-in-bundle. Need a live account.
- Bundle cost: Perceptium (S30) says bundle has no cost of its own; API example (S23) shows itemCost 5.00 on the parent and 0 on children.
- Magento: search snippets claim two contradictory statements (bundle quantity controlled in Magento vs synced from Brightpearl) - not fetched.
- Whether availability honours component quantity (floor(onHand/qty)) - docs say "fewest items on hand" (S5); Amazon example implies per-set logic (S4).
- Whether Add free SKU respects stock or skips when out of stock - undocumented.

## Confidence
- High: explode-on-save, price only on parent / children 0.00, fixed contents, WMS pick/pack behaviour, warehouse-scoped availability, Add free SKU action exists and is 0.00 before fulfilment, condition list.
- Low: current (2026) UI labels - all help sources are 2019-2023 snapshots; help centre now login-gated.
- Unverified: gift message capture, per-customer limit workaround, sales credit value for a returned component, out-of-stock gift behaviour.
