# Phase 2 / 7 - Cin7 Core (ex DEAR Inventory), with Cin7 Omni contrast

Researched 2026-11-04. help.core.cin7.com and help.omni.cin7.com sit behind a Cloudflare challenge in a browser,
but their Zendesk JSON API (`/api/v2/help_center/en-us/articles/<id>.json`, `/api/v2/community/posts.json`) is
public; all article quotes below come from it. Community = Cin7 Core feature-request forum (1,089 posts paged).
Anything not backed by a source is marked (unverified).

## 0. Mental model in one paragraph

Cin7 Core has no "bundle" object. A kit is an ordinary product with an **Assembly BOM** (Bill of materials dropdown
on the product header -> "Assembly BOM" -> Bill of materials tab). Two switches decide everything:
**Auto-assembly** (kit is virtual: on sale-order *authorization* the system creates and completes an Assembly task
that consumes components; kit availability = what components can build) and **Auto-disassembly** (on purchase
receipt a pack is broken into components). Without Auto-assembly the kit is a pre-built stocked item made through
Production -> Assemblies, and its availability is only assembled stock. Gifts are not a concept either: a free item
is a sale line with **100% discount**, produced manually, via a **Product Deal** ("Buy X / Get Y" with a 100% discount
template) or a coupon. Cin7 Omni is a different product: products get an Order Type **Kit** or **Made To Order**, show
**Virtual Stock**, and each sales channel has **"Automatically Load BOMs for Kits"** which *explodes the parent line
into component lines* on the order.

## 1. Kit definition (B-01)

Source: https://help.core.cin7.com/hc/en-us/articles/9034480629647-Bill-of-materials-assembly
- Path: Inventory -> Products -> product -> "Select **Assembly BOM** from the **Bill of materials** dropdown field in
  the document header. This activates the Bill of materials tab."
- Fields: Auto-assembly, Auto-disassembly, **Quantity to produce** (yield, default 1), **Instructions URL**,
  components via "+ / Add more items" with **Quantity**, **Wastage %** / **Wastage quantity** (mutually exclusive),
  **Disassembly cost %** (must total 100%), "+ Labor and overheads" (service lines with Expense Account + Price tier).
- "You must have already created the component products before they can be added."
- "For manually assembled products, the BOM is treated as a draft, and components/services can be added, changed,
  or removed during assembly. For auto-assembled products, it is not possible to change the BOM components during
  assembly."
- Hover a component code in the grid -> tooltip with product details (no stock levels shown; community asks for
  them: https://help.core.cin7.com/hc/en-us/community/posts/11182768270735).
- **Replace BOM components**: More actions -> Replace BOM component -> pick old/new -> "View BOMs" (how many affected)
  -> Replace (all BOMs). https://help.core.cin7.com/hc/en-us/articles/9034450446479-Bill-of-materials
- CSV import/export of BOMs (columns Action, ProductSKU, ComponentSKU, Quantity, WastageQuantity_ForStockComponentOnly,
  WastagePercent_..., CostPercentage_..., PriceTier_ForServiceComponentOnly, ExpenseAccount_...). Export is all-or-
  nothing (request for "selected products only": community/posts/14802159665551).
- API `/BillOfMaterials`: `AutoAssembly` = "true if this product is a kit or needs to be automatically assembled on
  sale order authorization"; PUT replaces the full BOM ("if some BOM line is not provided then these BOM components
  will be deleted"). https://help.core.cin7.com/hc/en-us/articles/9034480650127-Bill-Of-Materials-endpoint
- Multi-level (nested) assembly BOMs supported; Phantom BOM in Advanced Manufacturing.
- Prerequisite: kit costing method must be FIFO / FIFO (Batch) / FIFO (Special) / Special (Batch) for auto-assembly
  (FEFO-batch not supported: community/posts/12845502972175).
- Omni: Products -> Custom Links -> **BOM** -> "BOM Master" grid, rows with **Use** in Make BOM column; types **Make**
  (in-house) and **Addon** (contract manufacturing in a PO). https://help.omni.cin7.com/hc/en-us/articles/9052640971791

## 2. Kit availability and channel publishing (B-02, B-03, B-17)

- Auto-assembly article: "With auto-assembly, you keep only the component products in stock... Stock availability for
  the finished product is calculated as what could be assembled from available components."
  https://help.core.cin7.com/hc/en-us/articles/11952177561743-Auto-assembly
- API ProductAvailability: "Quantity of the product available = On Hand - Allocated + **Potential Kits** that can be
  assembled". https://help.core.cin7.com/hc/en-us/articles/9034523140879-ProductAvailability
- Sale order product picker shows "as many units available for sale as you have component quantities in stock for.
  This does not apply to manually assembled products."
- Product Availability Report FAQ: "Only assembled finished goods will appear as On hand, however Available will
  estimate both... The finished good will **not show as available, even with components in stock, if it does not have
  any movements** or transactions associated with it." https://help.core.cin7.com/hc/en-us/articles/9034522979343
- Shopify: Core pushes **Available** (not On Hand) automatically on every stock change; kits with auto-assembly push
  buildable quantity; "When auto-assembly is disabled, availability of the assembled products will only show currently
  assembled units, which could be 0 even if there are plenty of available components." Buffer inventory per product /
  channel. https://help.core.cin7.com/hc/en-us/articles/9034569866639-Shopify-Integration-FAQs ,
  https://help.core.cin7.com/hc/en-us/articles/11797001436943-Stock-levels-in-Shopify
- Shared components: falls out naturally, since every kit's availability is recomputed from the same component pool
  (BOM Component Availability report lets you search a component and see every kit that uses it - e.g. "Bottle of
  Wine" -> "Wine Pack of 24" and "Wine Pack of 6"). https://help.core.cin7.com/hc/en-us/articles/9034497340047
- Community pain: availability is coupled to auto-assembly. Merchants who want manual (pre-built, batch-tracked)
  assembly still want buildable stock published: posts 15668346878223, 14463575165199 ("we have a large number of
  assembled products with their BOMs set to auto-assembly solely so that Shopify will show the logical stock
  availability"; proposes a separate "Propagate Inventory" checkbox). Opposite request 13915676052623 (push only real
  on-hand of pre-built kits). And 10654738027535: "When a sale order is authorised for a BOM product only the main BOM
  product shows as allocated under the availability report, but the components do not show as allocated."
- Pre-built vs virtual (B-03): manual Assembly (Production -> Assemblies -> + Add, Location, product, Quantity,
  "Maximum quantity" calculator, Load BOM, components short shown **in red**, Authorize -> Pick tab "Auto-pick" ->
  Complete; WIP and Finished goods accounts). https://help.core.cin7.com/hc/en-us/articles/9034464144015-Assembly
- Hybrid "**Picking for kitting**" (WMS): kit has assembly BOM WITHOUT auto-assembly; "If the assembled item is in
  stock, WMS will direct picker to pick the assembled product. If there are not enough units... the system will split
  the remaining items into their components" and auto-creates an assembly order. "Partial pick is not possible."
  https://help.core.cin7.com/hc/en-us/articles/10848200365711-Picking-for-kitting
- Multi-level rule: "When auto-assembly is enabled, components are picked, pre-assembled subassemblies are ignored.
  When manual assembly is enabled, preassembled subassemblies are picked, components are ignored." Support recommends
  auto on top level, manual below. https://help.core.cin7.com/hc/en-us/articles/9034476129295-Multi-level-Assembly
- Omni: **Virtual stock** = min over components of (Stock Available in the same branch / Qty in BOM); shown when
  product Order Type = **Kit** or **Made To Order**; optional "Virtual Stock" column in product list; "Cin7 Omni will
  send through to your integration the total number of virtual items you could make, plus any finished components you
  physically have in stock." https://help.omni.cin7.com/hc/en-us/articles/9052704682511 ; Amazon: virtual stock only
  on FBM, not FBA.

## 3. Sale of a kit: order, auto-assembly, partial stock (B-04, B-10, B-12, B-13)

- Trigger: sale order **authorization** only ("not possible for auto-assembly to be triggered at another point of
  the process (e.g. fulfilment, payment)" - search summary of Cin7 docs). The created Assembly task appears in the
  sale's **Related orders** tab ("Assembly tasks (auto-assembly triggered by sale authorization)").
  https://help.core.cin7.com/hc/en-us/articles/9034450166287-Advanced-Sales-Multiple-Fulfillment
- Settings (Settings -> General settings -> Sale process customization -> **Auto-assembly settings** ->
  "On order authorization auto-assemble"): **Quantity required** / **Quantity required and maintain minimum stock level
  quantity** / **Difference between available quantity and quantity required to cover a shortage**. Per channel:
  "**Process auto-assembly as**: For ordered quantity / For minimum quantity required for picking".
  https://help.core.cin7.com/hc/en-us/articles/11073350145935-Sale-process-customization
- "Auto-assembly will never create a partial assembly." "You will not trigger auto-assembly if you do not have enough
  components in stock at the sale location. Auto-assembly limits picking to the same location of the sale, regardless
  of your pick settings."
- Shortage: on authorize a notification "requested stock exceeds available stock" -> **Backorder** / **Split order** /
  **Create Purchase Order**. For kits: finished good not assembled; components go to "Out-of-Stock Components for
  Auto-Assembly Report" (Location, Product SKU, Component SKU, Allocated Quantity, Needed Quantity). After receiving:
  "Undo the sale order, then Authorize the sale order again." Setting **Split auto-assembly products in sale orders**
  (off by default) lets a split create a partial assembly (e.g. 5 of 10 kits).
  https://help.core.cin7.com/hc/en-us/articles/9034518480527 ; https://help.core.cin7.com/hc/en-us/articles/9034480522511
- Backordered components: "the assembly will not automatically complete when the components are received. The
  assembly must be manually authorized" (Assembly article).
- Snapshot (B-10): the Assembly task records the components actually consumed (auto-assembly BOM is locked), linked
  in Related orders, so history survives later BOM edits (inference from docs; whether a BOM edit between sale and a
  delayed assembly is picked up is (unverified)).
- Ecommerce: Shopify/WooCommerce/Amazon orders: "When processing orders, the logic is identical to that of the Cin7
  Core UI. Dropshipping, Kitting and other important scenarios are implemented in the same way."
  https://help.core.cin7.com/hc/en-us/articles/9034459874703-Amazon-integration
- Batch-tracked kits: "it is not possible to change a line of the order without undoing the sale and voiding all the
  related auto-assemblies" (Shopify FAQ).
- Substitution: none. Community: "if the stock of one component isn't available, it prevents auto assembly, requiring
  our team to manually adjust the order" (posts/12048658922255, 12086482336271 "Swappable Product Options in BOMs").
- Omni contrast: per-channel **Automatically Load BOMs for Kits**: "Yes: The line item's BOM will expand; each
  component of the finished product will be shown as a separate line item. To dispatch the finished product, you must
  dispatch each component separately." On a manual sales order: **Make BOM -> Make New BOM from Master BOM** - "You
  can then edit the BOM or add other products to the sales order" (per-order editable contents).
  https://help.omni.cin7.com/hc/en-us/articles/9128597367439-Shopify-settings ; .../9052640971791
- Omni split orders across up to three branches via a Branch Routing Grid; "payments and discounts are split across
  sales orders based on which products they're dispatching."

## 4. Pick / pack / ship (B-11)

- Pick tab: "+Auto Pick" copies sale lines (the kit SKU). "Use the **Expanded pick list** to pick components for items
  with a bill of materials" (Print -> Pick List vs Expanded pick list).
  https://help.core.cin7.com/hc/en-us/articles/10848183141519-Pick-items-for-a-sale
- WMS Pick has an **Expand / Collapse BOM** button; WMS Pack does not (post 10437769026831: "when it comes to PACK, a
  different staff member currently will only see the single 1x BOM / SKU. Even though physically inside the tote,
  there may be... up to 10 individual items").
- Complaints: Combined Pick List template does not show BOM component bin locations (12855259238927, 600+ orders);
  expanded pick list not sorted by bin (11995931673103); expanded list prints "0.005 x 1000-pack" instead of "5 x
  single" when units-of-measure BOMs nest (14931032842639); "there is no way to indicate on a picking slip that you
  actually need to print an expanded picking slip... append all the assembly jobs for auto-assemblies onto the bottom
  of a picking slip so that fulfilment can see what the system has 'done' internally" (15767721652239); mixed physical
  pre-built kit vs electronic auto-assembled kit in the same pick is confusing (14327166003983); auto-assembly
  auto-picks from the high bin, warehouse wants an "auto-order assembly" that commits stock but lets staff pick
  (12549757467279, 8 votes).
- Shopify app-store review (secondary, via search): "turning on auto assembly breaks the WMS functionality
  completely" - https://apps.shopify.com/dear-inventory (unverified exact wording).
- Omni contrast: consolidated pick list setting **BOM Products Display**: "Both parent and child items, Parent items
  only, or Child items only"; document templates option **Hide all BOM components**; ShipStation "**Include BOM 'Use'
  Items**" (components become shipment items or only the finished product).
  https://help.omni.cin7.com/hc/en-us/articles/9052704454159 , .../9052641487247 , .../9128597282831

## 5. Documents, tax, returns, cost (B-14, B-15, B-16)

- Invoice: one line per sale line (kit SKU). Components live only on the Assembly task (inference). Mixed tax rates
  inside a kit cannot be split: "the system cannot automate separate sale order from an assembled product with
  different tax rules of its components" - workaround: sell components separately (posts/10804870143887).
- Discount display: "Discount rule": "Updates the sale price" or "Updates discount %"; documents follow the setting.
- Credit note (Sale -> Credit Note tab, then Restock tab; independent, any order). "Items in the credit note with a
  Bill of Materials showing their component parts will be **auto-disassembled during restock**."
  https://help.core.cin7.com/hc/en-us/articles/9034480981007 ; Disassembly: "Auto-assembled products that are
  refunded/issued a credit note are auto-disassembled upon restock." Component cost on disassembly uses
  **Disassembly cost %** (default equal split). https://help.core.cin7.com/hc/en-us/articles/9034497989135
- Returning only one component of a kit: no documented flow; restock lines can be added/edited, so restocking a
  single component SKU against a kit credit line looks possible manually (unverified). Lost bundle discount: none.
- RMA module: resolutions restock / replace / repair / inspect / scrap; "Warranty replacement... making the replacement
  free" (credit note allocated to the new invoice). https://help.core.cin7.com/hc/en-us/articles/10553627451919
- Cost: BOM "Cost estimate" (Average / Latest purchase / Fixed purchase cost) "for your reference only"; actual cost =
  sum of each component's costing method at assembly + labor/overheads + wastage; Finished Goods Analysis /
  Production Cost Analysis reports; Assembly list shows Unit cost per run. Gaps: kit list price is not derived from
  component prices ("ends up with the business maintaining the majority of their prices in Excel" - 15689964528783);
  supplier kit price cannot be captured for auto-assembled kits (10508952300559).

## 6. Multipack, dropship, buyer choice (B-08, B-09)

- **Additional Units of Measure**: base SKU + pack SKUs with ratio; auto-assembly/disassembly generated; availability
  shows "60 singles on hand, but 5 12-packs, 10 6-packs, and 60 singles available"; synced per SKU to Shopify.
  https://help.core.cin7.com/hc/en-us/articles/9034463961231
- Dropship per product: No / Optional / Always; Optional decides per whole line ("does not fulfill part of a line from
  stock and dropship the rest"); API sale line `DropShip`.
- Buyer-choice kits: Core **Make to Order BOM** (Advanced Manufacturing add-on; production order per sale; options
  pick components; FIFO not allowed). Omni "Make BOM" per order. No equivalent for the simple Assembly BOM.
  https://help.core.cin7.com/hc/en-us/articles/9034464800399

## 7. Free items / gifts

- Order line discount: "Only percentage (%) discounts are supported... Negative discounts cannot be applied. It can be
  added at the Quote or Order of a sale order." API sale line `Discount`: "Value between 0 and 100. **For free items
  discount is 100**." https://help.core.cin7.com/hc/en-us/articles/9034512161423-Sale-POST
- **Product Deals** (Settings -> Reference books -> Stock -> Product Deals): name, Active, Effective From/To, Customer
  Type (All / B2B / POS / Selected / With Tags), Allow Coupons, discounts. "Example 2: Free gift": 100% product discount
  template, "Order-level", Buy 3 "Or more" in category Books, Get 1, "Select Product and enter/search for the item...
  that will be given as a gift". Example "3 for the price of 1" (Buy 3 Get 1? doc wording). Buy/Get criteria: brand,
  category, tag, product, Order total, Buy collection total. "Discounts do not stack." Coupons: "Single Coupon Code
  Usage", Report tab shows used coupons; "Apply Coupon" button after saving the sale order.
  https://help.core.cin7.com/hc/en-us/articles/9034519918095-Product-Deals
- Deals apply on authorization if "Automatically apply discount and deals" is on, else via "Apply Discounts" button.
- BUT the deal only discounts an item that is already on the order; it does not add it:
  - "We would like to have an option to add automatically free product into sales order... At the moment we drive it
    through simple 100% discount however this is not automatic solution, and it requires human interaction to add
    particular free product onto sales order and press apply discount button." (10698547312143)
  - "currently the system requires you to include the total number of products in your sale for the Deal to get
    activated. Eg; Buy one Get one Free." (10642110333967)
  - "Cin7's automated 'Deals' cannot natively trigger a free item based on a Total Order Value. Workflow: GWP is setup
    as a coupon code that is applied manually to a sales order by sales rep" (17071262467471, 2026-08)
  - POS: no popup/auto-add for BOGO (12271570487439).
  - Care-pack-per-order rule request; partner workaround: make a "free gift" product with a BOM containing the gift and
    use auto-assembly / Expanded Pick List (14565076562319). Merchant: doesn't fit "one care pack per order".
  - Deals ignore items with customer Custom Price (11672015553167, answered by Product Owner as by design).
- Ecommerce orders: "Cin7 Core does not perform any discount calculations, it simply captures the discount amount from
  Shopify." Shopify setting **Add a discount as**: **Price reduction** (order discounts spread proportionally onto lines)
  or **Additional charge** (one additional charge line per order line x discount code, "Bring discount codes from
  Shopify", service product "Discount OFFER10"). Amazon: "Total order discounts are applied as additional charges to the
  whole order, without distribution by lines"; shipping, gift wrapping and discounts saved as additional charges.
  Free Shipping deals do not apply to ecommerce orders. https://help.core.cin7.com/hc/en-us/articles/11796986460431
- Tax/invoice quirks: 100%-discount line + Avalara gives 1-3 cent tax receivables (11907031201679); "We don't create
  zero cost lines in Cin7 Core because Xero will reject whole invoices with zero costs" (ShipStation FAQ in Shopify
  FAQs).
- Samples / promotional giveaways: "Using a sale with a 100% discount is not the way to go as it is recorded as a sale
  when that is not the case and will skew sales reporting and books COGS instead of the applicable samples account";
  request for a Samples order type with write-off account, auto-assemblies included (13013247702671).
- Omni contrast: Promotional Matrix (customer / product / category promotions); "We cannot set 100% discounts using
  the promotional matrix. The maximum... is 99.9999%. However you can set a 100% discount at a sales order level";
  "Buy X and get X free" not usable on Sales Orders (POS only); "If you decrease the quantity of an item in the order,
  all discounts are removed"; "You cannot use promotions with the Cin7 Omni API".
  https://help.omni.cin7.com/hc/en-us/articles/9052674054799-Promotions-overview

## 8. Per-use-case table

| ID | Cov. | How it works for the operator | Limits | Source |
|---|---|---|---|---|
| B-01 | Full | Product -> Bill of materials: Assembly BOM -> tab: components, Qty, Wastage %/qty, Disassembly cost %, Labor & overheads, Quantity to produce; CSV + API | components must pre-exist; export all-or-nothing | help.core .../9034480629647 |
| B-02 | Full (if auto-assembly) | Available = On hand - Allocated + Potential Kits; pushed to Shopify/Woo/Amazon on every stock change; shared components automatic | coupled to Auto-assembly flag; manual kits show 0; needs a prior movement; components not shown as allocated | .../11952177561743, .../9034523140879, posts 14463575165199, 10654738027535 |
| B-03 | Full | Manual assembly (Production -> Assemblies) = pre-built stock; auto-assembly = virtual; WMS "Picking for kitting" = pre-built first, else components | picking-for-kitting all-or-nothing, WMS only | .../9034464144015, .../10848200365711 |
| B-04 | Full | Kit SKU line on order; on authorize auto-assembly consumes components; Omni explodes into component lines ("Automatically Load BOMs for Kits") | only at authorization; only sale location | .../11952177561743; omni .../9128597367439 |
| B-05 | None (unverified) | no parent+children de-dup documented | risk of double count | - |
| B-06 | Unknown | no Shopify bundle-group handling documented | - | - |
| B-07 | Partial | discount captured as price reduction (spread) or additional-charge line per order line+code | no group/offer-bundle concept | .../11796986460431 |
| B-08 | Full | Additional Units of Measure (single/6/12) auto-assemble/disassemble, availability per UoM | can't combine with auto-assembly BOM on base | .../9034463961231 |
| B-09 | Partial | Core: Make-to-Order BOM (Adv. Manufacturing, production order); Omni: Make BOM editable per sales order | not for simple kits; no substitution | .../9034464800399, posts 12048658922255 |
| B-10 | Partial | Assembly task stores consumed components, in Related orders | delayed/backordered assembly behaviour (unverified) | .../9034450166287 |
| B-11 | Partial | Expanded pick list; WMS Pick Expand/Collapse BOM; Omni pick list "Both parent and child / Parent only / Child only", template "Hide all BOM components" | WMS Pack shows only kit SKU; combined pick list no component bins | .../10848183141519, posts 10437769026831, 12855259238927 |
| B-12 | Partial | Backorder / Split order / Create PO; Out-of-Stock Components for Auto-Assembly report; "Split auto-assembly products" setting | never partial assembly by default; undo+re-authorize after restock; no substitution | .../9034518480527, .../11073350145935 |
| B-13 | Partial | auto-assembly only from sale location; Omni virtual stock per branch, split across 3 branches | no cross-location kit build | .../11952177561743, omni .../9052704682511 |
| B-14 | Partial | invoice = kit line; discount shown as reduced price or %; components not on invoice | cannot split kit by tax rule | posts 10804870143887 |
| B-15 | Partial | credit note on kit line, restock auto-disassembles into components; RMA module | single-component return manual (unverified); no lost-discount calc | .../9034480981007, .../9034497989135 |
| B-16 | Full (cost) / None (price) | actual cost = component costing + labor + wastage; Finished Goods Analysis | kit price not derived; supplier kit cost not capturable | posts 15689964528783, 10508952300559 |
| B-17 | Full | list kit SKU to Shopify/Woo/Amazon/Magento with buildable qty, buffer inventory | no Allegro/PL channels (unverified) | .../11797001436943 |
| B-18 | Partial | BOM CSV import, API BillOfMaterials; no pull of shop-side bundle definitions | - | .../9034480650127 |
| G-01 | None | no gift flag read; Shopify tags/properties can land in attribute/comment fields | - | .../11796986460431 |
| G-02 | Partial | 0-price/discounted line imported as-is (price reduction or additional charge) | not recognised as gift | .../11796986460431 |
| G-03 | None | - | - | - |
| G-04 | Partial | operator adds gift line with 100% line discount (Quote/Order stage) or applies GWP coupon | fully manual | posts 17071262467471 |
| G-05 | Partial | add line + 100% discount; partner workaround: gift as BOM component | - | posts 14565076562319 |
| G-06 | Partial | Product Deals: Buy X (qty/category/brand/tag/order total) Get Y product at 100% template, dates, customer tags, single-use coupons | does NOT add item; not for ecommerce orders; no order-value GWP; no per-order cap | .../9034519918095, posts 10698547312143, 10642110333967 |
| G-07 | Full (workaround) | gift as component in kit BOM, consumed by auto-assembly | changing gift = editing BOM | posts 14565076562319 |
| G-08 | Partial | gift is normal stock line: allocated on authorize, decremented on ship, backorder/split on shortage | no stop/swap rule | .../9034480522511 |
| G-09 | Partial | appears as a normal line on pick/pack | no gift marker | - |
| G-10 | Partial | line with Discount 100 ("For free items discount is 100"); Discount rule shows price or % | Avalara cent rounding; Xero zero lines | .../9034512161423, posts 11907031201679 |
| G-11 | None | manual credit note | - | - |
| G-12 | Partial | coupon Report tab; sales/profit reports show 0-revenue lines with COGS | gifts skew sales; no per-customer value tracking | posts 13013247702671 |
| G-13 | None | - | - | - |
| G-14 | Partial | Amazon gift wrapping -> additional charge; Shopify notes -> shipping notes | no "is a gift" flag (unverified) | .../9034459874703 |
| X-01 | Partial | per-channel: "Add a discount as" price reduction / additional charge; Amazon order discount whole-order charge | inconsistent across channels | .../11796986460431, .../9034459874703 |
| X-02 | Unknown | (Shopify "consolidation" merges orders per customer, not units) | - | .../17517108705295 |

## 9. New use cases surfaced

1. Channel-SKU alias via a 1-component auto-assembly BOM (Woo FAQ: "different SKUs in WooCommerce and Cin7 Core...
   linked by auto-assembly for stock calculations"). https://help.core.cin7.com/hc/en-us/articles/9034588353295
2. Pick-time kitting: prefer pre-built kits, fall back to components, auto-record the assembly.
3. Assembly-quantity policy when a kit sells: exact / top up to minimum stock / cover shortage only.
4. Decouple "publish buildable availability" from "auto-assemble on sale" (two separate switches).
5. Free samples / marketing shipments (incl. kits) booked to a write-off account, not as a 0-value sale.
6. Kit list price derived from component prices; supplier price for a whole kit.
7. Required / recommended add-on prompt at order entry (11229349023759).
8. Kit "incoming / ETA" derived from component purchase orders (14247863628943).
9. Multi-order (wave) pick list that explodes kits with component bins (12855259238927).
10. Kit cost split back to components on disassembly/return (Disassembly cost %).
11. Dropship decision per line incl. kits; partial line never split stock/dropship.
12. Allocation visible on components while a kit order waits (10654738027535).
