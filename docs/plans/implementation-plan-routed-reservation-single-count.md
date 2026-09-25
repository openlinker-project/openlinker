# Implementation Plan — Routed orders count reserved units once (#3480)

Branched from `3453-routed-order-sale-decrement` (#3453 / PR #3489).

## 1. Understand

**Goal.** A routed order's advisory hold and #3453's sale decrement must count the
sold units exactly once:

- **before** the decrement lands, the hold subtracts (`published`), so marketplaces see
  the reduction the moment the order is routed;
- **after** the decrement lands, the hold is closed (`consumed`), so only the master's
  lower stock subtracts;
- **on a failed decrement** the hold stays `held`, so stock stays reduced.

**Layer.** CORE (orders ingestion + inventory reservation/decrement services).

**Non-goals.**
- #3479: a cancellation giving stock back.
- #3483: ADR wording.
- Re-stamping existing holds, which the insert-only `atpEffect` forbids.

## 2. Research

- Holds are created in `OrderIngestionService.reserveOrderInventory`, **before** the
  routing intercept. `atpEffect` is stamped only on INSERT, from the ADR-012 dispatch
  routing (`resolveReservationAtpEffect`), so the default `omp_fulfilled` topology
  gives `diagnostic`. That is the oversell window.
- The intercept enqueues `inventory.saleDecrement` (#3453). If holds were created
  after the intercept, the decrement job could run first. The hold would then be
  created after its own consume and would subtract for the whole TTL. **So the hold
  must stay before the intercept.**
- `IReservationService.closeForOrder({ orderRecordId, terminalStatus })` closes all of
  an order's held rows through the guarded `releaseHeld`, so it is idempotent.
- `InventorySaleDecrementService` lives in `inventory`, the same context as the ledger.
  No new edge is needed.

## 3. Design

1. **Resolve the routing target once, before the hold.**
   - Extract the router selection plus router resolution out of
     `interceptFulfillmentRouting` into `resolveRoutingTarget()`.
   - It never throws: a failure gives `none`, the same fail-open as today.
   - Its answer is used twice:
     - `reserveOrderInventory(…, routedByOms)` stamps `published` when a router is
       selected and resolves; otherwise it keeps `resolveReservationAtpEffect`.
     - `interceptFulfillmentRouting(order, target, …)` routes with the target
       already resolved, so the two can never disagree.
2. **Close per line when the decrement confirms.**
   - `CloseForOrderInput` gains an optional `orderLineIds`. This is additive:
     omitted means the whole order, exactly as today.
   - `InventorySaleDecrementService` consumes a line's hold when the line settles
     `applied` / `deduplicated`, or is `skipped` as `source-is-owner` (the shop already
     lowered its own stock).
   - The consume happens **before** the mirror write. The propagation that
     `setInventory` enqueues then reads an ATP where the hold is already gone and the
     master is already lower: no window where both subtract.
   - The consume also runs on a replay of an already-successful line, so a consume
     that failed once heals on the next run.
   - `blocked` / `in_doubt` / `retryable` keep the hold.

**Known limitation.** A router is selected and resolves, but then refuses the plan.
The order is mirrored to its destinations, yet the hold was already stamped
`published`, and it stays until the dispatch consume or expiry. The refusal is
already reported on the decision row. Re-stamping is impossible by design.

## 4. Steps

1. `reservation-service.types.ts` + `reservation.service.ts`: optional `orderLineIds`
   filter + spec.
2. `inventory-sale-decrement.service.ts`: inject `RESERVATION_SERVICE_TOKEN`, consume per
   confirmed line before the mirror, best-effort + spec.
3. `order-ingestion.service.ts`: `resolveRoutingTarget`, thread into reserve + intercept +
   spec (routed ⇒ `published` without consulting dispatch routing; router-less unchanged).
4. Int-spec: extend `inventory-sale-decrement.int-spec.ts` — a published hold is consumed
   when the decrement lands and stays held when it fails.
5. Docs: architecture-overview bullet.

## 5. Validate

- No new module edge. `ReservationService` and `InventorySaleDecrementService` are
  both in `InventoryModule`.
- `atpEffect` stays insert-only, and ADR-061's "a hold never decrements on-hand" still
  holds.
- The router-less install is byte-identical: `resolveRoutingTarget` gives `none` and
  the hold is stamped exactly as before. This is pinned by the existing
  characterisation tests.
