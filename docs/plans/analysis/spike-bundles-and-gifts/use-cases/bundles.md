# Bundles (zestawy): detailed use cases

Built from the spike evidence (claims.md, r3/, r4/, r5/, verify/) on 2026-11-04. Research only, not a decision record and not legal advice. The same content is in `bundles.json`.

## How to read this

- Paths like `r5/7-scope-overengineering.md` are relative to `docs/plans/analysis/spike-bundles-and-gifts/`. `C-nnn` are claim IDs from `claims.md`. Code locations are `file:line` as cited by the reports (worktree HEAD `9e35aec9d`).
- Priority follows `r5/7-scope-overengineering.md`: `stage0` fix now before the pilot, `pilot` Stage 1 MVP (conditional on the pilot client selling OL-packed kits on routed channels), `later` Stage 2/3, `out` not planned.
- Converging design assumed throughout: OpenLinker-defined bundles; component-grain stock, holds and work; synthetic component line ids `{lineId}~c:{componentVariantId}` used only on fulfilment paths; expansion frozen per order in its own insert-if-absent table; adapters declare facts in three-state fields and limits via declarations; bundle rendering on documents is an operator setting. Where evidence disagrees, the case says so under risks.
- Corrections carried in: C-027 is wrong (Allegro sends `offer.productSet` with catalogue UUIDs and quantities, price per set); about 25 breaking sites, not 6 (r4/code/B-line-identity-traced.md), and the synthetic id needs changes at 9 code sites, not 3 (verify/component-line-id.md); a routed PrestaShop pack decrement writes only the pack row, now confirmed live (B-22, verify/prestashop-live.md); "every competitor forbids nesting" is false (B-26, verify/nested-and-gift-stockout.md); bundle price split by each component own selling price at sale time is the defensible default and capping is a warning, not a method (B-14, r5/8-tax-fiscal.md).

## Summary

Cases: 27. stage0: 2, pilot: 14, later: 10, out: 1.

| ID | Name | Priority | Mechanism | Confidence |
|---|---|---|---|---|
| B-01 | Define a bundle (components and quantities) | pilot | core | confirmed |
| B-02 | Bundle availability from components, published to channels; shared components | pilot | core | confirmed |
| B-03 | Pre-built kit with its own stock versus a virtual bundle | later | field | probable |
| B-04 | Order arrives as the parent only and is expanded | pilot | core | confirmed |
| B-05 | Order arrives as parent and children; no double counting | pilot | setting | probable |
| B-06 | Order arrives as children only, grouped | later | field | probable |
| B-07 | Offer bundle: several separate lines with a shared discount | later | field | confirmed |
| B-08 | Multipack: one offer equals N units of one product | pilot | core | probable |
| B-09 | Bundle with buyer choice of variant per slot | later | core | probable |
| B-10 | Freeze bundle contents per order | pilot | core | confirmed |
| B-11 | Pack bench shows the bundle and its components; each component is scanned | pilot | core | confirmed |
| B-12 | A component is out of stock | pilot | core | probable |
| B-13 | Components in different warehouses | later | core | probable |
| B-14 | Documents: one bundle line or component lines; mixed VAT | pilot | setting | disputed |
| B-15 | Return of one component of a bundle | pilot | core | confirmed |
| B-16 | Bundle cost and margin | later | process | confirmed |
| B-17 | Publish an OpenLinker-defined bundle as a listing | pilot | core | probable |
| B-18 | Import bundle definitions from a master, shop or ERP | later | field | confirmed |
| B-19 | Which line carries the price and the VAT varies per channel or plugin | later | setting | probable |
| B-20 | The master already moves stock for a pack sale; avoid double or missing decrement | pilot | core | disputed |
| B-21 | Split shipment of one bundle and telling the channel it shipped | later | setting | confirmed |
| B-22 | NEW Routed sale decrement of a master pack writes only the pack row (silent oversell) | stage0 | core | confirmed |
| B-23 | NEW Expand a bundle line into component lines for reservation, routing and sale decrement | pilot | core | disputed |
| B-24 | NEW Operator edits or cancels an order that contains a bundle line | pilot | core | confirmed |
| B-25 | NEW Bundle shipping weight, dimensions and parcel count | later | core | unverified |
| B-26 | NEW Nested bundle (a bundle as a component of another) | out | core | disputed |
| B-27 | NEW Shoper set order: verify the live line shape before designing | stage0 | process | unverified |

## B-01 Define a bundle (components and quantities)

- **Actor:** Operator (admin)
- **Trigger:** The operator wants to sell a set that OpenLinker reserves, routes and packs from its components.
- **Priority:** pilot. Every other Stage 1 bundle behaviour reads the definition; Stage 1 itself is conditional on the pilot client selling OL-packed kits on routed channels (r5/7-scope-overengineering.md section 8).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- The bundle exists as an OpenLinker catalogue variant, which today can only come from a master sync (C-061).
- Every component is a synced, non-stale variant.
- Pilot assumption: one warehouse (r5/7-scope-overengineering.md section 0).

**Main flow**

1. The operator opens the bundle variant and adds components, each a variant with a whole quantity per set.
2. OpenLinker validates: positive whole quantities, no self-reference, no component that is itself a bundle, no stale component.
3. OpenLinker shows warnings, not refusals, when a component VAT rate differs from the bundle rate (B-14) or when the bundle variant is a master kit that keeps its own stock (B-03, B-20).
4. OpenLinker refuses a definition on a variant that is a WooCommerce bundle container (B-05 guard).
5. OpenLinker stores the component set with a definition version.
6. OpenLinker recomputes the bundle availability and enqueues a propagation for the bundle variant (B-02).

**Alternative flows and exceptions**

- Edit: a new definition version is stored; orders already ingested keep their frozen expansion (B-10).
- Remove a component: new version; open orders are not changed.
- A component later becomes stale: the bundle becomes unsellable (B-02), the definition stays.
- The operator tries to nest a bundle: refused in v1 (B-26).
- In-set price per component (spike D3a): not entered in the pilot. The sources support a split computed at sale time from each component own selling price as the default, with a typed in-set price only as an override carrying a recorded reason (verify/bundle-price-split.md section 4). A share above the standalone price raises a warning; capping is not itself an accepted method (BFH XI R 22/22, r5/8-tax-fiscal.md C-035).
- The same component listed twice in one recipe: merged into one component row with the summed quantity, so the component id stays unique (verify/component-line-id.md surprise 4).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Nothing used. Composition on the order is `offer.productSet.products[]{id, quantity}` with catalogue UUIDs only (C-001); OpenLinker owns the definition. |
| PrestaShop | Pack composition lives on `/products/{id}`: `type=pack`, `associations.product_bundle[{id, id_product_attribute, quantity}]`, `pack_stock_type` (r4/phase1/2-own-shops.md section 1.1). Not imported (D3, #3606). |
| WooCommerce | Plugin-specific meta (WPC `_woosb_ids`, official Product Bundles `bundled_items`) (r4/phase1/2-own-shops.md sections 3-4). Not read. |
| Shoper | `products.type="1"`, `children[]{bundle_id, product_id, stock_id, stock}` where `stock` is the quantity per bundle, not a stock level (r4/phase1/3-pl-saas-and-erp.md section 1.2). Not read. |
| Erli | Product-level `productSets{items[{metaProductId, quantity}]}` and `externalProductSets` (C-023). Not read. |
| Others | Subiekt GT/nexo komplet `Skladniki` (r4/phase1/3-pl-saas-and-erp.md section 4). Not read by the bridge. |

**OpenLinker behaviour**

Core only: a new OpenLinker-owned definition table plus admin CRUD (the filed #3607 scope, r5/7-scope-overengineering.md section 6). No adapter change, no new capability. The definition is the authority; channel or master compositions are never imported as truth in the pilot.

**Acceptance criteria**

- Given a bundle variant B and components A (x2) and C (x1), when an admin saves the definition, then the definition is stored as version 1 and the availability of B is recomputed from A and C.
- Given a component that is itself a bundle, when the admin adds it, then the save is refused with a "nested bundles are not supported" reason.
- Given component A at 8% VAT and bundle B at 23%, when the admin saves, then the definition is saved and the response carries a mixed-VAT warning naming both rates.
- Given B is a PrestaShop pack whose stock mode keeps its own pack row, when the admin saves, then the definition is saved with a warning that the master also keeps kit stock.

**Evidence**

`r5/7-scope-overengineering.md sections 1, 5, 6`, `C-061`, `C-035`, `verify/bundle-price-split.md`, `verify/nested-and-gift-stockout.md`, `verify/component-line-id.md surprise 4`, `r5/8-tax-fiscal.md C-035`, `r4/phase1/3-pl-saas-and-erp.md section 4.1`

**Risks**

- Without an in-set price (deferred D3a), component documents and component returns have no price basis for pilot orders; mitigation is to freeze component catalogue gross prices in the expansion row (r5/7-scope-overengineering.md section 7.4).
- An OpenLinker-only bundle variant has no source (C-061), so the bundle must exist as a product in the master.
- The no-nesting rule is justified on cost only: "every competitor forbids nesting" is false (Cin7 supports multi-level assemblies; the BaseLinker quote was misattributed) (verify/nested-and-gift-stockout.md; Subiekt GT allows a komplet inside a komplet, r4/phase1/3-pl-saas-and-erp.md section 4.1).
- The spike D3a "in-set price fixed at definition" conflicts with the price-split evidence, which favours a split at sale time by current standalone prices; a fixed figure goes stale as catalogue prices move (verify/bundle-price-split.md sections 3-4).

## B-02 Bundle availability from components, published to channels; shared components

- **Actor:** System (availability and propagation); operator reads the result
- **Trigger:** A component stock write, an OpenLinker hold claimed or closed, a component marked stale, or a definition change.
- **Priority:** pilot. Without it the bundle offer keeps selling from a figure that refreshes only on the next master sweep, the top merchant pain (C-063, r5/7-scope-overengineering.md section 5).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- A bundle definition exists (B-01).
- The bundle variant has at least one offer or shop-product mapping.

**Main flow**

1. A component position is written; `InventoryService.setInventory` enqueues a propagation for that component (inventory.service.ts:96-121, r4/code/C-stock-flows-traced.md b1).
2. A reverse lookup "component -> bundles containing it" enqueues one propagation per bundle variant.
3. `IAvailabilityService` answers the bundle as min over components of floor(global ATP of component / quantity per set), from unbuffered global component answers; any unknown component makes the bundle unknown; the bundle variant own positions are ignored (r4/code/C-stock-flows-traced.md b2).
4. The channel buffer and zero threshold are applied once, to the bundle number, by the existing write-back (inventory-sync.service.ts:99).
5. The freshness token for the bundle offer is the latest `updatedAt` over its components (r4/code/C-stock-flows-traced.md b4).
6. The bundle offer quantity is written to each channel.

**Alternative flows and exceptions**

- A shared component is sold on its own: both the component offer and every bundle containing it are republished.
- A component is stale: the bundle publishes 0 and the stale pause, its hourly sweep and the propagation stale guard all expand to bundles (stale-offer-pause.service.ts:90-104, offer-mapping.repository.ts:754-776).
- A component has no positions: known 0 for that component, so the bundle is 0.
- A component answer is unknown: the bundle publish is suppressed, never written as 0.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | A productSet offer has set-level `stock.available` only; "For number of sets available in stock, use `stock.available`" and Allegro never nets component stock across offers (r4/phase1/1-allegro.md, r5/1-allegro-pl.md C-063). |
| PrestaShop | The OL adapter already derives pack quantity on the read side (`derivePackAvailability`, prestashop-pack.types.ts:211-232) and reports it as the pack position (r4/code/C-stock-flows-traced.md c1). |
| WooCommerce | Quantity per product or variation only; bundle plugins compute their own (r4/phase1/2-own-shops.md). |
| Shoper | Set availability follows components on the shop side; whether REST returns a derived number or a manual cap for the set is unknown (r4/phase1/3-pl-saas-and-erp.md section 1.3). |
| Erli | Quantity per product offer only (r4/phase1/4-marketplaces-and-law.md section 1.1). |
| Others | Competitors: BaseLinker min of components, summing across warehouses is an option since 03/2025 (r5/4-competitors-pl.md C-039); Apilo recomputes every 15 min (C-041); Shopify is location-blind (r5/5-competitors-global.md). |

**OpenLinker behaviour**

Core, in the publish path of `IAvailabilityService`, never written into the master `inventory_items` row (two writers, r5/7-scope-overengineering.md sections 5 and 7.3). New: reverse fan-out, stale expansion at three sites, max-of-components freshness token. No adapter change.

**Acceptance criteria**

- Given A=10, C=3 and B defined as {A x2, C x1}, when B availability is computed, then B publishes 3.
- Given the same stock and A sold alone 6 units, when the propagation runs, then B is republished as 2 on every mapped channel.
- Given C availability is unknown, when B propagation runs, then no quantity is written for B and the suppression is logged.
- Given C is marked stale, when the stale pause runs, then B offers are paused at 0.
- Given a channel buffer of 1 on the connection, when B is published, then the buffer is subtracted once from the bundle figure, not per component.

**Evidence**

`r4/code/C-stock-flows-traced.md b1-b5`, `verify/standard-stress-test.md A1`, `r5/7-scope-overengineering.md sections 5, 7.3`, `C-063`, `C-039`, `C-041`, `r5/5-competitors-global.md Shopify B-02`

**Risks**

- Per-location availability for routing and global availability for publishing can disagree on a multi-warehouse install (Shopify shows the trap, r5/5-competitors-global.md); fine for a one-warehouse pilot.
- The #2617 freshness guard refuses a bundle write if the token is taken from the triggering component instead of the max over components (r4/code/C-stock-flows-traced.md b4).
- Two routes to zero (stale pause and derived ATP) must agree (r4/code/C-stock-flows-traced.md b5).
- The stress test rates a missing recompute trigger as the top critical hole: without the reverse fan-out the kit offer keeps its old quantity until something touches the kit variant (verify/standard-stress-test.md A1).
- BaseLinker sources disagree on summing across warehouses (help FAQ vs 03/2025 changelog, r5/4-competitors-pl.md C-039).

## B-03 Pre-built kit with its own stock versus a virtual bundle

- **Actor:** Operator and warehouse
- **Trigger:** A kit is physically assembled and shelved and the master counts it as its own item.
- **Priority:** later. The pilot needs only the warning (in B-01); a kit with own stock already works as an ordinary product, so modelling modes adds features, not damage prevention (r5/7-scope-overengineering.md section 5).
- **Mechanism:** field. **Confidence:** probable.

**Preconditions**

- The master reports a stock figure for the kit itself (Subiekt komplet, PrestaShop pack in pack-only mode).

**Main flow**

1. Master sync reports the kit as an ordinary variant with its own stock.
2. With no OpenLinker definition, the kit is handled as an ordinary product (works today).
3. If an OpenLinker definition is also saved on that variant, OpenLinker warns that the master keeps kit stock (pilot guard, r5/7-scope-overengineering.md section 5).
4. Later: the master declares the kit stock mode as a three-state product fact and OpenLinker chooses virtual, own or both per bundle.

**Alternative flows and exceptions**

- Subiekt GT komplet not yet assembled ("Zmontuj"): the bridge publishes SUM(st_Stan) = 0 although components are on the shelf (C-022).
- PrestaShop pack with `pack_stock_type=0` is read as "shop default" up to 9.1.x and fixed in 9.2.0, so OL can disagree with the shop on 9.2+ (r5/2-shops-erp.md section 3).
- Cin7-style kitting: pick the assembled kit if in stock, else its components (r5/5-competitors-global.md CN3); later.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not applicable (master-side concept). |
| PrestaShop | `pack_stock_type` 0 pack-only, 1 components, 2 both, 3 shop default (`PS_PACK_STOCK_TYPE`) (r4/phase1/2-own-shops.md section 1.1). |
| WooCommerce | No kit concept in core; plugin dependent (r3/code/C-stock-fulfilment-masters.md section 1.1). |
| Shoper | Optional cap "ile sztuk zestawów maksymalnie" on top of component availability (r4/phase1/3-pl-saas-and-erp.md section 1.3). |
| Erli | No kit stock concept found (r4/phase1/4-marketplaces-and-law.md). |
| Others | Subiekt GT `tw_Rodzaj` (komplet = 8 in the GT Sfera enum, r3/phase1/3-pl-saas-and-erp.md) is read by the bridge (bridge-gt Program.cs:304) and discarded; nexo komplet has zero stock until an assembly order (r4/phase1/3-pl-saas-and-erp.md section 4.2). Sky-Shop: configurable stock source per set. |

**OpenLinker behaviour**

Pilot: a definition-time warning only. Later: an optional three-state product field (kit stock mode, or composition) filled by the master adapter, following the `Product.gpsr` precedent; r5/6 argues for a field, not a capability (r5/6-design-and-code.md section 3.1).

**Acceptance criteria**

- Given a Subiekt komplet with own stock and no OL definition, when an order for it is routed, then the komplet own stock is reserved and decremented like any product.
- Given a PrestaShop pack in pack-only mode, when an admin saves an OL definition on it, then the save shows a warning that the master keeps its own kit stock.
- Given later, a master that declares kit mode "own", when availability is computed, then the master figure is used and components are not reserved.

**Evidence**

`C-022`, `C-014`, `r5/2-shops-erp.md sections 3 and 6`, `r4/phase1/3-pl-saas-and-erp.md section 4`, `r3/phase1/3-pl-saas-and-erp.md Subiekt GT`, `r5/5-competitors-global.md CN1, CN3`

**Risks**

- Whether a Subiekt GT sale of an unassembled komplet auto-assembles or blocks is unverified (C-022, r5/2-shops-erp.md section 6).
- The komplet kind code differs between products: GT 8 (Sfera SDK) and nexo 4 (bridge code comment, unverified) (r3/phase1/3-pl-saas-and-erp.md).
- C-014 version range is disputed: the empty() bug reaches 9.1.5, not only 8.1.7-9.0.2 (r5/2-shops-erp.md section 3).
- A Subiekt invoice that also releases stock (WZ) for a komplet may double the effect of an OL decrement (unverified, verify/standard-stress-test.md A10).

## B-04 Order arrives as the parent only and is expanded

- **Actor:** System (order ingestion)
- **Trigger:** An order line names a set as one item: Allegro productSet offer, PrestaShop pack row, Erli, Amazon, Kaufland, or Shoper while children are ignored.
- **Priority:** pilot. Recognition by resolved variant is the cheapest correct entry point for every parent-only channel and needs no adapter work (r5/7-scope-overengineering.md sections 3 and 9.1).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- The channel line resolves to an OpenLinker variant through offer or identifier mapping.
- That variant has a bundle definition (B-01).

**Main flow**

1. The adapter emits the line as it does today: one line, the channel line id, the bundle price.
2. Item resolution maps it 1:1 to the bundle variant (order-ingestion.service.ts:584-602).
3. Core recognises a bundle because the resolved variant has a definition; no adapter field is needed.
4. Core freezes the expansion for this order line (B-10).
5. Reservation, routing and sale decrement use the component lines from the expansion (B-23).
6. The order line, order snapshot, documents and channel writebacks keep the bundle line (D3).

**Alternative flows and exceptions**

- Unmapped line: the whole order stays `awaiting_mapping`, visibly (C-053).
- Allegro sends `productSet` but no OL definition exists: later, an attention state "set sold, contents unknown in OpenLinker" (r5/1-allegro-pl.md section 3A).
- Allegro `productSet` count or quantities differ from the OL definition: later, a drift attention, never an automatic re-definition (r5/1-allegro-pl.md section 3A, r5/3-marketplaces-countries.md C-027).
- Allegro One Fulfillment set (`fulfilledBySource`): routing is skipped (#3636, order-ingestion.service.ts:1273); whether that short-circuit runs before the expansion and also skips component holds is unverified (r5/1-allegro-pl.md item 10, verify/standard-stress-test.md A14).
- A definition created after the order was first ingested: the order must not be expanded on a later poll, because holds or work already exist on the bundle line id; the first ready ingestion records which line ids were evaluated (verify/standard-stress-test.md A2, see B-10).
- PrestaShop pack sold in the PrestaShop shop itself: not routed (own-shop skip, fulfillment-routing-eligibility.types.ts:48-50); see B-20.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | `lineItems[].offer.productSet.products[]{id (catalogue UUID), quantity}`, null on single-product offers; one `price`, `originalPrice`, `tax.rate` per line; line `quantity` counts sets and `price` is per set (verify/allegro-line-price.md Q1-Q2); no per-component price, EAN or SKU (C-001, r4/phase1/1-allegro.md). The OL mapper reads `offer.id`, `quantity`, `price`, name, tax only and ignores `productSet` and `offer.external.id` (C-002, allegro-order-source.adapter.ts:998-1016). |
| PrestaShop | One `order_rows` row with `product_id` = the pack; composition only from `/products/{id}` `associations.product_bundle`, live, not frozen (C-011, C-013). |
| WooCommerce | Only when no bundle plugin child lines are emitted (otherwise B-05). |
| Shoper | Today OL reads one line on the bundle own `stock_id` because `type`/`children` are not read (C-019, r4/phase1/3-pl-saas-and-erp.md section 1.5). |
| Erli | Order items `id, externalId, quantity, weight, unitPrice, unitPriceBeforeRebate, name, slug, ean, sku, taxRate, dispatchTime`; no set data (C-023, r5/3-marketplaces-countries.md). |
| Others | Amazon, Kaufland, Mirakl, eBay: no bundle field on the order (r4/phase1/4-marketplaces-and-law.md section 1). |

**OpenLinker behaviour**

Core recognition by resolved variant, no new `IncomingOrderItem` field in the pilot (r5/7-scope-overengineering.md section 6). Reading Allegro `productSet` becomes a later adapter field used only as a cross-check, three-state (absent = not reported, null = single product).

**Acceptance criteria**

- Given an Allegro offer mapped to variant B defined as {A x2, C x1} and an order line of quantity 2, when the order is ingested, then the order line stays B x2 and a frozen expansion A x4, C x2 is written once.
- Given an Allegro offer with no mapping, when the order is ingested, then the order is `awaiting_mapping` and no hold is written.
- Given a mapped variant without a definition, when the order is ingested, then it is handled as an ordinary line.
- Given the same order re-polled after the definition changed, when it is ingested again, then the first frozen expansion is kept.

**Evidence**

`C-001`, `C-002`, `C-011`, `C-013`, `C-019`, `C-023`, `C-053`, `verify/allegro-line-price.md Q2`, `r5/1-allegro-pl.md C-027 and section 3A`, `r5/6-design-and-code.md N-4`, `r4/phase1/4-marketplaces-and-law.md section 1`

**Risks**

- C-027 is wrong: Allegro does send composition; but it is catalogue UUIDs that Allegro merges or deletes (about 2% in one seller measurement, #7487, r5/1-allegro-pl.md), so it can only be a check, never the authority (r5/6-design-and-code.md N-4).
- The spike listed Allegro `productSet` and Shoper `children` ingestion as "fix regardless"; r5/7 disputes this as a must-have because recognition by variant covers parent-only shapes (r5/7-scope-overengineering.md section 3).
- The current Allegro `sku` is `lineItem.offer.id`, not a SKU; recognition by SKU must use `offer.external.id` or the offer mapping (r5/1-allegro-pl.md item 7).

## B-05 Order arrives as parent and children; no double counting

- **Actor:** System (order ingestion)
- **Trigger:** A shop sends a container line plus one line per component (WooCommerce bundle plugins; Shoper `children` if read).
- **Priority:** pilot. Only the definition guard is pilot work, because it stops a silent double reservation and double pick; reading children is deferred (r5/7-scope-overengineering.md section 5).
- **Mechanism:** setting. **Confidence:** probable.

**Preconditions**

- The source adapter emits child lines as ordinary order lines.

**Main flow**

1. Pilot: OpenLinker refuses to save an OL definition on a variant that is a WooCommerce bundle container, so container and children are never both expanded (r5/7-scope-overengineering.md section 5).
2. Later: the adapter tags child lines with a three-state parent link, or a per-connection operator setting states "this source sends children as lines" (X-03).
3. Later: core treats tagged children as the expansion (or suppresses them when they match the definition exactly, the Linnworks Magento guard) and takes the price from whichever side carries it (B-19).

**Alternative flows and exceptions**

- WPC fixed price: parent carries the price, children are 0; WPC auto price: parent 0 with no tax, children carry discounted prices (r4/phase1/2-own-shops.md section 3).
- Two identical bundles in one WPC order cannot be told apart reliably (link by product id, not order item id) (r4/phase1/2-own-shops.md section 3).
- A WooCommerce grouped product arrives as independent lines with no parent: not a bundle for OL (r4/phase1/2-own-shops.md section 2.2).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not applicable. |
| PrestaShop | Not applicable (pack is one row). |
| WooCommerce | Official Product Bundles: `bundled_by`, `bundled_items`, `_bundled_item_priced_individually` (C-015); WPC: children `_woosb_parent_id`, `_woosb_bundle{role, bundle_id, parent_id, qty_per_bundle, pricing_mode}`, parent `_woosb_ids`, `_woosb_price` (C-016). OL reads no `meta_data` (woocommerce-order-source.adapter.ts:363-404, r4/code/B-line-identity-traced.md section 3). |
| Shoper | `type:"1"` with nested `children[]{bundle_child_id, id, order_id, stock_id, quantity, price, tax, tax_value, discount_perc}`, no `product_id` on a child (C-018, r4/phase1/3-pl-saas-and-erp.md section 1.1). Not read (C-019). |
| Erli | Not applicable. |
| Others | Magento via Linnworks: mutually exclusive "ignore bundle child/parent items" switches (r4/phase2/4-linnworks.md B-05). |

**OpenLinker behaviour**

Pilot: core refusal at definition time. Later: a per-connection operator setting or a manifest value field (the `variantGrouping` precedent with a restrictive default), never a capability name (verify/standard-stress-test.md B); r5/6 shows "absent = no claim" is the dangerous default for this shape (r5/6-design-and-code.md section 3.3).

**Acceptance criteria**

- Given a WooCommerce variant that is a bundle container, when an admin saves an OL definition on it, then the save is refused naming the double-count risk.
- Given a WooCommerce order with a container and two child lines and no OL definition, when it is ingested, then each line is reserved as its own variant, as today.
- Given later, a connection whose setting says "children as lines" and a definition matching the children, when the order is ingested, then components are reserved once, not twice.

**Evidence**

`C-015`, `C-016`, `C-018`, `C-019`, `verify/standard-stress-test.md A6, B`, `r4/phase1/2-own-shops.md sections 2-4`, `r5/6-design-and-code.md section 3.3`, `r4/phase2/4-linnworks.md B-05`

**Risks**

- If an adapter emits children without a tag, OL would reserve and pick both the expanded bundle and the children (r5/6-design-and-code.md section 3.3).
- Shoper child `quantity` (per bundle or per line) and `price` (unit or line, net or gross) are undocumented; only an auto-generated SDK exists (r5/2-shops-erp.md section 4). See B-27.
- C-016 (WPC meta-only link) was not re-tested in round 5 (r5/2-shops-erp.md).

## B-06 Order arrives as children only, grouped

- **Actor:** System (order ingestion)
- **Trigger:** A channel sends only component lines with a group reference (Shopify `lineItemGroup`, IdoSell `bundleId`).
- **Priority:** later. OpenLinker has no Shopify or IdoSell adapter (libs/integrations list, r4/phase1/3-pl-saas-and-erp.md section 2), so nothing breaks today.
- **Mechanism:** field. **Confidence:** probable.

**Preconditions**

- An OpenLinker adapter for the channel exists (today none does for Shopify or IdoSell).

**Main flow**

1. The adapter emits component lines as ordinary lines (stock and picking are already component grain).
2. The adapter carries the group reference as a three-state field so the order view and documents can show "Part of: set".
3. No expansion happens; the price is already allocated on components.

**Alternative flows and exceptions**

- Amazon Virtual Product Bundles reportedly send components with no group key, which SKU recognition cannot detect (secondary sources only, unverified, r5/3-marketplaces-countries.md C-027).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not applicable. |
| PrestaShop | Not applicable. |
| WooCommerce | Not applicable (grouped products carry no link). |
| Shoper | Not applicable. |
| Erli | Not applicable. |
| Others | Shopify `LineItemGroup{id, title, quantity, productId, variantId, variantSku}` on each component line, price allocated by weight = unit price x quantity (C-017, r5/5-competitors-global.md SH4). IdoSell `productsResults[].bundleId` "A set's ID"; whether the set itself is a row is unknown (C-020, r4/phase1/3-pl-saas-and-erp.md section 2.1). |

**OpenLinker behaviour**

Adapter field only (group reference, three-state). No core expansion. Nothing to build until an adapter exists.

**Acceptance criteria**

- Given a Shopify order with two component lines in one `lineItemGroup`, when it is ingested by a future Shopify adapter, then two ordinary lines are reserved and both carry the group reference.
- Given the same order, when documents are issued, then component lines are shown with their allocated prices.

**Evidence**

`C-017`, `C-020`, `r5/5-competitors-global.md SH4, SH5`, `r4/phase1/2-own-shops.md section 6.1`, `r4/phase1/3-pl-saas-and-erp.md section 2.1`

**Risks**

- C-017 said the Shopify weighting method is unpublished; r5/5 shows it is published (SH4).
- IdoSell layout (set row present or not) is unknown without a live order.

## B-07 Offer bundle: several separate lines with a shared discount

- **Actor:** System (order ingestion); buyer chose a multi-offer bundle
- **Trigger:** An Allegro flexible bundle (or an Allegro-created automatic bundle) is bought.
- **Priority:** later. No stock, packing or document damage exists for this shape; only discount reporting is missing, which is gift/discount work (r5/7-scope-overengineering.md section 8 Stage 3).
- **Mechanism:** field. **Confidence:** confirmed.

**Preconditions**

- Each offer in the bundle is mapped to its own variant.

**Main flow**

1. Each offer arrives as its own line with the price already reduced and `discounts[{type: BUNDLE}]`.
2. OpenLinker handles each line as an ordinary line; stock, routing and packing are correct today.
3. Later: the reduction is carried as a neutral list price plus reduction on each line (X-01), without assuming a seller-funded discount.

**Alternative flows and exceptions**

- A partial return of one offer: refund by `AMOUNT` per line; the lost bundle discount is not computed (C-010, r4/phase1/5-merchant-voice.md PAIN-17).
- CAMPAIGN or ALLEGRO_PRICES on the same line: `originalPrice` equals `price`, so "list minus price" claims no reduction (r5/1-allegro-pl.md section 2).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Separate `lineItems[]`, each with `discounts[]{type}`; `BUNDLE` also used "for bundles with no price change" and for bundles created by Allegro; no bundle id, no amount (C-003, C-004, C-006, r4/phase1/1-allegro.md). |
| PrestaShop | Not applicable as a channel shape. |
| WooCommerce | Not applicable. |
| Shoper | Not applicable. |
| Erli | Order-level `rebate{id, name, code}` only (r5/1-allegro-pl.md C-023). |
| Others | Kaufland one `discounts[]` per order unit; Mirakl line `promotions[]` with `deduced_amount` (r4/phase1/4-marketplaces-and-law.md). |

**OpenLinker behaviour**

No bundle behaviour; the lines are ordinary. The only gap is discount attribution, which is X-01 (line list price plus reduction, three-state, with reasons array and funder per r5/1).

**Acceptance criteria**

- Given an Allegro flexible bundle of two offers mapped to A and C, when the order is ingested, then two ordinary lines are reserved, routed and packed with no expansion.
- Given the same lines carrying `discounts:[BUNDLE]`, when they are ingested, then no reason is stored as "seller discount" until X-01 lands.

**Evidence**

`C-003`, `C-004`, `C-006`, `C-010`, `r4/phase1/1-allegro.md ALG-05`, `r5/1-allegro-pl.md sections 1-2`

**Risks**

- C-003 corollary "amount = originalPrice - price" is wrong for CAMPAIGN and ALLEGRO_PRICES (r5/1-allegro-pl.md C-003).

## B-08 Multipack: one offer equals N units of one product

- **Actor:** System (order ingestion); operator maps the offer
- **Trigger:** An Allegro multipack offer (productSet with one product, quantity N) is bought.
- **Priority:** pilot. It costs little beyond B-04 and B-23, Allegro makes the multipack offer the only single-offer quantity deal from 2027-01-12 (C-005), and a multipack mapped to a single unit is a silent under-decrement (verify/standard-stress-test.md A5).
- **Mechanism:** core. **Confidence:** probable.

**Preconditions**

- The multipack offer is mapped to an OL bundle variant defined as {A x N} (B-01).

**Main flow**

1. The order line arrives as one line, quantity q.
2. Core recognises the bundle variant (B-04) and freezes the expansion A x (q * N).
3. Reservation, routing and sale decrement act on A (B-23); the bench asks the packer for q * N units of A.

**Alternative flows and exceptions**

- The multipack offer is mapped (by hand or by barcode linking on the shared product EAN) to the single-unit variant A instead of a bundle: OL would reserve and decrement q units instead of q * N (inference, unverified live; the stress test rates it HIGH, verify/standard-stress-test.md A5; the BaseLinker case in r4/phase1/5-merchant-voice.md PAIN-06 shows the pattern). Guard: park the order with an attention state when Allegro reports a productSet whose total product quantity is not 1 and the mapped variant has no definition. This guard is the one place the pilot reads `productSet`, as a three-state field used only as a check.
- Old single-offer MULTIPACK promotion lines (before 2027-01-12) carry `discounts[{type: UNIT_PERCENTAGE_DISCOUNT}]` and must keep parsing (r5/1-allegro-pl.md C-005).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | `offer.productSet.products` with one element `quantity` N; line `quantity` counts packs and `price` is per pack (verify/allegro-line-price.md Q2); offer `stock.available` counts packs; replaces single-offer MULTIPACK from 2027-01-12 (C-005, r4/phase1/1-allegro.md ALG-02). Whether the order line always carries `productSet` for a multipack is unverified (r5/1-allegro-pl.md C-001 caveat c). |
| PrestaShop | A pack with one product and quantity N. |
| WooCommerce | Plugin bundle with one child. |
| Shoper | A set with one child and `stock` = N. |
| Erli | `productSets` with one item (C-023), semantics unknown. |
| Others | Linnworks: single-child composite (r4/phase2/4-linnworks.md B-08). |

**OpenLinker behaviour**

Same core mechanism as B-04 and B-23. Pilot adds one adapter field (Allegro `productSet` total quantity, three-state) and one core guard that parks a line whose reported set quantity is not 1 when the mapped variant has no definition.

**Acceptance criteria**

- Given B defined as {A x6} and an Allegro line of B x2, when the order is ingested and routed, then a hold of 12 A is written and the work line asks for 12 A.
- Given A at 30 units, when B availability is computed, then B publishes 5.
- Given an Allegro line whose productSet is one product of quantity 3, mapped to the plain variant A with no definition, when the order is ingested, then the order is parked with a "set quantity unknown to OpenLinker" attention and nothing is reserved or routed.

**Evidence**

`C-005`, `C-001`, `verify/allegro-line-price.md Q2`, `verify/standard-stress-test.md A5`, `r4/phase1/1-allegro.md ALG-02, ALG-03`, `r5/1-allegro-pl.md C-005`, `r4/phase1/5-merchant-voice.md PAIN-06`

**Risks**

- The silent under-decrement when a multipack offer is mapped to the single-unit variant is an inference for OL, not tested.
- Allegro swagger still documents MULTIPACK creation without a deprecation marker (r5/1-allegro-pl.md item 11).

## B-09 Bundle with buyer choice of variant per slot

- **Actor:** Buyer; system (ingestion)
- **Trigger:** The buyer picks a size or colour for a component of a set.
- **Priority:** later. Already deferred by the spike and by r5/7; no pilot channel needs it on a single line.
- **Mechanism:** core. **Confidence:** probable.

**Preconditions**

- The bundle definition allows a slot with alternatives (not in the pilot model).

**Main flow**

1. Later: the definition holds a slot with allowed variants instead of one component variant.
2. Later: the chosen variant must reach OL on the order (channel field or operator choice after purchase).
3. Later: the expansion freezes the chosen variant per slot.

**Alternative flows and exceptions**

- The channel does not send the choice: the operator chooses after purchase (Sellasist dynamic sets update stock only after the choice, r5/4-competitors-pl.md C-042).
- Allegro flexible bundles: the buyer picks a whole offer per slot, so each pick is its own line (B-07), no slot logic needed.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Flexible bundle slots of up to 30 offers; the buyer picks one offer per slot (r4/phase1/1-allegro.md ALG-06). Product sets have fixed products. |
| PrestaShop | Pack items are fixed combinations (`id_product_attribute`). |
| WooCommerce | Plugin dependent; not researched in detail (unverified). |
| Shoper | Each variant combination is a separate set; non-stock options are buyer-chosen (r4/phase1/3-pl-saas-and-erp.md PLS-04). |
| Erli | No evidence (unverified). |
| Others | IdoSell "Wybór odpowiedniego wariantu i rozmiaru możesz pozostawić klientowi" and `productBundleItems[].sizeId` on create (r4/phase1/3-pl-saas-and-erp.md section 2.4); Shopify combine repeat options since 2025-12 (r5/5-competitors-global.md section 4). |

**OpenLinker behaviour**

Core definition model change (slots) plus a channel field or an operator step. Nothing in the pilot.

**Acceptance criteria**

- Given later, a bundle with a size slot {S, M, L} and an order naming M, when it is ingested, then the frozen expansion holds M and only M is reserved.
- Given later, an order that names no size, when it is ingested, then the order is held for an operator choice and no slot component is reserved.

**Evidence**

`r4/phase1/1-allegro.md ALG-06`, `r4/phase1/3-pl-saas-and-erp.md sections 1.2, 2.4`, `C-042`, `r5/5-competitors-global.md section 4`

**Risks**

- How the choice reaches OL differs per channel; IdoSell read and write fields disagree (read `bundleId`, write `productBundleItems`) (r4/phase1/3-pl-saas-and-erp.md section 2.2).

## B-10 Freeze bundle contents per order

- **Actor:** System (order ingestion)
- **Trigger:** The first ingestion of an order whose line resolves to a bundle variant.
- **Priority:** pilot. Component keys derive from the expansion, so an expansion that changes between polls would orphan holds and mint new decrement keys (r5/6-design-and-code.md section 3.9).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- B-04 recognition succeeded (order is ready, not `awaiting_mapping`).

**Main flow**

1. Core computes the expansion from the current definition: component variant, quantity per set, quantity for the line.
2. Core writes it once, in the first ready transaction, into its own table with insert-if-absent: every evaluated line id (including lines that are not bundles, as a negative fact), bundle variant id, component productId and variantId, quantity per set, definition version, component catalogue gross prices (verify/standard-stress-test.md A2, C; verify/component-line-id.md surprises 5-6).
3. The recipe is merged per component variant before it is frozen, so no component id repeats (verify/component-line-id.md surprise 4).
4. Every later reader (reservation, routing, decrement, bench label, guards) reads the frozen expansion, never the live definition.
5. The `orderSnapshot` column is not touched (it stays the channel original, #3542).

**Alternative flows and exceptions**

- Re-poll after a definition edit: the insert is a no-op, the first expansion wins.
- A definition created after the order was first evaluated: the negative fact keeps the line unexpanded, so holds and work stay on the bundle line id and are not duplicated (verify/standard-stress-test.md A2).
- The operator remaps the line from kit X to plain Y after the freeze: the expansion check `frozen.bundleVariantId === item.variantId` fails, an attention is raised and the line is not routed (verify/standard-stress-test.md A2).
- The order goes ready -> awaiting_mapping -> ready: the expansion row must survive (the ADR-080 cost snapshot does not, r5/6-design-and-code.md section 3.9).
- An old order ingested late (backfill, reconcile) is frozen with the definition current at ingestion, not at sale (r5/2-shops-erp.md section 2).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Line `productSet` reflects the offer at purchase but in catalogue UUIDs (C-001). |
| PrestaShop | No order-side pack composition; issue #37423 "Major" (C-013, r4/phase1/5-merchant-voice.md PAIN-03). Confirmed live on 9.0.2: after the pack was changed, reading the order pack through `products/{id}` gave the new contents (verify/prestashop-live.md Q4). The OL module hook `actionValidateOrderAfter` could capture it at sale (r5/2-shops-erp.md section 2, existence on 1.7.x unverified). |
| WooCommerce | Child lines are themselves the frozen contents when a plugin sends them. |
| Shoper | `children[]` on the order line, if read. |
| Erli | None on the order. |
| Others | Linnworks stores child rows on the order item (`CompositeSubItems`) (r4/phase2/4-linnworks.md B-10). |

**OpenLinker behaviour**

Core: a separate insert-if-absent table, not `orderSnapshot` (ingestion rewrites it and an `OrderItem` field must be named in five or more allowlists, C-055) and not `order_line_items` (delete-then-reinsert, ADR-080). The bundle line id is stored in the row and never recovered by splitting a component id on `~c:` (verify/component-line-id.md surprise 6).

**Acceptance criteria**

- Given order O with bundle line L and definition v1 {A x2, C x1}, when O is ingested, then one expansion row for (O, L) is written with v1.
- Given the definition edited to v2 {A x3}, when O is re-polled, then the expansion for (O, L) is still v1.
- Given O moves to awaiting_mapping and back to ready, when it is re-ingested, then the v1 expansion is unchanged and holds are not re-keyed.
- Given order P first ingested before B had a definition, when P is re-polled after the definition is saved, then P is not expanded and its bundle-line hold is not duplicated.

**Evidence**

`C-013`, `C-055`, `verify/prestashop-live.md Q4`, `verify/standard-stress-test.md A2`, `verify/component-line-id.md surprises 4-6`, `r5/7-scope-overengineering.md sections 5, 6, 7.4`, `r5/6-design-and-code.md section 3.9`, `r5/2-shops-erp.md section 2`, `r4/phase1/5-merchant-voice.md PAIN-03`

**Risks**

- r5/6 proposes instead a `bundleSnapshot` column on `order_records` expanded in `toDomain` (r5/6-design-and-code.md section 5); r5/7 rejects storing it in the order record. The two designs disagree on where the frozen data lives.
- Snapshot at ingestion is not the at-sale truth for PrestaShop (r5/2-shops-erp.md section 2).

## B-11 Pack bench shows the bundle and its components; each component is scanned

- **Actor:** Packer
- **Trigger:** A routed work containing a bundle line is opened at the bench.
- **Priority:** pilot. Component pick lines come free with B-23 and are the only way the packer sees what to put in the box; the label is cosmetic (r5/7-scope-overengineering.md section 5).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- Work lines were created at component grain (B-23).

**Main flow**

1. The bench lists one row per component work line with its own name, EAN and bin (bench-parcel.service.ts:879-901).
2. Each row shows "Part of: <bundle name> x q", read from the frozen expansion.
3. The packer scans each component; verification is keyed by work line id (fulfillment-verification.service.ts:108-116).
4. The parcel closes when every component line is verified.
5. The packing slip shows the bundle line and its components.

**Alternative flows and exceptions**

- The packer scans the bundle own barcode: it matches no line, by design (parcel-scan-match.ts:90-100).
- A component is missing: its line cannot be verified, so the parcel cannot close short (B-12).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not applicable (bench is internal). |
| PrestaShop | Not applicable. |
| WooCommerce | Not applicable. |
| Shoper | Shop WZ lists components (r3/phase1/3-pl-saas-and-erp.md checklist). |
| Erli | Not applicable. |
| Others | Linnworks: "Scanning composite parent will scan all child items" and pick list tables with and without composite parents (r5/5-competitors-global.md B-11); Sellasist hide-from-picking is product-level (r5/4-competitors-pl.md C-042). |

**OpenLinker behaviour**

Core and frontend: almost free once work lines are components; the label is a lookup in the frozen expansion. No adapter change.

**Acceptance criteria**

- Given a work for B x1 = {A x2, C x1}, when it is opened at the bench, then two rows A (2) and C (1) are shown, each labelled "Part of: B x1".
- Given A scanned twice and C not scanned, when the packer tries to close, then the parcel stays open with C outstanding.
- Given the bundle barcode is scanned, when the scan is matched, then no line is incremented.

**Evidence**

`r4/code/C-stock-flows-traced.md a5`, `r3/code/C-stock-fulfilment-masters.md section 3`, `r5/7-scope-overengineering.md section 5`, `r5/5-competitors-global.md Linnworks B-11`

**Risks**

- Packing slip content (bundle and components together) is a top merchant pain (spike pain 4) but the slip template change is not traced in code (unverified effort).

## B-12 A component is out of stock

- **Actor:** System (reservation, routing); operator
- **Trigger:** An order needs more of a component than is available.
- **Priority:** pilot. The hold-and-name behaviour comes from existing routing once components have their own line ids; only the copy is new (r5/7-scope-overengineering.md section 5).
- **Mechanism:** core. **Confidence:** probable.

**Preconditions**

- Expansion and component-grain lines exist (B-10, B-23).

**Main flow**

1. The reservation call is all-or-nothing per order; an `InsufficientAvailabilityError` is swallowed and no hold is written (order-ingestion.service.ts:2299-2304).
2. The OL router reports the short component line as unfulfillable (evaluate-routing.ts:320-327).
3. The commit refuses the plan and the order is held as `routing-refused` with UF-L attention naming the component (translate the synthetic id to the component name).
4. When the component stock arrives, the held order is re-routed (reroute sweep and stock-change trigger, #3485, #3558).

**Alternative flows and exceptions**

- Substitute a component, split the set, or back-order: later.
- A non-routed (mirror) order: no OL router; the destination shop decides.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Waybill cannot express a partial quantity of a line, so a set cannot be shipped short (C-009). |
| PrestaShop | Not applicable as a channel shape. |
| WooCommerce | Not applicable. |
| Shoper | The shop makes the set unavailable when a component sells out (r4/phase1/3-pl-saas-and-erp.md section 1.3). |
| Erli | Not applicable. |
| Others | Linnworks: splitting a composite across orders is not supported (r4/phase2/4-linnworks.md B-12); Shopify: item-level fulfilment holds (r5/5-competitors-global.md B-12). |

**OpenLinker behaviour**

Core, existing paths. The only new work is naming the component in the attention copy from the synthetic id.

**Acceptance criteria**

- Given B = {A x2, C x1}, A=5, C=0 and an order for B x1, when it is routed, then the order is held as routing-refused and the attention names C.
- Given the same order and C restocked to 3, when the stock change is propagated, then the order is re-routed and work lines for A and C are created.

**Evidence**

`r4/code/C-stock-flows-traced.md a2, a3 and D3 gap 3`, `C-009`, `r5/7-scope-overengineering.md section 5`, `r4/phase2/4-linnworks.md B-12`

**Risks**

- D3 says a shortfall "holds the line and names the component" but the reservation path has no such code; only the router can do it, and only for OMS-routed orders (r4/code/C-stock-flows-traced.md D3 gap 3).
- A reservation that silently fails leaves no hold, so stock can be promised elsewhere before routing runs (verify/standard-stress-test.md A13).

## B-13 Components in different warehouses

- **Actor:** System (router)
- **Trigger:** The components of one set are stocked in different locations.
- **Priority:** later. The pilot runs one warehouse, where routing groups by location and one bundle lands in one work (r5/7-scope-overengineering.md section 5 D3f row).
- **Mechanism:** core. **Confidence:** probable.

**Preconditions**

- More than one active location.

**Main flow**

1. Later: a cohesion check at commit refuses a plan that places the components of one bundle line in different locations; the stress test prefers this to a router port change (verify/standard-stress-test.md A7).
2. Later: a split is allowed only in whole sets, or by explicit operator override.
3. Later: per-location bundle availability is computed for routing.

**Alternative flows and exceptions**

- Today `line-split` and `quantity-split` rules could place two components of one kit in two locations, i.e. two parcels for one kit (r3/code/C-stock-fulfilment-masters.md section 3).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | One waybill per line id, no quantity (C-009). |
| PrestaShop | Not applicable. |
| WooCommerce | Not applicable. |
| Shoper | Not applicable. |
| Erli | Not applicable. |
| Others | Shopify bundles track inventory by overall stock, not by location (r5/5-competitors-global.md B-02); BaseLinker computes per warehouse then optionally sums (C-039). |

**OpenLinker behaviour**

Core router cohesion rule plus per-location availability. Not needed for a one-warehouse pilot.

**Acceptance criteria**

- Given later, A only in location 1 and C only in location 2, when an order for B is routed, then the plan is refused or the operator is asked, never split silently.
- Given the pilot with one active location, when an order for B is routed, then all component work lines of the B line land in one work.

**Evidence**

`r3/code/C-stock-fulfilment-masters.md section 3`, `r4/code/C-stock-flows-traced.md a3`, `verify/standard-stress-test.md A7`, `r5/5-competitors-global.md B-02`, `C-039`

**Risks**

- r3/phase1/5-merchant-voice.md PAIN-04 reports the pain; effort to add cohesion to the router is not sized.

## B-14 Documents: one bundle line or component lines; mixed VAT

- **Actor:** System (invoice and receipt mappers); operator; tax adviser
- **Trigger:** A sales document is issued for an order with a bundle line.
- **Priority:** pilot. Only "keep the bundle line plus a definition warning" is pilot; component documents wait for the tax adviser (r5/7-scope-overengineering.md sections 3 and 5).
- **Mechanism:** setting. **Confidence:** disputed.

**Preconditions**

- The order contains a recognised bundle line.

**Main flow**

1. Pilot: the invoice and receipt mappers keep the bundle line as the channel sold it, with its own price and rate (D3, order-to-issue-invoice-command.mapper.ts:374,384).
2. Pilot: if component rates differ from the bundle rate, the definition carries a warning (B-01); nothing changes on the document.
3. Later: an operator setting per connection (or per bundle) chooses "one line" or "components", in the ADR-082 shape. Default split: proportional to each component own standalone gross selling price at the time of sale, frozen with the order and reused for refunds and corrections; an operator in-set price is an override with a recorded reason (verify/bundle-price-split.md sections 3-4). A component share above its own selling price raises a warning; capping is not an accepted method on its own (BFH XI R 22/22, r5/8-tax-fiscal.md C-035).

**Alternative flows and exceptions**

- A component line would carry 0.00 alone in its VAT bucket on eparagony: HTTP 400 errorCode 41 before the printer (C-028, verify/eparagony-gift-forms.md).
- A single composite supply: one rate applies even when component prices are identifiable (ECJ C-463/16, r5/3-marketplaces-countries.md C-035), so "default to components when rates differ" (D3c) is not always right.
- The bundle costs more than the sum of its standalone prices: a proportional split puts every component above its own price; no source covers this, flag for the adviser (verify/bundle-price-split.md section 4).
- A component has no standalone selling price: the MF notice allows cost as the basis; the operator-recorded net unit cost (#3588) is a candidate but is net and optional (verify/bundle-price-split.md section 4).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | One `tax.rate` per line; product-set elements carry no tax (C-001, r4/phase1/1-allegro.md VAT split row). |
| PrestaShop | The pack row carries the pack price and is taxed entirely at the pack own rule; a 23% pack with a 5% component printed one 23% row (verify/prestashop-live.md Q4). |
| WooCommerce | WPC auto price sets the parent untaxed and taxes children (r4/phase1/2-own-shops.md section 3). |
| Shoper | Children carry their own `tax` and `tax_value` (r4/phase1/3-pl-saas-and-erp.md section 1.1). |
| Erli | One `taxRate` per item. |
| Others | IdoSell toggle "Pokazuj zestaw jako jedną pozycję na dokumentach sprzedaży", WZ always components, proportional split (r4/phase1/3-pl-saas-and-erp.md section 2.4); Subiekt nexo `ZamienKompletyNaSkladniki` (semantics unverified); Subiekt GT komplet on its own rate (r3/phase1/3-pl-saas-and-erp.md); Sky-Shop shows no component rates on invoices (C-021). |

**OpenLinker behaviour**

Pilot: no document change. Later: operator setting, never a core default, because choosing between one rate and per-component rates is a tax decision ADR-063 keeps out of core (r5/6-design-and-code.md section 4).

**Acceptance criteria**

- Given an order with B at 23% made of A (23%) and C (8%), when an invoice is issued in the pilot, then the invoice has one line for B at 23%.
- Given later, the connection setting "components", when the invoice is issued, then A and C lines are issued with prices split proportionally to the standalone selling prices frozen at sale, summing exactly to B, and a share above a component own price is reported as a warning.
- Given later, a component line that would be 0.00 alone in its rate on eparagony, when the receipt is composed, then OL refuses before calling with an operator-facing reason.

**Evidence**

`C-001`, `C-021`, `C-028`, `C-035`, `verify/bundle-price-split.md`, `verify/prestashop-live.md Q4`, `r5/8-tax-fiscal.md C-035`, `r5/3-marketplaces-countries.md C-035`, `r4/phase1/4-marketplaces-and-law.md sections 2.1, 2.6`, `r5/6-design-and-code.md section 4`, `verify/eparagony-gift-forms.md`

**Risks**

- The spike (D3c) defaults to components when rates differ; r5/7 says this reverses the decided D3 without client evidence; r5/3 says it is only right for separate supplies (ECJ C-463/16).
- C-035 is "probable, overstated": the BFH test disqualifies a method, it is not a free-standing rule (r5/3-marketplaces-countries.md); the companion XI R 22/22 also rejected capping, so the cap is a warning, not an allocation method (r5/8-tax-fiscal.md). German rulings are persuasive only in Poland.
- KIS 703725 and BFH both argue against documenting a mixed-rate set as one line at one rate (verify/standard-stress-test.md D6), which weakens the pilot "keep one line" rule for mixed-rate kits; the warning at definition is the pilot mitigation.
- Pilot orders documented as one line leave component returns without a document basis (B-15).

## B-15 Return of one component of a bundle

- **Actor:** Buyer; operator (returns desk)
- **Trigger:** The buyer returns part of a set.
- **Priority:** pilot. Without the guard a returned set restocks the bundle variant, which has no stock of its own, or credits the wrong component at the wrong price (r4/code/B-line-identity-traced.md row 31, r5/7-scope-overengineering.md section 4b).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- The order line is a recognised bundle with a frozen expansion.

**Main flow**

1. The return line is resolved to the bundle order line by sku or offerId (return-order-line-resolution.domain-service.ts:179,188).
2. Pilot guard: restock of a bundle line is blocked with a named reason ("bundle line, choose the component"). Today `resolveRestockTarget` restocks the resolved bundle variant, not its components (return-custody.service.ts:931-940, verify/component-line-id.md section 3 site 9).
3. Pilot guard: the credit-note proposal answers `no-match` for a bundle line, so the operator decides the amount.
4. Later: the operator picks the component from the frozen expansion; restock goes to that component in its owning master; the credit uses the per-component split frozen at sale (art. 29a ust. 10: the value attributed on the original document, verify/bundle-price-split.md section 3) and can claw back the lost bundle discount.

**Alternative flows and exceptions**

- Return of the whole set: later, restock every component by the frozen quantities.
- PrestaShop pack restock in components mode writes a row the shop ignores (r5/2-shops-erp.md section 5); see B-22.
- Allegro set with deposits: the deposit arrives as one sum for the line, so a component deposit split is not given (r5/1-allegro-pl.md item 8).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | `CustomerReturnItem{offerId, quantity, name, price, reason, serialNumbers}`, no line item id and no component; refund per line as `QUANTITY` or `AMOUNT`; One Fulfillment dispositions carry `product{gtins, name, quantity}` (C-010, r4/phase1/1-allegro.md). |
| PrestaShop | Return of the pack row only (r3/phase1/2-own-shops.md section 1.4). |
| WooCommerce | Refund per line item (plugin child lines if present). |
| Shoper | Unknown (r3/phase1/3-pl-saas-and-erp.md checklist). |
| Erli | `returns[].items[]{index, quantity}` by positional line index (r4/phase1/4-marketplaces-and-law.md section 1.1). |
| Others | Kaufland returns per piece; Linnworks `IsPartialCompositeReturn` with a manual amount (r4/phase2/4-linnworks.md B-15); Brightpearl component credit at 0 value (r5/5-competitors-global.md B-15); IdoSell allows a component return only if the set was not one line on the sale document (r3/phase1/3-pl-saas-and-erp.md PLS-09). |

**OpenLinker behaviour**

Core guards in the pilot (restock and credit proposal refuse a bundle line). Component returns later, reading the frozen expansion.

**Acceptance criteria**

- Given an Allegro return of offer X mapped to bundle B, when the return line is resolved, then it resolves to the B order line.
- Given the operator disposes it as restock, when the restock runs, then it is blocked with a "bundle line" reason and no stock is written to B.
- Given the same return, when the credit-note proposal is built, then the line is `no-match` and no amount is proposed.

**Evidence**

`C-010`, `C-064`, `verify/component-line-id.md section 3`, `verify/bundle-price-split.md section 3`, `r4/code/B-line-identity-traced.md rows 31, 32`, `r4/code/C-stock-flows-traced.md a9`, `r5/7-scope-overengineering.md section 4b`, `r5/2-shops-erp.md section 5`, `r4/phase1/5-merchant-voice.md PAIN-17`

**Risks**

- The Allegro "you lose the set discount" return text was only user-quoted, not found on an official page (r4/phase1/5-merchant-voice.md PAIN-17).
- Pilot orders have no in-set price, so a later component credit needs a fallback rule forever unless catalogue prices are frozen now (r5/7-scope-overengineering.md section 7.4).

## B-16 Bundle cost and margin

- **Actor:** Operator (analytics)
- **Trigger:** Margin is reported for orders containing bundles.
- **Priority:** later. Margin is reporting, not damage; the process step covers the pilot (r5/7-scope-overengineering.md section 5).
- **Mechanism:** process. **Confidence:** confirmed.

**Preconditions**

- Variant cost price exists (ADR-080, #3588).

**Main flow**

1. Pilot process: the operator enters the kit cost on the bundle variant through the existing cost endpoint before go-live.
2. The order cost snapshot uses the bundle variant cost like any variant.
3. Later: bundle cost = sum of frozen component costs x quantity, offered as a default.

**Alternative flows and exceptions**

- A bundle order ingested without a bundle variant cost stays "no-cost" forever, because snapshots are never upgraded (#3588, r5/7-scope-overengineering.md section 7.6).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not applicable. |
| PrestaShop | Not applicable. |
| WooCommerce | Not applicable. |
| Shoper | Not applicable. |
| Erli | Not applicable. |
| Others | Subiekt nexo `SzacujKosztKompletuJakoSumeKosztuSkladnikow` (r3/phase1/3-pl-saas-and-erp.md); BaseLinker `[bundle_average_purchase_price]` tag, sum unverified (r5/4-competitors-pl.md B-16); Brightpearl cost on the parent row (r5/5-competitors-global.md section 4). |

**OpenLinker behaviour**

Process now, zero code. Later: core derivation from the frozen expansion.

**Acceptance criteria**

- Given kit cost entered on B before go-live, when an order for B is ingested, then the line cost snapshot is the B cost.
- Given later, no cost on B and costs on A and C, when margin is reported, then B cost is shown as the sum of A and C costs times their quantities.

**Evidence**

`r5/7-scope-overengineering.md sections 5, 7.6`, `r5/4-competitors-pl.md B-16`, `r5/5-competitors-global.md section 4`, `r3/phase1/3-pl-saas-and-erp.md Subiekt nexo`

**Risks**

- The cost carry-forward key `productId|variantId` collides when the same variant appears twice in an order (r3/code/B-order-lines-and-documents.md row 10).

## B-17 Publish an OpenLinker-defined bundle as a listing

- **Actor:** Operator (listing wizard)
- **Trigger:** The operator publishes the bundle variant to a marketplace or shop.
- **Priority:** pilot. It needs no new code once B-02 feeds the quantity; productSet offer creation is a later feature.
- **Mechanism:** core. **Confidence:** probable.

**Preconditions**

- The bundle variant exists in the catalogue (from a master) and has a definition.

**Main flow**

1. The bulk wizard publishes the bundle variant like any variant (offer-builder.service.ts:273-300).
2. The quantity comes from bundle availability (B-02).
3. Barcode blockers apply as usual; a seller-made set usually has no GTIN (#2240, #2243).

**Alternative flows and exceptions**

- Later: publish to Allegro as a productSet offer naming each catalogue product and quantity (`productSet[]`, up to 10 products per the current tutorial).
- A set mixing producers: Allegro allows one GPSR responsible person per offer (r4/phase1/5-merchant-voice.md PAIN-20).
- Shop publish (WooCommerce) writes a simple product with the derived quantity; WC bundle types are never written (r3/code/C-stock-fulfilment-masters.md section 4).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | `SaleProductOfferRequestV1.productSet[]` with `ProductSetElementQuantity.quantity.value`; "For number of sets available in stock, use `stock.available`"; max 10 products (tutorial) vs 5 (2022 help) (r4/phase1/1-allegro.md). |
| PrestaShop | OL publishes nothing to a master. |
| WooCommerce | Published as a simple product (r3/code/C-stock-fulfilment-masters.md section 4). |
| Shoper | Publish destination since #3713; set type not written (unverified effect). |
| Erli | `ProductCreate.productSets` exists, semantics unknown (r5/3-marketplaces-countries.md). |
| Others | Linnworks lists composite parents like any SKU, price set manually (r4/phase2/4-linnworks.md B-17). |

**OpenLinker behaviour**

No new code in the pilot; it falls out of B-02. A "bundle listing support" declaration is dropped until a write path exists (r5/6-design-and-code.md section 3.2).

**Acceptance criteria**

- Given bundle B with availability 3 and an Allegro connection, when B is published through the wizard, then one offer is created with stock 3.
- Given a component of B selling out, when propagation runs, then the B offer quantity drops to 0.

**Evidence**

`r3/code/C-stock-fulfilment-masters.md section 4`, `r4/phase1/1-allegro.md offer product set`, `C-061`, `r5/6-design-and-code.md section 3.2`, `r4/phase1/5-merchant-voice.md PAIN-20`

**Risks**

- An OpenLinker-only bundle (no master product) cannot be published because variants come only from master sync (C-061).
- Whether Allegro wants a set-specific card or parameter for a seller-made set is unverified (r3/code/C-stock-fulfilment-masters.md section 4).

## B-18 Import bundle definitions from a master, shop or ERP

- **Actor:** Operator; system (master sync)
- **Trigger:** The operator already defines sets in PrestaShop, Shoper, IdoSell, Erli or Subiekt.
- **Priority:** later. Scoped out by #3606 and by r5/7; definitions are typed in OL for the pilot.
- **Mechanism:** field. **Confidence:** confirmed.

**Preconditions**

- The master exposes composition through its API.

**Main flow**

1. Later: the master adapter fills an optional three-state composition field on the product.
2. Later: OpenLinker proposes a definition and the operator accepts it; the OL definition stays the authority.
3. Pilot: no import; a definition-time warning when a master pack also exists (B-03).

**Alternative flows and exceptions**

- The master composition changes later: drift attention, never an automatic overwrite of the OL definition.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not a master. |
| PrestaShop | `/products/{id}` `type`, `associations.product_bundle`, `pack_stock_type` (r4/phase1/2-own-shops.md SHOP-02, SHOP-03). |
| WooCommerce | Plugin specific; WC core type union is `simple \| variable \| grouped \| external` (woocommerce-product.types.ts:20). |
| Shoper | `products.type`, `children[]{product_id, stock_id, stock}` (r4/phase1/3-pl-saas-and-erp.md PLS-02). |
| Erli | `productSets`, `externalProductSets` (C-023). |
| Others | IdoSell `productType = product_bundle`, `productBundleItems[]{productId, bundledId, bundleQuantity}`; Subiekt GT `Towar.Skladniki`, nexo `IAsortyment.Skladniki` (r4/phase1/3-pl-saas-and-erp.md); BaseLinker imports Shoper, WooCommerce and Subiekt GT sets (r5/4-competitors-pl.md B-18). |

**OpenLinker behaviour**

Later: a product field (three-state composition) per r4/code/A and r5/6, not a capability.

**Acceptance criteria**

- Given later, a PrestaShop pack with two items, when master sync runs, then the product carries a composition and OL offers it as a draft definition.
- Given later, the shop composition changes after acceptance, when sync runs, then a drift attention is raised and the OL definition is unchanged.

**Evidence**

`r5/7-scope-overengineering.md section 1`, `r4/code/A-capability-traced.md section 3`, `r5/6-design-and-code.md section 3.1`, `r5/4-competitors-pl.md B-18`, `r4/phase2/4-linnworks.md B-18`

**Risks**

- Competitors import sets (BaseLinker), so this is a parity gap after the pilot (r5/4-competitors-pl.md).

## B-19 Which line carries the price and the VAT varies per channel or plugin

- **Actor:** System (ingestion, documents)
- **Trigger:** An order with a set arrives with money on the parent, on the children, or split.
- **Priority:** later. Only matters once child shapes are read (B-05 later part); the pilot keeps the bundle line priced as sent.
- **Mechanism:** setting. **Confidence:** probable.

**Preconditions**

- The channel sends more than one line for a set (B-05, B-06).

**Main flow**

1. Pilot: only parent-only shapes are recognised, so the price is always on the bundle line.
2. Later: a per-connection setting or adapter declaration states which side carries money and tax.
3. Later: core sums the money onto one side for the order view and keeps the channel lines for documents and writebacks.

**Alternative flows and exceptions**

- WPC flips between parent-priced and child-priced per bundle setting (r4/phase1/2-own-shops.md section 10 item 3).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Always the parent line (C-001). |
| PrestaShop | Always the pack row (C-011). |
| WooCommerce | Official: container unless `priced_individually`; WPC fixed: parent; WPC auto: children, parent 0 untaxed (C-015, C-016, r4/phase1/2-own-shops.md). |
| Shoper | Children carry `price` and `tax`; relation to the parent price is undocumented (r5/2-shops-erp.md section 4). |
| Erli | Parent line only. |
| Others | Shopify: components, weighted (C-017); Brightpearl: parent carries price, children 0.00 (C-045); Linnworks: parent, children 0 (r4/phase2/4-linnworks.md B-14). |

**OpenLinker behaviour**

Later: per-connection operator setting (X-03), since the same plugin can produce both shapes.

**Acceptance criteria**

- Given later, a WPC auto-priced bundle, when it is ingested, then the order total equals the sum of child prices and the parent 0 line is not counted twice.
- Given the pilot and an Allegro set line, when documents are issued, then the price and rate come from the bundle line as the channel sent them.

**Evidence**

`C-015`, `C-016`, `C-017`, `C-045`, `r4/phase1/2-own-shops.md section 8`, `r5/2-shops-erp.md section 4`

**Risks**

- Shoper child price semantics are unknown until one live order is read (B-27).

## B-20 The master already moves stock for a pack sale; avoid double or missing decrement

- **Actor:** System (order sync to a destination, master-absorbed holds)
- **Trigger:** An order containing a bundle is created in, or sold by, the product master itself.
- **Priority:** pilot. The safety today is accidental; the expansion work is the change most likely to pass component product ids "to be complete" and turn it into an oversell, so it needs a pinning spec (r5/6-design-and-code.md section 1).
- **Mechanism:** core. **Confidence:** disputed.

**Preconditions**

- A bundle definition exists and the master is also the destination or the source.

**Main flow**

1. Own-shop order (PrestaShop or WooCommerce selling its own pack): not routed (#3487); the shop decrements per its own pack rules (PrestaShop `StockManager.php:65-95`).
2. Mirror path: OL creates the order in the master; PrestaShop answers "does not lower stock" for any order with a pack (prestashop-order-stock-effect.resolver.ts:200-208), so OL keeps its holds until dispatch (under-sell, never oversell).
3. For WooCommerce and Shoper the answer is per order, not per line (C-059).
4. After the create, the post-sale master stock refresh and `consumeAbsorbedHolds` take `productIds` from `order.items` (order-sync.service.ts:443, :515), i.e. the bundle product: component holds stay held (under-sell, safe) and component stock is not refreshed from the master until the next sweep (verify/component-line-id.md section 3 site 8).
5. Pilot: a pinning spec asserts that `consumeAbsorbedHolds` never consumes holds on component positions (order-sync.service.ts:515, master-absorbed-reservation.service.ts:106-107, 207-208).
6. Pilot: definition warning when the bundle variant is a master kit (B-03).

**Alternative flows and exceptions**

- OL bundle defined on a plain master product (own counter): the master lowers only the bundle row; components are never lowered there (r3/code/C-stock-fulfilment-masters.md F4, F7).
- Later: a line-grain stock-effect answer (`OrderCreateLineStockEffect`) once a second adapter needs it.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not a master. |
| PrestaShop | `validateOrder` decrements components for modes 1 and 2 and the pack row for modes 0 and 2 (r4/phase1/2-own-shops.md section 1.1); OL resolver answers false for any pack (r4/code/C-stock-flows-traced.md c3). |
| WooCommerce | `lowersStockOnOrderCreate` from `_reduced_stock`, whole order (woocommerce-order-processor.adapter.ts:252-254). |
| Shoper | Shop setting `shopping_update_stock_on_buy`, whole order (shoper-order-processor.adapter.ts:198-201); the shop decrements set components itself (r4/phase1/3-pl-saas-and-erp.md section 1.3). |
| Erli | Not a master. |
| Others | Subiekt declares nothing (r4/code/A-capability-traced.md section 1.2). |

**OpenLinker behaviour**

Pilot: core spec plus definition warning, no capability. Later: line-grain stock-effect capability (guard-only, probed, safe default) if needed.

**Acceptance criteria**

- Given an Allegro order for bundle B mirrored to PrestaShop where B is a pack, when the order is created, then OL keeps all component holds until dispatch.
- Given a destination that answers "lowers stock" for an order with bundle B, when absorbed holds are consumed, then holds on component positions are kept.
- Given a PrestaShop shop order for its own pack, when it is ingested, then it is not routed and OL writes no sale decrement.

**Evidence**

`C-059`, `C-060`, `verify/component-line-id.md section 3 site 8`, `verify/standard-stress-test.md A9`, `r5/6-design-and-code.md section 1 "R2-C claim refuted"`, `r3/code/C-stock-fulfilment-masters.md section 1.2 F4-F7`, `r4/code/C-stock-flows-traced.md c3, c4`, `r4/code/A-capability-traced.md section 1.2`

**Risks**

- r3/code C (F4) says the master-absorbed consume releases component holds and oversells; r5/6 reads the current code and finds the holds are kept as `unknown-position`. The two reports disagree; r5/6 is the later, line-cited reading.
- architecture-overview.md says PrestaShop and WooCommerce declare no stock effect; code shows both do (r4/code/A-capability-traced.md section 5 item 1).

## B-21 Split shipment of one bundle and telling the channel it shipped

- **Actor:** System (dispatch relay); packer
- **Trigger:** Components of one set leave in more than one parcel.
- **Priority:** later. With one warehouse a set cannot split, so D3f is deferred (r5/7-scope-overengineering.md section 5).
- **Mechanism:** setting. **Confidence:** confirmed.

**Preconditions**

- A bundle line split across works or parcels.

**Main flow**

1. Pilot: one warehouse, so all components of a line land in one work and one parcel; the parcel cannot close short (B-11, B-12).
2. Shipment lines stay at bundle grain (shipment-line.service.ts:113-133).
3. Later: a per-source policy: post each waybill as its parcel ships and gate only the order-level SENT status on the last component (r5/1-allegro-pl.md section 3D).

**Alternative flows and exceptions**

- Brightpearl marks the whole bundle shipped on the first component; it blames the channel shape (r5/5-competitors-global.md C-045).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | `POST /order/checkout-forms/{id}/shipments {carrierId, waybill, lineItems[{id}]}`, no quantity; "Wysyłam z Allegro" has no line items (C-009). |
| PrestaShop | Order status writeback, order level. |
| WooCommerce | Order status, order level. |
| Shoper | Order status, order level (unverified per line). |
| Erli | Not traced (unverified). |
| Others | Amazon 2026-01-01 `PackageItem.quantity` per package (r4/phase1/4-marketplaces-and-law.md section 1.3); Linnworks despatch per channel line (r4/phase2/4-linnworks.md B-21). |

**OpenLinker behaviour**

Later: per-source policy flag on the relay. Nothing in the pilot.

**Acceptance criteria**

- Given a one-warehouse pilot order for B, when the parcel is closed, then one waybill is relayed for the B line.
- Given later, B split across two parcels on Allegro, when the first parcel ships, then its waybill is posted and the order is not marked SENT until the second.

**Evidence**

`C-009`, `C-045`, `r5/1-allegro-pl.md section 3D`, `r5/5-competitors-global.md section 3 item 4`, `r5/6-design-and-code.md C-050`

**Risks**

- Holding back the first waybill may hurt Allegro dispatch-time metrics (unverified, r5/1-allegro-pl.md section 3D).
- C-050 listed shipment lines as a collision; r5/6 refutes it because shipment lines are built from `order.items` at bundle grain.

## B-22 NEW Routed sale decrement of a master pack writes only the pack row (silent oversell)

- **Actor:** System (sale decrement, PrestaShop inventory master)
- **Trigger:** An OMS-routed order (for example from Allegro) is for a variant that is a PrestaShop pack whose stock comes from components.
- **Priority:** stage0. It is a live silent oversell on the likely pilot stack the moment the OMS routes an Allegro order for a PrestaShop pack, and no bundle feature fixes it (r5/7-scope-overengineering.md section 2 D1).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- OMS routing on; the line resolves to a PrestaShop pack in mode components or both; no OL bundle definition needed.

**Main flow**

1. The sale decrement calls `adjustInventory(-n)` on the pack product (inventory-sale-decrement.service.ts).
2. Stage 0 fix (recommended): the PrestaShop adapter detects a pack whose stock comes from components (`readPackDefinition` + `resolvePackStockMode`, prestashop-inventory-master.adapter.ts:374-390) and refuses before writing with a typed error.
3. The sale decrement records the line as `blocked` and raises `stock-decrement-blocked` attention.
4. The operator corrects stock by hand or the client confirms the M option (decrement components like `validateOrder`).

**Alternative flows and exceptions**

- Pack-only mode (type 0): the pack row is the truth; the write is correct and allowed (verify/prestashop-live.md Q5).
- Both mode (type 2): the write lowers the pack but standalone component offers keep selling; refuse as well, or decrement components (verify/prestashop-live.md Q5).
- Type 3 (shop default) and the empty() read bug up to 9.1.5: the effective mode depends on the shop version, so a static rule can be wrong (verify/standard-stress-test.md A4, r5/2-shops-erp.md section 3).
- Pack with no own row: already refused as absent records (visible) (r4/code/C-stock-flows-traced.md c4).
- Return restock or manual correction on such a pack: same refusal, since the write is ignored by the shop (r5/2-shops-erp.md section 5).
- Same question for a Shoper set or Subiekt komplet as master: unverified.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | The order line is an ordinary offer mapped to the pack variant. |
| PrestaShop | Webservice PUT of `stock_availables` for the pack row; OL `adjustInventory` has no pack branch (prestashop-inventory-master.adapter.ts:887-960). Live on 9.0.2: for `pack_stock_type=1` the PUT answered 200, wrote only the pack row, components and `Pack::getQuantity` did not change, and with the row at 0 a cart still accepted 5 packs; for type 0 the PUT takes effect; for type 2 it lowers availability via min(own row, components) but components are untouched; in no type did the PUT reach components (verify/prestashop-live.md Q5). |
| WooCommerce | Not affected (no pack concept modelled). |
| Shoper | Unverified. |
| Erli | Not a master. |
| Others | Subiekt: unverified. |

**OpenLinker behaviour**

Adapter-only fix (PrestaShop inventory master); core already turns a refusal into a visible blocked decrement. Independent of the bundle feature.

**Acceptance criteria**

- Given a routed Allegro order for a PrestaShop pack in components mode, when the sale decrement runs, then no stock row is written, the line is `blocked` and the order shows `stock-decrement-blocked`.
- Given a pack in pack-only mode, when the sale decrement runs, then the pack row is lowered as today.
- Given a return restock on a pack in components mode, when it runs, then it is refused with a named reason.

**Evidence**

`C-060`, `verify/prestashop-live.md Q5`, `verify/standard-stress-test.md A4`, `r5/7-scope-overengineering.md sections 2 (D1), 5, 6`, `r4/code/C-stock-flows-traced.md c2, c4`, `r5/2-shops-erp.md section 5`, `r5/6-design-and-code.md C-060`

**Risks**

- Earlier rounds marked the consequence unverified (r5/6-design-and-code.md C-060); the live probe now confirms no cascade on 9.0.2 (verify/prestashop-live.md Q5). Other versions were not probed.
- Choosing the M variant (decrement components) needs per-component idempotency and an in-doubt rule for a partial write (r5/7-scope-overengineering.md section 5).

## B-23 NEW Expand a bundle line into component lines for reservation, routing and sale decrement

- **Actor:** System (ingestion, reservation, routing, decrement)
- **Trigger:** An ingested order has a recognised bundle line with a frozen expansion.
- **Priority:** pilot. Storing components under the bundle line id breaks about 25 keyed sites silently (wrong variant, early hold release, lost decrement); this is the minimum that avoids it (r4/code/B-line-identity-traced.md, r5/7-scope-overengineering.md section 4b).
- **Mechanism:** core. **Confidence:** disputed.

**Preconditions**

- B-04 and B-10 done.

**Main flow**

1. One pure function `expandFulfilmentLines(order, expansions)` returns one line per ordinary item with `orderLineId = item.id` (unchanged) and one per component with `orderLineId = {lineId}~c:{componentVariantId}`, quantity = per set x ordered.
2. Reservations use it (order-ingestion.service.ts:2236-2243).
3. Routing uses it through the shared projection (project-order-for-routing.ts:47-52), serving ingestion, dry run and the route handler.
4. The sale decrement handler builds its line map and `productId` from the same expansion, not from `orderItems`; the expansion must carry the component productId because of the `productVariantId === item.productId` rule (inventory-sale-decrement.handler.ts:90-117, verify/component-line-id.md surprise 5).
5. Six more sites keyed on the commercial line id must read the expansion or refuse: order-edit follow-ups `assessForEdit` and `lowerLineQuantity` (fulfillment-order-edit.service.ts:41-84), `narrowForOrder` (reservation.service.ts:247-261), `reverseLineQuantity` (inventory-sale-reversal.service.ts:155-200), the post-create stock refresh and absorbed-hold product ids (order-sync.service.ts:443, :515), and the return restock target (return-custody.service.ts:931-940). Nine sites in total, not three (verify/component-line-id.md section 4); the edit and restock sites are pilot guards (B-24, B-15).
6. Existing per-line keys (reservation index, closed-line gate, router conservation, work-line unique index, sale key, `closeForOrder`) become component-unique with no schema change; all columns are unbounded `text` and the longest key is about 185 of 255 characters (verify/component-line-id.md section 1).
7. Order items, snapshot, documents, shipment lines, return-line resolution, edit overlay and channel writebacks keep the bundle line. `shipment_lines` must stay on the bundle line: its coverage joins back to `orderSnapshot.items`, and component ids there would demote delivered orders (verify/component-line-id.md section 1 and surprise 3).

**Alternative flows and exceptions**

- Two components with the same variant cannot occur within one definition; a gift with the same variant later uses a reserved role segment `~g:` (r5/7-scope-overengineering.md section 4c).
- An ambiguous component position: drop the whole bundle line, not one component (order-ingestion.service.ts:2281, r4/code/C-stock-flows-traced.md a2).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Synthetic ids never leave OL; writebacks use the channel line id. |
| PrestaShop | Same. |
| WooCommerce | Same. |
| Shoper | Same. |
| Erli | Same. |
| Others | Linnworks keeps the parent line and adds child rows (r4/phase2/4-linnworks.md). |

**OpenLinker behaviour**

Core only, a value convention in existing `orderLineId` columns; no new column, no unique-index change, no router port change, no capability. Best shape: one read "bundle line id -> frozen component lines" used by every site that starts from the commercial id, aggregating results back to the bundle line where an operator response is keyed by it (verify/component-line-id.md section 4).

**Acceptance criteria**

- Given line L for B x2 = {A x2, C x1}, when reservations run, then holds `L~c:A` (4) and `L~c:C` (2) are written.
- Given the component A decrement settles first, when its hold is consumed, then the hold `L~c:C` stays held.
- Given the order is routed and its work settles, when the decrement handler runs, then two work lines with variants A and C exist and each component is decremented on its own product and owner, none logged as "NOT lowered".
- Given an order with no bundle line, when the same paths run, then every key is byte-identical to today.
- Given the bundle line ships, when shipment lines are reconciled, then one shipment line keyed on the bundle line id is written and the order rolls up as delivered when the parcel is delivered.

**Evidence**

`C-049`, `C-050`, `C-051`, `C-052`, `verify/component-line-id.md`, `verify/standard-stress-test.md A3, A8`, `r4/code/B-line-identity-traced.md section 1 and H1-H4`, `r4/code/C-stock-flows-traced.md section 0`, `r5/7-scope-overengineering.md sections 4a-4c`, `r5/6-design-and-code.md sections 3.8, 5`

**Risks**

- The breaking-site count is about 25 (r4/code/B-line-identity-traced.md: 25 breaks, 7 safe, 4 unclear), not 6 as earlier rounds said.
- Designs disagree: r5/7 derives ids only for fulfilment (`{lineId}~c:{variantId}`); r5/6 expands effective lines in `toDomain` with positional ids; r4/code/C uses `::` plus extra columns; r3/code/C threads a `componentKey` through routing. r5/7 rejects positional ids because they change when a definition is reordered.
- Every missed site fails as a silent no-op, never a throw (`unrouted`, `not-applicable`, "NOT lowered" with outcome ok), so tests must assert the effect, not the absence of errors (verify/component-line-id.md surprise 1).
- r5/7 named three call sites; verify/component-line-id.md finds nine. r4/code/C instead adds `parentOrderLineId` / `quantityPerBundle` columns; the column-free design works only if every reader goes through the expansion table (verify/standard-stress-test.md D9).
- The id format is the expensive lock-in: it is persisted in terminal reservations, unique decrement keys and work lines (r5/7-scope-overengineering.md section 7.1).

## B-24 NEW Operator edits or cancels an order that contains a bundle line

- **Actor:** Operator
- **Trigger:** The operator lowers the quantity of a bundle line or cancels the order.
- **Priority:** pilot. A silent no-op edit on a bundle line leaves holds and work for units the buyer no longer wants; the guard is small (r5/7-scope-overengineering.md section 4b).
- **Mechanism:** core. **Confidence:** confirmed.

**Preconditions**

- Component-grain holds and work lines exist (B-23).

**Main flow**

1. Quantity edit of a bundle line: refused with a new code `LINE_IS_BUNDLE` (pilot guard).
2. Whole-order cancel: holds of the order are released by order, which covers component holds; component stock comes back through `reverseForOrder`, which is row-based (inventory-sale-reversal.service.ts:117-150). But the cancellation stock restore republishes only the bundle own offers, not the component offers (offer-stock-restore.service.ts:350, 532-546, verify/component-line-id.md section 3).
3. Pilot: after a cancel, component offers are republished through the reverse fan-out of B-02 rather than a change to the restore service.
4. Discount edit on a bundle line: restates the bundle line price as for any line (documents keep the bundle line).

**Alternative flows and exceptions**

- Later: a bundle-line quantity edit scales component cancellations, hold narrowing and edit reversals by quantity per set.

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not applicable (operator action in OL). |
| PrestaShop | Not applicable. |
| WooCommerce | Not applicable. |
| Shoper | Not applicable. |
| Erli | Not applicable. |
| Others | Shopify cannot add a bundle in an order edit (r5/5-competitors-global.md SH8). |

**OpenLinker behaviour**

Core guard. Without it all four edit follow-ups key on the bundle id and miss silently: `assessForEdit` reads 0 fulfilled so `QUANTITY_BELOW_FULFILLED` never fires, `lowerLineQuantity` returns `unrouted` and cancels no units, `narrowForOrder` lowers no hold, `reverseLineQuantity` returns `not-applicable` and gives no stock back, while the edit reports success (verify/component-line-id.md section 3 sites 4-7).

**Acceptance criteria**

- Given an order with bundle line L, when the operator lowers L quantity, then the edit is refused with `LINE_IS_BUNDLE` and nothing is written.
- Given the same order, when the operator cancels it, then all component holds are released.
- Given the same order with components already decremented, when it is cancelled, then each component decrement is reversed once.
- Given the cancel gave stock back to component A, when the cancel completes, then the offers of A and of every bundle containing A are republished.

**Evidence**

`C-057`, `verify/component-line-id.md section 3`, `r4/code/B-line-identity-traced.md rows 4, 11, 17, 24`, `r4/code/C-stock-flows-traced.md a9`, `r5/7-scope-overengineering.md section 4b`

**Risks**

- Order edits are the biggest silent gap: the edit would report success while works, holds and stock are untouched (verify/component-line-id.md surprise 2).
- Republishing component offers after a cancel depends on the B-02 reverse fan-out; if that is not built, component offers stay stale (verify/component-line-id.md section 3).

## B-25 NEW Bundle shipping weight, dimensions and parcel count

- **Actor:** Operator (dispatch)
- **Trigger:** A label is bought for a parcel containing a set.
- **Priority:** later. Weight is operator-typed today for every parcel, so a set adds no new damage.
- **Mechanism:** core. **Confidence:** unverified.

**Preconditions**

- A carrier label is bought through OL.

**Main flow**

1. Pilot: the operator types parcel weight and dimensions as today (operator-typed per architecture-overview.md section 26, #2402 / #2729 note).
2. Later: suggest weight from the frozen components and their variant weights.

**Alternative flows and exceptions**

- Allegro counts a set offer as one unit in its delivery price list and max units per parcel (r4/phase1/5-merchant-voice.md PAIN-07, official moderator).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Delivery price list per offer; a four-rim set counts as one unit (r4/phase1/5-merchant-voice.md PAIN-07). |
| PrestaShop | Not traced (unverified). |
| WooCommerce | WPC plugin users report doubled weight (r4/phase1/5-merchant-voice.md PAIN-07). |
| Shoper | Not traced (unverified). |
| Erli | `items[].weight` on the order (r5/3-marketplaces-countries.md). |
| Others | Shopify: weight from component weights, no bundle shipping profile (r4/phase1/5-merchant-voice.md PAIN-07). |

**OpenLinker behaviour**

Later core suggestion; nothing in the pilot.

**Acceptance criteria**

- Given later, B = {A x2, C x1} with variant weights, when a label is prepared, then the suggested weight is the sum of component weights.
- Given the pilot, when a label is prepared for a parcel with B, then the operator types weight and dimensions as for any parcel.

**Evidence**

`r4/phase1/5-merchant-voice.md PAIN-07`, `docs/architecture-overview.md section 26 (#2402 bullet)`

**Risks**

- How OL label flows use variant weight was not traced in code (unverified).

## B-26 NEW Nested bundle (a bundle as a component of another)

- **Actor:** Operator
- **Trigger:** The operator wants a set that contains another set.
- **Priority:** out. Out for v1 on cost (tree snapshot and path ids), not on market consensus, which is disputed.
- **Mechanism:** core. **Confidence:** disputed.

**Preconditions**

- Both are OL bundle variants.

**Main flow**

1. v1: the definition save is refused (B-01).

**Alternative flows and exceptions**

- Later: the expansion becomes a tree and component ids get a path segment (r5/5-competitors-global.md section 3 item 2).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | A product set lists catalogue products only. |
| PrestaShop | Not traced whether a pack may contain a pack (unverified). |
| WooCommerce | Plugin dependent (unverified). |
| Shoper | Not traced (unverified). |
| Erli | Unknown. |
| Others | Linnworks one layer and Shopify "Bundles can't contain other bundles" (forbidden); Cin7 documents three-level assemblies (allowed); Brightpearl help forbids while its API models nesting; BaseLinker and Apilo unknown, because the BaseLinker "relationships between two bundles are not allowed" quote belongs to the `relations` cross-sell field, not to bundle composition; Sellasist blocks turning a component into a set (verify/nested-and-gift-stockout.md claim 1). Subiekt GT allows a komplet inside a komplet (r4/phase1/3-pl-saas-and-erp.md section 4.1). |

**OpenLinker behaviour**

Core validation rule only.

**Acceptance criteria**

- Given bundle B and bundle D, when the admin adds D as a component of B, then the save is refused with a "nested bundles are not supported" reason.
- Given component A already used in bundle B, when the admin defines A itself as a bundle, then the save is refused for the same reason.

**Evidence**

`verify/nested-and-gift-stockout.md claim 1`, `r5/5-competitors-global.md CN5 and section 3 item 2`, `r4/phase1/5-merchant-voice.md PAIN-09`, `r4/phase1/3-pl-saas-and-erp.md section 4.1`

**Risks**

- D3e "every competitor forbids nesting" is false: Cin7 supports multi-level assemblies, Brightpearl docs contradict themselves, and the BaseLinker evidence (C-039 "no nesting") was misattributed (verify/nested-and-gift-stockout.md).
- A Subiekt master with nested komplety cannot be modelled in OL.

## B-27 NEW Shoper set order: verify the live line shape before designing

- **Actor:** Engineer (read-only check on the Shoper trial shop)
- **Trigger:** A Shoper shop sells a native set and OL reads its order lines.
- **Priority:** stage0. A zero-cost live read decides whether a live double count exists today; C-019 and the child order-product ids are confirmed, the double count itself is not (r5/2-shops-erp.md section 4).
- **Mechanism:** process. **Confidence:** unverified.

**Preconditions**

- A Shoper trial shop with a set made in the panel.

**Main flow**

1. Place one test order for a set.
2. Read `GET /order-products?filters[order_id]=X` as OL does (shoper-order-source.adapter.ts:546-563).
3. Record whether children appear only nested in `children[]` or also as flat top-level rows; record parent and child `price`, `quantity`, `tax`.
4. If children are also flat: OL already reserves and counts the set and its components today, a live double count to fix (r5/2-shops-erp.md section 4).
5. If nested only: OL reserves the set own `stock_id` as one item; recognition by variant (B-04) covers it.

**Alternative flows and exceptions**

- The shop uses the set own stock row as physical stock in InventoryMaster today (r4/phase1/3-pl-saas-and-erp.md section 1.5).

**What each channel sends**

| Channel | Data |
|---|---|
| Allegro | Not applicable. |
| PrestaShop | Not applicable. |
| WooCommerce | Not applicable. |
| Shoper | Order line `type` 0/1, `children[]` with their own `id` ("order product identifier") and `order_id`, no `product_id`; `ShoperOrderLineRow` declares neither `type` nor `children` (C-018, C-019, r4/phase1/3-pl-saas-and-erp.md section 1.1). |
| Erli | Not applicable. |
| Others | BaseLinker imports Shoper sets as sets since 07/2025 (r5/4-competitors-pl.md). |

**OpenLinker behaviour**

Process step, zero code; the follow-up is an adapter fix only if children come flat.

**Acceptance criteria**

- Given a test order for a Shoper set, when OL reads its lines, then the check records whether child rows appear at top level, with the raw payload saved.
- Given children appear flat, when the result is reviewed, then an adapter fix is filed as a live defect, separate from the bundle feature.

**Evidence**

`C-018`, `C-019`, `r5/2-shops-erp.md sections 4 and 8 item 5`, `r4/phase1/3-pl-saas-and-erp.md sections 1.1 and 1.5`

**Risks**

- Shoper developer docs are behind a login; the only schema source is an auto-generated SDK (r4/phase1/3-pl-saas-and-erp.md).
