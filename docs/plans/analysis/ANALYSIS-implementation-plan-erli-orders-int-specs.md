# Pre-Implement Readiness Gate — #998 Erli Orders Vertical-Slice Int-Specs

**Date**: 2026-06-16
**Plan**: `docs/plans/implementation-plan-erli-orders-int-specs.md`
**Branch**: `998-erli-orders-int-specs` (stacked on `997-erli-writeback`) — the final Erli issue
**Gate type**: read-only readiness

## Verdict: ✅ READY

Test-only: new int-spec + new order-source test helper, reusing #991's `ErliFakeHttpClient` (+ raw-path scripting addition), plus a one-line `setup.ts` scheduler-gate fix. No production runtime change; no migration; no contract break.

## Reuse findings

| Plan artifact | Classification | Evidence |
|---|---|---|
| `apps/api/test/integration/helpers/erli-fake-http-client.ts` | **REUSE** (from #991) + add `setRawGet`/`enqueueRawGet` | present; scripts only `products/{id}` via private `pathFor` (`:144`) — raw-path scripting is a **blocking prereq** |
| `apps/api/test/integration/helpers/erli-test-order-source.helper.ts` | **NEW** (mirror #991 offer helper) | absent |
| `apps/api/test/integration/erli/erli-orders-vertical-slice.int-spec.ts` | **NEW** | absent |
| `setup.ts` `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED:'false'` | **NEW** (determinism fix) | only the offer-status gate present (`setup.ts:115`) |

## Seam-accuracy findings (confirmed)

| Seam | Status | Evidence |
|---|---|---|
| `IOrderIngestionService` / `ORDER_INGESTION_SERVICE_TOKEN` (`syncOrderFromSource`/`ingestOrders`) | exported | `orders/index.ts:96`; token `orders.tokens.ts:13` (review) |
| `InboundRoutingPolicyService` + `IInboundRoutingPolicyService` (order→`marketplace.order.sync`) | exported | `sync/index.ts:108-109` |
| `ErliWebhookEventTranslator` (REAL, direct-invoked) | present | `erli-webhook-event-translator.adapter.ts:63` (review) |
| `ErliOrderSourceAdapter` ctor `(connectionId, httpClient)` | present | review-confirmed |
| webhook DTO `eventType` regex vs translator camelCase (the #992 HTTP block) | confirmed structural | `webhook-request.dto.ts:62-67` vs translator `:63` (review) |
| `erli-orders-poll` cron registered by API-booted plugin; gate defaults enabled | confirmed | `erli-scheduler-tasks.ts`, `erli-plugin.ts`, `scheduler.service.ts:97-99` (review) |
| item-ref resolver needs `ProductVariant` mapping **and** variant row | confirmed | `order-item-ref-resolver.service.ts:90-100` (review) |
| routing/capability int-specs ripple from #993 `OrderSource` | **zero breakage** | `erli-plugin.spec.ts:99` already expects both; others use `arrayContaining`/other platforms (review) |

## Backward-compatibility findings

None. New test files + one additive `setup.ts` env gate (disables a background cron in-suite — strictly safer). The #993 manifest `OrderSource` addition breaks zero existing assertions (audited).

## Open questions (non-blocking, resolved in-plan)

- Webhook→sync proven by **direct invocation** (real translator + routing); live HTTP front door is #992-gated (DTO regex vs translator camelCase). Documented.
- `ready` orders seed both the `ProductVariant` mapping and row; a negative scenario asserts `awaiting_mapping`/`MissingOrderItemMappingError`.
- All wire fixtures #992-provisional, synthetic PII (`@example.test`).
- **Binding AC**: full `pnpm test:integration` must run green (Testcontainers) — the implementer must run it, not just the new spec.
