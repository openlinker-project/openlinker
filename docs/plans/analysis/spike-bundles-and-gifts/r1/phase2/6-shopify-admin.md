# Phase 2 / 6 - Shopify admin UX benchmark: Bundles app, discounts (BXGY), order editing, Flow, POS

Researched 2026-11-04. Scope: merchant/operator-facing UX of Shopify admin, the official Shopify
Bundles app, native discounts, order editing, Shopify Flow, packing slips, POS. Order PAYLOAD shape was
covered in phase1/2-own-shops.md and is not repeated. Anything not confirmed by a source is marked
(unverified). Community/app-vendor sources are labelled as such.

## Sources consulted
- https://help.shopify.com/en/manual/products/bundles/shopify-bundles - official Bundles app manual: create/edit flow, UI labels, limits, metrics.
- https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations - inventory formula, order display, returns/exchanges, SKUs, shipping, no nesting, no import/export.
- https://help.shopify.com/en/manual/products/bundles - overview, channels (Online Store, Shop, POS; Google & YouTube fixed only).
- https://help.shopify.com/en/manual/products/bundles/bundles-grouped-view-email-template-updates - nested-group vs flat-view notifications incl. POS receipt.
- https://shopify.dev/docs/apps/build/product-merchandising/bundles and .../bundles/start-building - "Order lines return bundle components, with a reference to the bundle parent"; weighted price allocation; taxes on components; refunds/returns and reporting at component level.
- https://changelog.shopify.com/posts/product-bundles-and-their-components-now-represented-more-consistently (2024-12-11) - grouped view in emails, admin Orders Detail Page, Abandoned checkout.
- https://www.highviewapps.com/kb/can-i-export-the-bundle-info-from-the-shopify-bundles-app-as-part-of-my-order-csv-export/ (vendor) - admin order shows "Part of:" label with bundle name under component line.
- https://changelog.shopify.com/posts/shopify-bundles-support-on-pos (2024-09-16) and https://changelog.shopify.com/posts/support-for-dynamic-product-bundles-on-pos (2025-08-18).
- https://help.shopify.com/en/manual/orders/packing-slips-variable-list - line_item.groups, group.title, group.deliverable?, order.note.
- https://community.shopify.dev/t/how-to-show-the-bundle-name-on-the-packing-slips/10530 (community) - Liquid loop over line_item.groups.
- https://help.shopify.com/en/manual/discounts/discount-types/buy-x-get-y - BXGY creation, labels, limits, POS, free item OOS.
- https://help.shopify.com/en/manual/fulfillment/managing-orders/editing-orders and .../editing-orders/discounts - edit order, line/order discounts, restrictions.
- https://help.shopify.com/en/manual/shopify-flow/reference/actions/add-order-line-item - Flow action fields incl. "Add for free".
- https://community.shopify.com/t/why-cant-i-manually-add-bundle-products-in-my-order/245131?page=2 (community) - "Bundles can't be added to orders" when editing existing orders, still reported 2026-06/07.
- https://community.shopify.com/t/buy-x-get-y-free/563870 (community, 2025-09) - gift via Flow, packer instructions, email shows gift.
- community search results (unverified detail): BXGY "Buy 2 Get 1" discount split across 3 units instead of one Free unit.
- https://apps.shopify.com/shopify-bundles and reviews filtered 1-2 stars - rating 2.9 / 571 reviews, launched 2023-07-11, complaints.
- https://apps.shopify.com/freegifts (BOGOS listing, UX reference) - 5.0 / 4,593 reviews, auto-add gift / gift popup, POS, analytics, "auto-sync inventory".
- Community search snippets on "Sales by discount" report (Analytics > Reports > Sales by discount; 12-72 h lag; higher plans) (unverified, secondary).
- Vendor help pages on BXGY returns (Swap, AfterShip, SCAYLE) - conflicting clawback approaches; NO Shopify-official statement found.

## Findings

### 1. Creating a bundle (Shopify Bundles app, first-party, free, all plans)
Path: Apps > Bundles > **Create bundle**.
1. **Title**.
2. **Select products** -> "Add products" dialog (standard resource picker) -> **Select**.
3. Per component row: quantity field; click a variant name to select/deselect which variants are allowed;
   row "..." menu: **Add quantity as an option** (quantity becomes a buyer-facing option), **Duplicate product**
   (this is HOW a multipack is made). Checkbox **Combine options with matching names** (one selector "Size" for
   all components that have "Size"; counts as 1 of 3 allowed options).
4. **Save and continue** -> redirected to the bundle's ordinary product page (title, media, price, SKU...).
5. New bundle is **Draft**; set **Status: Active** and **Manage sales channels** to publish.
Mobile app has the same flow.
- Product page of a bundle has a **Bundled products** block (edit entry point); Products list Inventory column
  shows "Bundle with XX variants"; product list filter can include/exclude bundles.
- Limits: fixed bundle up to 30 components (help also mentions "dynamic bundles" up to 150), up to 2000 units
  per component, max 3 options and 100 variants per bundle, no bundles inside bundles, no custom products,
  no import/export/bulk edit, no subscriptions/pre-orders. Mix-and-match = third-party app or Plus APIs.
- Integrity: if a linked component variant/option is deleted or renamed, the bundle **switches to Draft**
  (auto-unpublished). Fix: click the Bundles icon in "Bundled products" and **Save and continue**.
- Price: bundle price is the parent's own price; "Bundle prices don't update automatically when a bundled
  product's price changes."
- SKU: bundle has its own SKU; "If a component's SKU changes, you must delete and recreate the bundle."
- Shipping: no shipping profile of its own; weight = sum of component weights.

### 2. Availability
- Formula stated in help: per component floor(available / qty in bundle), take the minimum. Example: 2 chairs +
  1 desk, 15 chairs and 8 desks -> 7 bundles. Updates in real time.
- Components not tracked or with **Continue selling when out of stock** are EXCLUDED from the calculation.
- "Bundles track inventory by overall stock, not by location." (review 2026-02-18: "doesn't allow you to
  select which locations to fulfill from").
- Reviews (1-2 star): bundles appear sold out though components in stock (2026-05-20); app 2.9 stars overall.

### 3. Bundle on the order (admin)
- Order lines are the COMPONENTS ("Order SKUs are listed for individual items, not the bundle SKU").
- Since 2024-12-11 the admin Orders Detail Page shows a grouped view; each component carries the label
  **"Part of: <bundle title>"** (vendor KB). The bundle parent is not itself an order line -> merchants report
  bundle sales are hard to report and 3PL/ShipStation can't distinguish bundle vs standalone (phase 1).
- Customer-facing docs (order confirmation, invoice, POS and mobile receipt, new-order staff email) use a
  **nested group**: parent row = bundle title, qty, image, bundle total (strike-through original if
  discounted, **"Free"** if total is zero), components beneath with image/qty/title/variant.
  Return notifications use a **flat view** (each component separately).
- Draft orders: bundles now allowed (2024 changelog / Winter '25); but **editing an existing order** to add a
  bundle still fails with "Bundles can't be added to orders" (community, reported 2025-07, 2026-06, 2026-07).

### 4. Price split, tax, documents
- "The bundle price is allocated across components ... using a weighted price algorithm."
- "Discount calculated on the parent then allocated on the components."
- "Taxes will be computed on the components." -> deterministic per-component net/VAT, which is what a
  per-component invoice needs.

### 5. Fulfilment, packing slip
- "No fulfillment constraint": components can be fulfilled (split) independently, from different locations.
- Packing slip default lists components; to show the bundle name the merchant must edit the Liquid template:
  `line_item.groups` ("line item groups that the product belongs to, such as bundles or add-ons"),
  `group.title`, `group.deliverable?` (true = add-on to a parent, false = part of a bundle).
  Merchant complaints both ways (customers confused by components only; pickers need components).
- No native "gift" flag on packing slip; `order.note` is available.

### 6. Returns / refunds / exchanges of bundles
- "Refunds and returns: Operates at the component level"; refund screen lists components individually with
  their allocated price; restock toggle per refund.
- Return eligibility derives from components (bundle cannot be set final sale; component final sale blocks).
- **"Bundles can't be used in exchanges, even to exchange for an identical bundle."**
- No native "lost bundle discount" recalculation found; paid apps exist for prorated component refunds
  (phase 1: apps.shopify.com/order-ops) (unverified for native).

### 7. Free gift / BXGY (native discounts)
Path: Discounts > **Create discount** > **Buy X get Y**; method **Discount code** or **Automatic discount**.
- **Customer buys**: Minimum quantity of items | Minimum purchase amount + products/collections.
- **Customer gets**: quantity + products/collections + value **Percentage** | **Amount off each** | **Free**.
- **Uses per order** / "Set a maximum number of uses per order" (one gift per order vs one per qualifying item).
- **Limit number of times this discount can be used in total**; **Limit to one use per customer**
  (per email/phone; help notes on mobile it applies only to fixed-value discounts).
- **Combinations** section; active dates; POS Pro only (POS Lite: online only).
- Minimum purchase amount counts only products in "Customer buys", excludes shipping and tax.
- **The free item is never added to the cart automatically** - buyer must add it. Gift auto-add requires an
  app (BOGOS: "Auto-add to cart or show a free gift popup"; 5.0 / 4,593 reviews).
- **Out of stock gift**: "If free-item inventory drops to zero, those products display as sold out and
  customers can't use the discount." (i.e. the promotion silently stops; no swap logic).
- On the order: gift is a normal line at list price with a discount allocation (phase 1). Community reports
  that for same-product BXGY (Buy 2 Get 1) the discount may be spread across all units instead of one unit
  shown as Free (unverified, community).

### 8. Adding a gift after the order is placed
a) **Order editing** (before fulfilment): Add product; click the item price -> **Discount type**,
   **Discount value (per unit)**, **Reason for discount** ("is displayed to your customer") -> Done ->
   review -> **Update order**. Custom item at price 0 allowed. Restrictions: can't discount a partially
   fulfilled line; existing order discounts (incl. automatic) can't be changed or removed; discounts don't
   recompute automatically; shipping not recalculated; one custom order-level discount.
b) **Shopify Flow** action **Add order line item**: fields Product variant, Quantity, Allow duplicate
   variants, **Add for free** ("Apply a 100% discount to the line item"), Email order updates to customer,
   **Order timeline note**. "This action will add a line item without considering inventory" -> add a
   condition on variant inventory first. Runs after checkout: customer only sees it when viewing the order;
   community notes the confirmation email goes out before Flow adds the item.
   Conflict: older community threads (2024-2025) say Flow cannot zero the price; current official page has
   "Add for free". Treat as recently added.

### 9. POS
- Bundles publishable to POS (2024-09-16). POS receipt template shows nested bundle group.
- 2025-08-18: cartTransform on POS, line-item UI extension to view/edit components, split line item at
  checkout so components are itemised.
- BXGY works on POS Pro only.

### 10. Analytics
- Bundles app dashboard: **Bundle total sales**, **Bundle orders**, **Top total sales**, **Most ordered**, each
  linking to Reports; reports otherwise at component level.
- Discounts: Analytics > Reports > **Sales by discount** (community: lag 12-72 h, higher plans) (secondary).
- No native gift-cost report found (unverified); phase 1: merchants complain 100%-discount lines distort
  margin and missing cost-per-item makes the gift look like profit.

## Per-use-case table
ID | Coverage | How it works for the operator | Limits | Source
B-01 | Full | Apps > Bundles > Create bundle; Title, Select products, per-row qty, variant toggles, Save and continue -> product page | 30 comps, 3 options/100 variants, no nesting | help .../shopify-bundles
B-02 | Partial | floor(stock/qty) min over components, real time; shared components fine; Inventory column "Bundle with XX variants" | not per location; components with continue-selling excluded; reports of phantom OOS | help eligibility; app reviews
B-03 | None | Native bundle has no own stock; sealed kit = ordinary product, no assembly/kitting | - | help eligibility (inferred)
B-04 | None/n.a. | Native channels never send parent-only; API rejects "cannot be a variant with components"; imported marketplace orders can't be edited to expand | - | community search; Pickware help (secondary)
B-05 | n.a. | Shopify never sends parent+children | - | shopify.dev bundles
B-06 | Full | This IS Shopify's model: component lines + "Part of: <bundle>" label, grouped view since 2024-12 | parent not a line (3PL/report confusion) | changelog 2024-12-11; highview KB
B-07 | Partial | Separate discounts (Amount off products / BXGY with min qty) allocate across lines; no "group" object on order besides discount application | - | help BXGY
B-08 | Full | Multipack = "Duplicate product" in bundle editor, or "Add quantity as an option" | max 2000 units/component | help shopify-bundles
B-09 | Partial | Buyer picks size/colour per component; "Combine options with matching names" | 3 options/100 variants; mix-and-match needs app | help; app listing
B-10 | Full (implicit) | Order stores component lines at order time; later definition changes don't touch the order | - | shopify.dev
B-11 | Partial | Packing slip lists components; bundle title only via Liquid edit (line_item.groups/group.title) | no native grouped slip; complaints both ways | help packing-slip variables
B-12 | Partial | Bundle shows sold out; partial fulfilment of components possible; no substitute flow | - | help eligibility; shopify.dev
B-13 | Partial | No fulfilment constraint -> components split across locations; bundle stock not per location | can't choose location for bundle | shopify.dev; review 2026-02-18
B-14 | Full | Weighted price allocation; tax on components; discount on parent allocated to components; POS receipt nested | price not auto-updated when components change | shopify.dev start-building
B-15 | Partial | Refund per component at allocated price, restock toggle; return rules from components; | no exchanges of bundles; no lost-discount recompute (unverified) | help eligibility
B-16 | Partial (unverified) | Component-level reporting implies cost = sum of component costs | - | shopify.dev (reporting at component level)
B-17 | Partial | Publish to Online Store, Shop, POS, Google & YouTube (fixed only) via Manage sales channels | no Pinterest/marketplaces (review) | help bundles; review 2026-01-29
B-18 | None | No import/export/bulk edit of bundles | - | help eligibility
G-01 | None | No gift flag; only the discount title / Reason for discount marks it | - | help discounts
G-02 | Full | Gift = list price + 100% discount allocation; customer docs show "Free" when total 0 | - | grouped-view template; phase 1
G-03 | Partial | Same-product BXGY: discount allocated across units of one line (community) | (unverified) | community search
G-04 | Full | Operator adds via Edit order (Add product + 100% line discount + Reason) or Flow "Add for free" | before fulfilment only | help editing-orders/discounts; Flow help
G-05 | Full | Edit order -> Update order; timeline records edit; Flow adds "Order timeline note" | can't discount partially fulfilled line | help editing-orders
G-06 | Partial | Automatic BXGY (threshold/qty, uses per order, total limit, once per customer, dates, POS Pro) but buyer must add gift; Flow can auto-add post-checkout with conditions | no auto-add natively; once-per-customer limitation | help BXGY; Flow help
G-07 | Unknown | $0 component in a bundle not documented | - | -
G-08 | Partial | Gift is normal stock, decremented; OOS -> "display as sold out and customers can't use the discount"; Flow adds "without considering inventory" | no swap/skip rule | help BXGY; Flow help
G-09 | Partial | Gift line appears on packing slip like any item; no gift marker; packers rely on tags/notes (community) | - | community 563870
G-10 | Partial | POS/customer receipt shows strike-through + "Free"; no fiscal logic | n.a. for PL fiscal | grouped-view template
G-11 | None (unverified) | No native clawback of gift on partial return; apps do it, conflicting rules | - | vendor pages
G-12 | Partial | Sales by discount report; Bundles dashboard; no gift-cost report | lag, plan-gated (secondary) | community/secondary
G-13 | Partial | BXGY "Customer gets" from a collection -> buyer chooses which item to add | buyer must add | help BXGY
G-14 | None | No "is a gift" flag; order note only (order.note on slip); apps for gift messages | - | packing-slip variables
X-01 | Full | One model: line list price + discount allocations (code/automatic/manual) | - | phase 1; help discounts
X-02 | n.a. | - | - | -

## Conflicts / open questions
- Flow "Add for free": official page has it; 2024-2025 community threads say Flow can't discount. Likely a
  recent addition; date not found.
- Admin order display of bundles: changelog says grouped view on Orders Detail Page; vendor KB describes a
  "Part of:" label; no official screenshot/help text found.
- BXGY same-product allocation (spread vs one Free unit): community only.
- Returns of BXGY: no Shopify-official rule; vendor apps disagree (clawback vs keep).

## Confidence
- High: Bundles app create flow/labels/limits; availability formula; component-level orders/refunds; no
  exchanges; BXGY labels/limits/no auto-add/OOS behaviour; order-edit discount labels; Flow fields.
- Medium: admin "Part of:" grouped display; packing slip Liquid approach; POS behaviour.
- Low: discount reports detail; BXGY allocation quirk; native gift reporting.
