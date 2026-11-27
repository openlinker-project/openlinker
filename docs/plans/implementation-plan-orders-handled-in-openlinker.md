# Implementation plan - /orders shows an order handled in OpenLinker (#3482)

Epic #3460. Branch `3482-handled-in-openlinker-on-3014`, cut from `3014-destination-routing-reason` (PR #3014, head `32e927de4`, already merged with `main`). **Local only: nothing committed or pushed, nothing written to GitHub.** Supersedes the 2026-09-29 draft, which targeted the top of an old stack that has since landed on `main` as squashes.

Design source: the M4 mockup the issue links ("Orders list with OMS status"), read from the downloaded copy. Annotation numbers below are that mockup's.

## 1. Task and scope

A routed order has no destination `syncStatus` rows by design: with the OMS on it is held in OpenLinker, not mirrored to a product master. On `/orders` and the order detail header it therefore reads "No destinations" / "Awaiting dispatch". Show it as handled in OpenLinker: its packing stage, and, when OpenLinker holds it, why it waits.

Layer: Interface (API read) + Frontend. Non-goals are in section 6.

## 2. Research

What is on `main` / on the #3014 base:

- `OrderRecordResponseDto` already carries `fulfillmentBlockReason` / `fulfillmentBlockDetail` and `fulfillmentRoutingSkipReason` (#3485, #3455), and #3014 adds `destinationRoutingBlockReason` + `destinationRoutingBlockDetail`. The **frontend type** (`apps/web/.../orders.types.ts`) knows only the #3014 pair, so the Waiting badge needs no backend change, only the FE types.
- Nothing on the DTO says an order is on the pack bench, and no packing stage exists on it. `fulfillment_works` is reachable only through `IFulfillmentWorkQueryService` (`resolveLinkForOrder`, `listBlockingRejectionConnectionIds`, `findWorkById`); `FulfillmentWorkRepositoryPort.findByOrderId` is per order. So the packing stage **does need a read**; the issue allows exactly this ("otherwise add the smallest read needed", annotation 3).
- Precedent for a batched per-page read: `getLatestInvoicesForOrders` (#1713), `loadOpenReturnsForPage` (#2998), `loadReservationShortfallsForPage` (#2350). All best-effort; a failed read degrades to "absent", never to a positive claim.
- `apps/api` `OrdersModule` does not import `FulfillmentModule` today. It already composes sibling core modules for read projections (`CoreInventoryModule`, `CoreShippingModule`, `CoreReturnsModule`), so adding `CoreFulfillmentModule` there is the same shape. `libs/core` `OrdersModule` already imports `FulfillmentModule` (#2401), so no new core-to-core edge.
- Health: `deriveOrderHealth` (FE) and its SQL twins partition orders into buckets; an order with no `syncStatus` falls into the residual `awaiting_dispatch`, even after delivery. Annotation 2 of the mockup proposed a sixth bucket; the issue's 2026-09-28 decision **D22 rejects that**: `OrderHealthValues` stays a partition and "handled in OpenLinker" is a separate non-partitioning field (the `salesDocumentBlocked` / #2350 shape).
- FE surfaces: list columns `channel` / `status` / `shipment` are cell renderers in `apps/web/src/pages/orders/orders-list-page.tsx` (lines ~706-830); the detail header is `features/orders/components/order-health-summary.tsx` + `lib/order-health.ts` (`syncCellLabel`), which #3014 already extended with `resolveDestinationRoutingCopy`.

## 3. Design

### 3.1 Backend - one batched read

Already written locally and unit-tested (23 specs green):

1. `libs/core/src/fulfillment/domain/types/order-work-summary.types.ts` - pure `OrderWorkStage = 'to-pack' | 'packing' | 'packed'`, `OrderWorkSummary {stage, workCount}`, `stageOfFulfillmentWorkStatus`, `summarizeOrderWork`. Mapping per the issue: `open` / `scheduled` -> to-pack, `in_progress` -> packing, `closed` -> packed. `on_hold` -> to-pack (still waiting to be packed). `cancelled` and `incomplete` take no part (a cancelled work is gone, a short-picked one waits for the router) so they can never make an order look packed. A split order reports the **earliest** stage across its works. Exported from the `fulfillment` barrel.
2. `FulfillmentWorkRepositoryPort.findStatusesByOrderIds(orderIds)` + implementation: one `WHERE "orderId" IN (...)`, header columns only (no line hydration), `orderId` is indexed.
3. `IFulfillmentWorkQueryService.summarizeWorkForOrders(orderIds): Promise<ReadonlyMap<string, OrderWorkSummary>>`. An order absent from the map has no live work, and the absence is **not** a positive "not routed" claim.

Still to do on the API side:

4. `apps/api/src/orders/http/dto/order-handled-in-openlinker.dto.ts` + optional `handledInOpenLinker` on `OrderRecordResponseDto` (DTO file written, field added).
5. `OrdersController`: inject `FULFILLMENT_WORK_QUERY_SERVICE_TOKEN`; one batched read per list page (`loadHandledInOpenLinkerForPage`, best-effort, `logger.error` on failure, returns an empty map) and a single-order read for the detail response. Add `CoreFulfillmentModule` to `apps/api/src/orders/orders.module.ts` imports.
6. Controller specs: batched exactly once per page; absent when no work; a failing read does not fail the list; detail carries the same shape as the row.

### 3.2 Frontend

7. `orders.types.ts`: add `handledInOpenLinker`, `fulfillmentBlockReason`, `fulfillmentBlockDetail`, `fulfillmentRoutingSkipReason`.
8. A pure view-model `features/orders/lib/handled-in-openlinker.ts` + copy in `handled-in-openlinker.copy.ts` (so `check-ui-vocabulary` scans it): stage label and tone from the field; waiting reason label from the **persisted** `fulfillmentBlockReason` only (`routing-refused` -> "Waiting: stock", `routing-no-shipping-address` -> "Waiting: address", `routing-failed` -> "Waiting: routing"; anything unrecognised renders nothing rather than a guess). Never computed in the browser (#2100).
9. **Channel column** (annotation 3): `<source> -> OpenLinker` instead of an empty destination, when `handledInOpenLinker` is present.
10. **Shipment column** (annotation 4): the packing stage as a **tick-style marker** (To pack / Packing / Packed), in time order, before the existing Dispatched / Delivered. A workflow position is a marker, not a pill (mockup rule 2). No "Generate label" action for work on the bench (D46) - the list has none to remove today for such orders; the view-model just must not introduce one.
11. **Status group** (annotation 5): a "Waiting: ..." badge beside the existing badges, **replacing the phase pill** for that order so "On hold" and "Waiting" never sit side by side. Warning tone, reason line warning-toned (not the failure red); the routing-error reason keeps the red.
12. **Detail header** (`order-health-summary.tsx` / `syncCellLabel`): when there are no destinations and `handledInOpenLinker` is present, the Sync cell hint reads "Handled in OpenLinker" instead of "No destinations configured". Precedence, decided here: **handled in OpenLinker -> routed to no destination (#3014) -> "No destinations"**. The #3014 neutral copy still wins for an order the router sent nowhere, since such an order has no work.
13. **Mobile card** (annotation 12): "Packing" fact replaces "Packed", and a waiting order gets a wide "Waiting on" fact with its reason (the card has no reason line).

### 3.3 Health bucket answer the PR must state

An order handled in OpenLinker has no `syncStatus`, so `deriveOrderHealth` lands it in `awaiting_dispatch` - and `awaiting_dispatch` stays true after delivery. Per D22 the bucket vocabulary is not extended. The PR states this and fixes only what can be fixed **inside** the existing buckets: nothing is changed in `deriveOrderHealth` in this slice (a fix needs the SQL twins and the KPI sum test), so it is recorded as a known limitation, not silently claimed. Confirm with you before widening.

## 4. Tests

- Core: pure fold spec (done), query-service spec (done), repository int-spec for `findStatusesByOrderIds` (split order, empty, ids from another order) - runs in CI (needs Docker).
- API: controller specs (3.1 step 6).
- FE: view-model unit tests (every stage, every waiting reason, unknown reason renders nothing, precedence in `syncCellLabel`), list-cell tests (channel, shipment marker, waiting badge replaces phase pill), `order-health-summary` tests (handled, routed-nowhere, no destination, has destinations unchanged).
- Quality gate: `pnpm lint`, `pnpm type-check`; unit specs for touched packages only (per your standing rule, the full suite runs in CI).

## 5. Architecture / standards check

- Hexagonal: port in domain, implementation in infrastructure, service behind `I*Service`, token injection; the controller reads through the service, never the repository port (`check-cross-context-imports`).
- The pure rule lives in a `*.types.ts` under the pure-rule exception (no I/O, it IS the rule for the type, both halves change together).
- No migration: nothing is stored on `order_records` in this slice.
- No new health bucket; the field is separate and non-partitioning.
- Frontend: server state via the list query, no raw API calls from the page, copy in `*.copy.ts`, tokens only, accessible names on the marker.

## 6. Deferred, with reasons

| Item | Why deferred |
|---|---|
| Chip "On pack bench N" and chip "Waiting in OpenLinker N · oldest 5 h" with server count/filter (annotations 5, 6) | A server filter or count needs a column on `order_records` written when routing commits, a migration and the SQL twin. Separate slice; the badges here do not depend on it |
| Filter by `?routing=blocked` interplay with the above | already shipped by #3014 |
| "Retry routing" action on a waiting order (annotation 11) | needs a new endpoint; belongs to #3511 |
| Order search / "Matched ..." line (annotations 1, 10, 13) | order search shipped in #3633 |
| Packed filter, open-return badge/filter (annotations 7, 8) | already on `main` (#2997 / #2998) |
| Committing the M4 mockup to `docs/plans/mockups/oms-mvp/` | the issue says the closing PR commits it, without annotation 2 (D22); done at ship time, from the downloaded copy, not before |
| Fixing the "awaiting dispatch after delivery" derivation | see 3.3: needs SQL twins; asked before widening |

## 7. Decisions (user, 2026-10-23)

1. 3.3 accepted: no bucket logic changes in this slice; the limitation is stated in the PR.
2. The two chips and everything else in section 6 stay deferred. **Every deferred item and every limitation must be written into the PR description** ("Known limitations / deferred"), so a reviewer knows we are aware of each.

## 8. Known limitations - to be stated verbatim in the PR description

- An order handled in OpenLinker still lands in the residual `awaiting_dispatch` health bucket, **even after delivery**, because it has no `syncStatus`. Not fixed here (D22 forbids a sixth bucket; a derivation fix needs the SQL twins and the KPI-sum test).
- No "On pack bench N" or "Waiting in OpenLinker N" chip, count or server filter: that needs a column on `order_records` written at routing commit, a migration and an SQL twin. The per-row badges do not depend on it.
- No "Retry routing" action on a waiting order (needs an endpoint; #3511).
- `handledInOpenLinker` absent means "no live work found", never "not routed"; the batched read is best-effort and degrades to absent on failure.
- A split order shows its **earliest** stage across works.
- The M4 mockup is not committed by this change; it is committed when the closing PR ships, without annotation 2 (D22).
- The "Waiting" reason comes from `fulfillmentBlockReason`; a reason this build does not recognise renders no badge rather than a guess.
- Integration tests for the new repository read have not been run locally (no Docker); CI is the gate.
- No repository integration spec was added for `findStatusesByOrderIds` (it needs Docker and the seed helpers for `fulfillment_works`); the batched query is covered by the service spec against a mocked port and by type-check only. Worth adding before merge if CI coverage of the query itself is wanted.
- Bench scanning before the parcel is shut writes no column on the work, so it still reads "To pack"; "Packing" appears only when the status is `in_progress` (executor-driven).
- `OrderWorkStageValues` exists twice (core and `orders.types.ts`) with no mirror script, unlike the other FE/core vocabulary pairs. An unknown stage renders nothing, so drift is safe but silent.
- The Waiting badge covers only the three #3485 reasons (`routing-refused`, `routing-no-shipping-address`, `routing-failed`). The three transient guards (`routing-in-doubt`, `routing-contended`, `routing-already-live-elsewhere`) render no badge.

## 9. Implementation status (local, uncommitted)

Done: backend read + DTO + controller (list batch, detail), FE types, view-model + copy, `OrderPackingStage`, `OrderPhaseOrWaitingBadge`, Channel / Shipment / Status cells, mobile card facts, detail header + Sync cell, CSS modifiers, tests. Gates: `pnpm type-check` clean for all packages; eslint clean (0 errors) on changed files; `check:invariants` clean; targeted suites green (core fulfillment+shipping 980, api orders http 84, web orders 940). Full `pnpm lint` for `apps/web` OOMs at the default heap on this machine, so changed files were linted with a larger heap instead.

## 10. Correction after a live check (2026-10-23)

A parcel packed on the bench showed "✓ Packed 6m ago" AND "○ To pack". Cause: the stage read `fulfillment_works.status` only, and the pack bench never moves `status` - it records progress in its own columns (`parcelClosedAt`, `completedAt`, `packedByUserId`). A live row: `status = open`, `parcelClosedAt` and `completedAt` set. The unit tests passed because they fed synthetic statuses, not the shape the bench writes.

Fix: `stageOfFulfillmentWork({status, parcelClosedAt})` - a closed parcel is `packed` whatever the status; `closed` is packed; `in_progress` is packing; otherwise to-pack; `cancelled` / `incomplete` still take no part. The repository read is `findProgressByOrderIds` (status + `parcelClosedAt`). A spec now asserts the bench's real shape (`open` + `parcelClosedAt` -> packed). On the FE the marker is hidden for a packed order that has `packedAt`, because the existing "✓ Packed <age>" tick is the Packed stage and also says when.

Known limitation added to section 8: scanning on the bench before the box is shut writes nothing on the work, so that window still reads "To pack"; "Packing" appears only for executor-driven `in_progress`.
