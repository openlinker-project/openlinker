# Implementation plan — `OrderHoldService` + the two hold gates (#2339)

Wave 2, body A, second in the chain (#2338 → **#2339** → #2340 → #2341 → #2342).
Design of record: `DESIGN-oms-authority-model.md` §6.3 / §6.4 / §6.6; ADR-059.

## What ships

1. **`IOrderHoldService` / `OrderHoldService`** (`libs/core/src/orders/application/{interfaces,services}/`),
   provided by the LEAF `OrderHoldsModule` — not `OrdersModule`, which would spend #2338's split for
   nothing. It adds exactly the three things a conditional SQL statement cannot express:
   - **the clock** (`placedAt` / `releasedAt`). Holds are OL-internal operator acts, so OL's clock is
     the authority — unlike a fact about the outside world, which takes the channel's instant;
   - **§6.4's release policy** (below);
   - **the `held` / `released` `OmsLifecycleFact`**, returned to the caller and logged, never published.
2. **The provisioning gate** — `OrderSyncService` reads `getOpenHold` beside the existing
   `WHERE cancelledAt IS NULL` predicate (#2284) and returns a new, NON-terminal `skipped_held`
   result arm.
3. **The dispatch gate** — `ShipmentDispatchService` refuses a held order with
   `OrderNotDispatchableHeldException` (422, terminal, ADR-007), beside the #938 payment gate.

## §6.4's release policy, and where it lives

`order_holds.releaseNote` is nullable because the schema cannot know who is releasing. The rule is
therefore enforced in `OrderHoldService.assertReleaseAllowed`:

| Placed by | Released by | Outcome |
|---|---|---|
| user | user | allowed, note optional |
| user | service | **refused** (`HoldReleaseNotPermittedError`) |
| service | the same service | allowed, note optional |
| service | a different service | **refused** (`HoldReleaseNotPermittedError`) |
| service | user, no note | **refused** (`HoldReleaseNoteRequiredError`) |
| service | user, with note | allowed; the note is persisted |

The service→user-hold refusal is the one row §6.4 does not spell out. It follows from two facts it
does state: automation clearing a human's hold is an unmade judgement, and `order_holds` has no
`releasedByService` column, so such a release would persist as released by nobody.

**Whether a releasing human is entitled to overrule is a ROLE question and is NOT core's** — core has
no user roles. #2341 guards the release route with `@Roles('admin')`.

## Why `skipped_held` is not terminal, and what is persisted

A cancellation ends an order; a hold is a state an operator removes. So the arm is distinct from
`skipped_cancelled` (which would claim the order is over) and from `failed` (which would claim
something broke and put the row in the operator-retry affordance for a condition retrying cannot
change). The persisted per-destination row is written as **`pending`** with the hold reason in
`error` — literally true, and it exists so that a first ingestion of a held order does not render
"No destinations" on `/orders`, which would deny that the destinations exist at all.

## Gates read `order_holds`, never the projection

Both gates go through `IOrderHoldService.getOpenHold` → `findOpenByOrder`. #2340's
`order_records.activeHoldReason` is a cache that loses on drift, and a gate that trusts a stale cache
lets a held order ship. This is the epic's **L4 exit criterion**.

## Not in scope, and one honest gap

- **No migration.** A service over an existing table needs none; slot `1855000000000` is unused.
- **Automatic re-provisioning after a release** relies on a subsequent `marketplace.order.sync`. The
  gate itself is re-entrant (asserted), but nothing in this slice ENQUEUES that run — and for a
  cursor-based journal the source event will not be re-delivered. Closing it belongs with #2341,
  where the release route already sits next to the job-enqueue seam: the release handler should
  enqueue `marketplace.order.sync` for the order it just freed.
