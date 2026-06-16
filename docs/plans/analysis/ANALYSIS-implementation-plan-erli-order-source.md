# Pre-Implement Readiness Gate — #993 ErliOrderSourceAdapter

**Date**: 2026-06-16
**Plan**: `docs/plans/implementation-plan-erli-order-source.md`
**Branch**: `993-erli-order-source` (stacked on `994-erli-order-mapper`)
**Gate type**: read-only readiness

## Verdict: ✅ READY

New Integration-layer adapter + provisional inbox types + scheduler task + lockstep capability wiring. All additive; zero CORE edits; no migration; no contract break.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `erli-order-source.adapter.ts` | **NEW** | `ls` — absent |
| `erli-inbox.types.ts` | **NEW** | `ls` — absent |
| `__tests__/erli-order-source.adapter.spec.ts` | **NEW** | `ls` — absent |
| `erli-orders-poll` scheduler task | **NEW** (extends `buildErliSchedulerTasks`) | `erli-scheduler-tasks.ts:34` (only `erli-offer-status-sync` today) |
| `OrderSource` capability | **NEW for erli** (manifest currently `['OfferManager']`) | `erli-plugin.ts:52` (code comment pre-plans "#993 adds 'OrderSource'") |

## Seam-accuracy findings (confirmed)

| Seam | Status | Evidence |
|---|---|---|
| `OrderSourcePort`, `OrderFeedInput/Item/Output` | exported from barrel | `orders/index.ts:11,71-73` |
| `marketplace.orders.poll` jobType → `OrdersPollHandler` → `OrderIngestionService.ingestOrders` | registered worker handler | `handler-registration.service.ts:59` (review-confirmed) |
| Cursor commit-after-enqueue + `isCursorRegression` guard | core drives it | `order-ingestion.service.ts:131,138-176` (review-confirmed) |
| Factory `ErliAdapters` bundle + `createAdapters` | edit point exists | `erli-adapter.factory.ts:37,57,65` |
| Manifest `supportedCapabilities` + dispatch table (one `const`, no static/runtime drift) | edit points exist | `erli-plugin.ts:52,105` |
| Erli plugin registered in worker (so the poll task fires) | confirmed | `apps/worker/src/plugins.ts:49` |
| `IErliHttpClient` get/post/patch (inbox GET + order GET + ack PATCH) | package-private, relative import | `erli-http-client.interface.ts` |
| #994 mapper `mapErliOrderToIncomingOrder` (consumed by `getOrder`) | present on branch | `erli-order.mapper.ts` |

## Backward-compatibility findings

None. Adding `OrderSource` to `supportedCapabilities` + the factory bundle is additive; the static manifest is the same `const` the runtime descriptor returns (no #575 drift). New scheduler task + new adapter file. CORE untouched.

## Open questions (non-blocking, #992-provisional — flagged in plan)

- All inbox unknowns: endpoint path/shape, message-id ordering/monotonicity (the ack-on-next-read + cursor design's hard precondition — falls back to timestamp if ids aren't monotonic), event-type literals, ack mechanism, order-fetch path. Single reconciliation point `erli-inbox.types.ts`.
- Cancellation stock-restore (ADR-025 §4a) deferred: no core order-cancel hook exists (`OrderProcessorManagerPort` has only `createOrder`). Adapter surfaces `cancelled` faithfully for the future hook.
