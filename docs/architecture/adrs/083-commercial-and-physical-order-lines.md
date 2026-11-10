# ADR-083: An order has a commercial line list and a physical line list; the expansion is frozen at ingestion

- **Status**: Accepted
- **Date**: 2026-11-04
- **Authors**: @norbert-kulus-blockydevs

## Context

Sellers sell sets (an Allegro multipack, a PrestaShop pack, a Subiekt komplet) and give gifts. A set is one line for the buyer, the document and the channel, but several units of stock for the warehouse. Decision D3 (2026-09-28) already says stock, reservations and `FulfillmentWork` run at component grain, while the order line, documents and channel keep the bundle.

The first plan expanded a bundle in every site that needs it. The spike (`docs/plans/spike-bundles-and-gifts.md`, `verify/component-line-id.md`) found nine such sites, and the failure mode is bad: each one treats "no row matched" as a normal outcome. An order edit on a bundle line would do nothing to works, holds and stock, report success, and could let a quantity fall below what was already picked. Nothing throws.

Two other designs also fell apart on inspection. Asking adapters to send `role` and `parentLineId` would change every adapter for no gain, since core already knows a bundle from its own definition, and two sources of truth could disagree. And the only channel that sends components with the parent (Shoper) nests them inside the parent's order row (verified live in #3932), so its adapter maps the parent line and ignores the children.

## Decision

1. **Two lists.** `order.items` stays the commercial list, unchanged: what the buyer paid for, what documents and the channel show. Core derives one **physical list**, with bundle lines expanded to their components, and every stock, packing and decrement site reads that one.
2. **The expansion is frozen once.** `order_records.lineExpansion` (jsonb, one writer) is written at ingestion, after the order overlay is applied and before reservation. A later change to a bundle definition does not change an open order. The UI says so ("this order has the composition from before the change").
3. **Two read-only derivations on `OrderRecord`** (ADR-011: pure, synchronous, field-only): `physicalItems` and `componentLineIdsOf(lineId)`. The second is how the order-edit follow-ups find the component lines of a bundle line. Nothing recovers a bundle line id by splitting a component id.
4. **Component line id** is `{lineId}~c:{variantId}`. Quantities are aggregated per component variant before expansion, so a bundle that lists a component twice cannot produce a duplicate `(work, orderLineId)` or `(order, line, position)` key. Each physical line carries the component's `productId`, not only its variant id.
5. **Sites that read the physical list** (function names; line numbers drift):
   - `OrderIngestionService.reserveOrderInventory`
   - `projectOrderForRouting` (covers the ingestion intercept, the route handler and the dry run)
   - `InventorySaleDecrementHandler`
   - `OrderSyncService` (`productIds` for the post-sale refresh and for absorbed holds)
   - the restock-target resolution of `ReturnCustodyService` (a bundle return restocks components). Not a one-line swap: a component restock is N custody acts (one adjustment, key and ledger act each). #3933 implements it: the api layer passes the frozen components of the returned line into `disposeLine` as data (no orders import in `returns`), one act, adjustment and idempotency key `return:{returnId}:{lineId}~c:{variantId}:{seq}` per returned component
6. **Order-edit follow-ups** go through `componentLineIdsOf` and sum back to the bundle line for the edit response, because the frontend keys stock by bundle line id: `FulfillmentOrderEditService.assessForEdit` and `lowerLineQuantity`, `ReservationService.narrowForOrder` (target is bundle quantity times component quantity), `InventorySaleReversalService.reverseLineQuantity`.
7. **Availability and publishing.** `IAvailabilityService.getPromisableQuantities` answers a bundle variant as the minimum over components of floor(component ATP / quantity); `unknown` provenance if any component is unknown. `InventoryPropagateToMarketplacesHandler` also enqueues the bundles of a changed component. `OfferStockRestoreService` republishes component and bundle offers on cancellation.
8. **Sites that keep `order.items` on purpose** (commercial grain): `shipment_lines` (its coverage is joined back to the snapshot items, so component ids there would demote delivered orders), return line resolution, invoice correction matching, discount allocation and discount correction, the amendment diff, `order_line_items` and margin, the destination mirror (`OrderSyncService` sends gift lines and the bundle line as they are), offer creation (a bundle is an ordinary master variant), and the cost snapshot at ingestion.
9. **An invariant script fails the build** when a new stock, reservation, routing or decrement reader takes lines from `order.items`. It lists the allowed readers, in the `check:invariants` style (decision 8 is that list).
10. **Optional fields on lines.** `gift?: { source: 'channel' | 'cart-rule' | 'ol-rule' | 'operator'; ruleRef?: string }` and `packQuantity?: number` (units of the mapped variant per sold unit, default 1) on `IncomingOrderItem` and `OrderItem`. Absent means today's behaviour. There is no `role` and no `parentLineId`. `OrderEdits` gains `addedLines` (key `ol-gift:{ruleId}:{lineId}` or `op-gift:{changeId}`) so OL-added gifts follow the overlay rule: `channelSnapshot` stays the channel original.
11. **Optional guard-only capabilities** (ADR-046 probe, absent from `CoreCapabilityValues` and from manifests): `ZeroValueLineSupport` (`acceptsZeroValueLine()`, on document adapters) and `BundleReader` (`readBundleComposition(externalProductId)`, on `ProductMaster` adapters). No mandatory port method is added; no existing adapter stops compiling.
12. **What stays core**: expansion, OL-only gifts, totals equal to what was paid (one `presentGiftLines` helper in `sales-documents`, called by both document mappers), and bundle availability. None can be done per adapter: a Shoper order and an Allegro order for one bundle could reserve different stock, Allegro and Erli have no gifts of their own, and an adapter sees only one master.
13. **A multipack that OpenLinker has not been told about is held** as `awaiting_mapping` with the reason "multipack without a bundle", instead of shipping one unit for the price of three. The hold offers one click, "This offer sells N x {product}", which stores a confirmation (`multipack_confirmations`, unique on variant and pack quantity) that one sale of that variant at pack quantity N means N units of it. It creates no product and remaps no offer. A variant with a bundle definition is not held either. At freeze time the line gets its own line-scoped definition in `lineExpansion` (`lineId` set): N units of the variant itself, or N times the bundle's components. It is frozen with the order, so a later confirmation or edit never moves an open order. Confirming re-drives every held order for that variant and pack quantity at once, and a repeat confirmation is idempotent.
14. **Bundle definitions** are OpenLinker data (`bundle_definitions`, history by version in `libs/core/src/products`). Nesting is refused both ways. A `BundleReader` can import a composition on demand.

## Alternatives considered

- **Expand in every site.** Rejected: nine sites, silent no-ops, and the sites disagree the first time one is missed.
- **Recompute the expansion at each read.** Rejected for the same reason plus drift: a definition edited between two reads gives two answers for one order.
- **Adapter-set `role` / `parentLineId`.** Rejected: every adapter changes for nothing, and core's definition is the second source of truth that could disagree.
- **Explode the bundle into the commercial list.** Rejected: documents, margin and returns would show lines the buyer never bought.
- **A new promotion engine for gifts.** Rejected: the automation engine already has storage, AND-only conditions, dry run, run history and at-most-once firing. *Superseded for gifts by [ADR-084](./084-promotions-context.md) (#3935): gifts now live in a small `promotions` context, not as automation rules; see the amendment below.*

## Consequences

**Pros:**
- One frozen table gives every site the same answer; reservations, packing, decrements and edits cannot disagree.
- Adapters carry no bundle knowledge; a non-implementing adapter stays correct.
- Documents stay at the commercial grain, so totals still equal what was paid, with one tax-driven exception (see Amendment: documents and VAT rates).

**Cons / trade-offs:**
- Fifteen call sites change (five swaps, four edit follow-ups, three availability sites, two mappers, plus ingestion).
- A definition fixed later does not change open orders.
- A new site that forgets the physical list fails silently; the invariant script is the guard, not the compiler.

**Migration path:**
- Additive. `lineExpansion` is NULL on existing orders, and a NULL expansion means the physical list equals the commercial list.

## Amendment: documents and VAT rates (#3934)

Decision 8 keeps documents at the commercial grain; two product decisions refine what that means for tax.

**A. A bundle on a document follows its VAT rates, automatically.** The operator setting `bundleForm` is removed. When every component's catalogue rate equals the set line's rate, the set is one document line (unchanged). When they differ, the set is presented as its components, each at its own catalogue rate, the paid price split in proportion to standalone prices (cost when a component is not sold alone), the remainder on the largest, the discount built into unit prices, never a negative or 0,00 line. A component whose rate is unknown, or with neither price nor cost, is not guessed: the document is held with the persisted block reason `bundle-split-unknown` (the existing `salesDocumentBlockReason` mechanism). Component rates are catalogue facts read from the products context (ADR-063: rates are an input, never computed), and a transient failure reading them throws instead of falling back to another document shape. Return correction matches a returned component to its component line and credits every component line for a whole-set return. Research basis, not legal advice: a set of goods with different rates is separate supplies at their own rates; one set line is acceptable only when every component has the same rate; a proportional split is the accepted method; a receipt binds one name to one rate on the register.

**B. A gift whose rate matches no paid line** is carried according to `config.giftOnDocuments.differentRateGift`: `priced-in` (default, the gift at its own rate with a share of the payment proportional to its standalone price) or `technical-cent` (the gift at 0,01, the cent taken from the largest paid line). Research basis, not legal advice: a gift tied to a purchase is part of the paid sale, and moving value away from a higher-rate item is the direction the authority warns about; industry tools use a 0,01 technical price, fiscal software refuses a 0,00 line, and a receipt cannot carry a negative line. Where a provider does not accept a zero line (a receipt always counts as such) no presented line is left at 0,00.

## Amendment: gift forms on documents (#3936)

Decision 12 keeps the gift presentation in one core helper. Three product decisions define the form it applies. They replace the earlier per-connection `config.giftOnDocuments` (default `omit`) and the separate `differentRateGift` choice.

1. **One choice, four options.** `technical-cent` (default): the gift at 0,01, the cent taken from the most expensive paid line, whatever its rate. `priced-in`: the gift at its own rate with a share of the payment proportional to its standalone price (cost when not sold alone). `show-zero`: 0,00, offered only where the document provider declares `acceptsZeroValueLine()`. `omit`: no gift line, with a warning that it may be treated as a free transfer. `internal-record` stays a separate record of the gift's issue. The totals always equal what the buyer paid. The old `differentRateGift` choice is merged into this one.
2. **Three levels, most specific wins:** the gift itself (rule, bundle gift slot, manual add), then the connection, then the OpenLinker-wide default `technical-cent`. Each gift shows where its form came from.
3. **Placement:** the OpenLinker-wide default on Settings > Sales documents; the per-connection override as a "Gifts on documents" tab on Connection > Mappings; per gift a field "On the document" in the rule composer, the bundle gift-slot menu and the manual add-gift dialog.

Research basis, not legal advice: a gift tied to a purchase is part of the paid sale, not a free transfer; a gift left off the documents was treated by a court (WSA Krakow) as a free transfer; fiscal software refuses a 0,00 line; BaseLinker and IdoSell POS use a 0,01 gift price; IdoSell offers 1,00 / 0,00 / merged / not on documents; Sellasist shows the gift at full price with a cancelling discount line or hides it. Amendment B in the section above is superseded by this one. See [product-spec-oms-gifts](../../specs/product-spec-oms-gifts.md).

## Amendment: promotions replace gift rules (#3935)

The sentence "a new promotion engine for gifts is rejected" held while a gift was cheap to express as an automation rule. It stopped holding once gifts needed an ordered list, stacking, limits and their own history, none of which the automation model has. [ADR-084](./084-promotions-context.md) moves gift rules into a `promotions` context with a typed benefit (`free-gift` only) and a policy per benefit kind. This is not a generic rule engine: automation keeps its own model, and price-changing benefits stay out until a channel-side design exists (ADR-014). Nothing in decisions 1 to 12 changes: the gift is still a line of the overlay with `gift.source = 'ol-rule'`, and `ruleRef` now holds the promotion id (the migration kept every id).

## References

- Related ADRs: [ADR-011](./011-domain-entity-behavior.md), [ADR-046](./046-adapter-declared-description-format.md), [ADR-054](./054-fulfillment-work-unit-of-assignment.md), [ADR-061](./061-advisory-reservations-and-availability-authority.md), [ADR-082](./082-delivery-line-on-sales-documents.md)
- Issue: #3606 (epic #3520)
- Spec: [product-spec-oms-bundles-and-kits](../../specs/product-spec-oms-bundles-and-kits.md), [product-spec-oms-gifts](../../specs/product-spec-oms-gifts.md)
- Design: [ports-v1](../../plans/analysis/spike-bundles-and-gifts/ports-v1.md)
- Mockup: [m22-bundles-and-kits](../../plans/mockups/oms-mvp/m22-bundles-and-kits.html)
