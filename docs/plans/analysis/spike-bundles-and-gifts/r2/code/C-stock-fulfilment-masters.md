# Spike run 2 / code angle C: stock, fulfilment, product masters, listings, automation

Date: 2026-11-04. Read-only. Paths relative to repo root. Inputs: #3520, #3606, #3607, #3624 (D3),
docs/plans/spike-bundles-and-gifts.md, ADR-054/058/061/079/080, the code below.

Bottom line: D3 is the right model, but the code is keyed on `orderLineId` in at least SIX places
where one bundle order line would become several component rows. Every one of them silently
collapses components into one (lost decrement, wrong hold close, broken routing conservation).
The component line needs its own identity (`componentKey`) carried end to end. Almost all of the
work is core-only; only three adapter capabilities are worth adding, and none is needed for the
pilot's OMS-on path except a conservative core guard.

---

## 1. Product masters: how packs/sets are treated today

| Master | What it does with packs/sets | file:line |
|---|---|---|
| PrestaShop | Only master with pack logic. Pack = ordinary product in the OL catalogue (no special entity). Inventory sync derives its quantity: `pack_stock_type` 0/3 defer to shop `PS_PACK_STOCK_TYPE` (`packStockTypeDefersToShop`), mode `pack-only / components / both`, `derivePackAvailability` = min floor(component/qty), unreadable component counts as 0 | `libs/integrations/prestashop/src/domain/types/prestashop-pack.types.ts:26,36,46,103-150,166,205` |
| | Wired into `listInventory` only; writes a synthetic row `pack:{id}` with the derived qty | `.../adapters/prestashop-inventory-master.adapter.ts:307-343, 368-420` |
| | `getInventory` deliberately NOT at parity (returns the pack's own stale row) | same file `:216-223` |
| | `adjustInventory` writes ONE `stock_availables` row; for a pack that is the pack row, never its components | same file `:887` |
| | Pack ids cached per connection (`cache_is_pack`, 10 min TTL; `null` = unknown, never empty set) | `.../provisioners/prestashop-pack.resolver.ts:1-80` |
| | `OrderCreateStockEffect` answers `false` for an order containing a pack (decrement may land on pack row, components or both) | `.../provisioners/prestashop-order-stock-effect.resolver.ts:24-31` |
| | Module header: "a neutral pack model in libs/core would cement one platform's shape" - the author explicitly kept packs adapter-local | `prestashop-pack.types.ts:11-14` |
| WooCommerce | Imports every product type (`simple/variable/grouped/external`); no bundle awareness; bundle plugins (`woosb`, `bundle`, composite) arrive as unknown types and are mirrored as plain products with their own stock row | `libs/integrations/woocommerce/src/infrastructure/adapters/product-master/woocommerce-product.types.ts:20`, `.../inventory-master/woocommerce-inventory-master.adapter.ts:111` |
| | `lowersStockOnOrderCreate` is ORDER-wide (last create's answer), not per line | `.../order-processor/woocommerce-order-processor.adapter.ts:252-254` |
| Shoper | Product `type` is not read at all; a Shoper set (`children[]`) is mirrored as an ordinary product with its own stock; order mapper ignores `type/children` | `libs/integrations/shoper/src/domain/types/shoper-api.types.ts` (no type field on product), `.../mappers/shoper-incoming-order.mapper.ts` |
| Subiekt GT | Knows `DodajKomplet` (a kit of different towary) exists, does not read it; maps MODELS to variants | `libs/integrations/subiekt/src/infrastructure/adapters/subiekt-product-master.adapter.ts:25-40` |
| Subiekt nexo | No product master | - |

Consequence for D3 "OL-defined bundles": the bundle variant still has to EXIST in the catalogue, and
the catalogue is filled only by `ProductMaster` sync. So in practice the operator marks a variant that
some master imported (PS pack, Woo product, Shoper set product). That master usually also reports a
stock row for it -> OL holds two stock answers for one variant (the master's own row + the component
derivation). D3 must say the derivation wins and the bundle's own positions are ignored by ATP (and
by the sale decrement owner resolution), or a bundle variant would also be decremented as itself.

A purely OL-authored bundle (e.g. an Allegro productSet offer whose bundle is in no master) has no
variant at all: there is no core path that mints an `ol_product_*`/`ol_variant_*` without a master.
Flag for #3606: either "bundle requires a mastered variant" (pilot) or an OL-native catalogue variant
(later, needs a products-context write path).

### Double-decrement / mis-decrement risk matrix

| Path | What happens today with D3 bundle | Risk |
|---|---|---|
| OMS on, routed order, sale decrement (#3453) exploded to components | Component rows in the owning master decremented via `adjustInventory`; bundle's own master row untouched | OK for components. Bundle's own row in a Woo/Shoper master drifts high -> the shop's OWN storefront keeps selling the set on its own stock. Needs write-back or a warning (capability A below). |
| OMS on, sale decrement NOT exploded (today) | `decrementForWork` resolves owner of the BUNDLE variant's position and lowers the bundle row | Components never move (the live defect). |
| Master-absorbed hold consume at order create (`IMasterAbsorbedReservationService`) | Consumes holds whose position source == destination, by order line (`closeForOrder({orderLineIds})`) | With component holds: consumes component holds although Woo/Shoper lowered only the BUNDLE row -> OL over-promises components until next master sync = OVERSELL. PS already answers false for packs. `libs/core/src/inventory/application/services/master-absorbed-reservation.service.ts:96,115,167,209` |
| Storefront order (shop is master and source) | #3487 skips routing; reservation still created at ingestion | With exploded holds: component holds stay until expiry/dispatch consume (under-sell, safe). If the shop's own flow decremented only the bundle row, components in the master drift. |
| OMS off, mirror create of bundle SKU into a PS shop with pack mode components | PS decrements components itself | OL also exploded holds -> if consumed only on PS `true` answer it is fine; PS answers false for packs, so holds stay until dispatch. Safe. |

Conclusion: the safe core-only default is: **never consume a bundle line's component holds at order
create**, whatever `OrderCreateStockEffect` says (it is an order-wide boolean and cannot speak per
component). Only a per-line declaration (capability C below) may relax it.

---

## 2. Inventory / ATP hook points

| Area | file:line | What changes |
|---|---|---|
| Bundle ATP | `libs/core/src/inventory/application/services/availability.service.ts:69` (`getPromisableQuantities`) | For a variant marked bundle: answer `min floor(componentAtp/qty)` over components, computed from the components' own `PromisableQuantity`; any component `unknown` -> bundle `unknown`; any component variant `isStale` -> 0 with reason. Bundle's own positions ignored. Ledger subtraction happens at component grain (holds are component holds), so no bundle-level subtraction. Provenance: `computed` (or `authority` only if every component is authority-answered). |
| Publish controls | same file `:149` `applyPublishControls`, `:181` batch | Unchanged: safety buffer / zero-threshold are applied ONCE to the derived bundle quantity per channel. Do NOT buffer components first (double buffer). |
| Bulk wizard / cancellation restore reader | `libs/core/src/inventory/application/services/inventory-query.service.ts:168,183,202,220` | `availableToPromise` for a bundle variant must be the derived figure (or route through the same bundle-aware ATP). |
| Stock view / product page | `apps/api/src/inventory/application/services/stock-view.service.ts:346`, `apps/api/src/products/http/products.controller.ts:391` | Per-component breakdown + limiting component (M22). |
| Propagation to channels | `apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts:~112-140` (ATP read at 113, stale guard 130, mapping target 137) | After publishing variant X, also fan out to every bundle containing X (reverse lookup `bundle_components WHERE componentVariantId = X`), each computed with bundle ATP and propagated through the existing offer + ShopProduct branches. Dedupe key per bundle variant (location-free, like today). Bounded: cap fan-out per write and log. |
| Write-back choke point | `libs/core/src/inventory/application/services/inventory-sync.service.ts:58` (`updateOfferQuantities`) | No change if callers pass the bundle's derived quantity; observedAt (#2617) for a bundle = max of components' `inventoryUpdatedAt` (monotone guard still holds because any component change re-derives). |
| Offer create | `libs/core/src/listings/application/services/offer-builder.service.ts:283`, `product-publish-builder.service.ts:189` | Stock passed in from wizard; wizard must resolve bundle ATP (above). |
| Reservations | `libs/core/src/inventory/application/services/reservation.service.ts:67-141` | Explode in `reserveForOrder`: one claim per (orderLine, component position) with quantity = perBundle x ordered. Already one `claimHeld` transaction for the whole order = all-or-nothing is already stronger than "per bundle line". `ReserveOrderLineInput` needs `componentKey`. |
| Reservation identity | `libs/core/src/inventory/infrastructure/persistence/entities/reservation.orm-entity.ts:55` `UQ_reservations_active_line (orderRecordId, orderLineId, inventoryItemId)` | Works as is when components hit different positions; collides if two components resolve to the same position (only if a component variant appears twice -> forbid duplicate components). Add nullable `bundleComponentId`/`componentVariantId` column for display, shortfall naming and line-scoped closes. |
| Closed-line gate | `reservation.service.ts:111, 164-175` (comment: "a line holds against one position at a time") | That stated invariant becomes FALSE for bundle lines. Gate must key on (orderLineId, componentKey). |
| Line-scoped close | `reservation.service.ts:305` `closeForOrder({orderLineIds})` | Called by the sale decrement per settled line (`inventory-sale-decrement.service.ts:615-620`): first settled component would close ALL component holds of the bundle line -> other components lose their hold before their decrement lands (oversell window). Needs `componentKeys` scope. |
| narrowForOrder (order edit #3542) | `reservation.service.ts:239-296` | Target quantity is per order line; for a bundle it must be per component = perBundle x new qty. |
| Shortfall episodes | `libs/core/src/inventory/application/services/reservation-shortfall.service.ts` | Works at position grain; episode should name the bundle order line + component (ADR-061 amendment text). |
| ATP subtraction reader | `listPublishedReservedByLocation` (router) and `ReservationLedgerReader` | No change: component holds subtract from component positions, which is exactly D3. |
| Stale pause | `libs/core/src/listings/application/services/stale-offer-pause.service.ts:78-125`, `offer-mapping.repository.ts:754` `findStaleMappedVariants` | Extend both: a stale component also pauses offers mapped to every bundle containing it (event path + hourly sweep join through bundle_components). |
| Movement ledger (ADR-079) | `InventoryService.setInventory` | Unchanged: component mirror writes carry `sale` with sourceRef = workId/orderLine; add component ref so history sums. |
| Cost (ADR-080) | ingestion cost snapshot on `order_line_items` | Bundle variant cost = sum(component netUnitCost x qty) resolved at ingestion if every component has a cost recorded before placedAt; else `not-recorded`. Pure, core-only. |

### Sale decrement / reversal (most dangerous collisions)

| file:line | Problem | Change |
|---|---|---|
| `libs/core/src/inventory/domain/types/inventory-sale-decrement.types.ts:125` `sale:{owner}:{workId}:{orderLineId}` + `inventory-sale-decrement.orm-entity.ts:33` unique `idempotencyKey` | Two component work lines of one bundle line share workId+orderLineId (and usually owner) -> second component's claim conflicts and is treated as a REPLAY: it is never decremented and reported as settled. | Key on `workLineId` (stable, unique) or append `:{componentVariantId}`. Keep old format for non-bundle lines so in-flight rows replay identically. |
| `inventory-sale-decrement.service.ts:243` `saleDecrementPositionLockKey(owner, productId, variantId)` | Fine (component position) once input carries the component product/variant. | - |
| `apps/worker/src/sync/handlers/inventory-sale-decrement.handler.ts:93-118` | Resolves `productId` from the ORDER item (`itemsById.get(line.orderLineId)`) -> for a component work line it would decrement the bundle's product. | Take product/variant from the work line (component), use the order item only for existence/cancel checks. |
| `inventory-sale-decrement.service.ts:228,302,615` consume hold by `orderLineId` | Closes all components' holds on first settle | Scope by component. |
| `libs/core/src/inventory/application/services/inventory-sale-reversal.service.ts:142,160,163` `${workId}:${orderLineId}` and `buildEditReversalIdempotencyKey(changeId, orderLineId)` | Same collision on reversal / edit reversal | Same fix. |
| Source-is-owner skip (#3453 property 4) | Per line owner == source; fine at component grain | - |
| Returns restock `libs/core/src/returns/application/services/return-custody.service.ts:441,538` | Resolves owner and target by the return line's SKU (= bundle SKU) | Explode a returned bundle unit into components (or let operator dispose per component); in-set price (D3a) decides credit-note value per component. |

---

## 3. Fulfilment hook points

| Area | file:line | What changes |
|---|---|---|
| Routing projection | `libs/core/src/orders/domain/project-order-for-routing.ts:36-55` | Explode here (the single shared projection used by ingestion, route handler, dry run). Emit one `RoutingInputLine` per component. Bundle composition must be passed in as an argument (fulfillment leaf may not read products). |
| Routing input shape | `libs/core/src/fulfillment/domain/types/routing.types.ts:38-41` `RoutingInputLine {orderLineId, productVariantId, quantity}` (ADR-062 allowlist at :71) | Add `lineKey` (unique per input line; = orderLineId for plain lines, `orderLineId#componentVariantId` for components) and optional `bundleGroup` (opaque group id = orderLineId) so a router can keep a kit together. Allowlist widens deliberately (two-place edit). |
| Assignment + conservation | `routing.types.ts:149-155` (assignment has orderLineId only), `:261-293` `checkRoutingPlanConservesQuantities` keyed by orderLineId | Keyed by `lineKey`, otherwise two components sum into one expected bucket and a plan that swaps quantities between components passes. |
| Commit | `libs/core/src/fulfillment/application/services/routing-commit.service.ts:202, 489-545` (`variantByOrderLineId`, bucket.lines keyed by orderLineId) | Key by lineKey; work line carries `orderLineId` (bundle line) + component variant + new `bundleComponentRef`. |
| Work line | `libs/core/src/fulfillment/domain/types/fulfillment-work.types.ts:63-74` | Add nullable `bundleLineRef` {orderLineId already there, componentVariantId, perBundleQuantity}. Counters stay per component. Migration on `fulfillment_work_lines`. |
| OL router | `libs/oms/src/routing/ol-fulfillment-router.ts:203,262` (`loadStock`, published holds by location), `libs/oms/src/routing/evaluate-routing.ts:82,118,258,275-335` | Demand already aggregates by variant (:258) - good. Split ladder (`line-split`) would split a kit's components across two locations: add a cohesion rule (components of one `bundleGroup` never split; for the pilot one warehouse makes this moot). |
| Bench verification | `libs/core/src/fulfillment/domain/types/fulfillment-verification.types.ts:48,206,232` | Keyed by `workLineId` already - component lines verify independently with no change; parcel closes only when every component verified (existing rule). |
| Bench view | `apps/api/src/bench/application/types/bench-parcel.types.ts:79-132`, `.../services/bench-parcel.service.ts:878` | Add `partOf {orderLineId, bundleName, bundleSku, bundleQuantity}` and `gift: boolean` on `BenchParcelLineView`. Name/EAN already resolved per component variant. |
| Order edit (#3542) | `libs/core/src/fulfillment/application/services/fulfillment-order-edit.service.ts:79,121` | `cancelledDelta` must apply to every component line of the bundle line, proportionally (perBundle x cut). |
| Shipment lines (#2727) | `libs/core/src/shipping/application/services/shipment-line.service.ts:67,103-140` | Stays at ORDER-line (bundle) grain - correct per D3 (order line keeps the bundle). Partial-shipment of a kit across two works would make bundle shipped qty ambiguous: count a bundle unit shipped only when all components shipped = floor(min(componentShipped/perBundle)). |
| Dispatch relay | `libs/core/src/orders/application/services/fulfillment-dispatch-relay.service.ts:69`, `fulfillment-work-repository.port.ts:798` `claimDispatchRelay` | Work-grain claim. With kit cohesion (all components on one work) "shipped" already means all components shipped. D3f is only real if a kit may split across works; then relay per work must be suppressed until every work carrying a component of that bundle line is shipped. Simplest: forbid kit split (cohesion) in v1 and D3f holds by construction. |
| Sale decrement enqueue | `libs/core/src/fulfillment/domain/types/fulfillment-sale-decrement-enqueue.types.ts` | One job per work - unchanged; the per-line fix is inside the decrement (above). |

---

## 4. Listings: publishing an OL bundle

- An OL bundle is an ordinary variant (D3), so it can already be published through `OfferManagerPort`
  / `ProductPublisher` with no new capability: offer mapping is per variant, quantity is whatever
  ATP the builder is handed. What changes is only the QUANTITY (bundle ATP) and the stale pause.
- Allegro knows sets natively: `AllegroProductSetEntry.quantity.value` "Allegro uses it for
  bundles/sets", read-side only, create path never sets it (`libs/integrations/allegro/src/domain/types/allegro-api.types.ts:351-420`, esp. :375). `productSet` is always one entry today (`productSet[0]`).
  Publishing a bundle as a multi-entry productSet (each entry a component card + quantity) would be a
  NEW, OPTIONAL listing sub-capability, not required for the pilot: a bundle published as a single
  inline/own card is valid on Allegro.
- Proposed `BundleOfferComposer` (sub-capability of `OfferManagerPort`, guard-only / advertised-
  without-dispatch, like `OfferCreator`): `supportsComponentSets(): true`, consumes
  `CreateOfferCommand.bundle?: {components: [{productCardId|ean, quantity}]}`. Absent = publish the
  bundle as one product (today's behaviour). Only Allegro would declare it.
- Shop destinations (Woo/Shoper ProductPublisher) have no core set concept (Woo needs plugins,
  Shoper `children` write unverified) -> publish as a simple product; no capability now.

---

## 5. Automation: "add gift line"

- Vocabulary: `libs/core/src/automation/domain/types/automation-action.types.ts:43-50` (6 actions),
  irreversibility table `:66-73`; conditions `automation-condition.types.ts:44-49`
  (sourceConnection, orderCountry, orderTotalGross, holdReason); legality matrix
  `automation-legality.types.ts:55-147` (T9 `order.received` row at :121); facts
  `automation-facts.types.ts:50-74`; triggers `automation-trigger.types.ts:43-55`.
- New action `add-order-line` (config: variantId, quantity, gift: true, outOfStockPolicy
  `skip-and-attention | hold-order`, onceKey). Reversible (a gift line can be removed), so NOT in the
  irreversible gate. Legal on T9 `order.received` (and maybe T1 hold placed). New conditions needed:
  `orderContainsVariant` (SKU) and reuse `orderTotalGross` / `sourceConnection`. `satisfies` on the
  matrix forces every trigger row to decide.
- Ordering problem: ingestion fires `order.received` at `libs/core/src/orders/application/services/order-ingestion.service.ts:670`
  AFTER computing the effective order from the overlay (`:664`) but BEFORE reservation (`:699`) and
  routing (`:772`). An executor writing a gift into the overlay would be invisible to the reservation
  and routing in the same pass. Options: (a) re-read the overlay after `notifyOrderReceived` and
  rebind `order` before `reserveOrderInventory` (cheap, one read, same RETURNING discipline as #3542);
  (b) gift line added post-routing creates a separate FulfillmentWork (needs a re-route/append path -
  today one live decision per order). Recommend (a) for automation and the operator action before
  routing; an operator gift after routing = cancel-and-reroute is NOT allowed (ADR-054), so it must
  append a work (new path) or be refused once routed ("add before packing" window).
- Where the line lives: `OrderEdits` overlay (`libs/core/src/orders/domain/types/order-edits.types.ts:86-96`)
  today has `lines` keyed by existing `OrderItem.id` and only DEcreases (#3542, `min(overlay, channel)`).
  Add an `addedLines` section (OL-minted line id `ol_line_*`, variantId, quantity, listPrice,
  discount 100%, `origin: 'operator' | 'automation:{ruleId}'`, `gift: true`). Merged once in
  `toDomain` like every other overlay section; channel snapshot never contains it; order totals
  unchanged (gift is 0 net); documents render list price + 100% rebate (D3a/G-10).
- No channel write: a marketplace/shop order cannot gain a line (none of the four writeback adapters
  supports line add, same as #3542). So add-line is CORE-ONLY on an OL-owned order. A future
  `OrderLineAdder` sub-capability of `OrderProcessorManagerPort` (mirror shop order gets the gift)
  is optional and only for OMS-off mirror destinations; absent = gift exists only in OL (and the
  routed bench/documents), which is the whole OMS-on point.
- Reservation: added line reserves through the ordinary `reserveForOrder` (new line id, not
  `already-closed`), `atpEffect` same as the order. Out-of-stock: `InsufficientAvailabilityError` is
  swallowed today (reservation is best-effort) -> for gifts must map to the action's outOfStockPolicy
  and raise an attention entry (new producer `gift`), never drop silently.
- Once per order: the automation run claim is per (rule, subject); use an idempotency key
  `gift:{ruleId}:{orderId}` on the overlay write (OL-minted line id derived from it) so a re-poll or
  replay never adds a second gift.

---

## 6. Core-only vs capabilities

### Core-only (no capability; pure OL logic, integration- and country-agnostic)
1. `BundleDefinition` + `BundleComponent` (bundle variant, component variant, qty per bundle,
   in-set price D3a, gift flag D3d, stockMode `components` [later `own`, `min-of-both`] to cover B-03
   pre-built kits with PS's three-mode semantics, no nesting D3e). Owning context: `products`
   (catalogue composition) with inventory/fulfillment consuming it through `IProductsService`
   (or a `bundles` read port); NOT inventory (inventory must stay reader-only of catalogue).
2. Bundle ATP derivation + unknown/stale propagation in `IAvailabilityService`.
3. Reverse lookup + propagation fan-out + stale pause extension.
4. Component explosion at reservation and routing (`projectOrderForRouting`), `componentKey`
   identity through reservations, work lines, sale decrement, reversal, order edit.
5. Kit cohesion rule in the OL router (OMS plugin, not core port).
6. Bench `partOf` / gift badge; shipment-line bundle shipped = min over components.
7. Gift/added line in the OrderEdits overlay; `add-order-line` automation action; gift reservation
   and out-of-stock attention.
8. Recognising channel bundle shapes is adapter MAPPING into a neutral `OrderItem` extension
   (e.g. `OrderItem.bundle?: {children[]}` / `groupKey`) - an `IncomingOrder` shape widening, not a
   capability (every OrderSource either fills it or not; absent = no claim).
9. Guard: never consume a bundle line's component holds at order create (master-absorbed path).

### Adapter-declared capabilities (proposed)
| Name | Base port | Dispatch mode | Method | Absence semantics |
|---|---|---|---|---|
| `MasterBundleStockReader` | `InventoryMasterPort` (sibling `ProductMasterPort` acceptable) | guard-only, probed (ADR-046), absent from `CoreCapabilityValues` | `describeBundleStock(productIds): Map<id, {kind: 'not-a-bundle' \| 'components' \| 'own-stock' \| 'both' \| 'unknown', components?: [{externalProductId, externalVariantId?, quantity}]}>` | Absent or `unknown` = OL knows nothing; editor warns "the master also keeps its own stock for this product" never. With it: editor can (a) warn when the master holds `own-stock` for the bundle variant (drift, storefront oversell), (b) offer "pre-fill from master pack" later (B-18) without importing as authority. PS implements from `readPackDefinition`/`resolvePackStockMode`. |
| `OrderCreateLineStockEffect` (extension of `OrderCreateStockEffect`) | `OrderProcessorManagerPort` | guard-only, probed | `stockEffectForLines(): Map<orderLineId, 'lowers-line' \| 'lowers-components' \| 'none' \| 'unknown'>` (for the order just created) | Absent = core treats every bundle line as `unknown` -> keep component holds until dispatch (under-sell). PS can answer `lowers-components` for a pack in mode `components` created in a stock-lowering state. |
| `BundleOfferComposer` | `OfferManagerPort` | guard-only (advertised-without-dispatch, like `OfferCreator`) | consumes `CreateOfferCommand.bundle` components | Absent = publish bundle as one product (today). Only Allegro (`productSet[]` + `quantity.value`). Not in pilot. |
| `OrderLineAdder` (optional, later) | `OrderProcessorManagerPort` | guard-only | `addLine({externalOrderId, line})` | Absent = gift lives only in OL (OMS-on correct; OMS-off mirror does not get it, stated on the order). |

No capability for: bundle ATP, explosion, gifts on OL-owned orders, automation, bench, documents.

---

## 7. Where D3 should be amended

- D3-id: component lines need their own identity end to end (`componentKey` / `bundleComponentRef`):
  reservations, routing input/assignment conservation, work lines, sale decrement idempotency key,
  sale reversal key, hold close scope, narrowForOrder target. Without it, six keys collide.
- D3-own-row: the bundle variant's OWN master positions are ignored by ATP and by owner resolution;
  the bundle is never decremented as itself. State the drift consequence for a Woo/Shoper master that
  keeps its own stock row for the set (warn via `MasterBundleStockReader`; optional ShopProduct
  write-back of the derived qty).
- D3-variant-exists: an OL bundle must be a mastered catalogue variant in the pilot; a marketplace-only
  set (Allegro productSet with no master product) needs an OL-native variant (later).
- D3-absorb: component holds of a bundle line are never consumed at order create unless the
  destination declares per-line component decrement.
- D3-cohesion (supports D3f): a kit's components are routed to ONE work (no line-split / quantity-split
  across components of one bundle unit) in v1; then "shipped" relay = work shipped holds by construction.
- D3-stockMode: record `components` now and reserve `own` / `min-of-both` (pre-built kits, B-03) in the
  model so the PS three-mode semantics have a neutral home later.
- D3-cost/returns: bundle cost = sum component costs (ADR-080 amendment); returned bundle units restock
  per component (returns explode by definition snapshot, B-10).
- D3-gift: gift = component with in-set price 0 OR an OL-added order line (overlay `addedLines`), both
  reserving normally; out-of-stock gift = attention, never silent drop.
- ADR-062: `RoutingInputLine` allowlist widens by `lineKey` + `bundleGroup` (deliberate two-place edit).

## 8. Risks
1. Silent second-component non-decrement via idempotency-key collision (sale decrement / reversal) -
   reads as success. Highest severity; must have a spec with a 2-component bundle in one work.
2. Hold close by orderLineId releases sibling component holds early -> oversell window.
3. Master-absorbed consume with order-wide `OrderCreateStockEffect=true` (Woo/Shoper) -> oversell.
4. Routing conservation keyed by orderLineId accepts a plan that mixes component quantities.
5. Propagation fan-out on shared components (1 component in N bundles) multiplies jobs per stock write;
   needs cap + dedupe.
6. Woo/Shoper master keeps selling the set on its own stock row (storefront) while OL decrements
   components only -> shared-component drift (merchant pain #1) persists outside OL.
7. Gift added via automation after reservation/routing is invisible to them unless ingestion rebinds
   the overlay; after routing there is no append-work path.
8. A bundle with an `unknown` component publishes nothing (suppressed) - correct, but an unreadable
   component on one master stalls every bundle containing it; needs operator-visible reason.
