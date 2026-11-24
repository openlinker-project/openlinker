# Research: Brightpearl (Sage) - bundles, free items, integration normalisation

Researcher 8 of 8, SOLUTION phase, run 2. Date: 2026-11-04. Read-only, no sign-up.

## Sources consulted

The live help centre (help.brightpearl.com/s/..., Salesforce Experience site) renders client-side and returned only a shell; the old Zendesk URLs (help.brightpearl.com/hc/en-us/articles/...) answer 401. Article text below comes from **Wayback Machine raw snapshots** (dates given per article) plus search-engine snippets of the live pages. Treat everything as "as of the snapshot date"; Brightpearl may have changed screens since.

| Ref | Source | Snapshot / date | What it gave |
|---|---|---|---|
| S1 | "Bundles on Sales Orders and Goods Out Notes", help.brightpearl.com/hc/en-us/articles/212789843 | Wayback 2019-07-21 (article "Updated April 24, 2019") | explode on save, price from bundle record, fixed contents, print settings |
| S2 | "Bundles, Assemblies, Packages & Customization", .../articles/212789563 | Wayback 2019-12-09 (Updated May 24, 2019) | bundle vs assembly, components "may or may not be stock tracked", no BOM |
| S3 | "Bundles in WMS" / "WMS : Bundles", .../articles/360028908311 (live: help.brightpearl.com/s/article/360028908311) | Wayback 2022-05-20 (Updated Feb 11, 2022) | picking list, "Show bundle components in packing", bundle barcodes, validation, "Pack bundled items together" |
| S4 | "Shopify products", .../articles/360020598831 (live: /s/article/360020598831) | Wayback 2022-11-26 (Updated Nov 25, 2021) | Shopify bundle support table, per-warehouse availability, no nesting, split shipment behaviour |
| S5 | "Using bundles with eBay", .../articles/212646643 | Wayback (Updated Oct 26, 2022) | eBay support table, JobLot, "Track stock of bundles" per eBay account |
| S6 | "Bundles with Amazon", .../articles/211129046 | search snippet only (unverified wording) | whole bundle marked shipped on first component; listing unavailable if any component short |
| S7 | "Coupons", .../articles/360028382592 | Wayback 2023-02-02 (Updated Oct 11, 2021) | price shown = price paid; coupon row negative OR reference-only per channel |
| S8 | "Release notes & new features for Automation", .../articles/115003751586 | Wayback 2022-08-14 (Updated May 26, 2022) | "Add a free SKU" (June 2019), ANY/ALL/NONE row conditions, date conditions, advanced fulfilment, stock transfer, "Set a status when a rule fails" |
| S9 | "Brightpearl Automation actions overview" .../115001786563 (search snippet only) and "conditions overview" .../115001827586 (Wayback 2023-01-28) | action list incl. Add a free SKU; conditions Total value, Contains SKU (wildcards, comma OR), Channel, Customer tag |
| S10 | api-docs.brightpearl.com/order/order/get.html | live | order row `composition {bundleParent, bundleChild, parentOrderRowId}`; parent carries price, children 0.00 |
| S11 | api-docs.brightpearl.com/order/order-row/post.html | live | POST one row with bundle productId -> Brightpearl creates component rows; bundle not allowed on purchase orders |
| S12 | api-docs.brightpearl.com/order/order-row/delete.html | live (snippet) | component row cannot be deleted alone; deleting parent deletes children "including children-of-children in nested bundles" |
| S13 | api-docs.brightpearl.com/product/product/get.html, product-bundle/get.html, warehouse/bundle-availability/get.html | live | `composition.bundle`, `bundleComponents[].productQuantity`; reverse lookup tree; availability per warehouse only where all components are held |
| S14 | Magento orders article .../212096706 | search snippet only | "any discounts will be applied to each order row" |
| S15 | "Amazon orders" .../articles/211129146 | Wayback 2023-01-28 | gift wrap = extra row immediately below the product with its charge; gift messages into a "sales" custom field (type text area) prefixed with product SKU; bundle explosion on Amazon download |
| S16 | Shiptheory "Brightpearl bundle products have a value of 0" support.shiptheory.com/.../24000065575 | live | partner must re-apportion price to components; setting "Bundle Products Prices & Weights" |
| S17 | Perceptium "Bundles" perceptium.co.uk/bundles | live | income on bundle, cost on components; paid "Bundle Cost Calculator" and "Bundle Apportionment" apps |
| S18 | Conjura help.conjura.com/en/articles/10155870 | live | analytics partner zeroes child qty, sums child itemCost onto parent |
| S19 | brightpearl.com marketing: /shopify/inventory-management; "?p=9661" (automation hacks); /retail-workflow-automation | live | Shopify SKU-link explosion; "set rules to add free gifts to orders over a certain amount", "gift appears on the picking list", "free gift after their third order" |
| S20 | PreProduct "Pre-orders on Brightpearl" preproduct.io/erps/pre-orders-on-brightpearl | live (snippet) | unmatched SKUs become non-stock-tracked rows (third party, unverified for all connectors) |
| S21 | TrustRadius / Capterra reviews | live (snippets) | thin signal on bundles |

## Model in one paragraph

A Brightpearl **bundle** is a product record flagged `composition.bundle=true` with a fixed list of `bundleComponents` (productId + productQuantity). It is **never stock-tracked**; its quantity is "theoretical" = complete bundles buildable **inside one warehouse**. Components keep their own stock and stay sellable alone (S2, S4, S13). On any sales order (manual, API, or channel download) adding the bundle SKU makes Brightpearl **explode** it on save into child rows linked by `parentOrderRowId`; the **parent row carries the whole price and tax, children are 0.00** (S1, S10, S11). Stock is allocated and decremented on the components only, when the goods-out note (GON) ships. Pre-built kits are a separate concept, **assembly** (a normal stock-tracked SKU created by stock correction, no BOM; S2). Free items are not a concept on the order; the only native mechanism is the **Automation action "Add a free SKU"** (adds a 0-price row before fulfilment; S8, S9).

## Per use case

| ID | Rating | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Product record -> bundle components list (component SKU + quantity). Created only in Brightpearl back office. | Single level only per channel docs (S4 "does not support any nested bundles"); API docs mention nested bundles (S12, S13) - conflict, see below. Components "may or may not be stock tracked" (S2). | S2, S4, S13 |
| B-02 | Full | Bundle quantity computed from components and pushed to channels; component shared by many bundles and sold alone is the whole point ("limited inventory of components available to a number of different bundles"). eBay: per-account setting "Track stock of bundles". | Only complete bundles within ONE warehouse count. eBay article words it as "quantity of the item with the fewest items on hand" (ignores component qty?) - likely a simplification (unverified). | S2, S4, S5, S13 |
| B-03 | Partial | Two separate constructs: bundle (virtual) vs assembly (own stock, built by manual stock correction/CSV; BOM/manufacturing via App Store apps). WMS "bundle barcodes" for pre-packed bags still treat it as a virtual bundle. | No native kit-building/BOM; no "convert virtual to pre-built on demand". | S2, S3 |
| B-04 | Full | Channel product (Shopify simple product, eBay listing incl. JobLot, Amazon listing) linked to the bundle by SKU. On download Brightpearl "will use the bundle item and add on all the separate components" and allocates them. | Link is SKU equality; bundle cannot be created from the channel listing. | S4, S5, S6, S19 |
| B-05 | Unknown (likely None) | No documented handling for a channel that sends parent + children (WooCommerce bundle plugins). | Risk: children download as extra rows -> double allocation (unverified, no source either way). | none found |
| B-06 | Unknown (likely None) | No documentation for Shopify native bundles (lineItemGroup) - the Shopify article predates them and says "Shopify does not provide a bundle feature". | Would arrive as plain component rows with no grouping (inferred). | S4 |
| B-07 | Partial | Rows keep the price the customer paid; channel-level discount arrives as a coupon row (negative or reference-only). No grouping of N rows into one offer bundle. | No notion of "these lines form one discounted set". | S7 |
| B-08 | Partial | Model as a bundle whose single component has productQuantity N, linked to the listing (eBay JobLot is the documented case). | Pack-size per channel offer not a first-class concept (inferred). | S5, S13 |
| B-09 | None | "A bundle is a fixed set of items - it is not possible to edit the bundle contents when adding it to orders. If a different item is required then a separate bundle will be needed." Workaround: add items individually + a discount line. | Every variant combination = its own bundle SKU. | S1 |
| B-10 | Full (implicit) | Component rows are physically written onto the order at save, so later edits to the bundle record do not change existing orders (inferred from explode-on-save). | Not documented explicitly (unverified). | S1, S11 |
| B-11 | Full | WMS picking list shows components only (bundle SKU hidden). Setting Settings > Goods out > "Show bundle components in packing": OFF = components only; ON = bundle line with expandable components (down arrow). Bundle barcode scannable when rolled up. Validation: "WMS will warn you if you are trying to scan both components and a bundle"; once a component is scanned the others must follow. "Pack bundled items together" forces a pop-up until the bundle is complete. GON print: components always separate lines; bundle line single or with components in the same row (Settings > Sales > Sales settings). | Pre-WMS GON is print-only. | S1, S3 |
| B-12 | Partial | Channel listing goes unavailable when any component is short (Amazon). On the order: Settings > Products/Inventory > Inventory Settings partial fulfilment; Automation "Fulfil" with partial fulfilment / alternative warehouse; unfulfillable order returns to the Automation watch list. | No substitution, no per-bundle hold reason; partial fulfilment can split a bundle across shipments (see B-21). | S6, S8, S19 |
| B-13 | Partial | Availability counts only bundles completable in one warehouse; Automation can transfer stock between warehouses from a sales order and fulfil from alternative warehouses (one GON per warehouse). | Cross-warehouse components = bundle shows as not on hand on Shopify even if all warehouses sync. | S4, S8, S13 |
| B-14 | Partial | Invoice/quote shows bundle as one line or with components listed below (Settings > Sales > Sales settings). Ledger: parent row carries net+tax, children 0. | One tax code on the parent: no mixed-VAT split by component reference prices (inferred from S10 row data; unverified for a mixed-rate bundle). Partners (Shiptheory, Perceptium) re-apportion outside Brightpearl. | S1, S10, S16, S17 |
| B-15 | Unknown / weak | Generic sales credit (RMA): per-item restock / quarantine / write-off. No bundle-specific credit, no lost-discount logic documented. | Component rows are 0.00, so refunding one component has no price to refund (inferred). | Brightpearl "Handling returns" snippet; none bundle-specific |
| B-16 | Partial (via apps) | Bundle "has no cost of its own"; cost lands on components, income on bundle -> "you can't readily ascertain the net margin of a bundle". Perceptium sells Bundle Cost Calculator (sums component costs back onto the bundle). | Native margin per bundle not available. | S17, S18 |
| B-17 | Partial | Link bundle to an existing channel product by SKU; Brightpearl syncs quantity and price (Shopify, eBay, Amazon, BigCommerce). | "Brightpearl does not manage product details (other than price) on Shopify" - cannot create the listing. | S4, S5 |
| B-18 | None | "Not possible to import a bundle from Shopify"; eBay: "Create Brightpearl product from eBay listing" not supported. | Bundle definitions must be authored in Brightpearl. | S4, S5 |
| B-19 | Partial | Brightpearl normalises everything to "parent carries price, children 0.00". Channel price per line = what customer paid. | Normalisation is fixed, not configurable per channel. | S1, S10 |
| B-20 | N/A | Brightpearl is itself the stock master; components are decremented only on GON ship. No scenario where an upstream master already decremented. | - | S2 |
| B-21 | Partial (with a documented defect) | One GON per shipment; Shopify gets a shipment update per GON. Shopify: "If items within the same bundle are sent in different shipments the whole bundle on Shopify will be marked as shipped when the first item is shipped"; recommendation "complete bundles are shipped together". Table also says "Split shipment of components: Not supported. Shopify limitation." Amazon: same "first item" behaviour. eBay: "marked as shipped... as normal". Shiptheory: component prices recomputed per GON when a bundle spans notes. | Same Shopify article also says shipment update "when order is marked as fully shipped" - internal conflict. Tracking reference at "simple product level". | S4, S5, S6, S16 |
| G-01 | None | No gift/free-item flag on an order row; nothing reads a channel gift flag. | - | S7, S10 (absence) |
| G-02 | Partial | Row downloads at the price paid (0.00 or 0.01); no list price kept ("no automated comparison with price lists"). Indistinguishable from a normal cheap row. | No reason/flag; full-price + 100% discount depends on channel connector (coupon row vs line-level). | S7 |
| G-03 | Partial | Folded discount arrives as a coupon row (negative value) or already applied per row with the coupon row as reference; Magento: "any discounts will be applied to each order row". | Gift is invisible as a gift. | S7, S14 |
| G-04 | Partial | Automation rule: condition "Contains SKU" (the promo SKU) -> action "Add a free SKU". | Gift product must exist in Brightpearl; must be added before fulfilment. | S8, S9 |
| G-05 | Partial | Operator edits the sales order and adds a row at 0 (ordinary order editing). | No gift marker; proof = GON/shipping only (inferred). | S1 (order editing), unverified |
| G-06 | Full (rule engine) | Automation: conditions Total value (more/equal/less), Contains SKU (comma list = OR, one row per SKU = AND, wildcards PROD*; ANY/ALL/NONE checkbox), Channel, Customer tag, date conditions (created/placed-on/delivery date), each "is"/"is not"; action "Add a free SKU" -> row at 0 "always at 0 cost", before fulfilment. Marketing: "set rules to add free gifts to orders over a certain amount", "orders from certain customers or orders containing certain SKUs". | Once-per-order presumed (rule acts on an order once) - unverified; quantity rules (1 per N) not documented. | S8, S9, S19 |
| G-07 | Partial | A bundle can include a give-away component; price comes only from the bundle record so the component costs nothing to the buyer. | Not marked as gift; stock-out of gift blocks bundle availability. | S1, S2 |
| G-08 | None (blocks) | If the free SKU has no stock, Automation "Fulfil" cannot fulfil and the order goes back to the watch list; "Set a status when a rule fails" can make it visible. No substitute, no skip-with-notice. | The whole order stalls rather than the gift being skipped (inferred from S9 general rule). | S8, S9 |
| G-09 | Full | Gift is an ordinary row: on picking list, packing screen, GON ("You can ensure the gift appears on the picking list"). | Not visually distinguished as a gift. | S19 |
| G-10 | Partial | Row at 0 net, 0 tax on invoice. | No list price + rebate, no typed reason, no zero-VAT refusal. | S8, S10 |
| G-11 | None | Nothing documented. | - | none |
| G-12 | Partial | "Search in orders" for row text (documented for coupons); product sales reports for the gift SKU. | No gift cost ledger. | S7 |
| G-13 | None | - | - | none |
| G-14 | Partial | Amazon gift wrap downloads as an extra row immediately below the product it applies to, with its charge; gift messages go to a pre-created "sales" custom field (text area) selected in the Amazon marketplace setup, each prefixed with the product SKU. | Per-line gift message flattened into one order-level text field; Amazon-only documented. | S15 |
| G-15 | Partial | Automation "Tag customer" action + "Customer tag" condition: e.g. tag after first gift, then "is not" tagged; marketing: "automate rewards, such as a free gift, after their third order". Tied to the Brightpearl contact record. | Survives changed email only if contact dedupe matches (unverified); max 200 tags. | S9, S19 |
| X-01 | Partial | Price on row = price paid; coupon row negative or reference, chosen by the connector per channel. No neutral list-price + reduction pair. | Operator cannot see original list price on downloaded orders. | S7 |
| X-02 | Unknown | Kaufland not in scope of found sources. | - | none |
| X-03 | Partial | Per-channel knobs exist but are scattered: eBay per-account "Track stock of bundles"; global print settings; connector-specific coupon behaviour hard-coded; partners add their own ("Bundle Products Prices & Weights" in Shiptheory). | No operator-facing "this channel sends children / prices on parent / gift field" mapping. | S4, S5, S7, S16 |

## Conflicts / open questions

- **Nesting.** S4 (Shopify article, 2021) says single-level only; S12 (Order Row DELETE) and S13 (Product Bundle GET "recursively any bundles... hierarchy") describe nested bundles. Search snippet of the WMS article claimed "bundles within bundles" but the Wayback text does not contain it. Likely: data model allows nesting, channel connectors do not. Cannot resolve without a live account.
- **Shopify shipment update.** Same table in S4: "Shipment update: Yes - when order is marked as fully shipped" vs "whole bundle... marked as shipped when the first item is shipped". Amazon S6 states "first item". Treat "first component ships = bundle shipped" as the operative behaviour.
- **Availability formula.** S5 says "quantity of the item with the fewest items on hand"; S13/S4 imply component quantities are honoured. Unverified.
- **"0 cost" for Add a free SKU.** S8 says "always at 0 cost"; reads like 0 price, possibly also 0 cost - unclear whether COGS is still posted from the component.

## Integration normalisation

- **Explode-on-ingest, by SKU link.** Every connector (Shopify, eBay, Amazon, BigCommerce, Magento) downloads the channel line; if its SKU equals a Brightpearl bundle SKU, the order-save logic (same as manual/API) creates child rows. Normalisation is in the core, not per connector. Bundles are authored only in Brightpearl and pushed (qty + price) to channels. (S4, S5, S11)
- **One canonical row shape:** parent row carries full price + tax, children 0.00 with `parentOrderRowId`; components cannot be deleted alone. Downstream partners (Shiptheory, Conjura, Perceptium) all have to re-apportion price/cost themselves. (S10, S12, S16-S18)
- **Discounts: price-paid per row + an informational/negative coupon row**, and which of the two depends on the connector (Magento folds into rows). No list-price comparison. (S7, S14)
- **Unknown channel SKUs** reportedly land as non-stock-tracked free-text rows (third-party claim, unverified). (S20)
- **Shipment notification at GON grain**, mapped back to the channel product: since the channel only knows the bundle line, the first component shipped marks the bundle shipped (Shopify, Amazon). Brightpearl's answer is operational: ship bundles together ("Pack bundled items together"). (S3, S4, S6)
- **Free items are not normalised at all**: a 0.00 row from a channel and an Automation-added free SKU look the same as any row.

## UX patterns worth copying

1. Packing-screen toggle "Show bundle components in packing" with expandable bundle line, plus a scannable bundle barcode for pre-packed kits (S3).
2. Scan validation: warn when mixing bundle scan and component scans; once a component is scanned, the rest of that bundle must follow; optional "pack bundled items together" pop-up (S3).
3. Document display setting: bundle as one line vs components listed under it, separately for invoices/quotes and goods-out notes (S1).
4. Rule builder with ANY / ALL / NONE semantics on row-level conditions, wildcard SKU matching, "is / is not", and a status set when a rule fails (S8, S9).
5. Per-warehouse bundle availability with an API reverse lookup "which bundles contain this product" (S13) - useful for "this component change affects N bundles".
6. Order-row composition fields (`bundleParent`, `bundleChild`, `parentOrderRowId`) as a minimal neutral shape (S10).

## Anti-patterns

1. Parent row carries all money, children at 0.00: breaks mixed-VAT split, per-component refunds, per-component margin and every partner downstream (S10, S16, S17).
2. Whole channel bundle marked shipped when the first component ships (Shopify, Amazon) - the channel tells the buyer something false (S4, S6).
3. Fixed bundle contents with no slot choice: every variant combination is a new SKU (S1).
4. Free items with no flag/reason: a gift is indistinguishable from a 0.00 sale row; out-of-stock gift stalls the whole order (S7, S8).
5. Bundle definitions one-way only (cannot import from Shopify/eBay) and channel-specific behaviours hard-coded in connectors rather than exposed as settings (S4, S5, S7).

## New use cases surfaced

- **NEW B-22** Reverse impact: "which bundles (directly or nested) contain this component" before changing/discontinuing a component (S13).
- **NEW B-23** Bundles in purchasing: a bundle SKU cannot be put on a purchase order; buying must explode to components (S11).
- **NEW B-24** Downstream partners (shipping software, 3PL, analytics) need per-component price and weight; if the OMS keeps money on the parent only, each partner re-apportions differently (S16, S18). The neutral standard should export apportioned component values.
- **NEW G-16** Gift rule failure must not stall the order: a rule that cannot add/fulfil the gift needs its own visible status rather than returning the order to a queue (S8, S9).
- **NEW X-04** Channel SKU unmatched on download: fallback row type (non-stock free text) vs reject - an explicit policy is needed (S20, unverified).

## Confidence assessment

- High: explode-on-save, parent-priced rows, WMS packing settings, Shopify/eBay support tables, Automation "Add a free SKU" and conditions (primary text via Wayback / API docs).
- Medium: Amazon "first item" shipping (snippet), Magento discount folding (snippet).
- Low / unverified: nesting support, returns of bundles, gift reporting, unmatched-SKU fallback, customer-dedupe for G-15, current (2026) UI labels.
