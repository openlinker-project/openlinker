# Phase 2 / 5 - Linnworks: bundles (composite items), gifts and integration normalisation

Researched 2026-11-04. Read-only. Primary sources: Linnworks documentation portal (docs.linnworks.com, ClickHelp; topic text fetched from the
`/article/documentation/<slug>` frame), help.linnworks.com (Freshdesk support articles), apidocs.linnworks.net (Channel Integration framework),
the official SDK github.com/linnworks-dev/LinnworksNetSDK, plus one partner (Rishvi) macro doc as demand signal.
Raw downloads kept in `scratchpad/spike/run2/phase2/lw/` (txt/*.txt, *.md).

Short URL keys used in the table:
- [CI] https://docs.linnworks.com/articles/#!documentation/inventory-composite-items
- [PDC] https://docs.linnworks.com/articles/#!documentation/product-details-composition
- [IMP] https://docs.linnworks.com/articles/#!documentation/import-composites
- [ORD] https://help.linnworks.com/support/solutions/articles/7000024253-inventory-composite-items-in-orders-purchase-orders-warehouse-transfers
- [TRK] https://help.linnworks.com/support/solutions/articles/7000058578-composite-parent-sku-stock-levels-are-wrong
- [NEST] https://help.linnworks.com/support/solutions/articles/7000044542-inventory-control-composite-item-cannot-be-part-of-other-composition
- [FBA] https://help.linnworks.com/support/solutions/articles/7000038834-amazon-fba-listings-with-composite-items
- [M2S] https://docs.linnworks.com/articles/#!documentation/magento-2-settings
- [MAG] https://help.linnworks.com/support/solutions/articles/7000038821-magento-orders-with-bundle-products-are-downloading-incorrectly
- [AMZS] https://docs.linnworks.com/articles/#!documentation/amazon-settings  (and amazon-multi-channel-fulfillment)
- [SHS] https://docs.linnworks.com/articles/#!documentation/shopify-settings
- [RE-A] https://docs.linnworks.com/articles/#!documentation/rules-engine-actions
- [RE-C] https://docs.linnworks.com/articles/#!documentation/rules-engine-conditions-comparators
- [RE-X] https://docs.linnworks.com/articles/#!documentation/adding-items-services-merged-split-resend-orders
- [RE-CAP] https://help.linnworks.com/support/solutions/articles/7000100963-rules-engine-current-capabilities
- [GOM] https://docs.linnworks.com/articles/#!documentation/general-order-management
- [PL] https://docs.linnworks.com/articles/#!documentation/template-designer-pick-list ; packing list: template-designer-packing-list
- [PW] https://help.linnworks.com/support/solutions/articles/7000057008-pickwave-picking-composite-parent-group
- [SPK] https://docs.linnworks.com/articles/#!documentation/split-packaging ; [MS] open-orders-merge-split
- [OCE] https://docs.linnworks.com/articles/#!documentation/open-orders-create-edit
- [RMA] https://docs.linnworks.com/articles/#!documentation/processed-order-rma ; [REF] rma-refunds ; [RET] rma-returns
- [TAX] https://help.linnworks.com/support/solutions/articles/7000005442-order-taxes-and-discount-calculations
- [CN22] https://help.linnworks.com/support/solutions/articles/7000026695-shipping-royal-mail-printing-a-cn22-form
- [SIH] https://help.linnworks.com/support/solutions/articles/7000034390-stock-item-history-did-not-record-sale
- [PA] https://help.linnworks.com/support/solutions/articles/7000050176-pivotal-analytics-cost-of-shipped-products-margin
- [CI-ORD] https://apidocs.linnworks.net/docs/channel-integration-endpoint-orders ; [CI-DSP] ...-endpoint-despatch ; [CI-UC] ...-endpoint-user-config ; [CI-PSO] ...-endpoint-post-sale-options ; [CI-REF] ...-endpoint-refund
- [SDK] https://github.com/linnworks-dev/LinnworksNetSDK/blob/master/Linnworks/src/netcore/LinnworksAPI/ClassBase/ChannelOrderItem.cs
- [API-OD] https://apidocs.linnworks.net/reference/getopenordersdetails (OrderItem.CompositeSubItems)
- [KL] https://docs.linnworks.com/articles/#!documentation/kaufland-rules
- [VCS] https://docs.linnworks.com/articles/#!documentation/template-designer-amazon-vcs
- [RIS] https://docs.rishvi.co.uk/linnworks/ris-sm-1015-reduceitemdiscount (third-party partner macro)

## Core model in one paragraph

A **composite item** is a parent SKU (a normal inventory item) with a **Composition** tab listing child SKUs + quantities. Only ONE level
(no composite in a composite, [NEST]). The parent is normally **Not Tracked** (Minimum level = -1, red circle in the *Tracked* column) and
its stock = min over children per location; if set **Tracked** (green) it keeps its own stock, and the switch is **per location** [TRK].
On an order the parent line carries the price; children are shown under it (**Subitems** tab / `CompositeSubItems` in the API) with a
**sold value of zero**, because "Linnworks cannot estimate what ratio to split the composite retail price" [CI]. Stock is reserved and
history written only on children [ORD][SIH]. Wherever a value per physical item is unavoidable (shipping labels, CN22/23 customs, "split
order into packages of maximum value") the parent value is split **equally** between children [CI][CN22][RE-A].
Gifts have no first-class object: the only native mechanism is the **Rules Engine action "Add items to an order"** (up to 10 SKUs, qty,
retail price inc. tax pulled from the product, discount % e.g. 100%), released 2025-26 and explicitly pitched for "free gifts, samples or
promotional items" [RE-A].

## Per-use-case table

| ID | Rating | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | My Inventory > Add New SKU > Product Details > **Composition** tab > Add New > search children > set **Quantity** > Save. Bulk: Settings > Import Data > **Stock Item Compositions** (Parent SKU, Child SKU, Quantity). Removal: Delete import > *Delete Composite Child Items*. Report: Query Data > *Composite Export* (incl. "which composites contain child X"). | One level only; parent and children must pre-exist; cannot contain itself. Parent price is NOT derived - set manually or via Channel Specific Listing Price. | [CI][PDC][IMP][NEST] |
| B-02 | Full | Parent Not Tracked => available = min over children (floor(child avail / qty)), recalculated per location; children sold alone draw from the same stock; parent listing gets the derived qty via inventory sync. | Quirk: if set Not Tracked manually, parent qty does not refresh until a child level changes. In-Open-Order column empty for parents. | [PDC][TRK][CI] |
| B-03 | Partial | Tracked vs Not Tracked toggle, **per location**: a parent can hold its own stock (pre-built kit) in one warehouse and be virtual in another. FBA guidance: model pre-packed kits as ordinary (non-composite) items. | No assembly/"build kit from components" workflow found (unverified absence). Behaviour of children on a Tracked parent order not documented (unverified). | [TRK][FBA] |
| B-04 | Full | Link the channel SKU (Allegro offer, Amazon SKU, Kaufland id_offer...) to the composite parent in **Inventory Mapping** (or Stock Item Linking import / Auto-link by SKU). Order downloads with the parent line; children auto-attached as Subitems; children reserved. | Mapping is per Source/SubSource listing; parent must be exact composition. | [CI][ORD] channels-inventory-mapping |
| B-05 | Partial | Magento 2 only: channel Settings > Order > **Ignore bundle child items** (keep parent, Linnworks expands from its own composition) or **Ignore bundle parent items** (keep channel children, drop virtual parent) - mutually exclusive. Off = parent + children both download (double counting). | No equivalent documented for WooCommerce bundle plugins, Shopify or others; condition: Linnworks composition must exactly match the channel bundle. | [M2S][MAG] |
| B-06 | None | Channel integration order model has no grouping/parent field; grouped children arrive as independent lines and are treated as single SKUs. | Group identity lost (no bundle on bench/returns). | [CI-ORD][SDK] |
| B-07 | Partial | Lines keep their own price; channel discount enters as `LinePercentDiscount` (per line, %) or order-level `Discount` + `DiscountType` = AllEvenly / ItemsThenPostage / PostageThenItems. | Order discount is split **evenly**, not proportionally to line value; percent-only line discount. No link "these N lines form one offer bundle". | [CI-ORD][TAX] |
| B-08 | Full | Composite of one child with qty N (doc example "Box Green Bricks x 25"); order shows one box; **Pickwave** can group by composite parent (pick "1 box" instead of "25 bricks"). Amazon Seller Flex multi-box ASIN = composite with >=2 children or 1 child qty 2. | - | [PW] help 7000095498 |
| B-09 | None (workaround) | Composition is fixed. Workaround for configurable bundles: Magento "Ignore bundle parent items" -> buyer-chosen children come in as normal lines. | Bundle identity and parent price lost in workaround. | [M2S] |
| B-10 | Partial (unverified) | Children are materialised on the order at download (`CompositeSubItems`), so later composition edits plausibly do not rewrite open orders. | Not stated in docs; behaviour on composition change for open orders unverified. | [API-OD][CI] |
| B-11 | Full | Pick list tables: **Order Items** (parents) vs **Order items granular (No Composite Parents)** (children); packing list **Orders (No Composite Parents)**; Process Order requires scanning children; setting **"Scanning composite parent will scan all child items"**; children without barcode skip scan. Pickwave "group by composite parent". | Bench is a desktop/web Process Order screen, not a dedicated pack station. | [PL][GOM][CI][PW] |
| B-12 | Partial | Order item grid shows availability; pre-processing check **Stock is sufficient** blocks processing; operator can park/lock, edit lines in Open Orders. | **Splitting an order so composite children land in different orders is not supported**; no substitution/back-order logic; Rules Engine cannot read stock. Partner macros fill the gap (Rishvi "Out of stock order splitter"). | [MS][GOM][RE-CAP] |
| B-13 | None | Composite stock is computed per location and the order sits in one location; children cannot be split into separate orders. Must warehouse-transfer children (parents cannot be transferred). | - | [ORD][MS] |
| B-14 | Partial | Documents show parent line with the full price; children carry 0 value. Customs (CN22/23) and labels split parent value **equally** across children; tax rate = parent item tax rate (or channel tax). | No split by component reference prices; mixed-VAT bundles not handled (single tax rate on parent). Whether invoice template prints children not documented (unverified). | [CI][CN22][TAX] |
| B-15 | Partial (unverified) | Processed Orders > Action > Returns, Exchanges & Resends > Add RMA per item: return qty, scrap qty, reason, refund amount; Book or Action. Refunds can only be pushed to some channels (Amazon, Back Market, BigCommerce, eBay, Magento 2, Shopify, Walmart). | "You cannot refund more than what the buyer paid for a single item" + children valued 0 => refunding one component needs the **Additional refund** line; no lost-bundle-discount logic; whether a child line can be selected for RMA restock not documented. Composite parent cannot be scrapped. | [RMA][REF][RET] help 7000018216 |
| B-16 | Partial | Stock unit cost captured per order item at processing ("Dispatched Stock Cost"); Pivotal Analytics pre-built report **Product sales by month (composites)**; Query Data *Composite Parent Sales History* (order counts). | Pivotal not on all plans; explicit "bundle cost = sum of children" rule not documented (unverified). | [PA] query-data-composite-parent-sales |
| B-17 | Full | Composite parents are listed like any SKU (listing tool / configurators), stock pushed as derived qty; separate parent price or Channel Specific Listing Price per channel. Amazon MCF setting **Send Composite Parent Items to Amazon** (parent vs children sent to the fulfiller). | FBA does not support composites (treat as pre-packed item). | [CI][AMZS][FBA] |
| B-18 | None | No import of bundle definitions from channels/ERP found; compositions are created in Linnworks (UI/CSV). | Unverified absence for Shopify "Extract inventory". | [PDC][IMP] |
| B-19 | Partial | Normalised rule: parent carries price, children 0. Per-channel knobs: Magento ignore parent/child, "Use channel tax settings" (Magento/Shopify/Woo/eBay sites), Magento **Coupon control** (Line item / Order note / Ignore), Shopify **Save discount information** (to notes), Shopware vouchers -> service item or spread as % discount. | Knobs exist only where the integration author added them; no shared vocabulary. | [M2S][SHS][TAX] help 7000011642 |
| B-20 | Partial | Doctrine: "Linnworks is the source of truth" for stock/dispatch/refunds; for 3P fulfilment the Amazon MCF toggle decides whether the fulfiller gets parent or children. | No setting for "master already decremented components". | [CI FAQ][AMZS] |
| B-21 | Partial | **Split Packaging** supports composites: selecting a parent moves all children; deselect parent to move children into different packaging bins; Multi-box items (Postage Definition > Parts) prints several labels for one SKU. Despatch to channel is by channel `OrderLineNumber` + `Packages[]` (items may appear in several packages, partial `DespatchedQuantity`). | How a parent split across packages is reported per package not documented (unverified). | [SPK][CI-DSP] multi-box-items |
| G-01 | None | Channel order model has no gift/free flag (`ChannelOrderItem`: price, qty, LineDiscount, tax, IsService, Options). An integration could only smuggle it via item Options or extended properties. | - | [SDK][CI-ORD] |
| G-02 | Partial | 0.00 lines or 100%-discount lines are ingested as ordinary lines; nothing recognises them as gifts. Partner macro **Reduce Item's Discount** finds `CostIncTax<=0 AND Discount=100`, re-values them and offsets a paid line, marking `ItemValueChanged=Yes` - i.e. merchants need gift lines to carry value. | Native: no detection. | [RIS] |
| G-03 | None | Folded discounts arrive as order-level Discount spread evenly, or as notes (Shopify), coupon line/note (Magento). Gift units inside a paid line are invisible. | - | [CI-ORD][SHS][M2S] |
| G-04 | Full | Rules Engine rule: condition on **Channel SKU / SKU / Source / Subsource** + action **Add items to an order** (gift SKU, qty, price, 100% discount). | Rules run only on paid, unlocked, unparked orders; rules created later do not apply retroactively. | [RE-A][RE-C][RE-CAP] |
| G-05 | Full | Open Orders > open order > Items > **Add Product** (from My Inventory) or service; set cost / Discount % in the Costs tab; scanning at Process Order provides the proof. | No "gift" marker other than notes/additional info. | [OCE][GOM] |
| G-06 | Partial | Rules Engine IF/THEN: conditions Total charge, Subtotal, SKU, Channel SKU, Item count, Source/Subsource, Country, Identifier, Received day/hour; action Add items (<=10 SKUs) with discount %. Duplicate guards: conditions **Is merged / Order has been split / Order created by split / Status != Resend**. Rule ordering by number. | **No calendar date condition** (only weekday/hour/minute) => campaign dates = switch rule on/off manually (unverified scheduling). Admin-only. "Once per order" only via the guards. Can add notes (External/Processing) to explain. | [RE-A][RE-C][RE-X] |
| G-07 | Partial | A free item can be a child of a composite (children are always 0-valued anyway). | No gift semantics/reporting for it. | [CI] |
| G-08 | None | Rules Engine "is currently unable to check an item's available stock level" - the gift is added even if out of stock; order then fails *Stock is sufficient* at processing. | Silent until packing. | [RE-CAP][GOM] |
| G-09 | Partial | Added gift appears as a normal line on pick/pack lists and must be scanned; rule can add a Processing note and an Identifier/tag. | No "GIFT" label/section on slip unless built in Template Designer. | [RE-A][PL] |
| G-10 | Partial | Rule-added gift line carries retail price inc. tax from product + discount % (so invoice shows list price and 100% discount); tax rate from product settings, cannot be overridden in the action. Amazon VCS invoices list shipping, gift wrap and promotional discounts as separate order-item entities. | No zero-VAT-bucket handling, no typed reason (discount-in-goods vs gift). | [RE-A][VCS] |
| G-11 | None | No link between gift and qualifying lines; RMA treats lines independently. | - | [RMA] |
| G-12 | Partial | Mark gift orders with Identifier / tag / extended property via the same rule, then Query Data / Pivotal reports; dispatched stock cost is recorded per line. | No dedicated gift cost or recipient register. | [RE-A][PA] |
| G-13 | None | Not modelled (only if the channel sends the chosen gift as a line). | - | - |
| G-14 | Full | Amazon gift wrap becomes a **service line** ("GiftWrap -" title, price = wrap fee, qty 1) and the gift message goes to order notes (legacy desktop doc; current behaviour unverified); Magento 2 gift option messages shown in notes; Rules Engine **Add services to an order** (e.g. "Gift wrapping", price, tax rate set manually). | Service tax rate must be typed in the rule (no country rate). | [RE-A] help 7000005367; desktop.linnworks.com/Doc/Amazon_Giftwrap (redirects) |
| G-15 | None | Rules engine reads only the current order's flat data; no customer history. | - | [RE-CAP] |
| X-01 | Partial | Neutral line = PricePerUnit + Discount % + TaxRate (+ TaxCostInclusive); order Discount spread by DiscountType; "Use channel tax" vs Linnworks back-calculation; the discount is "backward calculated from the line total, removing the tax". | Percent-only, evenly distributed; no reduction reason codes. | [CI-ORD][TAX][SDK] |
| X-02 | Partial | Kaufland: each unit arrives as its own order (qty 1); merge via Open Orders merge or **Automatically merge orders** (same customer/address/source/subsource/currency/service, every 15 min). | Merge works at order level; identical lines not consolidated (unverified). | [KL][MS] |
| X-03 | Partial | Integration declares capabilities and settings itself: wizard/config `ConfigItems` (any BOOLEAN/LIST setting), `GlobalConfigSettings` toggles (IsRefundsVisible, IsCancellationsVisible, IsShippingMappingVisible, IsInventoryMappingVisible, IsPriceChangeVisible, IsMultilocationEnabled...), `IsListingSupported` in manifest, `PostSaleOptions` booleans (CanCancel, CanCancelOrderLines, CanCancelOrderLinesPartially, CanRefund, CanAttachRefundToItem, CanRefundAdditionally, CanReturn...). | No standard flags for bundle shape, price-bearing line or gift flag; each direct integration invents its own option (Magento's Ignore bundle child/parent). | [CI-UC][CI-PSO] channel-integration overview |

## Integration normalisation (how Linnworks does it)

1. **One thin inbound order contract for every channel** (`Order` + `OrderItem`: SKU, OrderLineNumber, PricePerUnit, Qty, TaxRate,
   TaxCostInclusive, UseChannelTax, LinePercentDiscount, IsService, Options; order Discount + DiscountType). No parent/child, no gift flag,
   no group id. Bundle expansion happens AFTER download, by mapping channel SKU -> Linnworks SKU; if that SKU is a composite parent,
   children are attached from Linnworks' own composition. So the bundle definition lives only in the OMS; the channel is never asked.
2. **Per-channel order settings for the shape problem**, implemented ad hoc per direct integration: Magento 2 *Ignore bundle child items*
   / *Ignore bundle parent items* (mutually exclusive), *Coupon control* (line item / note / ignore), *Use channel tax settings*,
   Shopify *Save discount information*, Shopware vouchers -> service line or spread %, Amazon MCF *Send composite parent items*.
3. **Capability declaration by the integration**: Channel Integration apps return `GlobalConfigSettings` booleans that hide/disable UI
   (refunds, cancellations, mapping buttons, multi-location), `IsListingSupported` in the manifest, and `PostSaleOptions` booleans
   (line cancel, partial line cancel, refund attached to item/service, shipping refund type) so the RMA/refund UI adapts per channel.
   Free-form `ConfigItems` give each integration its own settings page. "Default behaviour is that all features are supported".
4. **Outbound always speaks the channel's line**: despatch, refunds and cancellations reference the channel `SKU` + `OrderLineNumber`
   (with `Packages[]` and partial `DespatchedQuantity`), not the internal children - the composite expansion never leaks out.
5. **Linnworks is declared source of truth** for stock/dispatch/refunds/cancellations; paid orders are effectively frozen (only status
   / line cancellation updates are accepted from the channel).

## UX patterns worth copying

- **Per-location Tracked/Not-Tracked switch** on the bundle parent: same SKU is a pre-built kit in one warehouse and virtual in another.
- **Two table flavours on documents**: "Order Items" (bundles as one line) vs "granular (No Composite Parents)" (physical units) - pick
  per document; plus pickwave "group by composite parent" for multipacks.
- **"Scanning composite parent will scan all child items"** as an explicit setting; children without barcode do not block.
- **Duplicate-safety conditions for auto-added items**: Is merged / Has been split / Created by split / Status = Resend, with a doc
  page explaining exactly how a free gift duplicates on resend/split/merge.
- **Post-sale capability booleans returned by the integration** (CanCancelOrderLinesPartially, CanAttachRefundToItem...) so the UI
  hides actions the channel cannot do, instead of failing.
- **Rule action carries list price + discount %** (100% for a gift) rather than a 0.00 price - the document keeps the gift's value.

## Anti-patterns

- **Children valued at 0 and parent value split equally** for customs/labels - wrong for mixed-VAT bundles and for refunding one
  component (refund capped at what "the buyer paid for a single item" = 0).
- **Bundle-shape handling only as a Magento-specific toggle** with a prerequisite "composition must exactly match" - every other channel
  (WooCommerce plugins, Shopify bundles) is left to double count.
- **Gift rule cannot see stock** and has no calendar date condition: gift silently added when out of stock; campaigns depend on someone
  remembering to switch the rule off.
- **No gift identity at all**: ecosystem had to build a macro to re-value 100%-discount lines and rebalance a paid line (G-02).
- **Composite children cannot be split into separate orders** (B-12/B-13), and no nesting - forces flattening of kits-of-kits.

## New use cases surfaced

- NEW-1 Per-location kit mode: same bundle pre-built (own stock) in warehouse A, virtual in B.
- NEW-2 Bundle sent to a 3P fulfiller (Amazon MCF / FBA): choose parent vs children per fulfiller.
- NEW-3 Auto-added gift must not duplicate on merge, split or resend orders.
- NEW-4 Multi-box single SKU (one product shipped in several parcels, one label each) - the inverse of a bundle.
- NEW-5 Gift lines must carry a declared value for customs/accounting while the order total stays unchanged (re-value + offset).
- NEW-6 Channel without multi-unit orders (Kaufland) splits one bundle purchase into N orders -> merge before applying gift/bundle rules.

## Confidence

- High: composite model, stock rules, zero-valued children, equal value split, Magento bundle toggles, Rules Engine add-items/services
  and duplicate conditions, channel integration contract and capability booleans.
- Low / unverified: returns of one component, invoice template rendering of children, Tracked-parent order behaviour, Amazon gift wrap
  in current Linnworks.net (source is the retired desktop doc), absence of bundle import from channels, scheduled rules.
