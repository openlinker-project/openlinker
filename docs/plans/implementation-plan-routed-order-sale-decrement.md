# Implementation Plan — Routed orders lower product-master stock (#3453)

## 1. Understand

**Goal.** When OpenLinker's OMS routes an order (the order stays in OL and is never
created in the product master), lower the product master's stock once per work
line. After a successful write, persist the new quantity and propagate it to every
marketplace right away. Today nothing lowers it, so the last unit oversells.

**Layer.** CORE (inventory application service, persistence, migration) + host
(worker job handler) + fulfillment-authority vocabulary (one new attention state)
+ a small FE mirror update.

**Non-goals (named follow-ups).**
- Closing the ADR-061 advisory hold when the decrement lands (#3480). Until #3480
  lands, a routed order's `published` hold AND the decrement both reduce ATP.
  This slice does not make that worse for `omp_fulfilled` orders (they are
  `diagnostic`); it does for `ol_managed_carrier` ones, which is exactly what
  #3480 closes.
- Giving stock back on cancellation (#3479).
- ADR-061 / DESIGN wording "OL never decrements" (#3483).
- Two warehouses (#3454). v1 matches the work's location OR pooled (`NULL`)
  positions.
- An FE panel listing decrement rows. The order surface gets the attention badge
  only.

## 2. Research (what we reuse)

| Need | Existing piece |
|---|---|
| Report-don't-perform enqueue from a leaf | `deriveFulfillmentDispatchEnqueueIntents` (`fulfillment-dispatch-enqueue.types.ts`) |
| Two routing sites | `OrderIngestionService.enqueueRoutedDispatchJobs`, `FulfillmentWorkRouteHandler` |
| Adapter call + deterministic key + outcome classification | `ReturnCustodyService.writeMasterStock` + `restock-outcome.domain-service.ts` |
| Live positions per product/variant | `InventoryRepositoryPort.findLivePositionsByProductIds` (widen to carry `sourceConnectionId` + `availableQuantity`) |
| Persist quantity + enqueue propagation | `IInventoryService.setInventory(item, sourceConnectionId)` |
| Order attention write | `IOrderRecordService.markOmsAttention(orderId, producer, outcome)` |
| Durable at-most-once claim | `INSERT … ON CONFLICT DO NOTHING` idiom (`fulfillment_progress_claims`, #2360) |
| Worker handler composing work + order data into core | `FulfillmentWorkDispatchHandler` |

## 3. Design

### Flow

```
routing commit → status 'routed' { works[] }
  ├─ enqueue fulfillment.work.dispatch   (existing, #2955)
  └─ enqueue inventory.saleDecrement     (NEW, one per work)   dedupe inventory:sale-decrement:{workId}
         │
worker InventorySaleDecrementHandler
  reads work (IFulfillmentWorkQueryService) + order record (source connection, items → productId)
  → IInventorySaleDecrementService.decrementForWork(input)          (core, inventory)
       per line:
         resolve owner = distinct sourceConnectionId of live positions at work location ∪ pooled
           0 positions             → blocked 'no-position'
           NULL / 'legacy'         → blocked 'unattributed-owner'
           >1 owner                → blocked 'ambiguous-owner'
           owner == order source   → skipped 'source-is-owner'   (persisted, not silent)
         resolve owner's InventoryMaster adapter (BEFORE claiming; failure → retryable throw, nothing written)
         claim row  key sale:{owner}:{workId}:{lineId}   status 'pending'
           conflict: existing terminal row → report it, never re-call
                     existing 'pending'    → mark 'in_doubt' (crash between claim and settle)
         adjustInventory({productId, variantId, quantity:-n, reason:'order_sale', idempotencyKey})
           (never passes OL's locationId — Subiekt reads it as magazynId)
           success → 'applied' | 'deduplicated'; clamp flag when n > position.availableQuantity
                     setInventory(new quantity, owner) → enqueues inventory.propagateToMarketplaces
           MasterProductNotFoundError → blocked 'master-product-not-found'
           other throw                → 'in_doubt' (OL cannot tell a pre-write refusal from a
                                         mid-write failure; never auto-retried)
  → handler writes order attention 'stock-decrement-blocked' (producer 'sale-decrement'),
    level-triggered from ALL the order's decrement rows (blocked / in_doubt / clamped raise it).
```

### Key decisions

1. **A job, not an inline call.** Routing already runs inside ingestion's fail-open
   try; an adapter round trip there would widen that window and a failure would be
   unretryable. A job gives retries, lanes and an audit row. Lane `realtime`: the
   cost of starvation is an oversell on another channel.
2. **Postgres claim is the guarantee, the adapter key is a second layer.** The
   claim is written before the boundary, so a crash leaves `pending` → `in_doubt`,
   never a second decrement. This holds when the adapter reports
   `idempotency: 'unsupported'`.
3. **Owner resolution is per line** from `inventory_items.sourceConnectionId`,
   never a global single `InventoryMaster` (unlike returns restock), because v1
   allows two product masters (#3457).
4. **The source-is-owner skip is the safety net against a double decrement of
   every storefront sale** (routing applies to every OrderSource). Persisted as a
   `skipped` row.
5. **No new module edge.** `inventory` already imports `integrations` and
   `products`. The work/order read composes in the worker (`#3171` precedent), so
   `inventory` takes no `fulfillment`/`orders` edge, and `fulfillment` stays a
   zero-sibling-edge leaf (only a pure derivation is added there).

### Persistence — `inventory_sale_decrements` (migration `1902000000000`)

| column | type | notes |
|---|---|---|
| id | uuid PK | |
| idempotencyKey | varchar UNIQUE | `sale:{owner}:{workId}:{lineId}` — the enforcement |
| orderId | text | by value, no FK |
| workId | text | by value, no FK |
| orderLineId | text | |
| productId, productVariantId | text / text null | |
| ownerConnectionId | uuid null | null for a pre-owner block |
| quantity | int | CHECK > 0 |
| status | varchar | `pending \| applied \| deduplicated \| skipped \| blocked \| in_doubt` |
| reason | varchar null | closed union below |
| detail | text null | adapter's own sentence, verbatim |
| clamped | boolean default false | |
| idempotencyUnsupported | boolean default false | |
| resultingQuantity | int null | |
| createdAt / updatedAt | timestamptz | |

Index `(orderId)` for the attention recompute. For blocks raised before an owner is
known the key is `sale:unresolved:{workId}:{lineId}` so a retry still dedups.

Reason union `InventorySaleDecrementReason`: `source-is-owner | no-position |
unattributed-owner | ambiguous-owner | master-product-not-found | master-error`.

## 4. Steps

1. `libs/core/src/inventory/domain/types/inventory.types.ts` — add `'order_sale'`
   to `InventoryAdjustmentReasonValues`; add `InventoryOwnerPosition`.
   *AC:* adapters' reason logging still type-checks (PrestaShop/WooCommerce log the reason only).
2. `inventory/domain/types/inventory-sale-decrement.types.ts` — status/reason unions,
   `buildSaleDecrementIdempotencyKey`, pure `resolveSaleDecrementOwner(positions, locationId)`
   and `deriveSaleDecrementAttention(rows)`. Spec colocated.
3. `inventory/domain/entities/inventory-sale-decrement.entity.ts` + repository port
   `inventory-sale-decrement-repository.port.ts` (`claim`, `settle`, `findByKey`,
   `findByOrderId`) — no `save`.
4. ORM entity + repository + migration `apps/api/src/migrations/1902000000000-create-inventory-sale-decrements.ts`.
5. `InventoryRepositoryPort.findLiveOwnerPositions(productIds, variantIds)` + impl.
6. `IInventorySaleDecrementService` + `InventorySaleDecrementService`; token in
   `inventory.tokens.ts`; register in `InventoryModule`. Unit spec covering every arm.
7. `fulfillment-dispatch-enqueue.types.ts` — `deriveSaleDecrementEnqueueIntents` (pure).
8. `sync-job.types.ts` — job type `inventory.saleDecrement` + `InventorySaleDecrementPayloadV1`;
   FE `sync-jobs.types.ts` mirror; handler registration in `realtime`.
9. Enqueue from `OrderIngestionService.enqueueRoutedDispatchJobs` and
   `FulfillmentWorkRouteHandler` (never throws, per-work log). Specs: routed ⇒ enqueued,
   and **no `syncOrder` call** (regression AC).
10. `apps/worker/src/sync/handlers/inventory-sale-decrement.handler.ts` + spec.
11. Attention: add `'stock-decrement-blocked'` (producer `'sale-decrement'`, surface
    `order`, badge `blocked`) to `authority-attention-reason.types.ts` + spec counts;
    FE `attention-reason.ts` + copy; `check-attention-reason-mirror.mjs` stays green.
12. Docs: architecture-overview § Inventory bullet.

## 5. Validate

- Hexagonal: adapter reached only through `InventoryMasterPort` via `IIntegrationsService`. ✅
- Leaf property: `fulfillment` gains a pure function only; barrel-purity allow-sets unchanged. ✅
- No-injection guard: nothing under `libs/core/src/fulfillment` injects anything new. ✅
- Migration required (new table) — `migration:show` to be run by the user.
- Tests: unit specs per step. The end-to-end regression (last unit on Allegro →
  master 0 → Erli offer updated) is covered at service level (adjust → `setInventory`
  → propagation enqueue); a full worker int-spec is listed for CI.

## Decisions taken during implementation

- **`in_doubt` is never retried automatically**, and every `in_doubt` line gets a
  best-effort re-read of the master's stock (`listInventory` → `setInventory`), so the
  marketplaces show the master's real number whichever way the write went.
- A `pending` claim found on a later run (a crash mid-call) becomes `in_doubt`
  (`reason: 'interrupted'`), never re-sent.
- Only `adapter-unresolved` (failed before the boundary) is `retryable`; the handler
  throws a retryable `SyncJobExecutionError` and the next run re-claims just those lines.
- Job scope is the ORDER's source connection, not the holder.
- A work with no holder is still decremented — the units were sold.
- An order cancelled before the job ran lowers nothing (giving stock back after a
  decrement is #3479).
- Tests: unit specs for the rules, service, handler and both producers, plus
  `apps/api/test/integration/inventory-sale-decrement.int-spec.ts`, which proves N
  overlapping runs make exactly one adapter call against real Postgres.
- `/pre-implement` gate was not run.

## Risks / open questions

- **#3480 not landed** — double subtraction on `ol_managed_carrier` routed orders
  until it does. Ship behind it, or accept?
- `in_doubt` on any adapter throw is conservative. PrestaShop's typed refusals
  (multi-shop, `depends_on_stock`, no row) all happen before the write, so the copy
  says "check the stock in the product master". Better classification needs a neutral
  refusal error in core. Follow-up.
- Clamp detection compares against OL's mirrored `availableQuantity`, which can lag
  the master's.
