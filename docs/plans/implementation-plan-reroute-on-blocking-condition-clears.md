# Implementation plan - re-enter routing when a held order's blocking condition clears (#3558)

Epic: G07 (#3511), under #3460. Layer: CORE (orders) + Worker + API. Priority P1.

## 1. Task understanding

A held order (`fulfillmentBlockReason` = `routing-refused` | `routing-failed`) is re-routed today ONLY by
`fulfillment.work.rerouteSweep` (#3485): every 15 minutes, keyset-paged, time-driven. Two things from the
issue are not there:

1. **A stock change re-drives routing.** When the master writes a new stock figure for a variant that a held
   order is waiting on, that order should be re-routed now, not up to 15 minutes later (and, past the 72 h fast
   window, not up to a day later).
2. **An operator "Retry routing"**: `POST /orders/:internalOrderId/retry-routing`.

### Explicit non-goals
- The frontend button (a separate G07 child).
- The reaper for a stranded `live` decision (#2731) - the retry endpoint only has to accept its result later.
- A new job type, lane, scheduler task or migration.
- Any change to the router, the commit service or `routing_decisions` semantics.

## 2. Findings that shape the design

- **The re-route primitive already exists and is the right one**: `fulfillment.work.route` (handler
  `FulfillmentWorkRouteHandler`). It re-reads the stored snapshot, calls the exactly-once `route()` commit
  (#2395) and persists the new block through `deriveRoutingHoldOutcome`. Both new triggers only ENQUEUE it, so
  "no duplicate `routing_decisions` row" is inherited from #2395 and not re-implemented.
- **The job's `connectionId` must be the selected router's connection** (#2609 - never a synthetic id). The sweep
  resolves it with `selectPrimaryFulfillmentRouter` over all connections; the retry and the stock trigger need
  the same answer, so it is extracted rather than copied a third time.
- **`order_line_items` carries `variantId`** (denormalised at persist for `ready` records), so "held orders that
  contain variant V" is a join on an existing index (`orderRecordId`) - no jsonb scan of the snapshot.
- **A stock write already has one choke point**: `inventory.propagateToMarketplaces`
  (`InventoryPropagateToMarketplacesHandler`) runs once per changed stock row, with `productId`, `variantId` and
  `inventoryUpdatedAt`. `inventory` may not import `orders` (OrdersModule imports InventoryModule), so the hook
  lives in the WORKER handler and calls an `orders` service.
- **Retry-without-bound is the real risk.** Every `route()` mints a durable `routing_decisions` row that nothing
  prunes (documented in the sweep's header). A stuck order on a hot SKU would mint a row per stock write.
  The stock trigger therefore dedupes per (order, UTC hour): at most 24 attempts a day per order, like the sweep's
  fast window, never one per stock event.

## 3. Design

### 3.1 `IOrderRoutingRetryService` (orders context, application service)

New service in `libs/core/src/orders/application/services/order-routing-retry.service.ts`, interface in
`order-routing-retry.service.interface.ts`, token `ORDER_ROUTING_RETRY_SERVICE_TOKEN`, provided and exported by
`OrdersModule` (the `OrderProvisioningResumeService` / `OrderDestinationRetryService` shape).

```
retryRouting(internalOrderId): Promise<RoutingRetryResult>
rerouteHeldOrdersForVariant({ variantId, observedAt }): Promise<RerouteHeldOrdersResult>
```

- `retryRouting` (operator): reads the order; refuses with a named reason when it is not held, or held for a
  reason the sweep does not re-drive (`routing-no-shipping-address` retries on re-ingestion; the three #2396 guards
  resolve on their own). Selects the router; with none selected returns `no-router`. Enqueues
  `fulfillment.work.route` under the router's connection with a FRESH key
  (`fulfillment:work:route:retry:{orderId}:{Date.now()}`) - the first key of any family is permanent in
  `sync_jobs.idempotencyKey`, so an operator's second click must not dedup against the first.
  Never throws for a modelled condition; returns a discriminated result (`enqueued | not-held | not-retryable |
  no-router | enqueue-failed`) carrying a stable CODE, never an error message (the #2341 rule).
- `rerouteHeldOrdersForVariant` (stock trigger): lists held (`routing-refused`) orders whose line items include
  the variant (bounded page, `limit` 50), enqueues one route job each under key
  `fulfillment:work:route:stock:{orderId}:{utcHourBucket}`. Best-effort and never throws - it is called from the
  inventory propagation path and must not be able to fail a stock write-back.
- Router selection is extracted to one helper both services and the sweep call
  (`resolveRerouteRouterConnectionId` in the orders application layer), reading `ConnectionPort` the way
  `OrderIngestionService.resolveRoutingTarget` already does. The sweep handler switches to it only if that is a
  pure move; otherwise it is left alone and the duplication is noted (decision in section 6).

### 3.2 Repository read

`OrderRecordRepositoryPort.listOrderIdsHeldForVariant(reasons, variantId, limit)`: join `order_line_items` on
`orderRecordId`, filter `variantId = :v AND fulfillmentBlockReason IN (:reasons)`, `ORDER BY internalOrderId`
(keyset-ready, not offset), `LIMIT`. Exposed through `IOrderRecordService`. Query-builder with bound params.
No migration: both columns exist; `order_line_items.orderRecordId` is already indexed.

### 3.3 Worker hook

`InventoryPropagateToMarketplacesHandler`: after its existing work, when `variantId` is present, call
`rerouteHeldOrdersForVariant`. Wrapped in its own try/catch (log + continue). A stock change that LOWERS stock also
triggers an attempt; that is deliberate: a refused attempt costs one local router call and the hourly bucket bounds
it, whereas computing "did this increase availability" needs the previous value the job does not carry.

### 3.4 API

`POST /orders/:internalOrderId/retry-routing` in `orders.controller.ts`, `@Roles('admin', 'operator')`, 202,
modelled on `retryDestination`. Mapping: unknown order 404; `not-held` / `not-retryable` 409 with a machine
code field; `no-router` 409; `enqueue-failed` 503. Response `{ internalOrderId, jobId }`.

## 4. Implementation steps

1. `order-routing-retry.service.interface.ts` + result types (`order-routing-retry.types.ts`).
2. Repository port method + implementation + `IOrderRecordService` passthrough.
3. `OrderRoutingRetryService` + token + `OrdersModule` wiring + barrel exports.
4. Worker hook in `InventoryPropagateToMarketplacesHandler` (+ module imports if the handler needs the token).
5. Controller route + response DTO.
6. Tests (below).
7. `docs/architecture-overview.md` bullet under § Fulfillment (the #3485 bullet's successor).

## 5. Tests

- Service unit: operator retry enqueues under the router connection with a fresh key; each refusal code; no
  router; enqueue failure returns a code and does not throw; stock trigger enqueues per held order with the hourly
  key, is a no-op with no held orders, never throws.
- Repository int-spec (Testcontainers; needs Docker): only held-for-that-variant orders are returned, other
  reasons and other variants excluded, keyset order, limit.
- Handler unit: the propagation handler calls the re-route and still succeeds when it throws.
- Controller unit: status mapping per result.

## 6. Decisions to confirm (the issue text contradicts the merged code)

1. **`stock-shortfall` hold.** The issue asks for an order whose committed quantity is unavailable to be "held
   with `stock-shortfall`". That is an `order_holds` reason (#2339) that nothing writes automatically. #3485 (merged)
   deliberately chose the `routing-refused` fulfilment block instead, which already renders "Waiting: stock" and is
   already swept. Writing a second, order-hold copy would put the order in the "On hold" phase and need a release
   path, for the same condition. **Plan: do not add it; record the reason on the issue.**
2. **Async retry.** The issue says the endpoint "re-attempts the router and releases the hold on success,
   reporting the reason on failure". Running `route()` inside the HTTP request needs the router resolver and the
   distributed lock in the API process. **Plan: enqueue the route job and return 202**, so the outcome lands on the
   order's block (`Waiting: ...` clears, or the new detail appears), like every other retry in this repo.
3. **Sweep refactor.** Extracting the router selection from the sweep touches a shipped handler. Plan: extract
   only if the move is mechanical; otherwise leave the sweep as is.

## 7. Risks

- Stock trigger volume: bounded by the held set (page 50) and the hourly key.
- The hook adds a read to every stock propagation job: one indexed query, skipped when the variant id is absent.
- Integration test needs Docker; unit tests do not.
