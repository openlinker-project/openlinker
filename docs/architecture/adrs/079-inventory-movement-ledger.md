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
4. Reservations are not movements (ADR-061). The history read merges them from `reservations` as "Promised" rows that change no quantity.
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
