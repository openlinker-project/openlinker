# Implementation plan — #3485: with the OMS on, an order the router cannot place is held, not mirrored

**Issue:** #3485 (epic #3460) · **Branch:** `3485-hold-unrouted-orders` · **Stacked on:** `3455-no-routing-for-premirrored-orders` — the top of the single epic stack `3453 → 3480 → 3479 → 3486 → 3487 → 3488 → 3455`.

## 1. Understand

**Goal.** Once OpenLinker's OMS is the order's router, *every* outcome of routing keeps the order in OpenLinker. Today only a `routed` outcome does. A refused plan (a line out of stock), a missing shipping address and an error after the router was selected all return `held: false`, so `syncOrder` fans the order out to **every** active `OrderProcessorManager`. With two product masters it is created in both, and one fails with "Product not found" after creating a guest customer.

**Layer.** CORE (Application + Domain types in `orders` / `fulfillment`), a small Interface change (order DTO), one worker sweep job.

**Non-goals.**
- The `/orders` rendering of the reason (#3482). This slice exposes the reason on the API only.
- The `ambiguous` A2 arm. It already has a counted, derived A2-A state (#2352), and persisting a second reason would double-count `Needs attention`. Unchanged.
- A claimant with no router wired (`routerResolver.resolve` → `null`). That is ADR-054's degenerate pass-through for a non-OMS claimant, not "the OMS is on". Unchanged.
- The #3487 / #3488 / #3455 skip rules. A skipped order follows today's path by design. Unchanged.
- An operator "Retry routing" HTTP/UI trigger (belongs with #3482).

## 2. Research (current code, after the stack merge)

- `resolveRoutingTarget` (`order-ingestion.service.ts`) answers `route | skip(reason) | pass | indeterminate` once, before the advisory hold. The hold is stamped `published` iff `kind === 'route' && shippingAddress !== undefined` (#3480).
- `interceptFulfillmentRouting` switches on that target. On `route` it projects the order, calls `routingCommit.route`, enqueues dispatch (#2955) and sale-decrement (#3453) jobs, and maps the outcome via `toInterceptOutcome`. No address → `held: false`. `refused` → `held: false`. Catch → `held: false`, skip `indeterminate`.
- `persistFulfillmentOutcome` writes `fulfillmentBlockReason/Detail` (level-triggered, `IS DISTINCT FROM`-guarded, sole writer) and #3455's skip reason. The block columns are **write-only**: absent from the `OrderRecord` entity and the DTO.
- `FulfillmentBlockReasonValues` = `routing-in-doubt | routing-contended | routing-already-live-elsewhere`. Its docblock records why `refused` persisted nothing ("the order must keep its ordinary destination path"). This issue reverses that premise for the OMS case.
- `omsAttention` producer `routing` ↔ `line-unfulfillable` (UF-L, counted) is declared and has **no producer yet**. `markOmsAttention(orderId, producer, outcome)` is level-triggered per producer.
- `RoutingCommitService.refuse` terminalises the decision to `abandoned`, so a later `route()` mints a fresh decision: **re-routing a refused order is already legal**. The OL router emits `unfulfillable` for out-of-stock lines → abandon reason `plan-carries-unfulfillable`.
- `FulfillmentWorkRouteHandler` (`fulfillment.work.route`) routes one order from its stored snapshot (no marketplace call) and enqueues dispatch and sale-decrement. It has **no producer** and persists nothing. A missing address throws retryable.

## 3. Design

### 3.1 One shared rule — `deriveRoutingHoldOutcome`

A new pure function in the `fulfillment` leaf (`domain/types/routing-hold-outcome.types.ts`), used by **both** routing sites so they cannot disagree (the #2408 "one body answers" rule):

```ts
deriveRoutingHoldOutcome(outcome: RoutingCommitOutcome): {
  held: boolean;
  block: FulfillmentBlock | null;
  lineAttention: AuthorityAttentionOutcome<'routing'>; // type-only import, already allow-listed
}
```

| Outcome | held | block | UF-L (`routing` producer) |
|---|---|---|---|
| `routed` | yes | `null` | `none` (clears) |
| `in-doubt` / `contended` / `skipped(already-*)` | yes | as today | `indeterminate` (untouched) |
| `skipped(order-cancelled)` | no | `null` | `none` |
| `refused(plan-carries-unfulfillable)` | **yes** (was no) | `routing-refused` | **`blocked` / `line-unfulfillable`** |
| `refused(other)` | **yes** (was no) | `routing-refused` | `none` |

The caller writes `lineAttention` via `markOmsAttention(orderId, 'routing', …)`. The leaf injects nothing (ADR-053). #3485 becomes the first producer of UF-L.

### 3.2 Three new block reasons (no migration — `text` column, no CHECK)

- `routing-refused` — the router answered and the plan could not be committed. The detail names the abandon reason and decision id. Re-routable.
- `routing-no-shipping-address` — nothing to route to. Clears when the source sends an address (re-ingestion).
- `routing-failed` — an error after the OMS router was selected. The detail is the error name only (PII-free). Re-routable.

The file docblock is updated (the "refused persists nothing" paragraph is superseded).

### 3.3 Ingestion

Only the `route` arm changes. `skip` / `pass` / `indeterminate` are byte-identical.
- No shipping address → `held: true`, block `routing-no-shipping-address`, UF-L `none`.
- Routing outcome → `deriveRoutingHoldOutcome`.
- A throw inside the `route` arm → `held: true`, block `routing-failed`. The router was already selected, so the claim is known to be on and the old fail-open would send the order to every master. A failure *before* the target (`resolveRoutingTarget` catch) still answers `indeterminate` → today's path, because the claim state is unknown.
- `persistFulfillmentOutcome` also writes the UF-L attention when the intercept reports one.
- **The hold stamp follows the new rule.** `routedByOms` becomes `routingTarget.kind === 'route'` (the address condition is dropped). An address-less order no longer goes to any master, so OpenLinker owns its units and they must not be promised twice. `reserveForOrder` is get-or-create and `atpEffect` is insert-only, so an order that later gets an address and routes keeps the `published` stamp. The sale decrement then consumes that hold, so the units are still counted once (#3480).

### 3.4 Visible reason

- `OrderRecord` gains `fulfillmentBlockReason` / `fulfillmentBlockDetail` (read-only, coerced with `isFulfillmentBlockReason`, still excluded from `toOrm`, sole writer unchanged).
- `OrderRecordResponseDto` + `OrdersController.toDto` expose both (nullable), beside #3455's `fulfillmentRoutingSkipReason`.

### 3.5 Re-routing once stock arrives

- **`fulfillment.work.route` persists through the same rule.** After `route()`: `markFulfillmentBlock` + `markOmsAttention('routing', …)` from `deriveRoutingHoldOutcome`, best-effort (the routing outcome is already durable). A missing address maps to the `routing-no-shipping-address` block instead of a retryable throw. Job outcomes are unchanged (`refused` stays `business_failure`).
- **New sweep `fulfillment.work.rerouteSweep`** — its first producer. `bulk` lane (catch-up over orders already stalled; nobody waits on a slot), global scope under the nil-UUID system connection (the #2712 shape). Scheduler task `fulfillment-reroute-sweep`, **default ON** (`OL_FULFILLMENT_REROUTE_SWEEP_ENABLED`), every 15 min at `5,20,35,50`, offset from the other system sweeps. It is inert on an install with no held orders.
  - Candidates: `fulfillmentBlockReason IN ('routing-refused', 'routing-failed')`. `routing-no-shipping-address` is excluded, because only a source update fixes it and that re-ingests anyway.
  - **Keyset cursor, not frontier-as-query.** A re-refused order writes the same block, and the `IS DISTINCT FROM` guard (correctly) does not bump `updatedAt`. An oldest-first frontier would therefore re-read the same head page for ever and starve everything behind it. The pass pages `ORDER BY internalOrderId` from a cursor in `connection_cursors` (`fulfillment.reroute.after`, via `ISyncCursorsService`), wraps to the start on a short page, and budgets 50 orders per run. Keyset over a shrinking set never skips a row, unlike an offset.
  - Per candidate it enqueues one `fulfillment.work.route` job under the **selected router's** connection id (never a synthetic one, per the #2609 rule), with dedupe key `fulfillment:work:route:reroute:{orderId}:{tick}`. With no selected router (OMS switched off), the run enqueues nothing and does not advance the cursor.
  - Per-run `SyncLockPort` lock (`fulfillment:work:reroute-sweep:{scope}`).
- Repository read: `OrderRecordRepositoryPort.listOrderIdsByFulfillmentBlockReasons(reasons, { afterOrderId, limit })` plus an `IOrderRecordService` passthrough. There is no index at v1 volumes (the #2396/#3455 call). A partial index is recorded as the follow-up if held-order counts grow.

Cost per tick: one local router call per re-routed order (the OL router reads OL's own tables). No marketplace call.

## 4. Steps

1. `fulfillment-block-reason.types.ts` — three reasons + docblock.
2. `routing-hold-outcome.types.ts` + spec (one case per table row) + barrel export.
3. `order-ingestion.service.ts` — the §3.3 changes. Spec: every new arm is held and `syncOrder` is not called (the "two masters, no guest customer" AC); the UF-L attention is written; the claim-off / pass / skip / indeterminate characterisation stays byte-identical; the #3480 address test is updated to `published`.
4. Entity / repository `toDomain` / DTO / controller (+ controller spec).
5. Repository + port + service read (+ repository unit spec; integration spec against real Postgres).
6. Job type + payload + sweep handler (+ spec) + lane registration (`bulk`) + lane tripwire (59 handlers, 61 types, 18/31/5/7) + scheduler task + `.env.example`.
7. `fulfillment-work-route.handler.ts` persistence + address arm (+ spec).
8. Docs: architecture-overview § 26 bullet; block-reason and ingestion docblocks.

## 5. Validate

- Architecture: the `fulfillment` leaf stays zero-sibling-edge (a type-only import from `fulfillment-authority`, already allow-listed). Writes stay in `orders` and the worker. No new cross-context edge.
- Byte-identical with the claim off: pinned by characterisation tests on the `syncOrder` request.
- Re-routable: an abandoned decision frees the index. The sweep plus the route handler's persistence close the loop, and a successful re-route clears the block and the UF-L entry.
- Tests: unit specs per step and an integration spec for the repository read. Per session convention, tests run in CI.
- Everything local: no commits, no pushes, no GitHub writes until told to ship.
