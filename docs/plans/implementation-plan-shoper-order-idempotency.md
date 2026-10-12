# Implementation plan - Shoper order idempotency (#3694)

Sub-issue of epic #3642. Stacked on #3697 (createOrder). Highest-risk slice: it decides whether a retry can duplicate a real order.

## 1. Goal, layer, non-goals
Integration layer. A retried `createOrder` for the same source order must not create a second Shoper order, including when the first attempt succeeded on Shoper but OpenLinker never recorded it.
Non-goals: stock policy (#3695); changing core's lock.

## 2. Research findings
- **Core already provides the lock (the issue's open question is answered: NO new core seam).** `OrderSyncService.createOrderIdempotently` takes a per-(order, destination) `SyncLockPort` lock (`orderCreateLockKey`, TTL 180 s), re-reads the destination mapping under it, and skips if present. This is the #2047 shape the issue asked for, already shared by every destination.
- **The gap is the window core itself documents** (order-sync.service.ts, "Create-then-record is non-atomic"): `createOrder` succeeds on Shoper, the mapping write then fails or the response is lost, the retry finds no mapping and calls `createOrder` again. Core delegates that window to "the adapter's own platform-side duplicate recovery". Shoper gives none natively (SPIKE-3638 O5: `code` is not round-tripped, duplicates accepted).
- **Live probe (this session, trial shop): `GET /orders?filters[notes_priv]=<text>` is an exact-match filter.** #3693 already writes `notes_priv = "OpenLinker order <internalOrderId>"`. Exact value -> 1 hit; a different/longer id or a partial value -> 0; `[like]` also works. So Shoper CAN be asked "does an order for this OL order already exist".
- Stock moves per line (O6) and `DELETE /orders/:id` restores it (verified in #3693).

## 3. Design (adapter-level duplicate recovery, under core's lock)
1. `createOrder` requires `order.internalOrderId` (optional on the type): without it there is no key, so refuse with `ShoperOrderUnbuildableException` rather than create an unrecoverable order (the Subiekt rule, #3365). `notes_priv` is then always written.
2. Before any write (after `prepare`, before the customer/user write), look up `GET /orders?filters[notes_priv]=<marker>` (exact).
   - 0 hits -> create as today.
   - 1 hit, COMPLETE -> return its id; write nothing. Complete = its line count (`GET /order-products?filters[order_id]=`) equals the lines we would create.
   - 1 hit, INCOMPLETE (header exists, fewer lines: a crash mid-lines, or a failed rollback) -> `DELETE` it (restores stock), then create fresh. Never complete a half order in place: lines already written may be wrong.
   - >1 hits -> terminal `ShoperDuplicateOrderException` naming the ids (a prior duplicate exists; an operator decides which to keep). Never silently pick one.
3. `ShoperPartialOrderException` becomes RETRYABLE: with step 2 a retry removes the stale header and recreates, so it can no longer produce a second order. (Reverses #3693's terminal choice, which existed only because no recovery did.)
4. Tests: concurrency/retry proof at adapter level with a stateful fake shop (two sequential `createOrder` calls = one order; crash-after-create = the retry returns the same id; incomplete header = deleted and recreated; duplicates = refused). A true parallel race is core's lock (already covered there).

## 4. Steps (files)
1. `shoper-order-processor.adapter.ts`: require key, lookup, complete/incomplete/duplicate handling.
2. `domain/exceptions/shoper-duplicate-order.exception.ts`; retry classifier: duplicate terminal, partial no longer terminal (+ specs).
3. `domain/types/shoper-api.types.ts`: order list row slice.
4. Adapter spec with a stateful fake + README (idempotency section, remove the "do not enable" warning for duplicates).
5. Smoke: create, "lose" the mapping, retry -> same order; incomplete header (create header only) -> recreated.

## 5. Open questions
Q1 Incomplete existing order: delete and recreate (recommended), or refuse and leave to an operator?
Q2 OK to make the partial-order exception retryable now that retry self-heals?
Q3 The lookup costs one extra GET per createOrder. Acceptable (orders are low volume and a duplicate is a real fiscal/stock event)?
