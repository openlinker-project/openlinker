# R5 red team 5: global competitors (Linnworks, Shopify, Cin7, Brightpearl)

Date: 2026-11-04. Read-only. Scope: claims C-043..C-048 and every matrix cell in `app-src/src/data.ts` where r1 and r2 disagree for these four competitors.

Tooling note: WebFetch/WebSearch hit a spend limit midway, so later checks used `curl` against the live pages, `shopify.dev/*.md` exports, and Wayback raw snapshots (`web.archive.org/web/<ts>id_/...`). Login/Cloudflare-walled pages (help.core.cin7.com returns 403 live; help.brightpearl.com is a client-rendered Salesforce shell; docs.linnworks.com is an SPA) were read from Wayback or from r2's saved copies under `r2/phase2/lw/`; each row says which.

## Sources (primary unless marked)

| Ref | Source | Kind / date |
|---|---|---|
| SH1 | https://help.shopify.com/en/manual/products/bundles/shopify-bundles | official help, live 2026-11-04 |
| SH2 | https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations | official help, live |
| SH3 | https://shopify.dev/docs/apps/build/product-merchandising/bundles/start-building | official dev docs, live |
| SH4 | https://shopify.dev/docs/api/functions/latest/cart-transform.md (also /api/functions/reference/cart-transform) | official API ref, live |
| SH5 | https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItemGroup.md (api_version 2026-10) | official API ref |
| SH6 | https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductVariant.md | official API ref |
| SH7 | https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y | official help |
| SH8 | https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders/considerations | official help |
| SH9 | https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/holding-fulfillments | official help |
| SH10 | https://changelog.shopify.com/posts/apply-discounts-to-items-on-the-refund-page (2026-05-04) | official changelog |
| SH11 | https://changelog.shopify.com/posts/product-bundles-reporting-in-new-shopify-analytics (2024-12-11) | official changelog |
| SH12 | https://changelog.shopify.com/posts/combine-repeat-bundle-options (2025-12-10) | official changelog |
| SH13 | https://changelog.shopify.com/posts/sell-fixed-bundles-on-google (2026-02-10) | official changelog |
| LW1 | https://apidocs.linnworks.net/docs/channel-integration-endpoint-orders.md (updatedAt 2026-09-30) | official API ref, live |
| LW2 | https://apidocs.linnworks.net/docs/channel-integration-endpoint-post-sale-options.md (updatedAt 2026-06-19) | official API ref (r2 saved copy `r2/phase2/lw/`) |
| LW3 | docs.linnworks.com general-order-management / import-composites / magento-2-settings / processed-order-rma | official help, r2 saved copies `r2/phase2/lw/txt/*.txt` (SPA, not refetched live) |
| CN1 | help.core.cin7.com/hc/en-us/articles/9034480629647-Bill-of-materials-assembly | official help, Wayback 2025-10-16 |
| CN2 | .../9034519918095-Product-Deals | official help, Wayback 2025-10-08 |
| CN3 | .../10848200365711-Picking-for-kitting | official help, Wayback 2025-07-09 |
| CN4 | .../9034512161423-Sale-POST | official API help, Wayback 2025-08-15 |
| CN5 | .../9034476129295-Multi-level-Assembly | official help, Wayback 2025-10-16 |
| BP1 | https://api-docs.brightpearl.com/order/order/get.html | official API ref, live |
| BP2 | https://api-docs.brightpearl.com/order/order-row/delete.html | official API ref, live |
| BP3 | help.brightpearl.com/hc/en-us/articles/115001827586 (Automation conditions overview, "Updated May 23, 2022") | official help, Wayback 2023-01-28 |
| BP4 | help.brightpearl.com/hc/en-us/articles/115001786563 (Automation app actions) | official help, Wayback 2022-08-14 |
| BP5 | help.brightpearl.com/hc/en-us/articles/212648483 (Handling Returns) | official help, Wayback 2020-11-29 |
| BP6 | help.brightpearl.com/hc/en-us/articles/360020598831 (Shopify products) | official help, Wayback 2022-11-26 (2025 snapshot is an unreadable shell) |

Third-party/vendor sources used only as unverified context: Shopify gift apps (YSD Gift with Purchase, CartSprinkle) app-store blurbs via search snippets.

## 1. Disputed matrix cells (r1 != r2)

Rating rubric used to decide: same facts must get the same rating across competitors. Where r2 rated two competitors differently on identical facts, I harmonise and say so.

### Shopify

| Case | r1 | r2 | Correct | Evidence (verbatim) | Reasoning |
|---|---|---|---|---|---|
| B-02 stock = min of components | P | F | **P** | SH1: "Bundles don't track inventory by location, but by overall stock." SH2: untracked or continue-selling components: "the product's inventory is ignored when determining the available quantity of the bundle." | Location-blind sum is a real defect for a router: 1 unit of A in loc 1 + 1 unit of B in loc 2 shows 1 sellable bundle that no single location can ship. Untracked components silently drop out. Not Full. |
| B-03 pre-built kit with own stock | N | P | **N** | SH3 (customized bundles): "App maintains instock/out of stock for the parent." SH3 (fixed): "The parent inventory quantity is the minimum of the component's inventory quantities." | Natively there is no kit with its own stock and a link to components. "Just make a normal product" is the absence of the feature, not a partial feature. |
| B-12 component out of stock | P | N | **P** | SH9: "Select the items that you want to put on hold." and holds apply "when inventory isn't available". SH2: "In areas where each line item in a bundle is handled separately (such as split fulfillments), the bundle's included items display as individual line items". | Item-level fulfilment hold and split fulfilment of component lines exist. No substitute/back-order flow. That is Partial, same as Linnworks/Brightpearl. r2's "None" ignored fulfilment holds. |
| B-14 VAT split | F | P | **F** (for the split; P only if you also demand a fiscal document) | SH1: "The amount then allocates to component products by weighted price, and taxes calculate on the individual components." SH4: "Shopify allocates the bundle price to its component lines based on the weight of each component line. The weight of a component is calculated as the unit price multiplied by quantity" | r2's reason "weighting formula unpublished" is false: SH4 publishes it with a worked example. Proportional allocation of a bundle price <= sum of components can never put a component above its own price, so the DE BFH cap is met by construction (unless an app sets fixedPricePerUnit). Shopify issues no fiscal invoice; that is the only argument for P. |
| B-16 cost = sum of components | P | N | **P** | SH1: "SKUs are listed for individual items in orders, not for the bundle SKU." SH11: report shows "Total sales by Bundle, Total sales by Bundle component". | Because native order lines are the components, line COGS from each variant's "Cost per item" add up to the component sum without any roll-up feature (inference from the order shape). No bundle-level margin report. Partial, not None. |
| G-05 operator adds gift | F | P | **P** | SH8: "You can't edit any orders that are imported into your Shopify admin." and "Only the app that creates an order can edit the order." and "You can't add a product bundle to an order when you edit it." | Works for Shopify-native orders only. For an OMS scenario (orders from other channels) the restriction is decisive. r2 right. |
| G-07 gift as bundle component | U | P | **P** (r2 evidence, not re-verified) | r2: Cart Transform `lineExpand` with `fixedPricePerUnit` 0 | Possible via API, no gift semantics. |
| G-08 gift runs out | P | N | **P** | SH7: "If the inventory of free products drops to zero, then the products display as being sold out and customers can't take advantage of the discount." and "The free or discounted 'get' item is never automatically added to the cart." | This is a "stop" policy visible to the buyer (sold out). No swap. Same level as a "stop" elsewhere = Partial. |
| G-11 gift and returns | N | P | **P** | SH10 (May 04, 2026): "When issuing a refund from the refund page, you can now add, update, or remove a discount on eligible items without leaving the refund page." | Manual claw-back tool exists since 2026-05; r1 predates it. No automatic BXGY recompute. |

### Linnworks

| Case | r1 | r2 | Correct | Evidence | Reasoning |
|---|---|---|---|---|---|
| B-09 buyer variant choice | P | N | **N** | LW3 product-details-composition: compositions are a fixed list of child SKU + Quantity; LW1 order item has no group field (fields: TaxCostInclusive, UseChannelTax, IsService, OrderLineNumber, SKU, PricePerUnit, Qty, TaxRate, LinePercentDiscount, ItemTitle, Options, CancelStatus). | The only "workaround" (Magento ignore-parent) destroys bundle identity; that is B-05, not B-09. |
| B-11 pack bench | P | F | **F** | LW3 general-order-management, pre-processing checks: "All items are scanned / Scanning composite parent will scan all child items"; pick list has parent and "granular (No Composite Parents)" tables (r2). | Explicit scan-children check plus parent/child print tables = Full. Source is r2's saved copy of docs.linnworks.com (SPA, not refetched live). |
| B-18 import definitions | P | N | **P** (harmonise with Cin7 P) | LW3 import-composites: "The Stock Item Compositions import allows you to update or set the Linnworks SKUs that make up a composite item." | r2 gave Cin7 **P** for CSV BOM import and Linnworks **N** for the same CSV-only capability. Either both P or both N; I keep P (bulk import exists, no import from master/shop). |
| G-07 gift as component | U | P | **P** | composite children carry 0 value (r2 [CI]) | Possible, no semantics. |
| G-12 gift report | N | P | **P** | r2: rule can add Identifier/tag; Query Data / Pivotal; dispatched stock cost per line | Workaround reporting, consistent with Shopify P ("Sales by discount"). |

### Cin7 Core

| Case | r1 | r2 | Correct | Evidence | Reasoning |
|---|---|---|---|---|---|
| B-05 parent+children de-dup | N | U | **U** | Live help.core.cin7.com 403, Wayback has no snapshot of article 17129809392655; r2 quote "respecting type of Magento2 order: Bundle, family, Configurable" | Some Magento bundle handling is hinted; nothing proves N. Unknown is honest. |
| B-14 documents/VAT | P | N | **P** (harmonise) | r2: "Kit is one sale line with one tax rule. Components not on invoice." | Linnworks and Brightpearl were rated P for exactly this ("parent line, no split"). Cin7 gets the same. |
| G-07 gift as component | F | P | **P** | CN1: any product can be a component; "Disassembly cost % Indicates what percentage cost each component product makes up of the parent product." | Workaround with no gift semantics is Partial everywhere else. r1's "Full (workaround)" is self-contradictory. |

### Brightpearl

| Case | r1 | r2 | Correct | Evidence | Reasoning |
|---|---|---|---|---|---|
| B-15 return one component | P | U | **P** | BP5: "Select the lines that are being credited, or returned. Note that quantities can be edited directly on the credit later. Click the Clone to Sales Credit button"; returned goods: "add them back into stock, place them in quarantine or write them off". BP1: component rows have `"rowNet": {"value": "0.0000"}`. | Per-line credit + restock of a component exists; refund value of a component is 0 so must be typed. Same as Linnworks P. "Unknown" understates documented facts. |
| G-05 operator adds gift | F | P | **F** (harmonise with Linnworks F) or P for both | r1 S18/S19 (Wayback): add product row, price 0 or Discount % 100 | r2 rated Linnworks F and Brightpearl P with the same caveat ("no gift marker"). Pick one rubric. |
| G-06 rule adds gift | P | F | **F** | BP4: "Add free SKU Add a product to an order at a price of 0.00." BP3: "Placed on date The sale must have been placed (or not placed) within the specific date range." and "Contains SKU The sale must contain (or not contain) a specific SKU". | Threshold, SKU, channel, campaign dates all documented. Once-per-order not explicit, but rules act on an order once it qualifies. Brightpearl beats Linnworks (no date condition) here. |
| G-09 gift on bench/slip | P | F | **P** (harmonise with Linnworks P) | r2 S19 (marketing): "You can ensure the gift appears on the picking list" | Appears as an ordinary row, not marked as a gift. r2 gave Linnworks P for the identical fact. |

## 2. Claim verdicts

**C-043 Linnworks capability flags, nothing for bundles/gifts, Magento-only toggle: CONFIRMED.**
- LW2: "This call is made when creating an RMA or refund request for orders from this channel. It allows you to determine what kinds of refunds and returns are supported on the channel, so that the UI is presented accordingly." Fields CanCancel, CanCancelOrderLines, CanCancelOrderLinesPartially, AutomaticRefundOnCancel, CanRefund, CanAttachRefundToItem, CanAttachRefundToService, RefundShippingTypes, CanRefundAdditionally, CanReturn, PostSaleReasons.
- LW1 (2026-09-30): order item fields listed above; no bundle, composite, parent, gift or free field. Only `Options` (name/value, "usually used for customizations").
- LW3 magento-2-settings: "Ignore bundle child items : ... Should only be enabled if the bundle parent has a linked SKU to a composite parent in Linnworks with the correct and exactly matching child items." Grep across r2's 70 saved Linnworks help pages: "bundle" appears only in magento-2-settings (WooCommerce, Shopify, PrestaShop, BigCommerce settings pages: no hit).
- Nuance: these flags are post-sale only; the "standard" is a refund/cancel UI adapter, not an order-shape standard.

**C-044 Shopify apps declare bundles on the variant; one order shape for all apps: PROBABLE, overstated.**
- SH6: requiresComponents: "If `true`, then the product variant can only be purchased as a parent bundle with components and it will be omitted from channels that don't support bundles."
- SH5: "When a bundle is purchased, each component line item references its LineItemGroup ... The parent bundle's product, variant, and custom attributes enable apps to group and display bundle components in order management systems".
- Limits that break "for all apps": SH4 lists "Create Order API: Not supported", "Order Edit (Admin): Not supported"; at most "one cart transform function per app", conflicts resolved first-come. Third-party bundle apps that do not use the native API encode bundles their own way (r2, community, unverified). So: one shape for native-API bundles on checkout orders, not for every app or every order source.

**C-045 Brightpearl parent carries price, children 0.00; first component shipped marks bundle shipped: PROBABLE, but the "anti-pattern" label is partly wrong.**
- BP1 live example: parent row 149 "Bundle" `rowNet 12.5000`, `rowTax 2.50`, `itemCost 5.0000`, `"bundleParent": true`; children 150-152 `rowNet 0.0000`, `itemCost 0.0000`, `"parentOrderRowId": 149`. This is a doc example, plus r1/r2 archived help; it is consistent.
- BP6 (Wayback 2022-11-26): "If items within the same bundle are sent in different shipments the whole bundle on Shopify will be marked as shipped when the first item is shipped in Brightpearl." Same page: "Split shipment of components Not supported. Shopify limitation." and "Shipment update Yes - when order is marked as fully shipped in Brightpearl" (internal conflict, r2 noted it).
- Why the label is wrong: the channel knew ONE line (a Shopify product mapped to a Brightpearl bundle). Brightpearl explicitly blames the channel ("Shopify limitation"). OpenLinker has the same structural problem for every marketplace that sells a set as one SKU (Allegro, Erli, Kaufland): a qty-1 line cannot be "partly shipped". The design question is a policy (report on first / on last / never split a set across parcels), not avoidance of an anti-pattern. Evidence is 2022-era; current behaviour unverified.

**C-046 Cin7 one BOM with modes; per-integration settings; free-item deals never add the item: PROBABLE.**
- CN1: "Check Auto-assembly to automatically produce the item after the sale order is authorized, assuming there are enough components in stock." "For manually assembled products, the BOM is treated as a draft".
- CN3: "Product for kitting must have an Assembly BOM without auto-assembly/disassembly enabled." "If the assembled item is in stock, WMS will direct picker to pick the assembled product. If there are not enough units ... the system will split the remaining items into their components." "Partial picking is not allowed."
- CN4: "Discount. Value between 0 and 100. For free items discount is 100."
- CN2: deals "can be used to give a fixed free item"; "if the Automatically Apply Discounts setting is set to Yes, any applicable product discounts will be added automatically when the sale quote or sale order is authorized". The official page never says a deal inserts a line; "never adds" rests on community requests (r1/r2). Per-integration named settings not re-verified (Cin7 live 403).
- Everyone missed: CN5: "Cin7 Core supports multi-level assemblies." This refutes the spike doc's D3e "No nested bundles (every competitor forbids them)". Brightpearl is also inconsistent: help says "Brightpearl only allows a single level of bundles" (BP6) while BP2 says deleting a parent deletes "children-of-children in nested bundles".

**C-047 No competitor has a gift out-of-stock swap/notify policy: PROBABLE in its narrow form; "no policy at all" is REFUTED.**
- Swap: none found for the 7 named competitors. 310 recent posts on changelog.shopify.com scanned (2025-2026): bundle/gift-related titles are only combine-repeat-bundle-options, sell-fixed-bundles-on-google, bundles on draft-order status page, gift cards in local currency. No gift out-of-stock post.
- Stop exists: SH7 (above) sold-out display + discount unusable. Linnworks: r2 quotes Rules Engine "is currently unable to check an item's available stock level" (so None there). Third-party Shopify apps advertise auto-pause when the gift is out of stock (vendor blurbs, unverified); none found with a backup/substitute gift.
- So the differentiator is "declared substitute + buyer notice", not "having a policy".

**C-048 No competitor offers a common, integration-declared standard for bundles and gifts: DISPUTED.**
- Shopify is in the competitor list and has exactly such a standard for bundles: components as order lines + LineItemGroup (SH5, "enable apps to group and display bundle components in order management systems"), weighted price allocation published (SH4), and a channel capability gate (SH6 "omitted from channels that don't support bundles"; SH13 Google added as a supporting channel 2026-02). Every app using the native API produces the same order shape. C-044 in the same register already says this, so C-044 and C-048 contradict each other.
- For gifts, a channel-side standard exists across many marketplaces: Mirakl (Empik and every other Mirakl operator) declares FREE_ITEMS promotions with `offered_quantity` and `apportioned` per line (r2 phase1 4-other-marketplaces, OR11 spec).
- What survives: no competitor OMS has adapter-declared capabilities that normalise FOREIGN channels' bundle and gift shapes into one neutral line model. Linnworks' channel integration framework (closest) declares post-sale capabilities only (LW1/LW2). ChannelEngine: not checked (docs not reachable with available tools) - Unknown.

## 3. Counterarguments against the proposed design (with alternatives and cost)

1. **"Bundle price must be split onto components at definition" (CONFIRMED list in data.ts, spike doc point 3).** Shopify splits at sale time by current component prices (SH4 weight = unit price x quantity; SH1 "by weighted price"). That matches the DE BFH rule (individual selling prices) better than a hand-typed in-set price that drifts. Alternative: no per-component price field in the definition; allocate at order snapshot from each component's reference price, with an optional per-component override. Cost: needs a reliable reference price per component at order time (master price sync already exists); loses Apilo/Sellasist-style fixed in-set prices unless the override is kept.
2. **"No nested bundles (every competitor forbids them)" (D3e).** False as stated: Cin7 supports multi-level assemblies (CN5). The decision may still be right for v1, but must be justified on cost, not on market consensus. Cost of supporting one more level later: composition snapshot must be a tree, fulfilment-line ids get a path.
3. **"Standard as advantage" (C-048).** Overclaimed against Shopify. Cheaper alternative positioning: "Shopify's standard, generalised to channels that do not have one" - and copy Shopify's exact shape (component lines + group header + allocated price) as the neutral model, since Shopify, IdoSell and Brightpearl (children with parent row) already converge on it. Cost: none; it reduces design risk.
4. **B-21 "channel must not get 'shipped' after the first component".** For one-line marketplaces this is not an option a channel offers; the real choice is "ship sets in one parcel" (Brightpearl's own recommendation: "It's recommended that complete bundles are shipped together", BP6) vs report on last parcel. Cheapest alternative: a pack-bench guard that keeps a set in one parcel by default; split only with explicit override, then report on the last parcel.
5. **Matrix rubric drift.** At least four cells (Linnworks/Cin7 B-18, Cin7 vs Linnworks/Brightpearl B-14, Linnworks vs Brightpearl G-05 and G-09) have different ratings for identical facts. Any "we beat X" conclusion read from the matrix inherits this noise.

## 4. Anything everyone missed

- Shopify B-09 (both rounds P): SH12 (2025-12-10) "you can bundle options like size or length so your customers will only have to select them once" - native per-slot variant choice exists; arguably Full.
- Shopify B-18 (both N): confirmed by SH2 "Bundles don't support import, export, or bulk editing capabilities." and "Bundles can't contain other bundles."
- Shopify G-07: SH2 "The Shopify Bundles app doesn't support mix-and-match bundles."
- Shopify order editing cannot add bundles at all (SH8) and Cart Transform is "Not supported" on orderCreate (SH4): a Shopify adapter in OL will receive bundle groups only from checkout orders; marketplace orders pushed into Shopify by connector apps cannot carry them.
- Brightpearl parent row carries `itemCost` 5.00 while children carry 0 (BP1 example): cost sits on the parent too, so per-component margin is also lost, not only price.
- Brightpearl help content is from 2019-2022 Wayback snapshots; the live help centre is a client-rendered shell. Treat every Brightpearl rating as "as of 2022".
