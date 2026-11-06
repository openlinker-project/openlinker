# R3 code design C - stock, fulfilment, product masters, listings, automation

Angle: where bundles ("zestawy") and gifts ("gratisy") hit stock, reservations, sale decrement,
propagation, routing, the pack bench, listings and automation. Blind round: built only from the
code, ADR-054/058/061/079/080, `docs/architecture-overview.md` and issues #3520/#3606/#3607/#3624
(decision D3, read with `gh issue view`, read-only). All paths are relative to the repo root;
`libs/core/src` is abbreviated `core/`, `libs/integrations/<x>/src` as `<x>/`.

Evidence rule used: `file:line` for code; "(unverified)" for any claim about third-party platform
behaviour I could not test here. Nothing was run against a live shop.

## 0. D3 as recorded (the baseline this report amends)

From #3520/#3606/#3607 (D3, 2026-09-28): component grain for stock, reservations and
`FulfillmentWork`; a bundle line is exploded at reservation time and at routing time; order line,
sales documents and channel keep the bundle SKU and price; bundle ATP = min over components of
floor(component ATP / qty per bundle), unknown component => bundle unknown (never 0); a stale
component makes the whole bundle unsellable; bundles defined in OpenLinker, master pack composition
NOT imported; a bundle is an ordinary catalogue variant plus a components table, no
identifier-mapping entry of its own. Gifts are not covered by D3 at all.

---

## 1. Product masters today, and what a master must declare

### 1.1 Per master

| Master | Kit/pack concept today | Evidence | What OL does with it |
|---|---|---|---|
| PrestaShop | `product_pack` with `pack_stock_type` 0/1/2/3 (pack-only / components / both / shop default). | `prestashop/domain/types/prestashop-pack.types.ts:18-47` (modes), `:205-235` (`derivePackAvailability` = min floor) | **Read side only.** `listInventory` reports a pack's quantity derived from components (`prestashop/infrastructure/adapters/prestashop-inventory-master.adapter.ts:319-343`, `resolvePackQuantity` `:368-420`, `both` = min(own row, derived) `:413-420`). Composition never leaves the adapter (header `prestashop-pack.types.ts:11-13`: "a neutral pack model in libs/core would cement one platform's shape"). |
| PrestaShop (write) | - | `adjustInventory` `prestashop-inventory-master.adapter.ts:887-1000` | **Writes the pack's OWN `stock_availables` row** (`:906-909`, `:955-962`); no component handling. `getInventory` explicitly not at parity with packs (`:215-223`). Whether a webservice PUT on a pack row cascades to components inside PrestaShop: **(unverified)**. |
| PrestaShop (order create) | `validateOrder` decrements per pack stock type | resolver header `prestashop/infrastructure/provisioners/prestashop-order-stock-effect.resolver.ts:24-31` | `lowersStockOnOrderCreate` answers `false` if ANY line is a PS pack (`:121`, `anyPack` `:200-206`), else `true` for a non-skipping state. Whole-order boolean, `prestashop-order-processor-manager.adapter.ts:226-235`. |
| WooCommerce | none modelled. Type union is `'simple' | 'variable' | 'grouped' | 'external'` | `woocommerce/infrastructure/adapters/product-master/woocommerce-product.types.ts:20` | Anything non-variable is read as a simple product (`woocommerce-inventory-master.adapter.ts:111-114`; product master `woocommerce-product-master.adapter.ts:320`). A "Product Bundles" extension product (type `bundle`, not in the union) falls into the simple branch **(behaviour of that extension unverified)**. `lowersStockOnOrderCreate` = WC's own `_reduced_stock` record, whole order (`woocommerce-order-processor.adapter.ts:241-254`). |
| Shoper | none modelled (grep for bundle/zestaw in `shoper/src` finds only a test name and a category example) | `shoper/infrastructure/adapters/product-master/shoper-product-master.adapter.ts:518-519` (category text only) | `lowersStockOnOrderCreate` = shop-wide `shopping_update_stock_on_buy` (`shoper/infrastructure/adapters/order-processor/shoper-order-processor.adapter.ts:191-202`) - says nothing per line. Shoper's own bundle product type and its stock semantics: **(unverified)**. |
| Subiekt GT | `DodajKomplet` (komplet = kit of different towary) known but deliberately not modelled | `subiekt/infrastructure/adapters/subiekt-product-master.adapter.ts:25-28` | No komplet read, no `OrderCreateStockEffect` declared (grep: no `lowersStockOnOrderCreate` in `subiekt/`). How a komplet line on a ZK moves component stock: **(unverified)**. |
| Subiekt nexo | invoicing only | architecture-overview § 14 | n/a for stock. |

### 1.2 Where double (or missing) decrement actually happens

The OMS writes a master's stock only on a **routed** order, via `InventorySaleDecrementService`
(`core/inventory/application/services/inventory-sale-decrement.service.ts:135-176`). On the
**mirrored** path (OMS off / not routed) the master lowers its own stock when OL creates the order
there, and `MasterAbsorbedReservationService` consumes OL's holds
(`core/inventory/application/services/master-absorbed-reservation.service.ts:96-170`). Each path has
a bundle failure mode:

| # | Path | What happens with a D3 bundle naively bolted on | Effect |
|---|---|---|---|
| F1 | Routed, components exploded, sale decrement | Idempotency key is `sale:{owner}:{workId}:{orderLineId}` (`core/inventory/domain/types/inventory-sale-decrement.types.ts:125-132`). N components of one bundle line share `orderLineId` -> component 2..N collide with component 1's claim. | **Under**-decrement (components 2..N never lowered) - oversell. |
| F2 | Routed, decrement handler | Worker builds decrement input with `productId` from the ORDER ITEM and `productVariantId` from the WORK LINE (`apps/worker/src/sync/handlers/inventory-sale-decrement.handler.ts:91-118`). For a component line that is (bundle productId, component variantId) -> owner lookup `resolveSaleDecrementOwner` (`inventory-sale-decrement.types.ts:226`) finds no position. | Blocked decrement, attention raised; never lowered. |
| F3 | Routed, OL bundle is a PS pack in mode `components`/`both`, implementation decrements the BUNDLE row instead of exploding | `adjustInventory` writes the pack row (F-PS above). If PrestaShop cascades that write to components **(unverified)** AND OL also decrements components, that is a true **double decrement**. If it does not cascade, components are never lowered (oversell). | The one true double-decrement risk in the routed path; answer depends on master behaviour OL cannot see -> must be declared. |
| F4 | Mirrored, OL-defined bundle whose master product is a PLAIN product (own counter) | Master lowers the bundle's own row only. OL's component holds: PS resolver says "not a pack" -> `true` (`prestashop-order-stock-effect.resolver.ts:121`) -> `consumeAbsorbedHolds` closes every hold whose position owner = destination (`master-absorbed-reservation.service.ts:115-129`, `:167-171`), i.e. the **component** holds. | Components never decremented AND their holds released -> oversell of every component, silently. |
| F5 | Mirrored, PS pack (mode components) | PS lowers components; resolver says `false` for a pack -> holds kept to dispatch. | Correct (under-sell window only). |
| F6 | Storefront order from the master itself (`source-is-owner`) | Sale decrement records `skipped/source-is-owner` and consumes the hold (`inventory-sale-decrement.service.ts:218-231`). For a component line that assumes the shop lowered the COMPONENT, true only for a native pack. Note #3487 (`isOrderFromOwnProductMaster`, architecture-overview § Fulfillment) never routes own-shop orders anyway, so this only bites a mixed two-master case. | Under-decrement when the shop's bundle is a plain product. |
| F7 | Master storefront sells the bundle product | OL publishes component-derived ATP to channels, but the master's own bundle row is never written (a master is never a write-back target, architecture-overview § Listings, WooCommerceOfferManagerAdapter note). | Master storefront oversells an OL-defined bundle whose master row is a plain counter. |

### 1.3 What a master must declare (to make F3/F4/F6/F7 decidable)

The current `OrderCreateStockEffect` (`core/orders/domain/ports/capabilities/order-create-stock-effect.capability.ts:37-53`) is one boolean per created order. It cannot say WHICH rows moved. For bundles OL needs, per master product that participates in a bundle:

1. **Is this master product itself a kit, and what does a sale of it move?** `own-row | components | both | unknown` - on the master's OWN sale (checkout/validateOrder) and, separately, on an `adjustInventory` write to the kit row (does it cascade).
2. **Per created order line, which rows the master lowered** (line grain of `OrderCreateStockEffect`).
3. Optionally **the master's own composition** (component refs + qty) - only so OL can warn when the OL definition and the master pack disagree (D3 forbids importing it as truth).

Absence of any of these must read as `unknown`, and `unknown` must resolve to the
under-sell direction (keep holds, decrement components only, never the kit row) - the same
"probe, never trust" posture as ADR-046 / `lowersStockOnOrderCreate`.

---

## 2. Component explosion hook points (stock side)

Single principle: **one pure explosion function, many callers**, so no caller restates the rule
(the `applyPricingRule` / `deriveOrderLifecyclePhase` precedent). Proposed
`explodeBundleLine(line, composition) -> ComponentLine[]` with `componentKey` (stable id of the
`BundleComponent` row), living with the `BundleComponent` type in `products` (owner of catalogue
variants; `inventory`, `orders`, `listings` already depend on `products`, see
architecture-overview § Cross-context map). `fulfillment` is a zero-sibling-edge leaf
(`core/__tests__/barrel-purity.spec.ts`) so it must receive already-exploded lines as arguments.

| Area | File:line | Change |
|---|---|---|
| ATP / availability | `core/inventory/application/services/availability.service.ts:100-147` (`getPromisableQuantities`) | For a variant with a `BundleComponent` set: read components' rows + ledger with buffer 0 / threshold 0, take min floor, propagate `unknown` if ANY component unknown, then apply `controls.buffer`/`zeroThreshold` ONCE to the bundle number (controls resolved at `:237-266`; channel scope applies them per variant). Every consumer then gets bundle ATP for free: propagation (`apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts:112-116`), bulk wizard (`core/listings/application/services/bulk-listing-submit.service.ts:866-873` via `inventory-query.service.ts:183-202`), cancellation restore (`core/listings/application/services/offer-stock-restore.service.ts:370-395`), stock view. `observedAt` = max of components' `stockUpdatedAt` (feeds the #2617 freshness token). |
| ATP / bundle's own row | `core/inventory/infrastructure/persistence/repositories/inventory.repository.ts:329-337` | A bundle variant that a master ALSO reports (PS pack row, plain "gift set" product) keeps a mirrored row; ATP must ignore it once a component set exists (else two answers). Document: own row is display-only. |
| Buffer | `availability.service.ts:259-260` (global = 0) and write-back `InventorySyncService.updateOfferQuantities` -> `applyPublishControls` | Already applied once downstream on the global path; the bundle path must not buffer per component (min of buffered components != buffered min). |
| Reservations (write) | build lines `core/orders/application/services/order-ingestion.service.ts:2240-2248`; claim `core/inventory/application/services/reservation.service.ts:96-138` | Explode bundle lines into component claim lines. Unique index `UQ_reservations_active_line (orderRecordId, orderLineId, inventoryItemId)` (`core/inventory/infrastructure/persistence/entities/reservation.orm-entity.ts:55`) admits N components per line only while components resolve to different positions; add `componentKey` to the row and to the index so a bundle containing the same variant twice (or a component that equals a sibling standalone line - fine, different line) is expressible. `claimHeld` is already all-or-nothing per CALL (`:133-138`), i.e. per order - stronger than D3's "per bundle line"; keep. |
| Reservations (closed-line gate) | `reservation.service.ts:164-174` (`readClosedLineIds`, keyed on line) | Line-keyed is still correct for components (one component consumed => do not re-hold its siblings either) **only if** consume closes all components together; per-component consume (F1 fix) means the gate must key `(line, componentKey)`. |
| Reservations (close) | `closeForOrder(orderLineIds)` `reservation.service.ts:305-320` | Needs `(orderLineId, componentKey)` scoping so the decrement can consume a settled component while a blocked sibling keeps its hold. |
| Master-absorbed consume | `master-absorbed-reservation.service.ts:115-129`, `:167-171` | Today a line with >1 held row is treated as "re-resolved, keep" (`keptSharedLine`) - with components >1 row is normal. New rule: a component hold is absorbable only when the destination declares, for THAT line, `components` (or `both`) lowered; absent/unknown => keep until dispatch consume. Fixes F4. |
| Sale decrement | `inventory-sale-decrement.service.ts:135-176`, key `inventory-sale-decrement.types.ts:125-142`, lock `:161-167`, source-is-owner `inventory-sale-decrement.service.ts:218-231`, consume `:583-640` | Component lines in; key becomes `sale:{owner}:{workId}:{orderLineId}:{componentKey}` (absent componentKey = today's key, so no migration of existing rows); lock already per position (good). `source-is-owner` skip for a component only when the source declares it lowered components. Movement ledger context (`setInventory`, ADR-079) `sourceRef` should name the bundle line. |
| Decrement handler | `apps/worker/src/sync/handlers/inventory-sale-decrement.handler.ts:91-118` | Take component `productId` from the work line (store it) or `IProductsService.getVariantsByIds`; never from the order item for a component line (F2). |
| Sale reversal / edit reversal | `core/inventory/application/services/inventory-sale-reversal.service.ts:117-160`, `:234-257` | Keyed `workId:orderLineId`; same componentKey widening. `reverseLineQuantity` (order edit lowering a bundle line, #3542) must scale bundle units to component units. |
| Order edit (lower qty) | `core/fulfillment/application/services/fulfillment-order-edit.service.ts:47-48`, `:79-119` | `fulfilledByLine` sums work-line counters in COMPONENT units vs bundle units of the order line - must convert (bundles fulfilled = min over components of floor(fulfilled/qtyPer)). |
| Return restock | `core/returns/application/services/return-custody.service.ts:538-556`, `:899-924` | Restock target resolved by the returned line's SKU = bundle SKU -> would restock the bundle's own row. Needs explosion (restock each component x qty) or refuse with a named block `bundle-restock-unsupported`. |
| Propagation fan-out (reverse lookup) | `inventory-propagate-to-marketplaces.handler.ts:112-156` (variant read), `:195-236` offers, `:250-300` shop products | After a component's own fan-out, look up bundles containing that component (`BundleComponent` index on `componentVariantId`) and enqueue the same job for each bundle variant (dedupe key location-free, as today). Cycle guard: a bundle must not be a component of a bundle (or cap depth = 1). |
| Re-route held orders | `inventory-propagate-to-marketplaces.handler.ts:305-310` -> `core/orders/application/services/order-routing-retry.service.ts:140-144` (`listOrderIdsHeldForVariant`) | Held bundle orders key on the bundle variant in `order_line_items`; a component restock must also re-route them (reverse lookup, or let the bundle fan-out above call it with the bundle variant). |
| Stale pause (event) | `core/listings/application/services/stale-offer-pause.service.ts:78-95` | Re-verification checks `variant.isStale` of the event's variant; add: for each bundle containing a stale component, pause the bundle's offers (re-verify "any component stale" before zeroing). |
| Stale pause (sweep) | `core/listings/infrastructure/persistence/repositories/offer-mapping.repository.ts:754-780` | `findStaleMappedVariants` joins `product_variants` on the offer's own variant only; add a second arm joining the component table so a bundle offer with a stale component is found by the hourly backstop. |
| Propagation stale guard | `inventory-propagate-to-marketplaces.handler.ts:189-205` | Bundle variant itself not stale -> propagates ATP; ATP already 0 because stale positions are excluded (`inventory.repository.ts:336`). Consistent; no change beyond reverse lookup. |
| Shortfall episodes | architecture-overview § Inventory (#2349) | Per reservation, so a component short names the order and (via componentKey) the component - what #3624's "reservation blocked on component" needs. |
| Cost / margin (ADR-080) | `core/products/domain/entities/product-variant.entity.ts:71-75` | Cost snapshot is per order line variant = bundle variant. Simplest: operator enters bundle cost on the bundle variant (ADR-080 unchanged). Derived (sum of component costs) is a later option; never both. |
| Movements (ADR-079) | `InventoryService.setInventory` single writer | No change in mechanism; component `sale` rows each carry the bundle line as `sourceRef`. A bundle variant's own row (if mirrored) gets no sale row - expected. |

---

## 3. Fulfilment, routing, bench, shipment lines, relay

| Area | File:line | Change |
|---|---|---|
| Routing input | `core/orders/domain/project-order-for-routing.ts:36-53` | Explode bundle items into `RoutingInputLine`s. `RoutingInputLine` (`core/fulfillment/domain/types/routing.types.ts:38-41`) needs `componentKey?` and `bundleLineId?` (= order item id) so identity stays unique per line. Allowlist update at `routing.types.ts:71` (ADR-062 projection is an explicit allowlist). |
| Conservation check | `routing.types.ts:261-298` | Keyed per `orderLineId`; key per `(orderLineId, componentKey)`. |
| Router (libs/oms) | `libs/oms/src/routing/evaluate-routing.ts:256-262` (demand per variant - already correct for shared components), `:340-395` (`assignLines`), stock `libs/oms/src/routing/ol-fulfillment-router.ts:203-216` | **Cohesion**: with components as independent lines, `line-split` lets two components of ONE bundle go to two locations, and `quantity-split` can split a component in non-bundle multiples. Add a group key: all components of one bundle line move together, split only in whole-bundle multiples. Without it a buyer gets half a gift set per parcel. |
| Commit -> work lines | `core/fulfillment/application/services/routing-commit.service.ts:195-202` (`orderLineId -> productVariantId` map, one variant per line), `:489-551` (bucket lines by orderLineId) | Both assume one variant per orderLineId - break with components. Key by `(orderLineId, componentKey)`. |
| Work-line identity | `core/fulfillment/infrastructure/persistence/entities/fulfillment-work-line.orm-entity.ts:41-43` `UQ_fulfillment_work_lines_work_order_line (fulfillmentWorkId, orderLineId)` | **Hard collision**: N component lines of one bundle in one work violate it. Add `componentKey` (nullable, NULL-distinct needs COALESCE or a sentinel in the index) and `componentProductId` (fixes F2). `FulfillmentWorkLine` type `core/fulfillment/domain/types/fulfillment-work.types.ts:63-75` gains `bundleLineRef { orderLineId, componentKey, quantityPerBundle }` = ADR-054 amendment. |
| Progress | `core/fulfillment/application/services/fulfillment-progress.service.ts:223-234`, event `core/fulfillment/domain/types/fulfillment-progress-event.types.ts:96`, repo `recordLineProgress` `core/fulfillment/domain/ports/fulfillment-work-repository.port.ts:833` | Events name `orderLineId`; must name the work line (or componentKey) for component lines. |
| Sale-decrement enqueue | `core/fulfillment/domain/types/fulfillment-sale-decrement-enqueue.types.ts` | One job per work - unchanged; the handler reads component lines. |
| Pack bench (server) | `apps/api/src/bench/application/services/bench-parcel.service.ts:879-923` (lines built from `work.lines`, variant name/barcode/bin per `productVariantId`), `bench-work.service.ts:395`, `:495`; verification `core/fulfillment/application/services/fulfillment-verification.service.ts:91-135` (by `workLineId`) | Already component-friendly: lines are work lines, scanned per `workLineId`. Add the "Part of: <bundle> x N" label from the new `bundleLineRef`. |
| Pack bench (scan) | `apps/web/src/features/bench/lib/parcel-scan-match.ts:90-100` | Duplicate codes across lines are handled (first line with room). A bundle's OWN barcode matches no line - by design under D3 ("never pick the bundle SKU"). |
| Shipment lines | `core/shipping/application/services/shipment-line.service.ts:103-138` | Built from order snapshot items (bundle grain) - keep: a shipment ships the bundle the channel sold. Coverage of a bundle line split across two works stays the existing "full quantity per shipment" approximation. |
| Dispatch relay | `core/orders/domain/types/order-lifecycle-event.types.ts:76` (no line items) | Order-level event; bundle-agnostic. No change. Split-across-works bundles inherit the existing first-dispatch-relays-whole-order behaviour. |

---

## 4. Publishing a bundle as an offer

- A D3 bundle is an ordinary catalogue variant (#3606 "Identity"), so `OfferBuilderService`
  (`core/listings/application/services/offer-builder.service.ts:273-300`) and the bulk wizard publish
  it like any variant. The only bundle-specific number is stock, and it arrives from
  `getPromisableQuantities` once the explosion lives there (section 2).
- Barcode: a seller-made set usually has no GTIN; the wizard already models that as a blocker /
  advisory (`no barcode`, `in-store-barcode`, architecture-overview § Listings #2240/#2243). Whether
  Allegro wants a set-specific parameter or catalogue card: **(unverified)** - out of this angle.
- Shop publish (WooCommerce `ProductPublisher`) publishes the bundle as a simple product with the
  derived quantity; WC's own bundle types are never written. Fine.
- Channel quantity write-back of a bundle shares the #2617 freshness guard; `observedAt` must be the
  max of components' stamps (section 2), otherwise a later component change can be refused as
  "older".
- Master storefront (F7): no core path writes the master's own bundle row. Options: a master-side
  writer capability, or a pilot rule "the bundle product in the master must be a native pack in
  `components` mode, or not sold in the master storefront".

## 5. Automation for gifts

Today (closed vocabulary): actions `core/automation/domain/types/automation-action.types.ts:43-50`
(`issue-sales-document`, `dispatch-shipment`, `relay-status-to-source`, `send-email`, `place-hold`,
`release-hold`); conditions `core/automation/domain/types/automation-condition.types.ts:44-49`
(`sourceConnection`, `orderCountry`, `orderTotalGross`, `holdReason`); T9 `order.received` legality
`core/automation/domain/types/automation-legality.types.ts:121-128`. No line-level fact exists.

Needed:
- Action **`add-order-line`** (config `{variantId, quantity, priceGross: 0, label: 'gift'}`),
  reversible (not in `AUTOMATION_ACTION_IS_IRREVERSIBLE`), legal for T9 only at first.
- Conditions **`orderContainsVariant`** (`{variantId, minQuantity}`), **`orderContainsProduct`**,
  and reuse `orderTotalGross` (inline amount+currency already).
- Storage: OL-added lines cannot be quantity overlays - `OrderEdits.lines` holds absolute
  quantities that "can only go down" (`core/orders/domain/types/order-edits.types.ts:20-23`, shape
  `:86-96`). Add an `addedLines` section to `OrderEdits`, merged in the same `toDomain` seam so the
  effective order (reservations, routing, bench) sees it and the channel snapshot does not; a gift
  line carries `origin: 'openlinker'` + `role: 'gift'` on `OrderItem`
  (`core/orders/domain/types/order.types.ts:255-...` today has no such field).
- **Timing collision**: T9 is emitted at `order-ingestion.service.ts:666-671` AFTER `order` was
  merged from the overlay (`:664`) and BEFORE reservation (`:699`) and routing; dispatch runs
  executors inline (`core/automation/application/services/automation-dispatch.service.ts:140`).
  A gift executor that writes the overlay leaves the in-memory `order` stale, so the gift misses
  its reservation/routing on this ingestion (picked up only on the next poll). Fix: re-merge after
  T9, or evaluate gift rules as a pure step in ingestion (preferred: deterministic, no inline DB
  write in the middle of ingestion).
- **Optional-line semantics**: a gift out of stock must not hold the order. The committer refuses
  any plan carrying an unfulfillable line (`plan-carries-unfulfillable`, architecture-overview
  § Fulfillment #2730/#3485). Gift lines need `optional: true` that the router may drop (or the
  rule pre-checks gift ATP and skips with a recorded reason).
- Gifts on documents (zero-price line on invoice/receipt) and on the channel (never relayed):
  out of this angle; flag for the documents round.

## 6. Core-only vs adapter capability split

Core-only (no adapter involvement):
- `BundleComponent` entity + table (`product_bundle_components`: bundleVariantId,
  componentVariantId, componentProductId, quantityPerBundle, position; index on componentVariantId
  for reverse lookup; depth 1; no identifier mapping) in `products`.
- Pure `explodeBundleLine` + `deriveBundleAtp` (min floor, unknown-propagating, buffer once).
- `componentKey` on reservations, fulfillment_work_lines, inventory_sale_decrements, routing I/O.
- Router cohesion group (libs/oms, plugin-owned).
- Reverse-lookup fan-out (propagation, re-route, stale pause + sweep).
- Gift overlay (`addedLines`) + automation action/conditions.

Adapter capabilities (all optional, guard-only, NOT in `CoreCapabilityValues`, probed per ADR-046):

| Proposed name | On port | Method | Absence semantics |
|---|---|---|---|
| `KitStockModelReader` | `InventoryMasterPort` | `describeKitStock(productIds) -> Map<productId, { kit: boolean|'unknown', ownSaleLowers: 'own-row'|'components'|'both'|'unknown', adjustCascadesToComponents: boolean|'unknown' }>` | `unknown` => OL decrements components only, never the kit row; refuses to define an OL bundle on a variant whose master says `adjustCascadesToComponents: true` (F3 double decrement) unless OL then skips component writes. |
| `OrderCreateLineStockEffect` | `OrderProcessorManagerPort` (sibling of `OrderCreateStockEffect`) | `stockEffectByLine() -> Map<orderLineId, 'own-row'|'components'|'both'|'none'|'unknown'>` | `unknown` => component holds are never absorbed; kept until dispatch consume (under-sell). Fixes F4. PS can answer from `pack_stock_type` (it already reads it). |
| `MasterKitCompositionReader` (deferred, D3 out of pilot) | `ProductMasterPort` | `listKitCompositions(productIds)` | none read; OL definition is the only truth. Used later only to warn on drift. |

## 7. D3 amendments proposed

1. **Component identity is a column, not a synthetic line id.** `componentKey` on reservations,
   work lines, sale-decrement rows and routing I/O; unique indexes widened
   (`reservation.orm-entity.ts:55`, `fulfillment-work-line.orm-entity.ts:41`); idempotency keys
   suffixed (`inventory-sale-decrement.types.ts:125-132`, `:179-185`). A synthetic
   `orderLineId#c1` would break every consumer that reads `orderLineId` as a snapshot item id
   (handler `:97`, shipment lines, edits).
2. **ADR-054 amendment also needs a cohesion rule** - one bundle line's components are assigned
   together, split only in whole-bundle units.
3. **Who decrements components must be declared** (section 1.3); D3's "master pack not imported"
   stays, but the master's *stock behaviour* for the bundle product must be read, else F3/F4.
4. **Mirrored (non-routed) path**: D3 only describes reservation and routing. State explicitly:
   with OMS off, an OL-defined bundle is safe only when the destination master lowers components
   (native pack) - otherwise raise attention, keep holds; OL does not decrement on that path.
5. **Buffer and zero threshold apply once to the bundle quantity**, never per component.
6. **Stale extends via reverse lookup** in both the event path and the hourly sweep.
7. **Pre-assembled kits are not bundles**: a manufacturer gift set with its own EAN and stock is
   an ordinary variant (no explosion). D3's "the packer never picks the bundle SKU" is only right
   for assemble-at-pack sets; the bundle definition needs that distinction (or the operator simply
   does not define components for it).
8. **Returns, cancellation reversal and order-quantity edits explode too** (or refuse with a named
   block) - D3 is silent on them and the current code would act on the bundle row.
9. **Gifts are a separate decision** (OL-added overlay line + optional-line routing); not D3.

## 8. Risks

- F4 is a silent oversell on the default OMS-off path if bundles ship without the line-grain stock
  effect - the highest-impact risk, and nothing errors.
- F1 key collision is silent too (dedup reads as success).
- Unique-index widening touches live tables (`fulfillment_work_lines`, `reservations`); migrations
  run in one transaction (ADR-058 context) - indexes are small today, but recreation holds
  `ACCESS EXCLUSIVE`.
- Reverse-lookup fan-out multiplies propagation jobs on popular components (one component in 50
  bundles = 51 jobs per stock write); dedupe keys keep it bounded per tick but not free.
- ATP for a bundle adds a component read per propagation; batch it (`findAvailabilityByVariantIds`
  already batches).
- Master storefront oversell of the bundle (F7) has no core fix without writing to the master.
- Multi-position ambiguity (#2628, `AmbiguousReservationPositionError`) now hits each component;
  a bundle with one ambiguous component loses its whole hold set (all-or-nothing per call).
- Gift line timing (T9 inline write vs stale in-memory order) gives a first ingestion without the
  gift reserved/routed.
- Third-party behaviours (PS cascade on pack row PUT, WC Product Bundles, Shoper bundles, Subiekt
  komplet on ZK) are all **unverified** here and decide F3; each needs a live test before the
  adapter declares anything other than `unknown`.
