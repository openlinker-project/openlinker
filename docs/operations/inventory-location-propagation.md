# Inventory location propagation — upgrade and operations

Covers the one **plugin-breaking** change in Wave 1b (#2324, [ADR-058](../architecture/adrs/058-multi-location-positions-reservations-availability-authority.md)
decision 5): an inventory write that names a `locationId` now propagates to
marketplaces instead of being silently dropped.

Read this if you run an in-house or out-of-tree `InventoryMaster` adapter. If
every one of your adapters leaves `locationId` unset — which is true of every
adapter shipped in this repository — nothing changes for you, and the detection
query below will confirm it in one statement.

## Why the skip existed

Marketplace propagation was written when OpenLinker mirrored exactly one
inventory position per variant. `InventoryService.setInventory` therefore
refused to enqueue anything for a row carrying a `locationId`:

> `inventory_write_propagation_skipped_non_default_location`

The reasoning was defensive and, at the time, correct: the propagation handler
read a **single** `(product, variant, location = NULL)` row, so a located write
had no correct number to publish. Publishing one warehouse's quantity as if it
were the whole stock would have oversold or undersold by whatever the other
warehouses held.

## What was actually happening

The skip did not degrade gracefully — it stopped propagating **entirely**. A
master that locates its stock wrote position after position, every one of them
skipped, and the marketplace kept publishing the last *pooled* number it ever
saw. Nothing errored, no job failed, no counter moved. The symptom is stock that
looks healthy in OpenLinker and is arbitrarily stale on the channel.

Because the skip was silent, its blast radius scaled with how long the
deployment had been locating.

## What changed

Two halves, and they only work together:

1. **The write side no longer skips.** Every inventory write enqueues
   `inventory.propagateToMarketplaces`, located or not.
2. **The read side sums.** The propagation handler no longer reads one row. It
   asks the availability seam (#2321/#2323) for the variant's
   available-to-promise in the **global** scope, which is the aggregate across
   every live position — all locations *and* all sources.

The dedupe key is deliberately **location-free**. A master reporting N located
positions for one variant in a single pull writes them with a shared
`updatedAt`, so N enqueues collapse into one job — and one job is the right
number, because that job publishes the aggregate.

### What "the aggregate" means

`Σ availableQuantity` over the variant's rows in `inventory_items` where
`isStale = false`, **summed across locations and across owning connections**,
minus OpenLinker's own advisory reservations, then the destination's
`stockSafetyBuffer` applied once downstream.

Summing across *sources* is deliberate, not a defect (ADR-058 decision 2): two
positions for one variant that differ only in owning connection are legitimate
coexisting mirrors. If two of your sources mirror the **same** physical stock,
that sum is too high — that is the duplicate-position problem, tracked as
[#2319](https://github.com/openlinker-project/openlinker/issues/2319), and it is
not something this change introduces or can decide.

A staled position contributes nothing. In particular the #2322 transition — a
source that used to report one pooled position and now reports located ones —
stales the pooled row rather than overwriting it, and #2324 is what makes that
staling reach the marketplace at all.

## Are you affected? — pre-upgrade detection

Run this against your OpenLinker database **before** upgrading:

```sql
SELECT "sourceConnectionId",
       "locationId",
       COUNT(*) AS positions
FROM inventory_items
WHERE "locationId" IS NOT NULL
  AND "isStale" = false
GROUP BY "sourceConnectionId", "locationId"
ORDER BY positions DESC;
```

- **Zero rows** — you are unaffected. Published quantities will not move.
- **Rows returned** — those connections are the ones whose stock has been
  silently frozen on the channel. After the upgrade their next inventory write
  publishes the true aggregate, which may be a large single-step correction in
  either direction. Expect a burst of `marketplace.offerQuantity.update` jobs
  proportional to the number of affected variants, not positions (the
  location-free dedupe key collapses siblings).

To see which variants will move, replace the grouping with
`"productId", "productVariantId"`.

## If the new number is wrong

The aggregate is a sum over rows you can read. Check them directly:

```sql
SELECT "sourceConnectionId", "locationId", "availableQuantity", "isStale", "updatedAt"
FROM inventory_items
WHERE "productVariantId" = '{variantId}'
ORDER BY "isStale", "sourceConnectionId";
```

- A quantity that is **too high** and shows two sources reporting the same
  physical stock is [#2319](https://github.com/openlinker-project/openlinker/issues/2319),
  not a propagation bug.
- A quantity that is **too high** and shows a live pooled row alongside located
  rows from the same source means the #2322 staling repair has not run for that
  product yet; the next master inventory sync for it performs the repair.
- A quantity that is **too low** is usually the destination's own
  `stockSafetyBuffer` (#1844) doing its job — check
  `connections.config -> 'stockSafetyBuffer'` for the destination.

## Opting out

If a locating adapter of yours is not ready for aggregate publishing, the opt-out
is one line in **your adapter**, not a setting: return `locationId: undefined`
from `InventoryMasterPort.listInventory` so OpenLinker records the position as
pooled. That restores exactly the pre-#2324 behaviour for that connection.

Note what you are choosing: pooled positions for one variant from one source
collapse onto a single row, so per-warehouse detail is not mirrored. That is the
trade the old skip made implicitly and permanently.

## Log tokens worth alerting on

| Token | Meaning |
|---|---|
| `inventory_propagation_suppressed_availability_unknown` | The reservation ledger could not be read, so no quantity was published. The job throws and retries. Sustained occurrences mean the ledger read is failing, and channel stock is drifting until it recovers. |
| `inventory_propagation_no_observed_positions` | A variant with no live positions published a **known zero**. Correct (a deleted or fully-staled variant must stop selling), but a spike means something staled a lot of stock. |
| `inventory_pooled_stale_propagation_enqueued` | The #2322 staling repair triggered a propagation. Expected during a source's transition to locating. |
| `inventory_pooled_stale_propagation_enqueue_failed` | That best-effort enqueue failed. The hourly reconcile sweeps re-derive from persisted state, so this is not stock loss, but repeated occurrences point at the job queue. |
| `inventory_pooled_position_staled_by_located_write` | The #2322 repair staled a source's own pooled row because that source just located the same variant. Expected exactly once per variant during a source's transition to locating — a token that keeps recurring for the same variant means the source is flapping between pooled and located answers. |
| `inventory_pooled_and_located_in_one_response` | One master pull reported the SAME variant both pooled and at a location, contradicting itself. The located position wins. Always a defect in the adapter or the platform response, never a normal state. |
| `inventory_writeback_suppressed_availability_unknown` | The destination's publish Controls could not be resolved, so the whole quantity write-back batch was suppressed and **no marketplace call was made** (#2323). The batch fails and retries. Sustained occurrences mean channel stock is drifting. |
| `inventory_cross_source_position_conflict` | A second source tried to insert a position at a NON-NULL `locationId` already held by another source (#2320). **Permanent — no retry can clear it**; the fix is the #2325 four-column position key. |

The retired `inventory_write_propagation_skipped_non_default_location` token no
longer appears anywhere. Any dashboard or alert keyed on it should be removed
rather than left silently matching nothing.
