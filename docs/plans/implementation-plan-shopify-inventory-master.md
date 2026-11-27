# Implementation Plan: Shopify InventoryMaster - single location, CAS, corrections (#3976)

Stacked on #3975 (ProductMaster, branch `3975-shopify-product-master`), itself on
#3974 (foundation, PR #4042): this branch reuses the product reader, the GraphQL
documents, the id resolver and the cost backoff from those two.

## 1. Task

Implement `InventoryMasterPort` for Shopify: stock of the ONE configured
location per variant, and stock corrections from OpenLinker written to Shopify
once, without overwriting a concurrent change. Plus the guard-only
`BulkInventoryReader` rung for the batched inventory sweep.

Layer: Integration / infrastructure. No core change.

### Non-goals

- Multi-location stock (waits for a WMS); other Shopify locations are ignored.
- Stock write-back to a published Shopify product (`OfferManager`, role D) - own issue.
- Inventory webhooks.

## 2. Research findings

Prototype `shopify-inventory-master.adapter.ts` (reference only) and spike cases
A06-A09, A18, G05, L-I1, L-M2, L-S1c.

| Case | Live result | Here |
|---|---|---|
| L-I1 | untracked variants refused -> one dead job per product per tick | untracked reported at `unmanagedStockQuantity`, default 1000 (WooCommerce `DEFAULT_UNMANAGED_STOCK_QUANTITY`) |
| A18 | correction applied once; same key again: no second write | key remembered in the host cache after the write + `@idempotent` |
| G05 | `CHANGE_FROM_QUANTITY_STALE`, nothing written | retried INSIDE the adapter (see 3.3) |
| L-S1c | stock sweep Shopify -> Allegro works with no webhook | sweep only |

Core contracts: `InventoryMasterPort` (`listInventory` one entry per variant,
`adjustInventory` with optional `idempotencyKey` / `reason`, outcome
`applied | deduplicated`, `appliedAt` = the master's instant), `BulkInventoryReader`
(prefetch by INTERNAL product ids, never throws, a missing product stays unwarmed).

**Every core caller of `adjustInventory` treats a throw as "outcome unknown"**
(`InventoryCorrectionService`, `InventorySaleDecrementService`,
`InventorySaleReversalService`, `ReturnCustodyService`): it is recorded `in_doubt`
and never retried automatically. Only a `MasterProductNotFoundError` or an error
named `*NotSupported*` reads as a refusal. So a CAS refusal, which writes nothing,
must not escape as an ordinary error on the first attempt.

### Shopify API (2026-10)

| Point | Reference says | Here |
|---|---|---|
| Delta write | `inventoryAdjustQuantities(input:{name, reason, changes:[{inventoryItemId, locationId, delta, changeFromQuantity}]})`; `changeFromQuantity` must be passed (`null` skips the check) | delta on `available` with `changeFromQuantity` = the level just read. The issue names `inventorySetQuantities`: that is the ABSOLUTE write, while every core caller asks for a delta, so adjust is the right one; both take the same CAS (the prototype used adjust, live A18) |
| Quantity names | adjust accepts `available, damaged, quality_control, reserved, safety_stock`; `on_hand` = sum, `committed` not writable; only `available` needs no `ledgerDocumentUri` | `available` |
| Reasons | `correction, restock, received, ...` | `return_restock` -> `restock`, everything else -> `correction`; the neutral reason is also logged |
| `@idempotent` | required since 2026-04; key remembered 24 h; same key + same body -> cached answer, nothing reapplied; same key + different body -> `IDEMPOTENCY_KEY_PARAMETER_MISMATCH`; previous attempt failed -> `IDEMPOTENCY_PREVIOUS_ATTEMPT_FAILED` | one key per attempt, derived from the caller's key (3.3) |
| Stale CAS | userError `CHANGE_FROM_QUANTITY_STALE` | re-read and retry in the adapter |
| Reads | `InventoryItem.tracked`, `inventoryLevel(locationId:)`, `InventoryLevel.quantities(names:)`, `updatedAt` | as the prototype; variants paged 100 at a time (cost) |
| Scopes | `write_inventory`, `read_inventory`, `read_locations` | already required by the foundation |

## 3. Design

### 3.1 Files

- `infrastructure/readers/shopify-inventory.queries.ts` - per-product level read
  (`product(id){ variants{ inventoryItem{ id tracked inventoryLevel(locationId){
  updatedAt quantities(names:[available on_hand committed]) } } } }`, variants paged)
  and the bulk read (`nodes(ids:)`, cost-sized).
- `infrastructure/readers/shopify-inventory.reader.ts` - memo per product,
  `product: null` / ARCHIVED -> `MasterProductNotFoundError` (same rule as the
  ProductMaster reader), seed for the prefetch.
- `infrastructure/adapters/inventory-master/shopify-inventory-master.adapter.ts`.
- `domain/exceptions/shopify-variant-required.exception.ts`,
  `shopify-variant-not-found.exception.ts` (non-retryable).
- Factory `createInventoryMaster`, plugin manifest + dispatch, default-enabled.

### 3.2 Read

One `Inventory` per variant at the configured location (`shopContext.locationGid`):
`available` = Shopify `available`, `reserved` = `committed`, `quantity` = `on_hand`,
`updatedAt` = the level's. A variant not stocked there reports 0. Untracked ->
`unmanagedStockQuantity` (default 1000). `locationId` stays undefined (pooled;
the operator maps the warehouse with `stockLocationOverride`, #3206).

### 3.3 Write (`adjustInventory`)

1. Pick the variant (named by `variantId`, or the only one); untracked or not
   stocked at the location -> `ShopifyNotSupportedException` (a refusal, nothing written).
2. Caller key seen in the host cache -> `deduplicated`, current level, the recorded `appliedAt`.
3. Write the delta with compare-and-set on the level read just before
   (`changeFromQuantity`) and `@idempotent`. On `CHANGE_FROM_QUANTITY_STALE`
   (nothing written) re-read the level and try again, up to 3 attempts; a negative
   result is clamped at 0 against the FRESH level each time.
   Shopify key per attempt: a UUID-shaped hash of (connection, caller key,
   attempt number), or a random UUID when the caller gave no key. Within one
   call an attempt refused as stale wrote nothing, and its key cannot be reused
   with a new `changeFromQuantity`, hence one key per attempt. Across a job
   retry after a crash the first attempt's key comes back: if that write
   landed, the level moved, the body differs and Shopify answers
   `IDEMPOTENCY_KEY_PARAMETER_MISMATCH` - an error the caller records as in
   doubt, never a second write.
4. Record the key in the host cache only after the write succeeded.
5. `appliedAt` = Shopify's `createdAt` of the adjustment group.

## 4. Steps

1. Queries + inventory reader (+ spec).
2. Adapter read path + prefetch (+ spec).
3. Adapter write path: dedupe, CAS retry, clamp (+ spec).
4. Exceptions + retry classifier; factory + plugin (+ plugin spec).
5. README + architecture-overview bullet.
6. Type-check, lint, invariants (tests on CI).
