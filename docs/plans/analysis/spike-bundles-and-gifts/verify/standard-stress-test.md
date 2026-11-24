# Stress test of the proposed standard (Plan agent, 2026-11-04)

Read-only review at HEAD 9e35aec9d. The agent read STATUS.md before the PrestaShop probe and R5-8 finished; both have since run (verify/prestashop-live.md confirms C-060's consequence, r5/8-tax-fiscal.md exists).

## A. Holes, ranked

1. **CRITICAL - bundle ATP has no recompute trigger.** Component sold standalone, hold claimed/released, or component staled: the kit offer keeps its old quantity until something touches the kit variant. Propagation, freshness token and stale pause key on the mapped variant only (r4/code/C b1, b4, b5, gaps 5-7; stale-offer-pause.service.ts:90-104). Fix: reverse fan-out component -> bundles, token = max over components, stale component -> bundle stale, ignore the bundle variant's own positions.
2. **CRITICAL - expansion taken late.** An order ingested before the definition existed gets an expansion on a later poll: `L` holds plus `L~c:v` holds, or work routed at `L` while the decrement expands. Operator remaps kit X -> plain Y after freeze: X's expansion applied to Y. Fix: freeze a negative fact per order ("these line ids were evaluated") in the first-`ready` transaction; `expand` asserts `frozen.bundleVariantId === item.variantId`, else attention and no routing.
3. **HIGH - readers keyed on the commercial id the three call sites miss**: `fulfillment-order-edit.service.ts:77-84` (unrouted), `assessForEdit` :44-49, edit reversal key + `inventory-sale-reversal.service.ts:159-160`, `return-correction-matching.domain-service.ts:263-270`. Fix: guard (`LINE_IS_BUNDLE`, manual restock), do not build.
4. **HIGH, live - PrestaShop pack decrement (D1).** An offer mapped to a components-mode pack with no OL definition writes only the pack row (`prestashop-inventory-master.adapter.ts:909-946`). `pack_stock_type=0` bug spans 1.7.6.9-9.1.5, so a static declaration would be wrong on some versions.
5. **HIGH - Allegro multipacks.** From 2027-01-12 a multipack is a productSet offer with quantity > 1. "3x A" has no master variant; mapped to A, one unit is decremented for three shipped. Fix: park the order when productSet total != 1 and the variant has no definition, or a quantity multiplier per mapping.
6. **HIGH - parent + children shapes** (WooCommerce, possibly Shoper): container expanded by definition and children arrive as ordinary lines -> double reservation and pick.
7. **HIGH multi-warehouse / LOW one-warehouse - kit cohesion.** Router sees components as unrelated lines; an incomplete kit can ship. Fix: cohesion check at commit, not a router port change.
8. **MEDIUM - identity details**: never parse `~c:`; definitions unique per (bundle, component), no nesting; reserve `~g:`; expansion stores component productId (owner lookup `inventory-sale-decrement.service.ts:136-137`, handler `:107`).
9. **MEDIUM - mirror path**: component holds survive by accident (`order-sync.service.ts:515`, `master-absorbed-reservation.service.ts:207-208`); pin with a spec. Destination simple product for the kit decrements only the kit row.
10. **MEDIUM, unverified - Subiekt komplet**: own stock after assembly contradicts min-over-components; WZ release on invoice may double the effect.
11. **MEDIUM - adjustment model gaps**: PS same-product gift is qty+1 on the paid row (needs `targetLineId` + `freeQuantity`); Mirakl `offered_quantity` inside/outside `quantity` unknown; Allegro CAMPAIGN/ALLEGRO_PRICES make `originalPrice == price` (false "no reduction"); operator discount rewrites `unitPriceGross`; unallocated remainder; Kaufland-funded promotions invisible.
12. **MEDIUM - rule gifts**: `order.received` never fires after `awaiting_mapping`; gift added after routing has no path into work; no internal add-line, edit writer in apps/api.
13. **LOW-MEDIUM - shortfall swallowed per order** (`order-ingestion.service.ts:2299-2304`); "names the component" has no code path.
14. **LOW - Allegro One Fulfillment**: check the `fulfilledBySource` short-circuit (`order-ingestion.service.ts:1273`) runs before expansion.

## B. Field vs capability

- productSet hint: three-state field, check only.
- "Source emits children as lines": manifest value field (`variantGrouping` precedent, `adapter.types.ts:149-165`, restrictive default :328-332) or per-connection operator setting; never a capability name (#2085; manifest sub-capabilities are copied into `enabledCapabilities` at create, `connection.service.ts:996-1004`).
- Line-level stock-effect declaration: drop. Pack composition/stock mode is product data (three-state `Product` field, `gpsr` precedent).
- Device limits: a REQUIRED method on `FiscalizationPort` / `InvoicingPort` (ADR-046 + amendment); absence = omit and refuse, never a silent document change (ADR-014 decision 1).
- Rendering: operator setting in the ADR-082 shape; default = today's behaviour; tax treatment never a core default (ADR-063, ADR-026).
- OrderLineAdder: guard-only capability, deferred (no implementer, no internal add-line; ADR-048 decision 1).
- Drop the `unknown` enum member where "absent" already means "cannot say"; make "platform hides channel-funded promotions" a manifest value.

## C. Cheapest safe pilot

- Cut: new IncomingOrder/OrderItem fields, rendering setting, both capabilities; gifts = packer note + manual stock correction.
- Stage 0 (3-6 dev-days): PS `adjustInventory` refuses a components/both pack with a typed error landing as `blocked`; skip zero-gross lines in the two allocators guarding the zero-rate bucket; eparagony pre-check (rate net value > 0) with an operator-readable reason.
- Stage 1 (20-30 dev-days, only if the client sells OL-packed kits on routed channels): definitions (unique, no nesting, qty > 0, refused on children-emitting platforms); one expansion row per order written in the first-`ready` transaction (evaluated line ids, bundle variant, component productId + variantId, qty per unit, definition version, component catalogue gross) - not on `order_line_items` (delete-then-reinsert, ADR-080); expand at three sites; ATP in `IAvailabilityService` with hole 1; guards for holes 3, 5, 7; spec pinning absorbed holds; one E2E.
- Lock-in: id format; the per-order negative fact; documents keep the bundle line (freeze component catalogue gross); ATP owned by the publish path; recognition by mapping only.

## D. Contradicting evidence

1. "OL-defined" is OL composition over a master SKU and can diverge from the PS pack / Subiekt komplet (C-061, C-013).
2. Subiekt native model = kit has own stock (C-022).
3. C-027 refuted, but productSet UUIDs are check-only.
4. `listUnitPriceGross` false under CAMPAIGN/ALLEGRO_PRICES; Erli `unitPriceBeforeRebate` is not a list price.
5. ADR-082 decision 7 + KIS 2026: "omit" is the only safe receipt option for a free gift.
6. One bundle line at one rate goes against KIS 703725 and BFH; warn when a definition mixes rates.
7. PS gift is never its own zero-price row; mapper comment `prestashop-order.mapper.ts:163-166` wrong.
8. Shipment-lines collision refuted; "existing orderLineId columns" excludes shipment, invoice and return lines.
9. r4/code/C added `parentOrderLineId` / `quantityPerBundle` columns; the design adds none, which works only if every reader goes through the expansion table.
10. "2-4 declarations" cost refuted (each needs a server read and FE mirror).
