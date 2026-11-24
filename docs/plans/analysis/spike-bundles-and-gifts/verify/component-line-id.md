# Verify: synthetic component line id `{orderLineId}~c:{componentVariantId}`

Read-only code verification, 2026-11-04, worktree `zestawy-gratisy-rekonesans-c15354`.

## Verdict

**Works, with changes at 9 sites (3 claimed + 6 the claim missed).** The storage
side is safe: every column is unbounded `text`, the one length-limited key has
headroom, nothing parses a line id. The danger is not a crash: it is that the
sites the proposal did not list keep calling with the BUNDLE line id while the
rows now carry COMPONENT ids, and every one of them treats "no row matched" as
a normal outcome. Order edits on a bundle line would silently do nothing to
works, holds and stock, and could let a quantity drop below what was picked.

One rule must be added to the proposal: **`shipment_lines` must stay on the
bundle line** (its coverage is joined back to `orderSnapshot.items`).

## 1. Columns that store an order-line id

| Column | Type / limit | Unique index | Parsed or validated? | Synthetic id OK? |
|---|---|---|---|---|
| `reservations.orderLineId` | `text` (reservation.orm-entity.ts:81-82) | `UQ_reservations_active_line (orderRecordId, orderLineId, inventoryItemId) WHERE status='held'` (:55-56) | no | yes |
| `fulfillment_work_lines.orderLineId` | `text` (fulfillment-work-line.orm-entity.ts:84-85) | `UQ_fulfillment_work_lines_work_order_line (fulfillmentWorkId, orderLineId)` (:41-42) | no | yes, if the recipe is aggregated per component (see surprises) |
| `inventory_sale_decrements.orderLineId` | `text` (inventory-sale-decrement.orm-entity.ts:49-50) | none on the column | no | yes |
| `inventory_sale_decrements.idempotencyKey` | **`varchar(255)`** (:40-41), `UQ_inventory_sale_decrements_key` (:33) | unique | prefix tests only: `startsWith('sale:')`, `'sale-reversal:'`, `'edit:'`, and `startsWith(`${ownKey}:`)` (inventory-sale-reversal.service.ts:121,165,179,192-193,232; inventory-sale-decrement.service.ts:166). Never split. | yes, see length below |
| `shipment_lines.lineId` | `text` (shipment-line.orm-entity.ts:106-107) | `UQ_shipment_lines_shipment_order_line (shipmentId, orderId, lineId)` (:49), `IDX_shipment_lines_order_line` (:54) | joined to snapshot items (shipment-line.service.ts:113-118, 223-229) | **keep bundle id** |
| `return_lines.resolvedOrderLineId` | `text` nullable (return-line.orm-entity.ts:80-81) | partial non-unique `IDX_return_lines_resolved_order_line` (:45) | resolved FROM snapshot items (return-order-line-resolution.domain-service.ts:47, 181-182) | keep bundle id |
| `order_line_items` | **has no line-id column** - keyed `orderRecordId + lineNumber` (order-line-item.orm-entity.ts:37-47) | none | - | n/a, commercial |
| invoice line `orderLineId` (issued-line snapshot jsonb) | jsonb, `item.id` (order-to-issue-invoice-command.mapper.ts:384) | - | matched against snapshot items (order-edit.service.ts:1396-1405; return-correction matching) | keep bundle id |
| order edits overlay `orderEdits.lines[<id>]` | jsonb keys = snapshot item ids (order-edits.types.ts:259, 456; order-edit.service.ts:353-386) | - | looked up in channel snapshot | keep bundle id |
| `order_changes` amendment diff `lineId` | jsonb (order-amendment-diff.ts:153-185) | - | snapshot item ids | keep bundle id |

**Key length.** Work id is `ol_fulfillmentwork_` + 32 hex = 51 chars
(fulfillment-work.repository.ts:173). Synthetic line id with an Allegro UUID =
36 + 3 + 43 (`ol_variant_`+32) = 82. Longest key:
`sale-reversal:` (14) + owner uuid (36) + `:` + 51 + `:` + 82 = **185 / 255**.
`edit:{changeId}:{lineId}:{workId}` (inventory-sale-reversal.service.ts:211)
is about 176. Headroom for a source line id is ~106 chars beyond a UUID. Fine
for Allegro, PrestaShop, WooCommerce; worth a guard if a future source mints
long line ids.

**Prefix matching is safe because of `~`.** `startsWith(`${ownKey}:`)`
(inventory-sale-reversal.service.ts:165) with ownKey `edit:{chg}:{B}` does not
match `edit:{chg}:{B~c:X}` (next char is `~`, not `:`), and the rows are
already filtered by exact `orderLineId` first (:160). A `:`-only separator
would also have been caught by that filter, but `~` is the cleaner choice.
Nothing anywhere splits a line id or a key on `:` or `~`.

## 2. Lookups of a line id in `orderSnapshot.items` / `orderItems`

| Site | What it does | With a component id |
|---|---|---|
| inventory-sale-decrement.handler.ts:91-106 | `itemsById.get(line.orderLineId)` to get `productId` | **miss**: logs "NOT lowered", `continue`; job ends `ok`, hold never consumed. Claimed site, must change. |
| shipment-line.service.ts:113-118, 223-229 | builds lines from items, coverage `deliveredByLine.get(item.lineId)` | if component ids were ever written: coverage reads 0, rollup demotes a delivered order. Keep bundle id. |
| return-order-line-resolution.domain-service.ts:47,181 | resolves a return line to a snapshot item | always yields the bundle line; fine as a commercial join |
| return-custody.service.ts:931-940 (`resolveRestockTarget`) | restocks `resolvedVariantId` (= bundle variant) | not a miss: **restocks the bundle variant**, not the components. Wrong behaviour, needs expansion. |
| order-edit.service.ts:353-386 | overlay validation against channel items | bundle id, fine |
| order-edit.service.ts:1396-1405 | discount correction: invoice line -> item by id | bundle id, fine |
| return-writes.controller.ts:799-828 | live vs edited lines by id | bundle id, fine |
| routing conservation routing.types.ts:261-296; routing-commit.service.ts:197-202, 524-537 | compares plan against `routingInput.lines`, never the snapshot | consistent if the projection expands; throws `plan-not-conserving` only on a router bug |
| reservation `closeForOrder(orderLineIds)` (inventory-sale-decrement.service.ts:620; master-absorbed-reservation.service.ts:117-170) | row-based, ids come from decrement/reservation rows | consistent |
| bench (bench-work.service.ts:395,493-514; bench-parcel.service.ts:352-356, 879-923) | work lines -> variant catalogue, never the snapshot | works; shows components (no "part of bundle" label) |
| worklist / work controller (fulfillment-worklist.service.ts:475-482; fulfillment-work.controller.ts:610-620) | passes `orderLineId` through, names from variant | works |

## 3. Places that turn order items into physical stock/fulfilment lines

Claimed and confirmed:
1. order-ingestion.service.ts:2236-2243 (reserve).
2. project-order-for-routing.ts:47-52 - one function, so it also covers the
   ingestion intercept (order-ingestion.service.ts:1158/1499), the route
   handler (fulfillment-work-route.handler.ts:453) and the dry run
   (routing-dry-run.service.ts:207).
3. inventory-sale-decrement.handler.ts:90-117.

Missed (all reachable from an operator order edit or a sync):
4. fulfillment-order-edit.service.ts:41-66 `assessForEdit` - `fulfilledByLine`
   is keyed by work-line ids (components); order-edit.service.ts:374 reads it
   by the bundle id -> 0 -> **`QUANTITY_BELOW_FULFILLED` never fires**.
5. fulfillment-order-edit.service.ts:69-84 `lowerLineQuantity` - filters work
   lines by the bundle id -> none -> returns `unrouted`, **cancels no units**
   (called from order-edit.service.ts:917).
6. reservation.service.ts:247-261 `narrowForOrder` (called from
   order-edit.service.ts:937-943) - SQL `IN (bundleId)` returns nothing,
   **holds not lowered**; target is also a bundle quantity, not
   bundle qty x component qty.
7. inventory-sale-reversal.service.ts:155-200 `reverseLineQuantity` (called
   from order-edit.service.ts:954) - `forLine` empty -> `not-applicable`,
   **no stock given back** for a lowered bundle line.
8. order-sync.service.ts:443 and :515 - `productIds` from `order.items` feed
   the post-sale master refresh and `consumeAbsorbedHolds`; component holds
   classify `unknown-position` (master-absorbed-reservation.service.ts:105-111)
   and stay held (under-sell, safe), component stock is not refreshed.
9. return-custody.service.ts:931-940 - restock needs the frozen expansion
   (bundle return -> component restock).

Not line-id sites but bundle-aware gaps found on the way:
- offer-stock-restore.service.ts:350,532-546 - cancellation republishes ATP for
  the snapshot's (bundle) variants only; component offers are not republished.
  Stock itself comes back correctly via `reverseForOrder` (row-based,
  inventory-sale-reversal.service.ts:117-150).
- order_line_items / margin: commercial bundle line; cost snapshot per bundle
  variant (order-line-cost.service.ts:57, order-ingestion.service.ts:2113).

Work unchanged with component ids (row-based): reservation claim/expiry/
shortfall, `reverseForOrder`, sale-decrement service and keys, fulfillment
progress, routing commit, bench, pack verification (keyed `workLineId`),
executor port (sends `workLineId`, never `orderLineId`,
fulfillment-execution.types.ts:76-81). No adapter sends an order-line id to a
channel.

## 4. Count

- **Must handle component ids: 9 sites** (3 claimed + 4 order-edit follow-ups
  [`assessForEdit`, `lowerLineQuantity`, `narrowForOrder`, `reverseLineQuantity`]
  + `order-sync` productIds + returns restock). Best shape: one
  "bundle line id -> frozen component lines" read used by the edit follow-ups,
  aggregating results back to the bundle line for the edit response (the FE
  keys `stock[]` by bundle line id, order-edit-review.tsx:100-155).
- **Keep working on the bundle line: ~10** (shipment_lines reconcile + coverage,
  returns resolution, invoice/fiscal mappers, invoice correction matching,
  discount correction, edits overlay, amendment diff, order_line_items, order
  sync mirror, KSeF line classifications).
- **Unchanged and correct with component ids: ~12** row-based sites above.

## Surprises

1. The failure mode everywhere is a silent no-op, never a throw: `unrouted`,
   `not-applicable`, `untouched`, "NOT lowered" + `ok`. Tests will not catch it
   unless they assert the effect.
2. Order edits are the biggest gap: four follow-ups key on the bundle id and
   all miss. The edit would report success.
3. `shipment_lines` MUST stay commercial. Writing component ids there demotes
   delivered orders via the coverage join.
4. The recipe must be aggregated per component variant before expansion: a
   bundle listing one component twice would produce a duplicate
   `(work, orderLineId)` / `(order, line, position)` key. Routing commit sums
   repeats (routing-commit.service.ts:477-537), but the reservation claim does
   not expect duplicate ids.
5. The decrement handler's `productVariantId === item.productId ? null` rule
   (inventory-sale-decrement.handler.ts:111-114) means the expansion must carry
   the component's `productId`, not only its variant id.
6. Nothing parses the id, so the bundle line id must live in the frozen
   expansion table; never recover it by splitting on `~c:`.
