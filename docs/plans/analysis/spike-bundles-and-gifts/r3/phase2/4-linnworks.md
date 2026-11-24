# R3 phase 2 / competitor 4: Linnworks (composite items, free items, Channel Integration framework)

Round 3, blind replication. Built only from briefs/ and use-cases-v3.md plus the sources below. Accessed 2026-11-04.

## Sources consulted (kind in brackets)

Primary, vendor documentation (docs.linnworks.com is a ClickHelp single-page app; the content was read through the crawler URL `https://docs.linnworks.com/articles/?_escaped_fragment_=documentation/<slug>`, which returns the same topic text as the canonical `https://docs.linnworks.com/articles/#!documentation/<slug>` link cited below):

- [D1] `#!documentation/inventory-composite-items` - Inventory: Composite Items (current main article) [vendor docs]
- [D2] `#!documentation/product-details-composition` - Product Details: Composition tab [vendor docs]
- [D3] `#!documentation/import-composites` - Import: Stock Item Compositions [vendor docs]
- [D4] `#!documentation/rules-engine-actions` - Rules Engine: Actions (incl. "Add items to an order NEW", "Add services to an order NEW") [vendor docs]
- [D5] `#!documentation/adding-items-services-merged-split-resend-orders` - Add Items & Services: Split, Merged, Resend Rules [vendor docs]
- [D6] `#!documentation/rules-engine` - when rules run [vendor docs]
- [D7] `#!documentation/rules-engine-conditions-comparators` - conditions incl. Has composites, Item count (no children / no parents) [vendor docs]
- [D8] `#!documentation/add-items-to-orders` - Apps: Add Items to Orders (older macro app) [vendor docs]
- [D9] `#!documentation/magento-2-settings` - Magento 2 settings: Ignore bundle child / parent items [vendor docs]
- [D10] `#!documentation/kaufland-rules` - Kaufland rules and guidelines [vendor docs]
- [D11] `#!documentation/amazon-settings` - Send Composite Parent Items to Amazon (MCF) [vendor docs]
- [D12] `#!documentation/shopify-settings` - Save discount information, Split Orders by Shopify Fulfillments [vendor docs]
- [D13] `#!documentation/open-orders-create-edit` - edit order: Add Product / Add Service, Subitems tab [vendor docs]
- [D14] `#!documentation/open-orders-merge-split` - split/merge, composites cannot be split across orders [vendor docs]
- [D15] `#!documentation/open-orders-split-packaging` [vendor docs]
- [D16] `#!documentation/template-designer-pick-list`, `#!documentation/template-designer-packing-list` [vendor docs]
- [D17] `#!documentation/open-orders-order-calculations` [vendor docs]
- [D18] `#!documentation/rma-refunds`, `#!documentation/rma-returns` [vendor docs]
- [D19] `#!documentation/query-data-composites`, `#!documentation/query-data-composite-parent-sales`, `#!documentation/export-composites` [vendor docs]
- [D20] `#!documentation/channels-tax`, `#!documentation/channels-order-download`, `#!documentation/channels-inventory-mapping`, `#!documentation/woocommerce-settings` [vendor docs]

Primary, developer documentation (apidocs.linnworks.net, fetched as `.md`):

- [A1] https://apidocs.linnworks.net/docs/channel-integration-endpoint-orders - Orders endpoint (connector -> Linnworks) [API spec]
- [A2] https://apidocs.linnworks.net/docs/channel-integration-endpoint-despatch [API spec]
- [A3] https://apidocs.linnworks.net/docs/channel-integration-endpoint-refund [API spec]
- [A4] https://apidocs.linnworks.net/docs/channel-integration-endpoint-post-sale-options [API spec]
- [A5] https://apidocs.linnworks.net/docs/channel-integration-endpoint-user-config (GlobalConfigSettings) [API spec]
- [A6] https://apidocs.linnworks.net/docs/endpoints-general and https://apidocs.linnworks.net/docs/channel-integrations-faq [API docs]
- [A7] https://apidocs.linnworks.net/docs/channel-integration-endpoint-inventory-update [API spec]
- [A8] https://apidocs.linnworks.net/reference/getorderitemcomposition and https://apidocs.linnworks.net/reference/addorderitem [OpenAPI]
- [A9] github.com/linnworks-dev/PublicApiSpecs `2.0/orders-v2.json` (via `gh api`) and github.com/linnworks-dev/LinnworksNetSDK `Linnworks/src/netcore/LinnworksAPI/ClassBase/OrderItem.cs` [source/spec]

Older vendor material (still primary, but may describe legacy behaviour):

- [H1] https://help.linnworks.com/support/solutions/articles/7000038821-magento-orders-with-bundle-products-are-downloading-incorrectly [vendor KB]
- [H2] https://help.linnworks.com/support/solutions/articles/7000038834-amazon-fba-listings-with-composite-items [vendor KB]
- [H3] https://help.linnworks.com/support/solutions/articles/7000058578-composite-parent-sku-stock-levels-are-wrong (modified 7 Nov 2024) [vendor KB]
- [H4] https://help.linnworks.com/support/solutions/articles/7000024253-inventory-composite-items-in-orders-purchase-orders-warehouse-transfers [vendor KB]
- [H5] https://help.linnworks.com/support/solutions/articles/7000034390-stock-item-history-did-not-record-sale [vendor KB]
- [H6] https://help.linnworks.com/support/solutions/articles/7000044542-inventory-control-composite-item-cannot-be-part-of-other-composition [vendor KB]
- [H7] https://web.archive.org/web/20221204085318/https://desktop.linnworks.com/Doc/Composite_Items_Item_composition_using_granular_items (legacy desktop docs; live URL now 301s to docs.linnworks.com) [vendor docs, archived]

Third party:

- [T1] https://docs.rishvi.co.uk/linnworks/ris-sm-1015-reduceitemdiscount - partner macro "Reduce Item's Discount" [partner docs]
- [T2] https://help.conjura.com/en/articles/10155870-handling-bundles-in-brightpearl-and-linnworks-data [third-party analytics vendor; weak, not Linnworks-specific]

Not found / thin signal: no community or review thread found that discusses composite pricing on invoices or free-gift handling in Linnworks; Reddit and G2 searches returned nothing usable. Two help.linnworks.com discussion URLs surfaced by search (7000013571 "Option for composite items to show in the invoice", 7000039187 "Composite and manufactured items") redirected to the support home page when fetched, so their content is unverified.

## Core model in one paragraph

Linnworks has ONE bundle concept, the **composite item**: a parent stock item with a Composition tab listing child SKUs and quantities. The parent is normally set "Not Tracked" (stock derived from children), one level of nesting only. When an order line maps to a composite parent, Linnworks writes the parent line plus child rows (child rows point to the parent via `ParentItemId`); children carry "a sold value of zero". There is NO free-item / gift concept: a gift is either an ordinary stock line with a 100% discount (typically added by the Rules Engine action "Add items to an order"), a "service" line (no SKU), or a child of a composite. The Channel Integration framework gives connectors a fixed, flat order-line schema with no parent/group/gift fields; normalisation happens through per-channel settings (e.g. Magento "Ignore bundle child items") and through SKU linking of the channel line to a composite parent.

## Ratings

| ID | Rating | How it works in Linnworks | Evidence |
|---|---|---|---|
| B-01 | Full | My Inventory > Add New > item window > **Composition** tab > **Add New** > pick child SKUs > Quantity > Save. Bulk via import type **Stock Item Compositions** (Parent SKU, Child SKU, Quantity). Limits: "Composites cannot contain another composite", "A composite cannot contain itself", all SKUs must exist first. | [D2] "Click the Composition tab. Click the Add New button."; [D1] "Composites cannot contain another composite."; [D3] |
| B-02 | Full | Parent "Not Tracked" (Minimum Level -1) -> availability computed from children and pushed through the normal inventory update; children can also be listed alone. Gotcha: manual -1 does not recompute until a child level changes. | [D1] "Linnworks will calculate the number of available units based on the availability of the child SKUs... Child SKUs can be listed on the channel independently or as a part of the composite item."; [D2] "the available quantity of a composite item will not update until one of the child SKUs changes their stock level" |
| B-03 | Full | Tracked vs Not Tracked decides kit-with-own-stock vs virtual; Tracked is per location, so one SKU can be pre-built in one warehouse and virtual in another. Legacy docs also describe "simple compositions" where a tracked parent ships with a tracked child. | [H3] "The logic of Composite Parent SKU stock levels is determined by the Tracked status of an inventory item." / "Tracked status is location-specific."; [H7] "you don't need to set Garden Football Goal as Not Tracked as by itself it is tracked product" |
| B-04 | Full | Channel line SKU is linked (inventory mapping) to the composite parent; on download Linnworks shows parent and children. | [D1] "When an order is received for a composite item, Linnworks will display the composite and their individual child items." |
| B-05 | Partial | Only as a per-connector setting where the connector implements it: Magento 2 **Ignore bundle child items** / **Ignore bundle parent items** (mutually exclusive). Requires the channel parent be linked to a composite with "exactly matching" children; otherwise children are downloaded as separate items (double count). No WooCommerce/Shopify equivalent documented. | [D9] "Should only be enabled if the bundle parent has a linked SKU to a composite parent in Linnworks with the correct and exactly matching child items. When disabled, bundle child and parent items will be downloaded as separate items."; [H1] |
| B-06 | None | The connector order-line schema has no group/parent field (SKU, Qty, PricePerUnit, TaxRate, LinePercentDiscount, IsService, Options). Children-only grouped lines arrive as independent lines; no documented regrouping. | [A1] OrderItem table (no grouping field) |
| B-07 | Partial | Lines arrive with `LinePercentDiscount` or an order-level `Discount` spread by `DiscountType` (AllEvenly / ItemsThenPostage / PostageThenItems). Spread is even, not proportional; no "these N lines are one offer bundle" grouping. | [A1] "`AllEvenly` - The given discount amount will be split evenly across all items and any applicable postage." |
| B-08 | Full | Multipack = composite of N x the same child ("a pack of the same"). | [D1] "It can be a set of different items or a pack of the same."; [D3] "This could either be as a multipack of the same SKU or a bundle" |
| B-09 | None | No slot / choice concept; composition is a fixed list. No source found. | [D2] (fixed SKU + Quantity columns only) |
| B-10 | Unknown | Child rows are materialised on the order (`ParentItemId` on child rows), which suggests a snapshot, but no doc states what happens to open orders when a composition is edited; the removal article mentions stock recalculation and listings, not open orders. | [A9] orders-v2.json OrderItem.ParentItemId "Id of the composite parent row. Null if not a child item"; [H4]/removal article silent on open orders |
| B-11 | Full | Order screen: expand row > **Subitems** tab. Pick list templates choose "Order Items (No Composite Parents)" (default, no children) or "Order items granular (No Composite Parents)" (includes child SKUs). With scan-to-process on, children must be scanned; a child without barcode is skipped. Pickwave can group by parent. | [D13] "The Subitems tab is displayed when an item that was sold is a composite item."; [D16] "This table will display all items to be picked for an order, including Child SKUs of composite items."; [D1] "orders containing composites will require the child items to be scanned before the order is processed. If a child item does not contain a barcode, then no scan will be required" |
| B-12 | Partial | Order simply waits (children reserved). Order split cannot separate composite children; "Auto Split > By Out of Stock" works on whole lines. No substitute or back-order of a single component. | [D14] "Splitting an order with composite items to have child items contained in different orders is not supported."; [D14] "By out of stock: ... groups out-of-stock items into a new order." |
| B-13 | Partial | Availability and composition are location-aware (per-location Tracked, `fulfilmentCenter` parameter); but a composite cannot be split across orders/locations, and warehouse transfers move children only. | [H3]; [A8] GetOrderItemComposition param "Location to get the order item composition for"; [H4] "only stock levels for child SKUs can be moved from one location to another" |
| B-14 | Partial | Price/VAT live on the parent line; children have sold value 0 because "Linnworks cannot estimate what ratio to split". Exception: shipping labels (customs) split the parent value EQUALLY across children. No reference-price split, no mixed-VAT split. | [D1] "the child items will have a sold value of zero... Linnworks cannot estimate what ratio to split the composite retail price." / "the value of the composite is split equally between the child items." |
| B-15 | Unknown | Returns (RMA) and refunds are per order item, refund capped at what was paid for the item; given children have value 0, a component refund would have to be entered against the parent or as "Additional refund". No doc covers returning one component of a composite. | [D18] "You cannot refund more than what the buyer paid for a single item." / "Additional refund button" |
| B-16 | Unknown | Order item exposes `UnitCost` / `DespatchStockUnitCost` per row incl. composite sub-items, but no doc states how parent cost is derived. A third-party analytics vendor rolls child COGS up itself (not evidence of Linnworks behaviour). | [A8] OrderItem "DespatchStockUnitCost"; [T2] "the COGS value for the child SKUs is set to zero once it has been aggregated" |
| B-17 | Full | A composite parent is listed like any SKU (listing tools, channel price). Retail price is set manually on the parent or per channel. | [D1] "Composite items can be listed to sales channels the same way as usual SKUs." / "Linnworks will not calculate the retail price based on child SKUs." |
| B-18 | Partial | Only CSV import (Stock Item Compositions) or manual entry; no import of bundle definitions from a shop/ERP is documented (Magento requires the composite to already exist and match). | [D3]; [D9] |
| B-19 | Partial | Price is always on the Linnworks parent; for channels sending price on children, only the Magento parent/child ignore switches exist. Channel tax toggle per channel ("Use channel tax"). | [D9]; [D20] channels-tax "If Use channel tax setting is enabled, Linnworks will not perform any calculations" |
| B-20 | Partial | Linnworks is itself the stock master and always decrements children only. Where a marketplace fulfils (FBA) composites are unsupported; for Amazon MCF a switch decides whether parent or children are sent. | [H4] "only child items have their available stock levels reserved"; [H2] "FBA integration does not support composites in Linnworks."; [D11] "Send Composite Parent Items to Amazon: For MCF orders only." |
| B-21 | Partial | Split Packaging can put composite children in different packages (the documented workaround for multi-label composites); Despatch reports per channel line (SKU + OrderLineNumber + DespatchedQuantity) with Packages grouped by tracking number. | [D14] "If you need multiple shipping labels printed for composite child items, use the split packaging functionality."; [A2] "the order items might appear multiple times in different groups where they might exist in different packages." |
| G-01 | None | Connector order-line schema has no gift flag; IsService is the only line type flag. | [A1] OrderItem table |
| G-02 | Partial | Free lines are stored as normal lines with price 0 or 100% discount; nothing classifies them as gifts. A partner sells a macro that rewrites such 100% discounts, showing the shape exists in practice. | [A1] `LinePercentDiscount`; [T1] "It finds order items that have been given away free with a 100% discount" |
| G-03 | None | No mechanism to unfold a gift hidden in a paid line or order-level discount. | none found |
| G-04 | Full | Rules Engine **Add items to an order** with an item-level condition (Channel SKU / item title / source) adds the promised gift on download. | [D4] "allows you to automatically add specific SKUs to an order when certain rule conditions are met."; [D7] "Channel SKU" condition |
| G-05 | Partial | Edit order > **Add Product** (cost editable) or **Add Service**; API `AddOrderItem` with optional LinePricing (DiscountPercentage). No gift type, no reason field. | [D13] "Click the Add Product button."; [A8] AddOrderItem "Line pricing is optional with the default values being - PricePerUnit: Stock item retail price - DiscountPercentage: 0" |
| G-06 | Full (caveats) | Rules Engine, action "Add items to an order": up to 10 SKUs, Quantity, retail price incl. tax pulled from inventory, Discount (100% = free). Conditions include total, item/SKU, source/subsource, date placed. New rules do not touch existing orders. Caveats: no "once per customer", no stock check, duplicates on merge/split/resend unless guarded. | [D4] "Discount: Optionally apply a percentage discount to the item. For example, enter 100% for a completely free gift."; [D6] "As rules run only when an order is saved, existing orders will not be affected." |
| G-07 | Full | Composite child with value 0 (children always have sold value 0). Legacy docs use a gift-like example (goal ships with a football). | [D1] "the child items will have a sold value of zero"; [H7] "automatically include Football into the order when Garden Football Goal sells." |
| G-08 | None | No documented stock check, substitute or notice when a rule-added item is out of stock. | none found (D4 silent) |
| G-09 | Partial | Gift is an ordinary line on pick/pack documents and must be scanned like any line; it is not marked as a gift. | [D16]; [D1] scanning |
| G-10 | Partial | Line keeps retail price + 100% discount (rule fills price from inventory and the discount); tax rate cannot be set in the rule. No gift-vs-discount reason typing. | [D4] "Retail price including tax: This field automatically retrieves the retail price including tax" / "You cannot manually change the tax rate or define it in the Rules Engine action." |
| G-11 | None | Nothing ties a gift to a threshold for returns. | none found |
| G-12 | Partial | Only generic SKU sales reports (a gift SKU reports like any SKU); no gift-cost or recipient report. | [D19] reports list; no gift report found |
| G-13 | None | No buyer gift choice. | none found |
| G-14 | Full | **Services** (no SKU) - the docs' own example is gift wrapping; can be added manually or by rule "Add services to an order" with manual price and tax. | [D13] "Services: It is an item that does not have a Linnworks SKU associated with it. For example, gift wrapping."; [D4] "Add services to an order NEW" |
| G-15 | None | Conditions include email, but no counter across orders. | [D7] |
| G-16 | None | Rules: last matching rule wins; scripts/macros run after and can overwrite; no failed-rule state. | [D6] "changes made by Rules Engine may be overwritten by a script or macro." |
| X-01 | Partial | Line = PricePerUnit + Discount % (+ DiscountValue); order-level discount spread evenly by DiscountType; discount is back-calculated from tax-inclusive totals. Shopify discount detail only saved into notes. | [A1] DiscountType; [D17] "The order discount is backward calculated from the line total, removing the tax."; [D12] "Save discount information: If enabled, Linnworks saves additional Discount information in notes." |
| X-02 | Full | Kaufland orders arrive one item, qty 1 each; Order Merge (manual or auto every 15 min). | [D10] "a Kaufland order in Linnworks will always contain a single item with a quantity of one... make use of the Linnworks Order Merge functionality"; [D14] "automatically look for and merge orders every 15 minutes" |
| X-03 | Partial | Per-integration settings exist (Magento bundle switches, channel tax, Amazon MCF parent/children) and connectors declare UI/post-sale capabilities (GlobalConfigSettings, Post Sale Options), but there is no declared capability for bundles or gifts. | [D9]; [A5]; [A4] |
| X-04 | Partial | Operator can add lines after download (edit order, API). Channel-side changes after download: framework supports status and whole-line cancellation updates only; adding a line later from the channel is not documented. | [A1] CancelStatus "Currently only whole lines can be cancelled."; [A8] AddOrderItem |
| X-05 | Partial | One generic non-goods line type: service (IsService), with required unique title. No typed deposit/wallet/points. | [A1] "`True` - The item is a service and when the order is saved it will create a order line service that is not linked to a Linnworks SKU." |
| X-06 | Partial | Raw channel order kept ("raw XML", GetOrderXml) and notes; no per-line audit of who applied which discount was found. | [D20] "all order details are downloaded from the channel in the raw XML format"; [A9]/llms index GetOrderXml "Get order XML received from channel" |

Rating counts: Full 12, Partial 19, None 9, Unknown 3 (43 IDs).

## Integration normalisation

- **One fixed connector contract, flat lines.** Every channel connector returns the same `OrderItem` shape: SKU, Qty (>0), PricePerUnit, TaxRate, LinePercentDiscount, TaxCostInclusive, UseChannelTax, IsService, Options, CancelStatus [A1]. There is no parent pointer, group id, gift flag or bundle-origin field. Consequence: the connector must decide how to flatten bundle shapes before Linnworks sees them; Linnworks cannot tell later.
- **Bundle meaning comes from catalogue linking, not from the order.** A channel line becomes a bundle only because its channel SKU is mapped to a composite parent in inventory mapping; unlinked lines show a "?" and reserve nothing [D20]. Auto-link by SKU exists (WooCommerce) [D20 woocommerce-settings "Auto-link by SKU"].
- **Parent+children channels are solved per connector with a checkbox.** Magento 2 has "Ignore bundle child items" / "Ignore bundle parent items", mutually exclusive, with a manual precondition that the Linnworks composite matches the channel bundle exactly; if wrong, the order double counts [D9][H1]. No equivalent switch is documented for WooCommerce or Shopify.
- **Discount encoding normalised to two numbers.** Line % discount, or an order discount the connector chooses how to spread (AllEvenly, ItemsThenPostage, PostageThenItems) [A1]; Shopify additionally dumps discount detail into notes [D12]. Proportional or per-offer-bundle discounts are not representable.
- **Connectors declare capabilities, mostly for UI.** `GlobalConfigSettings` (IsRefundsVisible, IsCancellationsVisible, IsInventoryMappingVisible, IsMultilocationEnabled...) with the rule "The default behavior is that all features are supported if no settings are provided by the integration" [A5]. `Post Sale Options` returns booleans per action: CanCancelOrderLines, CanCancelOrderLinesPartially, CanAttachRefundToItem, CanAttachRefundToService, RefundShippingTypes flags, plus channel reason tags, "so that the UI is presented accordingly" [A4]. Nothing in either list covers bundles, gifts or discount encoding.
- **Unsupported endpoints return success.** "if an endpoint cannot be implemented then return success and ensure documentation for the marketplace clearly states the function is not supported" [A6]; Linnworks is the source of truth for actions [A6 FAQ].
- **Fulfilled-by-channel paths have their own bundle rule.** FBA: composites unsupported; MCF: one switch sends parent or children [H2][D11]. Shopify: fulfilment orders can become separate Linnworks orders (affects a bundle spread across Shopify locations) [D12].
- **Single-unit channels are merged downstream.** Kaufland one item per order -> Order Merge [D10].

## UX patterns worth copying

1. **Post-sale capability booleans from the connector** (CanCancelOrderLines, CanCancelOrderLinesPartially, CanAttachRefundToItem, ShippingRefundType flags) drive which buttons the operator sees [A4]. Same idea fits "this channel can receive a bundle as one line / as children / can flag gifts", but with fail-closed defaults (see anti-pattern 2).
2. **Two pick-list tables, operator picks granularity**: parent-only vs "granular" including child SKUs; plus scan-every-child with an explicit rule for children without barcode [D16][D1].
3. **Rule conditions that prevent duplicate gifts**: Is Merged, Order Has Been Split, Order Created By Split, Status = Resend, plus "Has composites" and "Item count (no children / no parents)" [D5][D7]. The docs name the exact failure: a resend getting the free gift again [D5].
4. **Rules are not retroactive**: a new rule never touches existing orders [D6]; mirrors the need for a rule creation floor.
5. **Reverse lookup report**: Composite Export filtered by child SKU lists every bundle containing that component [D19] - useful before stocking out a shared component.
6. **Child rows with a parent pointer** (`ParentItemId` on order rows) rather than nested JSON only [A9] - lets each component be reserved, picked and reported while keeping the bundle line.

## Anti-patterns

1. **Children carry value 0 and the split is inconsistent across documents**: zero on the order, equal split on shipping labels, parent price on the invoice line. Margin, mixed VAT and customs values per component cannot be derived [D1].
2. **Capability defaults to "everything supported"** when a connector says nothing [A5], and unsupported endpoints are told to return success [A6]. A connector that silently ignores bundles looks capable.
3. **Bundle normalisation as a per-connector checkbox with a manual matching precondition** (Magento only); a mismatch silently doubles the items with no warning [D9][H1].
4. **Gift = retail-priced stock line with a 100% discount and no gift type**; tax rate cannot be set in the rule, no stock check, no failure state, and a later macro can overwrite rule results [D4][D6]. Partners sell macros to rewrite these lines [T1].
5. **Rigid composites**: one level only, no nested bundles, no buyer choice per slot, cannot split a composite across orders, and a manually untracked parent does not recompute until a child changes [D1][D14][D2].

## New use cases (not in v3)

- **N-01 Duplicate gift on merge / split / resend**: a rule-added gift is added again when orders are merged, split or resent; needs guards per order lineage. Source [D5] "Imagine ORDER A gets a free gift item added by a rule. Later, a resend is created (ORDER B)... ORDER B will also get the same free gift".
- **N-02 Customs / shipping-label value of bundle components**: the carrier label needs a value per physical item even though only the bundle has a price. Source [D1] "when shipping labels are printed... the value of the composite is split equally between the child items."
- **N-03 Bundle weight**: use bundle weight if set, else sum of components; never both. Source [D1] "Linnworks never sums or doubles parent and child SKUs".
- **N-04 Component without barcode on the pack bench**: scanning rules must say what happens to an unscannable component. Source [D1].
- **N-05 Kit pre-built in one warehouse, virtual in another** (stock mode per location). Source [H3] "Tracked status is location-specific."
- **N-06 Bundle sent to an external fulfiller (marketplace fulfilment / 3PL): send parent SKU or component SKUs?** Source [D11] "When enabled, Linnworks will send the composite parent item to Amazon. If the setting is disabled, composite child items will be sent".
- **N-07 Re-valuing a free line** (turn a 100% discount into a partial one offset against a paid line) for reporting/customs reasons. Source [T1].
- **N-08 "Shipped-with" accessory that is itself a sellable stock item** (tracked parent + tracked accompanying item, e.g. goal + football), distinct from a virtual bundle. Source [H7].
- **N-09 Partial-quantity cancellation of a bundle line** is not expressible on many channels (whole lines only). Source [A1] "Currently only whole lines can be cancelled. Cancellation of partial line quantities is not supported." and [A4] CanCancelOrderLinesPartially.

## Conflicts and open questions

- [H2] (older KB) says for FBA kits "Linnworks splits orders into child items", while [D1] (current docs) says the order shows the composite AND its children. Both can be true (children are materialised as rows), but the KB wording suggests replacement. Trust [D1] and [A9] (`ParentItemId` rows) as current.
- [H7] (legacy desktop, archived 2022) says the open-order screen shows only the parent with children on hover; current [D13] shows a Subitems tab. Treat [H7] as legacy UI.
- Rules Engine "Add items to an order" is marked NEW in [D4]; older articles (`rules-engine-logic` KB) list no add-item action and the earlier route was the "Add Items to Orders" macro app [D8], which uses retail or channel price and has no discount field. Trust [D4] for current behaviour.
- Unknown: whether open orders are re-expanded when a composition is edited (B-10); how a single component is returned/refunded (B-15); how composite cost is computed (B-16).

## Confidence

- High: composite model, zero-valued children, equal split on labels, scanning, pick-list options, split restrictions, Magento switches, connector order schema, post-sale capability flags, Rules Engine add-items action.
- Low: anything about invoices beyond "children have value 0"; returns of components; cost roll-up.
