# Phase 2 / competitor 5: Linnworks (bundles = "Composite items", gifts)

Researched 2026-11-04. Read-only. Linnworks' own help moved: desktop.linnworks.com/Doc/* now 301 -> docs.linnworks.com (landing only), LinnLearn tutorials need login, community forum threads (help.linnworks.com/support/discussions/*) redirect to the homepage when fetched. So several facts below come from search-engine snippets of those pages, the official .NET SDK on GitHub, apidocs.linnworks.net, and third-party app docs (Rishvi, Rigidas epicklist). Every row says which.

## 1. Sources consulted

Official help (help.linnworks.com)
- [S1] Inventory - composite items in orders / purchase orders / warehouse transfers: https://help.linnworks.com/support/solutions/articles/7000024253-inventory-composite-items-in-orders-purchase-orders-warehouse-transfers
- [S2] Composite Parent SKU stock levels are wrong: https://help.linnworks.com/support/solutions/articles/7000058578-composite-parent-sku-stock-levels-are-wrong
- [S3] Inventory - removing composite child items: https://help.linnworks.com/support/solutions/articles/7000011166-inventory-removing-composite-child-items
- [S4] Inventory Control - Composite item cannot be part of other composition: https://help.linnworks.com/support/solutions/articles/7000044542-inventory-control-composite-item-cannot-be-part-of-other-composition
- [S5] Pickwave - Picking composite parent group: https://help.linnworks.com/support/solutions/articles/7000057008-pickwave-picking-composite-parent-group
- [S6] Magento orders with bundle products are downloading incorrectly: https://help.linnworks.com/support/solutions/articles/7000038821-magento-orders-with-bundle-products-are-downloading-incorrectly
- [S7] Amazon - FBA listings with composite items: https://help.linnworks.com/support/solutions/articles/7000038834-amazon-fba-listings-with-composite-items
- [S8] Composite weight article: https://help.linnworks.com/support/solutions/articles/7000040894
- [S9] Import types (Stock Item Compositions Import): https://help.linnworks.com/support/solutions/articles/7000026455
- [S10] Scrapping (composites cannot be scrapped): https://help.linnworks.com/support/solutions/articles/7000018216
- [S11] Rules Engine - logic (2020 action list): https://help.linnworks.com/support/solutions/articles/7000039317-rules-engine-logic
- [S12] Refunds: https://help.linnworks.com/support/solutions/articles/7000027285-refunds
- [S13] Locations - multiple warehouses: https://help.linnworks.com/support/solutions/articles/7000023181-locations-multiple-warehouses
- [S14] Shopware item, service or discount: https://help.linnworks.com/support/solutions/articles/7000011642-shopware-item-service-or-discount
- [S15] Dispatch Console item scanning: https://help.linnworks.com/support/solutions/articles/7000057011
- [S16] Forum: Option for composite items to show in the invoice (snippet only): https://help.linnworks.com/support/discussions/topics/7000013571
- [S17] Forum: Composite product parent view - show child sku stock levels (snippet only): https://help.linnworks.com/support/discussions/topics/7000026997
- [S18] Forum: Composite bin rack locations on pick lists (snippet only): https://help.linnworks.com/support/discussions/topics/7000007834
- [S19] Forum: Composite and manufactured items (snippet only): https://help.linnworks.com/support/discussions/topics/7000039187
- [S20] Forum: Allow composite values of less than 1 (snippet only): https://help.linnworks.com/support/discussions/topics/7000007223
- [S21] Old desktop doc "Composite Items - Item composition using granular items" (snippet only, page now redirects): https://desktop.linnworks.com/Doc/Composite_Items_Item_composition_using_granular_items
- [S22] Old desktop doc "Amazon Giftwrap" (snippet only): https://desktop.linnworks.com/Doc/Amazon_Giftwrap.html
- [S23] Old desktop changelogs (snippets: exchange bookings of composite children, resend composites, split not copying order item options): https://desktop.linnworks.com/Doc/Linnworks_ChangeLog_201406.html (and 2014-2015 siblings)
- [S24] Old desktop doc returns/resend/exchange (snippet): https://desktop.linnworks.com/Doc/Processing_Order_Refunds_Exchanges_and_Returns.html

API / SDK
- [A1] LinnworksNetSDK OrderItem class (GitHub, official): https://github.com/linnworks-dev/LinnworksNetSDK/blob/master/Linnworks/src/netcore/LinnworksAPI/ClassBase/OrderItem.cs
- [A2] LinnworksNetSDK RulesEngineActionType enum: https://github.com/linnworks-dev/LinnworksNetSDK/blob/master/Linnworks/src/netcore/LinnworksAPI/ClassBase/RulesEngineActionType.cs
- [A3] LinnworksNetSDK IOrders interface (AddOrderItem, AddOrderService, GetOrderItemComposition, SplitOrder, SetOrderPackagingSplit, SetAdditionalInfo): https://github.com/linnworks-dev/LinnworksNetSDK/blob/master/Linnworks/src/netcore/LinnworksAPI/Interfaces/IOrders.cs
- [A4] apidocs GetOrderItemComposition: https://apidocs.linnworks.net/reference/getorderitemcomposition
- [A5] apidocs AddOrderService: https://apidocs.linnworks.net/reference/addorderservice
- [A6] apidocs AddOrderItem: https://apidocs.linnworks.net/reference/addorderitem
- [A7] apidocs despatch FAQ: https://apidocs.linnworks.net/docs/endpoint-despatch-faq
- [A8] apidocs index (Returns/Refunds, RMA booking, Rules Engine endpoints): https://apidocs.linnworks.net/llms.txt

Third-party / product news
- [T1] Rishvi "Reduce Item Discount" macro: https://docs.rishvi.co.uk/linnworks/ris-sm-1015-reduceitemdiscount
- [T2] Rishvi app docs index: https://rishvi.gitbook.io/rishviappdocuments
- [T3] Rishvi "Split Every" macro (composite handling): https://docs.rishvi.co.uk/linnworks/ris-rm-2298-split-every-macro
- [T4] Linnworks Q2 product updates (Reduce Item Discount macro "runs as an action of the Rules Engine"): https://www.linnworks.com/news/linnworks-q2-product-updates-2/
- [T5] Linnworks Q4 product updates (Fulfilment Networks Order Split): https://www.linnworks.com/news/linnworks-q4-product-updates-2/ and search snippet on Split First / Split Last / No Split
- [T6] Rigidas epicklist "Composite Mode": https://docs.rigidassoftware.co.uk/epicklist
- [T7] ecomclips composite import walkthrough: https://ecomclips.com/blog/linnworks-integration/
- [T8] Conjura "Handling bundles in Brightpearl and Linnworks data": https://help.conjura.com/en/articles/10155870-handling-bundles-in-brightpearl-and-linnworks-data
- [T9] opsmavix "Linnworks for manufacturing": https://opsmavix.com/blog/linnworks-for-manufacturing/
- [T10] theretailexec review (pros/cons; "Order Item Adder App" mention Feb 2026 via search snippet): https://theretailexec.com/fr/tools/avis-linnworks/
- [T11] Trustpilot (snippet only; page blocked): https://uk.trustpilot.com/review/www.linnworks.com?page=23
- [T12] Bragan SOP "create discount to customer" (snippet: Add New in edit order): https://sop.bragan.net/sales-channels/linnworks-sop-create-discount-to-customer/index.html

## 2. The Linnworks model in one page

- A bundle is a **Composite item**: a "virtual" parent SKU whose **Composition** tab lists child SKUs + quantity [S1][S9][S17]. Children are ordinary physical stock items.
- Bundle stock is NOT a separate model; it falls out of the **Tracked** flag, per location: parent **Untracked** (red circle in the Tracked column of My Inventory) => stock = computed from children ("the system will be calculating the stock level from the minimum of the child items" [S21 snippet]); parent **Tracked** (green) => it keeps its own stock and order processing decrements it [S2]. Tracked status is "set per location, so one SKU can be Tracked in one location and Untracked in another" [S2]. Bulk toggle: inventory import with Minimum Level = -1 (untracked) or positive (tracked) [S2].
- "A Composite parent item will only calculate the stock level from child items and orders in the same Location" [S21 snippet].
- One layer only: saving fails with "Composite item cannot be part of other composition"; fix = flatten [S4]. Audit with Dashboards > Query Data > Composite Export [S4].
- Bulk setup: Settings > Import Data > Import Now > Type "Stock Item(s) Compositions", columns Parent SKU / Child SKU / Quantity [S9][T7]. Removal: Import Type Delete / Sub Type "Delete Composite Child Items" [S3].
- Removing all children: parent stops being composite; "Active linked listings are updated with a zero stock level"; parent stock recalculated in every location [S3].
- Weight: parent weight if set, else sum of children; "never sums or doubles parent and child" [S8].
- Composite parent cannot go on a purchase order (pop-up; you choose qty, click "Accept", children are added to the PO), cannot be warehouse-transferred (search returns nothing; transfer children; parent levels recalculated after), cannot be scrapped [S1][S10].
- Order: order line = composite parent; only children reserve stock; only children get Stock Item History entries, at processing [S1]. Open Orders: "the order item is displayed as normal (the parent), when you move the mouse over the stock item indicator you can review all composite items" [S21 snippet].
- API: `OrderItem.CompositeSubItems: List<OrderItem>` (nested sub-lines), `OrderItem.CompositeAvailablity`, `IsService`, `AdditionalInfo: List<OrderItemOption>` (order item options), `PartShipped`/`PartShippedQty`, `DespatchStockUnitCost`, `Discount` (%) + `DiscountValue` [A1]. `GetOrderItemComposition(orderId, stockItemId, fulfilmentCenter)` returns the composition of a line for a location [A3][A4].
- Gifts: no gift concept. Tools: manual edit (Open Orders > right-click > Actions/edit > "Add New", type SKU, double-click, set "Discount %" [T12]); API `AddOrderItem` with `LinePricing {PricePerUnit, DiscountPercentage, TaxRatePercentage, TaxInclusive}` [A6]; `AddOrderService {Service, Cost, TaxRate, DiscountPercentage, Quantity}` [A5]; Rules Engine action types in the official SDK now include `AddItemToOrder`, `AddServiceToOrder`, `AddNoteToOrder` [A2] (the 2020 help article lists only 12 actions without them [S11]; UI labels and options of the new actions not found in public docs = unverified).

## 3. Per-use-case table

| ID | Cov | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Inventory > My Inventory > item > Composition tab (child SKU + qty), or bulk CSV import "Stock Item Compositions" (Parent SKU, Child SKU, Quantity) | one layer only; integer qty (forum asks for <1 [S20]); Composition tab shows no child stock (feature request [S17]) | S1, S4, S9, T7, S17 |
| B-02 | Full | Parent Untracked => stock = min over children per location, recomputed on every child change; linked channel listings get the computed figure; one child can sit in many composites and be sold alone | per location only; new composition needs a child stock adjustment to initialise (snippet); wrong figures when parent left Tracked by mistake (own KB article) | S1, S2, S3, S21 |
| B-03 | Partial | Set parent to Tracked (green) in a location => it has its own stock like a normal item ("pre-packaged item" option for FBA) | no kitting/assembly step converting children into kits; per-location flag confusion; forum: composite shows "possible" units not assembled units | S2, S7, S19, T9 |
| B-04 | Full | Channel SKU is linked to the composite parent; order line = parent, children reserved; FBA: Linnworks splits composite into children when submitting | needs link set up; FBA composites otherwise unsupported | S1, S7 |
| B-05 | Partial | Per channel setting, e.g. Magento: Settings > Channel Integrations > Edit > Order > "Ignore Bundle Child Items" (only if linked composite has exactly matching children); off => parent and children downloaded as separate lines (double count) | per-integration, exact-match requirement | S6 |
| B-06 | None (unverified) | no group recognition found; children arrive as ordinary lines | | - |
| B-07 | Partial | channel discounts land as Discount %/DiscountValue per line, or as a service item (Shopware: taxed voucher => Service Item; untaxed => spread as % over other lines) | no "discount group" concept | S14, A1 |
| B-08 | Full | composite with one child at qty N ("Box Green Bricks x 25"); pickwave can show box or 25 bricks | | S5 |
| B-09 | Partial | composites are fixed; variable bundles only via channel sending children (B-05 off) or order item options (AdditionalInfo) | no slot/choice model | S6, A1 |
| B-10 | Unknown | order line carries CompositeSubItems; GetOrderItemComposition is per order+location; whether sub-items are frozen at order time not documented | composition edits: no doc on effect on open orders | A1, A4, S3 |
| B-11 | Partial | Open Orders: parent line, hover stock indicator to see children; pick list templates have "Order Items" table (with PrintingComposites column) and "Composite Child Items" table; Pickwave can group by composite parent; Dispatch Console item scanning exists | bin rack of composite children not on pick list (forum); scanning behaviour for composites undocumented; third-party picklist apps add "Composite Mode: Parent/Child" | S5, S15, S18, S21, T6 |
| B-12 | Partial | order shows stock indicator; manual split (drag line to new split order), Split Packaging (Actions > Packaging > Split Packaging), Fulfilment Networks "Split First / Split Last / No Split" across locations | no substitute (one 3rd-party blog claims pre-approved substitute, unverified); no component-level hold | A3, A7, T5, T9 |
| B-13 | Partial | composite stock computed per location; order sits in one location; Fulfilment Networks split moves parts to locations with stock | whether one composite's children can be split across locations: unknown | S13, S21, T5 |
| B-14 | Partial | invoice template item table editor can include composite parents and children (forum); revenue on parent line, children carry no price (Conjura on LW data) | no per-component price/VAT split | S16, T8 |
| B-15 | Partial (unverified detail) | Processed Orders > right-click > Action > Refunds: per-item refund; Returns & Refunds booking with "Return to Location"/Scrap; changelog shows exchange bookings of composite children | no lost-bundle-discount calc; component-level RMA of a composite not documented | S12, S23, S24, A8 |
| B-16 | Partial | order lines carry DespatchStockUnitCost; Conjura sums child COGS itself when parent has none (suggests no automatic roll-up, unverified) | | A1, T8 |
| B-17 | Full | composite parent listed like any SKU; computed stock pushed to linked listings (set to 0 if composition removed) | FBA no | S3, S7 |
| B-18 | Partial | CSV import only; channel bundles must be mapped to a pre-made composite (Magento) | no import of shop pack definitions | S6, S9 |
| G-01 | None | no gift flag; Amazon IsGift => gift wrap service + note (see G-14) | | S22 |
| G-02 | Partial | 0-value / 100% discount lines imported as ordinary lines (Discount=100); "Reduce Item Discount" Rules Engine macro gives them a value | no gift recognition | T1, T4 |
| G-03 | None (unverified) | | | - |
| G-04 | Partial | operator adds the item by hand or by rule (G-05/G-06) | | T12, A2 |
| G-05 | Full | Open Orders > edit order > "Add New" > search SKU > double-click; set "Discount %" (100 for free); API AddOrderItem with LinePricing | no "gift" marker on the line | T12, A6 |
| G-06 | Partial (unverified UI) | Rules Engine conditions (total charge, weight, items, channel, extended properties, regex) + action "Add item to order" (AddItemToOrder in official SDK enum); rules run when order is saved, top to bottom | one action per rule; no per-customer limit, "while stocks last", once/repeat found; Linnworks announced an "Order Item Adder App" (Feb 2026, no details) | A2, S11, T10 |
| G-07 | Unknown | a child of a composite could be any stock item; parent carries price | | S1 |
| G-08 | Partial | added gift is a normal stock item: reserved and decremented; out of stock => red stock indicator | no stop/swap/skip logic | S1 |
| G-09 | Partial | gift appears as a normal line on pick list, Dispatch Console scan | no visual gift marker (macro writes AdditionalInfo "ItemValueChanged = Yes") | S15, T1 |
| G-10 | Partial | line with Discount 100%; Reduce Item Discount macro: lines with CostIncTax <= 0 and Discount = 100 get a configured % (e.g. 50), and the summed value is taken off the first paid line's PricePerUnit so the total is unchanged ("Finance teams get a value on every order line") | rebalances a single paid line; warning + higher total if no line is large enough | T1, T4 |
| G-11 | None | | | - |
| G-12 | None (unverified) | standard sales reports only | | - |
| G-13 | None | | | - |
| G-14 | Partial | Amazon: gift wrap price => service item renamed "GiftWrap - ..." (IsService), gift message copied into order notes | Amazon-specific | S22, A1 |
| X-01 | Partial | per line Discount % + DiscountValue; Linnworks "back calculates" from channel XML (Open Orders > View Order > Properties > Order XML); vouchers as service items or spread % | per-channel logic | S14, A1 |
| X-02 | Unknown | merge orders exists (MergeOrders); Kaufland unit merging not documented | | A3 |

## 4. UX patterns worth copying
- Stock indicator on the order line with hover showing the component breakdown and per-child availability (cheap way to explain "why is this bundle red").
- One "Tracked/Untracked" switch per location deciding virtual vs pre-built kit, visible as a red/green dot in the inventory grid.
- Purchase order: adding a bundle explodes it into its components with a quantity prompt; transfers only of components.
- Pick list / pickwave toggle: show the bundle as one box or its components (parent vs child mode), chosen per process.
- Finance-friendly gift line: give free lines a value and rebalance against a paid line so totals do not move (Linnworks needs a paid macro for it; we can do it natively with an audit marker).
- Channel-level "this channel sends bundle children too, ignore them" setting with a strict match check.

## 5. Anti-patterns / complaints
- Wrong bundle stock because the parent was left "Tracked"; whole KB article exists for it.
- One-layer nesting and integer quantities only; nested kits must be flattened by hand.
- No gift concept: free item = ordinary line with 100% discount, rules engine one-action-per-rule, no limits/stock fallback; gaps filled by paid third-party macros/apps.
- Pick lists show parents, no bin rack for children, parents cannot be hidden from inventory views (forum/Trustpilot snippets, unverified dates).
- FBA/3PL fulfilment centres do not support composites; bundle silently becomes a split or must be a pre-packed SKU.

## 6. New use cases not in the catalogue
- NU-1 Per-location bundle mode (virtual in warehouse A, pre-built kit in B).
- NU-2 Buying/restocking a bundle = ordering its components (PO explode) and transfers of components only.
- NU-3 Bundle weight derived from components unless overridden (labels, carrier choice).
- NU-4 Removing/changing a composition must push 0/new stock to linked listings immediately.
- NU-5 Outsourced fulfilment (FBA/3PL) cannot assemble kits: split to components on submission or require a pre-packed SKU.
- NU-6 Audit report of all bundle definitions (Composite Export).
- NU-7 Scrap/write-off a bundle = write off components (parent not scrappable).
