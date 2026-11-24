# ADR-079: Inventory movement ledger written at the mirror

- **Status**: Accepted
- **Date**: 2026-10-26
- **Authors**: @norbert-kulus-blockydevs

## Context

OpenLinker mirrors stock that a product master owns. Before #3565 nothing recorded why a mirrored quantity changed: the master sync overwrote `inventory_items.availableQuantity`, the sale decrement (#3453) and the sale reversal (#3479) wrote their results through the same path, and the return restock (#2370) changed the master without touching the mirror at all. An operator could not tell a sale from a recount from a sync, and a manual correction (#3566) had nowhere to record the operator's reason, which the master cannot store.

Three sources were candidates for "history": the reservation ledger (what OpenLinker promised), `return_line_events` (returns only) and the mirror writes (no history).

Decision D40 of the OMS pilot (2026-09-28) said a sale is recorded when the reservation is consumed at dispatch. That predates the sale decrement: with the OMS off, the shop lowers its own stock and OpenLinker sees the change as a sync delta, so a sale row at consume plus the sync row would count the sale twice.

## Decision

1. An append-only `inventory_movements` table is written from ONE place, `InventoryService.setInventory`, the only code that knows the previous quantity. A caller passes an optional movement context (reason, source, actor); no context means `master_sync`. A row is written only when `availableQuantity` changed or a position was created, and a ledger failure never fails the stock write.
2. Every write OpenLinker makes to a master is mirrored through `setInventory` with its reason: sale decrement (`sale`), sale reversal (`cancellation_restore`), return restock (`return_restock`, newly mirrored, under the sale position lock) and the manual correction (`manual_correction`, which claims a `pending` row before the adapter call and completes it on the mirror).
3. A `sale` row is written where OpenLinker itself lowers the master's stock (the sale decrement), never at reservation consume. This narrows D40 (decision G-1, 2026-10-26).
4. Reservations are not movements (ADR-061). The history read merges them from `reservations` as "Reserved" rows that change no quantity.
5. Rows are pruned after `inventoryMovementRetentionDays` (default 365, Operational Settings) by a maintenance-role sweep.

## Alternatives considered

- **Write at every caller.** Rejected: each caller would have to read the old quantity itself, and a new write path would silently produce no history.
- **Infer movements from sync deltas.** Rejected: a delta cannot say why stock moved, and attributing it to an order is guesswork (D40 already forbade it).
- **Sale row at reservation consume (literal D40).** Rejected: double counts against the sync row when the OMS is off, so the history stops summing to the stock.

## Consequences

**Pros:**
- The history sums to the mirrored stock; every OpenLinker-originated change carries its source.
- The return restock now reaches the marketplaces at once instead of at the next sync.

**Cons / trade-offs:**
- With the OMS off, a sale appears as "Sync change detected", not as a sale with an order reference.
- A movement made in the master by hand also appears only as a sync change.
- `isStale` repairs are not recorded; a position leaving availability that way has no row.
- The manual correction classifies an adapter error as a refusal only for `MasterProductNotFoundError` or a `*NotSupported*` error (which adapters raise before writing); anything else is `in_doubt` and never retried automatically.
- **An in-doubt correction is never retried automatically - a deliberate deviation from the epic's "only the backend retries with the same key".** Resending a write that may already have landed risks a double change on a master that cannot dedupe on the key; the operator checks the master's stock (the product page shows a fresh read) and corrects again on purpose.
- **A ledger row describes the master, not the mirror, and records the change that actually happened.** The adapter write is a delta write in both modes, so when the master's answer is above 0 (or the change added stock) `quantityBefore = quantityAfter - requested delta` exactly, and a drifted mirror or a concurrent shop sale is never attributed to the operator (the next sync row carries that drift). When the answer is 0 after a removal the master may have clamped, so `quantityBefore = min(pre-write master read, removal size)` and `quantityDelta = quantityAfter - quantityBefore` (#3512 fix B15; rule in `resolveRecordedQuantityBefore`). A delta-mode removal therefore reads the master before writing, the same read set mode always made, and is refused as `insufficient-stock` (409 with `currentQuantity`) when the master holds less than the removal, before anything is claimed or written. No `pending` row survives a returned correction: the service re-reads the row after the mirror and settles it itself if the best-effort ledger attach was lost. A `pending` row older than five minutes also shows under "Needs attention".
- **When the mirror write fails after the master applied the change**, the row is applied with the master's before/after, and the next stock sync still appends its own `master_sync` row for the same movement, so the sum of deltas can count that change twice until the mirror catches up. When the master reports no quantity the row records neither before nor after.
- A price-only commercial snapshot no longer erases a quantity observed earlier on the same offer; the observation time is shared by price and quantity, so it still advances.
