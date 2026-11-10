# R3 phase 2 / competitor 5: Shopify admin (operator-UX benchmark)

Round 3, blind replication. Sources read: help.shopify.com, shopify.dev (Admin GraphQL reference, Cart Transform Function API, bundles guides), Shopify Community threads, and a few third-party app help pages. No earlier round outputs were read.

## Method and caveats
- The pages were read with WebFetch, which summarises through a small model. Text in quotation marks is what that tool returned as verbatim. The short, distinctive sentences were cross-checked where two fetches returned the same text. Even so, read every quote as "near-verbatim, re-check before citing externally".
- Source kinds: **[P-doc]** official Shopify help or dev docs (primary); **[P-api]** GraphQL reference (primary); **[C]** community forum (user reports, low weight); **[V]** third-party vendor docs (secondary).
- Shopify is a shop plus checkout plus OMS-lite. It is not a multi-channel OMS. Many of our use cases about channels sending things to us do not apply directly. For those, I rate what Shopify does as the **receiving system** (mainly Marketplace Connect for Amazon and eBay), or I mark N/A inside the note.
- Today is 2026-11-04. Shopify Scripts were sunset on 2026-06-30 (per a search snippet, unverified). Everything below assumes Functions only.

## Key primary facts (the model in 8 lines)
1. Bundles are built by an app. The free first-party app is **Shopify Bundles**: "Shopify Bundles is a free first-party bundles app that allows you to create and edit fixed product bundles and multipacks". https://help.shopify.com/en/manual/products/bundles/shopify-bundles [P-doc]
2. Orders store **components as real line items**, plus a group reference: "Order lines return bundle components, with a reference to the bundle parent." https://shopify.dev/docs/apps/build/product-merchandising/bundles [P-doc]. The group object `LineItemGroup` is "The information for line items that are part of a bundle." Its fields are title, quantity, productId, variantId, variantSku and customAttributes. It has **no price field**. https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItemGroup [P-api]
3. Price allocation is a documented formula: "Shopify allocates the bundle price to its component lines based on the weight of each component line." / "The weight of a component is calculated as the unit price multiplied by quantity". https://shopify.dev/docs/api/functions/latest/cart-transform [P-doc]
4. Taxes, refunds, reports and fulfilment all work at component level: "Taxes will be computed on the components." / Refunds "Operates at the component level" / "Sales reporting at the component level" / "No fulfillment constraint". https://shopify.dev/docs/apps/build/product-merchandising/bundles/start-building [P-doc]
5. Availability: "The parent inventory quantity is the minimum of the component's inventory quantities." (same page). But "Bundles don't track inventory by location, but by overall stock." (shopify-bundles help page) [P-doc]
6. Discounts are split into an **intent** and an **actual amount**. `DiscountApplication`: "Discount applications capture the intentions of a discount source at the time of application" … "don't represent the actual final amount discounted on a line". `DiscountAllocation`: "The actual amount discounted on a line item or shipping line." `LineItem.originalUnitPriceSet`: "This value doesn't include discounts." https://shopify.dev/docs/api/admin-graphql/latest/interfaces/DiscountApplication , /objects/DiscountAllocation , /objects/LineItem [P-api]
7. Buy X Get Y does **not** add the gift: "The free or discounted 'get' item is never automatically added to the cart." https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y [P-doc]
8. The Flow action "Add order line item" adds a variant after checkout, with an "Add for free" option that applies "a 100% discount to the line item". It "will add a line item without considering inventory." https://help.shopify.com/en/manual/shopify-flow/reference/actions/add-order-line-item [P-doc]

## Rating per use case

### Bundles
| ID | Rating | How it works for the operator | Evidence |
|---|---|---|---|
| B-01 | Full | Admin: Apps > Bundles > "Create bundle", enter the "Title", pick components in the "Add products" dialog. The bundle is created in "Draft" and must be set "Active" to publish. Limits: "Fixed bundles: Up to 30 components", "Up to 2000 units per component", "Maximum of 3 options and 100 variants total per bundle". Also available through the API (`productBundleCreate`). | https://help.shopify.com/en/manual/products/bundles/shopify-bundles |
| B-02 | Full (no location) | Sellable quantity of the parent is the minimum over its components and updates in real time. A component stays a normal product that also sells alone. Gap: no per-location bundle availability. | start-building page: "The parent inventory quantity is the minimum of the component's inventory quantities."; eligibility page: "Product inventory levels are updated in real-time."; shopify-bundles page: "Bundles don't track inventory by location, but by overall stock." |
| B-03 | Partial | Only virtual bundles are supported natively. A pre-built kit with its own stock is just an ordinary product with no bill of materials and no assembly or kitting step. There is no switch between "virtual" and "pre-assembled". | Inferred from the docs describing only the virtual model (no source describes a kit mode) |
| B-04 | Partial | Native Shopify never receives a parent-only order line, because checkout expands it. For marketplace orders through Marketplace Connect (an Amazon bundle ASIN), bundle import works only after the merchant contacts Marketplace Connect support to enable it. Community reports show imports failing. Amazon MCF does not map or fulfil bundle SKUs. | [V] Pickware: "you need to contact Shopify Marketplace Connect directly"; [C] https://community.shopify.com/t/amazon-bundle-import/298590 |
| B-05 | Full (by design) | The parent is never a priced line. It exists only as a `LineItemGroup` that components point to, so double counting is impossible inside Shopify. Older third-party bundle apps that added a parent line plus children are not covered here (unverified). | LineItemGroup reference (no price field); bundles guide: "Order lines return bundle components, with a reference to the bundle parent." |
| B-06 | Full | This IS Shopify's encoding: children only, grouped by `lineItem.lineItemGroup` (group quantity, parent SKU and attributes). | https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItemGroup |
| B-07 | Partial | Customised bundles merge N cart lines into one bundle line with a price adjustment ("For merge, the price is derived from components, with a price adjustment applied in the function"). Alternatively, ordinary BXGY or volume discounts are used. Shopify has no marketplace-style auto-created offer bundles. | start-building page |
| B-08 | Full | Multipack: in the bundle editor, use "..." > "Duplicate product" on a component. The result is one product holding N units of one variant. | shopify-bundles help: "To create a multipack bundle, click ... and select Duplicate product." |
| B-09 | Full | The buyer picks a variant per component, and options can be combined across components ("You can combine product options in a bundle, such as size or length, so your customers can select the option once."). The 3-option and 100-variant cap applies. True mix-and-match is not supported by Shopify Bundles: "The Shopify Bundles app doesn't support mix-and-match bundles." | shopify-bundles and eligibility pages |
| B-10 | Full | Components are stored as real order lines, so contents are frozen per order. The definition does not freeze prices, though: "When the price of one of the bundled products updates ... the bundle price doesn't update." | shopify-bundles help |
| B-11 | Partial | The packing slip lists component lines, and since recently each line can print its group: "line_item.groups - A list of line item groups that the product belongs to, such as bundles or add-ons." and "group.title". This is not on by default; the merchant edits the Liquid template. A Dec-2023 community answer said the grouped view was "not possible at the moment". Shopify has no scan-to-pack bench natively. | https://help.shopify.com/en/manual/orders/packing-slips-variable-list ; [C] https://community.shopify.com/t/how-can-i-indicate-a-line-item-is-a-bundle-component-in-the-packing-slip/273458 |
| B-12 | Partial | Availability is the minimum over components, so a bundle with an out-of-stock component simply cannot be sold. There is no substitute or split-bundle logic. After the order exists, only general fulfilment holds and partial fulfilment are available (fulfilment holds not checked in this round). | start-building page (min rule) |
| B-13 | Partial | "No fulfillment constraint" lets components be fulfilled from different locations as separate fulfilment orders. Bundle availability ignores locations, so a bundle can show as sellable while its components are spread out. | start-building; shopify-bundles help |
| B-14 | Full (allocation) / N/A (fiscal) | Weighted allocation by unit price × quantity, with taxes computed per component. This matches "split by component reference prices". It is not explicitly capped at a component's own price: if a bundle is priced above the sum of its parts, a component could carry more than its own price (inferred from the formula). Shopify issues no fiscal invoice. | cart-transform page; start-building: "Taxes will be computed on the components." |
| B-15 | Partial | Refunds and restocks work per component, each at its allocated (already discounted) price, so the bundle discount stays proportional. A broken bundle is not re-priced. "Bundles can't be used in exchanges even when exchanging for an identical bundle". Return notification templates show components flat. | eligibility page; grouped-view page |
| B-16 | Partial | "Sales reporting at the component level", so margin is the sum of components if each component has a cost. No bundle-level margin view was found (unverified). | start-building |
| B-17 | Partial | A bundle is a normal product published to "the Online Store, Shop, and Shopify POS sales channels, and on Headless storefronts". Google & YouTube take "fixed product bundles only". Marketplaces only through Marketplace Connect with support-enabled bundle support. | shopify-bundles and bundles help pages; [V] Pickware |
| B-18 | None (UI) / Partial (API) | "Bundles don't support import, export, or bulk editing capabilities." Apps can create bundles through `productBundleCreate`. | eligibility page |
| B-19 | Full (inside Shopify) | Fixed rule: the parent carries no price; price and tax sit on components through weighted allocation. Consistent across checkout, orders and reports. | cart-transform; start-building |
| B-20 | Full (single owner) | Shopify is the stock master, so components are decremented once by the platform itself. There is no external master to clash with. | start-building (component-level oversell protection) |
| B-21 | Partial | Components can ship in separate fulfilments. "In orders with split fulfillments and returns and exchanges, the bundle's included items display as individual line items instead." There is no bundle-level "shipped" state. | eligibility page |

### Gifts
| ID | Rating | How it works for the operator | Evidence |
|---|---|---|---|
| G-01 | None | Shopify has no gift flag on a line. A free item is only recognisable from its `discountAllocations` that point at a BXGY `DiscountApplication`. | LineItem / DiscountAllocation reference |
| G-02 | Full (it is the emitter) | A free item = a normal line with `originalUnitPriceSet` at full price plus a 100% `DiscountAllocation`, both from BXGY and from the Flow "Add for free" action. | BXGY help; Flow action: "applies a 100% discount to the line item" |
| G-03 | Unknown | When the gift is the same variant as the paid item (buy 2 get 1 of the same SKU), it is likely one line with qty 3 and a partial allocation. Not verified in this round. | none |
| G-04 | Partial | Shopify cannot see promises made in a listing. The operator adds the item through the order editor or a Flow rule after checkout. | editing-orders; Flow action page |
| G-05 | Full (with limits) | Order editor: add a product and apply a manual line discount ("apply manual discounts to specific items"). Blocked when: "You can't edit any orders that are imported into your Shopify admin.", "If an order contains fulfilled line items, then you can't edit this order.", "Only the app that creates an order can edit the order." | https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders/considerations |
| G-06 | Partial | BXGY (Discounts > Create discount > "Buy X get Y"; "Customer buys" with "Minimum quantity of items" or "Minimum purchase amount"; "Customer gets" with "Free"; "Set the maximum number of uses per order") prices the gift but never adds it. The post-checkout alternative is a Flow trigger on order created, a condition, then "Add order line item" with "Add for free", "Allow duplicates", "Notify customer" and an "Order timeline note". Native gift-with-purchase is closed only with third-party apps. | BXGY help; Flow action page; [C]/[V] gift-app ecosystem |
| G-07 | Unknown | The weighted allocation gives a component with price 0 an allocation of 0. Whether a zero-price component is allowed in Shopify Bundles was not verified. | cart-transform formula (inference) |
| G-08 | Partial | BXGY: when the gift is sold out the discount just stops working (help page paraphrase: free items "show as sold out and the discount can't be used"). Flow: "This action will add a line item without considering inventory." That is a silent oversell. No substitute is declared in either. | BXGY help; Flow action page |
| G-09 | Partial | Packing slip shows the line. Only the line properties hint it is a gift, there is no native gift marker. | packing-slip variables |
| G-10 | Partial | The data model is right (original price + per-line discount allocation + per-line tax lines), but Shopify issues no receipt or invoice and has no typed reason for the discount. | LineItem / DiscountAllocation reference |
| G-11 | None (native, unverified) | Native refunds return the allocated price per line. No native threshold clawback was found. Returns apps (Swap, AfterShip) implement BXGY clawback themselves, which suggests the platform does not. | [V] https://help.swap-commerce.com/en/articles/15958483-understanding-buy-x-get-y-returns-returns-v2 |
| G-12 | Unknown | Discount sales reports probably exist. Not verified in this round. | none |
| G-13 | Partial | BXGY "Customer gets" can be a collection, so the buyer chooses which item to add (and must add it). | BXGY help |
| G-14 | Unknown | No native gift-wrap or "is a gift" object was found. Merchants use order notes or line properties (unverified). | none |
| G-15 | Partial | "Limit to one per customer" restricts a code per email address or phone number (BXGY help, near-verbatim). It applies to codes, and a new email bypasses it. | BXGY help |
| G-16 | Partial (unverified) | Flow runs have a run log, but nothing on the order shows a failed gift rule. The add-line action does not fail on missing stock, it oversells. | Flow action page |

### Cross-cutting
| ID | Rating | How it works for the operator | Evidence |
|---|---|---|---|
| X-01 | Full | Every line carries `originalUnitPriceSet` + `discountAllocations[]` (amount + link to the `DiscountApplication` with `allocationMethod`, `targetSelection`, `index` precedence). It is the cleanest neutral model seen. | DiscountApplication / DiscountAllocation / LineItem reference |
| X-02 | Unknown | Not applicable to Shopify's own checkout. Marketplace Connect merging of per-unit marketplace lines was not checked. | none |
| X-03 | Partial | No operator-facing per-channel setting. Bundle handling for marketplaces is a per-store flag that Marketplace Connect support switches on. | [V] Pickware |
| X-04 | Partial | The order editor adds products and gifts, but: "You can't add a product bundle to an order when you edit it." / "you can't increase the quantity of an item in the bundle beyond the quantity that was originally ordered" / "You also can't add or edit a custom discount that applies to the entire order when an order contains a bundle." Cart Transform is "Not supported for the Create Order API, Order Edit". | editing considerations; cart-transform |
| X-05 | Partial | Gift-card lines (`isGiftCard`), shipping lines and restocking or return fees ("Return fees aren't automatically deducted from refunds"). No deposits or points lines natively. | LineItem reference; return-rules help |
| X-06 | Partial | `DiscountApplication.index` gives precedence, the Flow action can write an "Order timeline note", and edits show in reports as a separate order ("If you edit an order after the day the order was placed, then the edit displays as a separate order in your reports."). No per-line before/after audit was found. | DiscountApplication; editing considerations |

## Integration normalisation (how Shopify standardises across apps and channels)
- **One platform primitive for every bundle app.** The Cart Transform Function API (`lineExpand`, `linesMerge`, `lineUpdate`) is the shared mechanism. Fixed bundles (`productBundleCreate`) and app-built customised bundles end in the **same order shape**: components + `LineItemGroup`. Downstream apps (OMS, 3PL, email) read one shape whichever bundle app created the bundle. "The parent bundle's product, variant, and custom attributes enable apps to group and display bundle components in order management systems, transactional emails". [P-api]
- **Declared capability flag on the product.** "mark parent bundles with the requiresComponents attribute to true"; POS support is "partial" unless `requiresComponents` is true. The product itself declares that it expands. [P-doc]
- **Deterministic conflict rules between apps.** "Operations are ordered by the time each app activated its cart transform function"; on the same line, expand beats merge and update. This standardises what happens when two bundle apps compete. [P-doc]
- **One discount model for all discount sources.** Codes, automatic, manual and app (Function) discounts all produce `DiscountApplication` (intent) + `DiscountAllocation` (actual amount per line) against an unchanged `originalUnitPrice`. A free item is just a 100% allocation. This is X-01 done well.
- **Explicit eligibility gate.** Shopify refuses to publish bundles when the store is incompatible ("If the store isn't eligible for bundles, then Shopify prevents you from publishing bundled products to sales channels"), and exposes a `BundlesFeature` eligibility object (search snippet, unverified).
- **External channels are the weak spot.** Marketplace Connect bundle import is a hidden per-store switch handled by support ([V] Pickware). Amazon MCF does not map or fulfil bundle SKUs ([C] thread). Google & YouTube take fixed bundles only. There is no operator-visible "this channel sends a parent SKU" setting (our X-03), so the normalisation stops at Shopify's own checkout.
- **Notifications differ by template.** Grouped view in order confirmation and similar, flat in return templates. Each surface states which view it uses. https://help.shopify.com/en/manual/products/bundles/bundles-grouped-view-email-template-updates

## UX patterns worth copying
1. **Intent vs actual discount.** Keep a per-order list of discount applications (source, method, target, precedence index) and per-line allocations (actual amount) on top of an untouched original unit price. This maps straight onto X-01, G-02, G-10 and X-06.
2. **Components as real lines + a group record with no price.** The parent is a group with SKU, quantity and attributes, not a priced line. Double counting becomes impossible, and stock, tax, refunds and reports all work at component level.
3. **A published allocation formula** (unit price × quantity weight, documented separately for expand and merge), plus "taxes are computed on the components". Operators and auditors can recompute it.
4. **Packing slip "Part of: <group title>"** on each component line, with groups typed as "bundle" vs "add-on". Copy the bundle vs add-on distinction for warranties and engraving.
5. **An automation action with explicit, auditable fields**: "Add for free", "Allow duplicates", "Notify customer", "Order timeline note". This is a good template for an operator or rule gift-add (G-05, G-06) that leaves a trace.
6. **Edit rules written down per case** ("can't add a bundle on edit", "can't raise a component above the ordered quantity", "no order-level custom discount when a bundle is present"). Explicit refusals are better than silent recalculation.

## Anti-patterns
1. **Gift priced but not added.** "The free or discounted 'get' item is never automatically added to the cart." The promise and the order drift apart, and the whole gift-app ecosystem exists to patch this.
2. **Gift added without checking stock.** Flow "will add a line item without considering inventory". The gift oversells silently. That is exactly G-08 / G-16 done wrong.
3. **Stale bundle price plus a magic re-sync.** "the bundle price doesn't update" when components change. The documented fix is "adjusting a component in the affected bundle up by one, saving, and adjusting it back, to trigger the product to re-sync."
4. **Bundles as second-class citizens.** No import, export or bulk edit; no exchanges; not editable after the order; not on subscriptions or preorders; availability not per location; grouped view shown on some templates and flat on others.
5. **Channel bundle support behind a support ticket.** Marketplace Connect bundle import is a hidden per-store flag, not a visible per-integration setting, and MCF cannot fulfil bundle SKUs.

## New use cases (not in v3)
- **N-1 Post-order edit rules for bundles.** Forbid adding a bundle on edit, forbid raising a component above the ordered quantity, forbid an order-level discount once a bundle exists. Source: editing considerations page.
- **N-2 Bundle vs add-on group type.** A grouped line can be a bundle component or an add-on (warranty, engraving, gift wrap?). Source: packing-slip variables, "Returns true if the line item is an add-on to a parent product, or false if the line item is part of a bundle."
- **N-3 Bundle definition price drift.** The parent price is not re-derived when component prices change, so the operator needs a warning. Source: shopify-bundles help.
- **N-4 No nesting, as an explicit rule.** "Bundles can't contain other bundles." Decide this in our standard. Source: eligibility page.
- **N-5 Bundle incompatible with selling plans** (subscription, preorder, try-before-you-buy) and with exchanges or final-sale rules. Source: eligibility and return-rules pages.
- **N-6 Shipping profile and weight derived from components** ("Weight calculation is derived from individual item weights"; "Bundles don't have their own shipping profiles"). Source: shopify-bundles and eligibility pages.
- **N-7 Competing bundle sources on one line.** When two apps or rules both want to expand or merge the same line, a deterministic precedence is needed. Source: cart-transform "Multiple operations".
- **N-8 Grouped vs flat rendering per document type** (confirmation grouped, returns flat). Decide per document. Source: grouped-view page.

## Sources
- https://help.shopify.com/en/manual/products/bundles [P-doc]
- https://help.shopify.com/en/manual/products/bundles/shopify-bundles [P-doc]
- https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations [P-doc]
- https://help.shopify.com/en/manual/products/bundles/bundles-grouped-view-email-template-updates [P-doc]
- https://shopify.dev/docs/apps/build/product-merchandising/bundles [P-doc]
- https://shopify.dev/docs/apps/build/product-merchandising/bundles/start-building [P-doc]
- https://shopify.dev/docs/api/functions/latest/cart-transform [P-doc]
- https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItemGroup [P-api]
- https://shopify.dev/docs/api/admin-graphql/latest/objects/LineItem [P-api]
- https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountAllocation [P-api]
- https://shopify.dev/docs/api/admin-graphql/latest/interfaces/DiscountApplication [P-api]
- https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y [P-doc]
- https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders [P-doc]
- https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders/considerations [P-doc]
- https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/return-rules [P-doc]
- https://help.shopify.com/en/manual/orders/packing-slips-variable-list [P-doc]
- https://help.shopify.com/en/manual/shopify-flow/reference/actions/add-order-line-item [P-doc]
- https://community.shopify.com/t/how-can-i-indicate-a-line-item-is-a-bundle-component-in-the-packing-slip/273458 [C]
- https://community.shopify.com/t/amazon-bundle-import/298590 [C]
- https://help.pickware.com/en/articles/659921-how-can-i-use-shopify-marketplace-connect-with-pickware [V]
- https://help.swap-commerce.com/en/articles/15958483-understanding-buy-x-get-y-returns-returns-v2 [V]
