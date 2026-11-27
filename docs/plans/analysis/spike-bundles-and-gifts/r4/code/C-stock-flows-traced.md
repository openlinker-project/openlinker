# R4 / code / C - Stock flows traced (bundle + gift impact)

Method: primary source = this repository at worktree HEAD `9e35aec9d` (branch `zestawy-gratisy-rekonesans-c15354`), plus `gh` read of issues #3520 / #3606 / #3607 / #3624. Every claim is `file:line` + verbatim quote. Nothing was run; nothing under `docs/plans/analysis/` except `briefs/` was read.

Paths are relative to the repo root. Abbreviations: `ING` = `libs/core/src/orders/application/services/order-ingestion.service.ts`, `RES` = `libs/core/src/inventory/application/services/reservation.service.ts`, `RCS` = `libs/core/src/fulfillment/application/services/routing-commit.service.ts`, `SDS` = `libs/core/src/inventory/application/services/inventory-sale-decrement.service.ts`, `SDH` = `apps/worker/src/sync/handlers/inventory-sale-decrement.handler.ts`, `PROP` = `apps/worker/src/sync/handlers/inventory-propagate-to-marketplaces.handler.ts`, `PSINV` = `libs/integrations/prestashop/src/infrastructure/adapters/prestashop-inventory-master.adapter.ts`, `PSEFF` = `libs/integrations/prestashop/src/infrastructure/provisioners/prestashop-order-stock-effect.resolver.ts`, `PACK` = `libs/integrations/prestashop/src/domain/types/prestashop-pack.types.ts`.

---

## 0. The one finding that decides most of the rest

**Every per-line key in the routed path is `orderLineId` (the source's `OrderItem.id`) with no component axis.** A bundle line exploded into N component lines therefore cannot reuse the bundle's `orderLineId` without colliding in at least five places (reservation closed-line gate, routing variant map, work-line uniqueness, sale-decrement idempotency key, hold consume). The two possible models:

- **(A) synthetic component line id** (e.g. `{bundleLineId}::{componentVariantId}`) + a `parentOrderLineId` / `quantityPerBundle` carried on the reservation and work line. Every existing per-line key keeps working unchanged; what breaks is every place that maps a work line BACK to the order snapshot by `orderLineId` (sale-decrement handler, order edit, sale reversal, bench "Part of" label).
- **(B) keep the bundle `orderLineId`, add `componentVariantId` to every key.** Touches `UQ_fulfillment_work_lines_work_order_line`, the published `RoutingAssignment` plugin port (no variant field), `checkRoutingPlanConservesQuantities`, `buildSaleDecrementIdempotencyKey`, `closeForOrder({orderLineIds})`.

Code favours (A): it changes no unique index and no published port. D3/#3606 says only "carrying a reference to the order line it came from" and does not choose. **This is the first D3 gap.**

---

## (a) Routed order line: ingestion -> reservation -> routing -> work -> bench -> decrement -> shipment -> relay

### a1. Ingestion builds the live Order from snapshot + edit overlay
`ING:651-664`
```ts
const persisted = await this.orderRecordService.persistOrder(channelOrder, connectionId, ...);
const order = applyOrderEditsToOrder(channelOrder, persisted?.orderEdits ?? null);
```
Everything downstream (reservation, routing, mirror) uses `order` (`ING:657-663`: "everything BELOW works from the live Order, not the snapshot"). `persistOrder` keeps writing the CHANNEL line (bundle SKU, bundle price) into `order_records.orderSnapshot` and `order_line_items` - D3 "order line keeps the bundle" is already true with **zero change**.
- Bundle change: none here. The explode must happen AFTER this, not in the snapshot.
- Hook: yes - the `order` value is the single input to both reservation and routing.

### a2. Advisory reservation
`ING:2236-2242`
```ts
const lines: ReserveOrderLineInput[] = order.items
  .filter((item) => Boolean(item.productId) && item.quantity > 0)
  .map((item) => ({ orderLineId: item.id, productId: item.productId,
    productVariantId: item.variantId ?? null, quantity: item.quantity }));
```
`RES:141` - one call, one transaction for the whole order:
```ts
const granted = await this.reservations.claimHeld(claims);
```
`libs/core/src/inventory/infrastructure/persistence/repositories/reservation.repository.ts:105-117` sorts and runs every claim in ONE `dataSource.transaction`; `:550` throws `InsufficientAvailabilityError` - so the claim is all-or-nothing **per order**, not per bundle line.

Idempotency key, `libs/core/src/inventory/infrastructure/persistence/entities/reservation.orm-entity.ts:55-58`:
```ts
@Index('UQ_reservations_active_line', ['orderRecordId', 'orderLineId', 'inventoryItemId'], {
  unique: true, where: `"status" = 'held'` })
```
Closed-line gate is LINE-scoped, `RES:164-173`:
```ts
for (const row of rows) { if (row.status !== 'held') { closed.add(row.orderLineId); } }
```
Explicit-position hook, `RES:213-215`:
```ts
if (line.inventoryItemId !== undefined) { return line.inventoryItemId; }
```
- Bundle change: map one bundle item to N `ReserveOrderLineInput` (component `productId`/`productVariantId`, `quantity = perBundle x ordered`).
  - Under (B) the unique index would accept N rows (different `inventoryItemId`), but the closed-line gate would treat the whole bundle as closed as soon as ONE component's hold was consumed, so a re-poll skips the remaining components as `already-closed` (silent loss of holds).
  - Ambiguity fallback in ingestion drops by `orderLineId` (`ING:2281`: `const ambiguous = new Set(error.ambiguities.map((a) => a.orderLineId));`) - with (A) ids, an ambiguous component must drop its siblings too, or the bundle is half-held.
  - Shortfall: ingestion swallows `InsufficientAvailabilityError` (`ING:2299-2304` "the order is unaffected and no hold was recorded") - nothing "holds the line and names the component" (#3607 AC). That naming must come from the router (a3).
- Hook: **partial** - the `lines` mapping is the single explode point and `claimHeld` already gives atomicity (stronger than D3 asks: whole order). No column links a reservation to a bundle (stated in #3607).

### a3. Routing
`libs/core/src/orders/domain/project-order-for-routing.ts:47-54`
```ts
lines: order.items.map((item) => ({ orderLineId: item.id,
  productVariantId: item.variantId ?? item.productId, quantity: item.quantity })),
```
Router demand is aggregated per variant - `libs/oms/src/routing/evaluate-routing.ts:265-271`:
```ts
for (const [variantId, quantity] of demandByVariant(input)) {
  if (availableAt(facts, candidate.locationId, variantId) < quantity) { return false; }
```
`RoutingAssignment` carries NO variant - `libs/core/src/fulfillment/domain/types/routing.types.ts:149-155`:
```ts
export interface RoutingAssignment { readonly orderLineId: string; readonly locationId: string | null;
  readonly connectionId: string | null; readonly deliveryMethod: string | null; readonly quantity: number; }
```
and the commit rebuilds the variant from a Map keyed by `orderLineId`, `RCS:200-203`:
```ts
const variantByOrderLineId = new Map(
  routingInput.lines.map((line) => [line.orderLineId, line.productVariantId]));
```
- Bundle change: explode in `projectOrderForRouting` (component lines). Router stock math is already correct at component grain (shared component across a bundle and a plain line sums correctly via `demandByVariant`).
  - Under (B) the Map collapses N components to the last one -> every work line would carry the same variant. (A) is mandatory here unless the published `RoutingAssignment` port grows a field.
  - `line-split` / `quantity-split` rules can place components of one kit in two locations = two parcels for one kit. D3 is silent.
  - Unfulfillable reasons come back per `orderLineId` (`evaluate-routing.ts:320-327`), which is how "names that component" can be met - but a synthetic id must be translated back to a component name for UF-L copy.
- Hook: **yes** (`projectOrderForRouting` is the single shared projection; the router is grain-agnostic).

### a4. FulfillmentWork creation
`RCS:524-541`
```ts
const existing = bucket.lines.get(assignment.orderLineId);
...
bucket.lines.set(assignment.orderLineId, { orderLineId: assignment.orderLineId, productVariantId, totalQuantity: assignment.quantity });
```
Uniqueness is `(work, orderLine)` - `libs/core/src/fulfillment/domain/exceptions/duplicate-fulfillment-work-line.error.ts:4-6`: "`UQ_fulfillment_work_lines_work_order_line`. One order line participates in one work object exactly once". `FulfillmentWorkLine` (`libs/core/src/fulfillment/domain/types/fulfillment-work.types.ts:63-74`) has `orderLineId, productVariantId, totalQuantity, ...` and no parent/product id.
- Bundle change: with (A) nothing in grouping changes; add nullable `parentOrderLineId` + `quantityPerBundle` columns to `fulfillment_work_lines` (ADR-054 amendment). With (B) the unique index and grouping must change.
- Hook: yes for (A).

### a5. Bench verification
`libs/core/src/fulfillment/application/services/fulfillment-verification.service.ts:108-116` - keyed on the work LINE id, not the order line:
```ts
const line = work.lines.find((candidate) => candidate.id === input.workLineId);
```
Bench rows are built from the work line's variant, `apps/api/src/bench/application/services/bench-parcel.service.ts:879-901`:
```ts
const variantIds = [...new Set(work.lines.map((line) => line.productVariantId))];
... name: product?.name ?? null, sku: variant?.sku ?? null, ean: variant?.ean ?? null,
```
- Bundle change: none for scanning/counting/auto-close - a component work line shows the component's name/EAN/bin automatically. Only the "Part of: <bundle> x N" label needs `parentOrderLineId` + a read of the order snapshot item.
- Hook: **yes, already component-ready**.

### a6. Sale decrement (product master)
Key, `libs/core/src/inventory/domain/types/inventory-sale-decrement.types.ts:125-131`:
```ts
export function buildSaleDecrementIdempotencyKey(ownerConnectionId, workId, orderLineId): string {
  return `sale:${ownerConnectionId}:${workId}:${orderLineId}`; }
```
Lines come from the WORK but `productId` comes from the ORDER item, `SDH:91-116`:
```ts
const itemsById = new Map(record.orderItems.map((item) => [item.id, item]));
for (const line of work.lines) { ... const item = itemsById.get(line.orderLineId);
  if (item === undefined) { this.logger.error(`... is missing from order ...; its stock was NOT lowered`); continue; }
  lines.push({ orderLineId: line.orderLineId, productId: item.productId, productVariantId: line.productVariantId === item.productId ? null : line.productVariantId, quantity });
```
Owner is resolved from `productId`, `SDS:136-137`:
```ts
const productIds = [...new Set(input.lines.map((line) => line.productId))];
const positions = await this.inventoryRepository.findLiveOwnerPositions(productIds);
```
Hold consume is per `orderLineId`, `SDS:615-618` -> `closeForOrder({orderRecordId, ... orderLineIds})`.
- Bundle change:
  - (A): `itemsById.get(syntheticId)` misses -> "its stock was NOT lowered" for EVERY component (missing decrement, logged). Fix: work line must carry the component `productId` (or the handler resolves variant -> product), and the handler must not require the line to exist in `orderItems`.
  - (B): `productId` would be the BUNDLE product while `productVariantId` is the component -> owner lookup on the wrong product; and all components share one `sale:` key -> the second component is DEDUPLICATED (missing decrement); and the first settled component's `consumeHold` closes every component's hold of that line.
- Hook: no - needs a change either way (handler + possibly `SaleDecrementLineInput`).

### a7. Shipment lines
`libs/core/src/shipping/application/services/shipment-line.service.ts:109-119` reads `order.items` (`lineId: item.id, variantId: item.variantId ?? null`).
- Bundle change: none - shipment lines stay at bundle order-line grain, which matches D3 "channel keeps the bundle". Caveat: a kit split across two parcels (a3) attributes the full ordered quantity per shipment (already-documented lossy behaviour).
- Hook: n/a (unchanged).

### a8. Dispatch relay
Claimed per WORK (`claimDispatchRelay(workId, at)`, `libs/core/src/fulfillment/domain/ports/fulfillment-work-repository.port.ts:798`), relay is order-level status.
- Bundle change: none.

### a9. Side paths that also key on `orderLineId`
- Order edit cancel, `libs/core/src/fulfillment/application/services/fulfillment-order-edit.service.ts:77-80`: `work.lines.filter((line) => line.orderLineId === input.orderLineId)` then compares summed component units against the BUNDLE `newQuantity` - wrong unit under (B), finds nothing under (A). Needs `quantityPerBundle` scaling.
- Sale reversal for an edit, `libs/core/src/inventory/application/services/inventory-sale-reversal.service.ts:159-160`: `rows.filter((row) => row.orderLineId === input.orderLineId)` with `units` in bundle units vs component-unit rows.
- Returns restock resolves by SKU / resolved variant of the RETURN line (`libs/core/src/returns/application/services/return-custody.service.ts:908` "Fallback: the sku, resolved through IProductsService"). A returned kit carries the bundle SKU -> restocks the bundle variant, which has no stock of its own. D3/#3607 do not mention returns.

---

## (b) Master stock change -> inventory_items -> ATP -> channel offers

### b1. Write + enqueue (per changed variant row)
`libs/core/src/inventory/application/services/inventory.service.ts:96-121`
```ts
if (previous && previous.availableQuantity === upserted.availableQuantity) { ... return upserted; }
const writeEventToken = upserted.updatedAt.toISOString();
await this.jobQueue.enqueue({ type: 'inventory.propagateToMarketplaces', connectionId: sourceConnectionId ?? SYSTEM_CONNECTION_ID,
  payload: { productId: upserted.productId, variantId: upserted.productVariantId, inventoryUpdatedAt: writeEventToken }, ... });
```
- Bundle change: a component write must ALSO enqueue a propagation for every bundle variant containing it (reverse index component -> bundles). Same for every place that moves ATP without a stock write: hold claim/close (`master-absorbed-reservation.service.ts` `enqueuePropagation`), stale marking.
- Hook: no reverse fan-out exists.

### b2. ATP read (global scope, per variant)
`PROP:113-116`
```ts
const [availability] = await this.availabilityService.getPromisableQuantities({ variantIds: [payload.variantId], scope: { kind: 'global' } });
```
`libs/core/src/inventory/application/services/availability.service.ts:99-140` reads positions + published holds per variant; `libs/core/src/inventory/domain/types/availability.types.ts:128-138`:
```ts
export function computeAtp(totalAvailable, olReservedPublished, buffer, zeroThreshold = 0): number {
  return applyStockSafetyBuffer(Math.max(0, totalAvailable - olReservedPublished), buffer, zeroThreshold); }
```
A variant with no positions is a KNOWN zero (`PROP:144-155`), `unknown` suppresses the publish (`PROP:126-140`).
- Bundle change: `getPromisableQuantities` for a bundle variant must compute `min_c floor(globalATP_c / q_c)` from components (unbuffered global answers), `unknown` if any component is unknown. **Today a bundle variant with no own positions would publish a known 0**, and a bundle variant that DOES have its own master position (a PS pack row, a simple product in the shop) would publish that row - D3 does not say which wins.
- Hook: **yes** - `IAvailabilityService` is the single seam (ADR-061, `no-direct-buffer-read.spec.ts`), so the derivation can live in one place.

### b3. Buffer / zero threshold (channel Control, once)
Applied downstream per connection, `libs/core/src/inventory/application/services/inventory-sync.service.ts:99` (`applyPublishControlsBatch`); global scope carries no buffer (`availability.service.ts:237-258` only the `channel` arm reads `stockSafetyBuffer`).
- Bundle change: none if the bundle number is derived from GLOBAL component ATP and the channel buffer is applied once to the bundle number. Wrong if component ATP were read at channel scope (buffer applied per component, then again on the bundle).
- Hook: yes.

### b4. Freshness guard (#2617)
`inventory-sync.service.ts:240`: `if (!isWritableQuantityObservation(observedAt, lastWritten))` - refuses a strictly older observation per OFFER, token = `payload.inventoryUpdatedAt` of the row that triggered the job (`PROP:207-228`).
- Bundle change: a bundle offer would receive tokens from DIFFERENT component rows; a job triggered by component D (older `updatedAt`) but executed after component C's job is refused even if it read the newer aggregate. Token for a bundle propagation must be `max(updatedAt)` over its components at read time.
- Hook: no.

### b5. Stale pause (#1689)
Trigger path checks only the variant itself, `libs/core/src/listings/application/services/stale-offer-pause.service.ts:90-104`:
```ts
const variant = await this.productsService.getVariant(variantId);
if (!variant || variant.isStale !== true || !variant.staleAt) { ... continue; }
const offerMappings = await this.identifierMapping.getExternalIds(CORE_ENTITY_TYPE.Offer, variantId);
```
Sweep backstop joins offers to the mapped variant's own flag, `libs/core/src/listings/infrastructure/persistence/repositories/offer-mapping.repository.ts:754-776`: `.innerJoin('product_variants', 'pv', 'pv."id" = mapping."internalId"') ... .andWhere('pv."isStale" = true')`. Propagation guard `PROP:186-198` likewise checks only `payload.variantId`.
- Bundle change: "a stale component makes the whole bundle unsellable" (#3520) needs (i) the trigger to expand a stale component to its bundles, (ii) the sweep to join through the components table, (iii) the propagation stale-guard to treat a bundle with a stale component as stale. Note the pause zeroes offers with `quantity: 0`; the bundle ATP derivation returning 0 for a stale component is a second, independent route to the same number and must agree.
- Hook: no.

---

## (c) PrestaShop packs and `OrderCreateStockEffect` today

### c1. Pack availability (read side only)
`PACK:211-232` (`derivePackAvailability`):
```ts
if (components.length === 0) { return null; }
if (unreadableComponentCount > 0) { return 0; }
for (const component of components) { const available = availability.get(packComponentStockKey(...));
  const packsFromComponent = Math.floor(Math.max(0, available ?? 0) / component.quantity); limit = Math.min(limit, packsFromComponent); }
```
Mode, `PACK:150-170` (`resolvePackStockMode`): PS `0`->`pack-only`, `1`->`components`, `2`->`both`, unresolvable->`both`; `0` and `3` defer to `PS_PACK_STOCK_TYPE` (`packStockTypeDefersToShop`).
Wired into `listInventory` only, `PSINV:329-343`: the pack's position is reported with the derived quantity (`id: \`pack:${psProductId}\`` when it has no own row). `getInventory` is explicitly NOT pack-aware (`PSINV:217-222`: "this method reports a pack's own stock row (which PrestaShop never decrements when a component sells)").

### c2. `adjustInventory` (write side) has NO pack awareness
`PSINV:887-960`: resolves `psProductId`, reads `stock_availables` for `(id_product, id_product_attribute)`, throws on 0 rows (`throwForAbsentStockRecords`) or `depends_on_stock = 1`, otherwise
```ts
const newQuantity = alreadyApplied ? current : Math.max(0, current + adjustment.quantity);
await this.httpClient.updateResource('stock_availables', String(row.id), { ...row, id: String(row.id), quantity: String(newQuantity) });
```
i.e. it writes the PACK's own row. No `cache_is_pack` check, no component write.

### c3. `OrderCreateStockEffect`
Contract, `libs/core/src/orders/domain/ports/capabilities/order-create-stock-effect.capability.ts` ("A destination that declares nothing keeps the holds until dispatch - the pre-existing behaviour, an under-sell and never an oversell"); probe `lowersStockOnOrderCreate(adapter)` returns `false` on anything but a declared `true`.
- PrestaShop answers per created order: `PSEFF:94-121` -> `false` for an empty product list, unreadable history, a `PS_OS_CANCELED`/`PS_OS_ERROR` initial state, any `depends_on_stock = 1`, and **any pack** (`PSEFF:200-208`: `custom: { cache_is_pack: 1 }` ... `return rows.length > 0;`; header `PSEFF:29-30`: "a pack, whose decrement lands on the pack row, its components, or both, depending on its pack stock type (#2598)").
- WooCommerce: `woocommerce-order-processor.adapter.ts:252-254` `return Promise.resolve(this.lastCreateReducedStock === true);` (from `_reduced_stock` on created lines). No pack/bundle concept in the adapter (only `type?: 'simple' | 'variable' | 'grouped' | 'external'`, `woocommerce-product.types.ts:20`).
- Shoper: `shoper-order-processor.adapter.ts:199-202` returns the shop setting `decrementsStockOnOrder`. No bundle concept.
- Consumer: `libs/core/src/inventory/application/services/master-absorbed-reservation.service.ts:106-107,201-212`: positions are looked up only for `input.productIds` (the order LINE products); a hold on any other position is `'unknown-position'` and KEPT. Line-scoped close requires every held row on the line to be a candidate (`:115-128`).

### c4. Double / missing decrement verdict
**No double decrement path exists in code today. There IS a missing-decrement path, and D3 adds two more if implemented naively.**

1. **Today, routed OMS order for a PS pack in `components` mode (or `both`)**: the work line is the pack variant; `SDS` calls `adjustInventory(-n)` on the pack product -> c2 writes the pack's own `stock_available` row, components untouched. In `components` mode that row is ignored by `resolvePackQuantity` (`PSINV:400-417` returns `derived`), so the mirror re-read reports an unchanged quantity: **the sale is lost - components and pack keep selling (missing decrement / oversell)**. In `both` the pack drops via `min(own, derived)` but standalone component offers are not lowered. In `pack-only` it is correct. If the pack has no own row, `throwForAbsentStockRecords` refuses -> blocked, visible. Possibly flagged as a clamp only if the mirrored derived quantity was below the sold units (`SDS:400-405`, "logged and persisted ... never raised as an operator-facing block").
2. **Today, non-routed mirror to PS**: PS `validateOrder` lowers components/pack itself; OL does no sale decrement; `PSEFF` answers `false` for a pack so OL holds stay until dispatch -> under-sell window, never double.
3. **D3 + model (B)**: shared `sale:{owner}:{workId}:{bundleLineId}` key dedups components 2..N -> missing decrement; first settled component closes all components' holds of the line -> transient over-promise.
4. **D3 + model (A)**: `SDH:97` cannot find the synthetic line in `orderItems` -> every component logged "NOT lowered" -> missing decrement until the handler is changed.
5. **D3 bundle defined on a variant that is itself a PS pack** (D3 forbids importing the composition, but nothing forbids marking a PS pack variant as an OL bundle): the master keeps writing `derivePackAvailability` into the bundle variant's own position while OL derives its own number - two writers for one published quantity. Only safe if OL ignores the bundle variant's own positions; D3 does not say so.
6. **Absorbed-hold path with D3**: component holds sit on positions not in the line's `productIds`, so they are `unknown-position` and KEPT (under-sell until dispatch consume). Safe, not double. But: if a D3 bundle variant maps to a PS product that is NOT a pack (operator kept a simple product as the shop listing), PS decrements the bundle SKU row on mirror create, not the components - component stock in PS is never lowered for that sale. That is the OL-defined composition and the master's stock model disagreeing; D3 assumes the master holds component stock only.

---

## (d) "Add a gift line": automation vocabulary + edit overlay

Actions, `libs/core/src/automation/domain/types/automation-action.types.ts:43-50`:
```ts
export const AutomationActionValues = ['issue-sales-document','dispatch-shipment','relay-status-to-source','send-email','place-hold','release-hold'] as const;
```
Payload union `:102-132` - no line/product action. Max 3 steps (`:81`). Irreversibility map `:66` (`AUTOMATION_ACTION_IS_IRREVERSIBLE`).
Conditions, `libs/core/src/automation/domain/types/automation-condition.types.ts:44-49`:
```ts
export const AutomationConditionFieldValues = ['sourceConnection','orderCountry','orderTotalGross','holdReason'] as const;
```
Facts `automation-facts.types.ts:52-73`: `sourceConnectionId, country, totalGross, currency, holdReason` - no line/SKU/quantity fact. Legality `automation-legality.types.ts:121-128`: `order.received` allows only `send-email` and `place-hold`; legal fields `:193` `'order.received': ['sourceConnection', 'orderCountry', 'orderTotalGross']`.
Trigger timing: `ING:671` `notifyOrderReceived(persisted, new Date())` runs synchronously (dispatch executes in-process, `automation-dispatch.service.ts:140` `await executor.execute(...)`) BEFORE `resolveRoutingTarget` (`ING:689`) and reservation (`ING:699`), but AFTER `order` was computed (`ING:664`).

Edit overlay, `libs/core/src/orders/domain/types/order-edits.types.ts:75-95`:
```ts
export interface OrderLineEdit extends OrderEditStamp { /** Absolute new quantity; always lower than the channel's. */ readonly quantity: number; }
export interface OrderEdits { readonly v: 1; readonly rev: number; readonly address?: ...; readonly lines?: Readonly<Record<string, OrderLineEdit>>; readonly deliveryMethod?: ...; readonly discount?: ...; }
```
`:286-288` `return Math.min(edit.quantity, channelQuantity);` - the overlay can only LOWER existing channel lines; there is no section to ADD a line. `FulfillmentWorkRepositoryPort` (`fulfillment-work-repository.port.ts:535-1072`) has `create`, `recordLineProgress`, `cancel`... but no method to add a line to an existing work.

What "add a gift line" needs, minimally:
1. A new overlay section (e.g. `addedLines: Record<newLineId, {productId, variantId, quantity, unitPrice: 0, reason: 'gift', ruleId?}>`) + `readOrderEdits` / `applyOrderEditsToOrder` / `applyOrderEditsToSnapshot` merge that APPENDS items; totals unchanged at price 0; `channelSnapshot` stays clean so documents can choose to show or hide it.
2. A writer: either an operator edit route (like `/edits/lines`) or a new automation action `add-line` (+ legality on `order.received` only, + `AUTOMATION_ACTION_IS_IRREVERSIBLE` entry - it is irreversible once decremented, + condition fields like `orderContainsVariant` / `lineQuantity`, + facts with lines).
3. Ordering: if added by automation on T9, ingestion must recompute `order` after the trigger (or the action runs before `ING:664`), else the gift misses reservation/routing for that ingestion; later re-polls reserve it (reservation re-runs every poll) but routing does not re-run for a routed order, and there is no add-to-work path -> gift never reaches the bench. Must be before routing, or force cancel + re-route.
4. Gift-as-bundle-component alternative: a gift that always ships with a kit is just a component with price 0 in the kit definition - no overlay needed. A conditional gift (threshold, promo window) needs the overlay.
5. Sale decrement for the gift line works unchanged if it is a real order item (`SDH:97` finds it).

---

## D3 (#3520) gaps

1. **Component line identity not decided** (synthetic id vs extra key column). Code forces this choice: `RoutingAssignment` (published plugin port) has no variant, `variantByOrderLineId` collapses, `UQ_fulfillment_work_lines_work_order_line`, `sale:` key, `closeForOrder({orderLineIds})`, closed-line gate all key on `orderLineId`.
2. **Sale decrement is not in D3's "explode points"** (only reservation + routing are named). `SDH:91-116` maps work lines back to `orderItems` for `productId`; it must change in either model or every component decrement is lost/deduped.
3. **All-or-nothing grain**: D3 says per bundle line; code is per ORDER (`claimHeld` single transaction) and the failure is swallowed (`ING:2299-2304`) - so "a shortfall on one component holds the line and names that component" has no code path at reservation time; it can only come from router `unfulfillable` (UF-L / `routing-refused`), and only for OMS-routed orders.
4. **Bundle variant's own positions**: D3 silent on what happens when the bundle variant has its own master stock row (PS pack `listInventory` derived row, or a shop simple product). Needs "OL bundle definition overrides; own positions ignored for ATP and never reserved".
5. **Propagation fan-out**: no reverse component -> bundle trigger for stock writes, hold claim/close, absorbed consume, stale marking.
6. **Freshness token** for bundle offers must be max over components (#2617 guard refuses otherwise).
7. **Stale**: trigger, sweep join and propagation guard all check the mapped variant only; three code sites to extend.
8. **Order edit / sale reversal / cancellation** use bundle units vs component units - `quantityPerBundle` scaling needed (`fulfillment-order-edit.service.ts:77-80`, `inventory-sale-reversal.service.ts:159-160`).
9. **Returns**: a returned kit restocks by SKU/resolved variant -> bundle variant; D3 does not cover explode-on-restock.
10. **Split kits**: `line-split`/`quantity-split` can ship one kit in two parcels; D3 silent.
11. **Non-routed (mirror) path**: D3 explodes "at reservation and routing time"; on a non-OMS install (no routing) reservations would be component-grain while the destination shop receives the bundle SKU and decrements whatever IT thinks the bundle is. Holds stay until dispatch (safe), but D3 should state the mirror path is out of scope or define it.
12. **PS pack sale today (no D3) loses the decrement in `components` mode** - a live defect independent of D3, worth fixing or refusing (`adjustInventory` on a `cache_is_pack=1` product in non-`pack-only` mode should refuse, like `depends_on_stock`).

---

## Minimal pilot path (smallest change set that stays correct)

1. Model (A): `bundle_components(bundleVariantId, componentVariantId, quantityPerBundle)` in `inventory` (or `products`); component line id = `{bundleLineId}::{componentVariantId}`; carry `parentOrderLineId` + `quantityPerBundle` + component `productId` on reservation rows and `fulfillment_work_lines` (two nullable columns each).
2. One pure `explodeOrderItems(items, bundleDefs)` used by BOTH `reserveOrderInventory` (`ING:2236`) and `projectOrderForRouting` (`project-order-for-routing.ts:47`) - no other explode point.
3. `SDH`: resolve component `productId` from the work line, not `orderItems`; `SDS` unchanged.
4. `IAvailabilityService`: bundle variant -> derived ATP from unbuffered global component answers; any component unknown -> unknown; bundle's own positions ignored.
5. Reverse fan-out: after a component propagation, enqueue the bundle variants' propagations (same job type, token = max component `updatedAt`).
6. Stale: extend `pauseOffersForVariants` input expansion + sweep join.
7. Bench: render `parentOrderLineId` as "Part of". Nothing else on the bench.
8. Guard: refuse marking a PS pack variant (or any variant with its own non-zero master stock) as an OL bundle in the pilot; separately make PS `adjustInventory` refuse a pack in non-`pack-only` mode.
9. Defer: edit/reversal scaling, returns explode, gift lines (needs overlay `addedLines` + automation action + pre-routing ordering).
