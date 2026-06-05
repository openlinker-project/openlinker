# ADR-019: Synchronous bulk shipment dispatch (loop the per-order seam)

- **Status**: Accepted
- **Date**: 2026-06-03
- **Authors**: @pjswierzy

## Context

Shipping dispatch is per-order today: `ShipmentDispatchService.dispatch(input)` produces one `Shipment` and already owns routing resolution (#832), the payment-status gate (#938), per-order idempotency (`findActiveByOrderId`), and `Shipment`-row creation. #964 (DPD Polska) needs a bulk surface — dispatch N orders' labels in one action and produce one DPD handover protocol (the courier hand-off manifest), with per-order success/failure and partial-failure survival.

The issue flagged the orchestration shape as undecided. The tempting precedent is the listings bulk-offer aggregate (#726/#734): a parent batch row, a `bulk_*_advancements` at-most-once gate, submit/progress/retry services, a worker fan-out job, and an FE progress-polling page. That machinery exists because offer creation is **N slow, independent, rate-limited Allegro calls** that run for minutes, must survive worker restarts, and need durable progress + retry. DPD bulk is a different workload: a handful of fast HTTP calls, and the protocol is a single batch-native call.

The decision must also hold for the next consumer of this seam: #831 (Allegro Delivery dispatch manifest + courier pickup), whose dispatch half **is** the slow, source-brokered workload.

## Decision

Build a **synchronous** core `BulkShipmentDispatchService` that loops the existing per-order `ShipmentDispatchService.dispatch()` (inheriting all four per-order guarantees with zero duplication), isolates per-order failures with a `try/catch` per item, then issues one carrier-neutral `DispatchProtocolReader.generateProtocol()` over the dispatched waybills. No async executor, no durable batch record, no migration. The bulk API caps N at **25**.

The fork is treated as three *separate* deferral decisions, not one binary:

- **(a) Async executor — rejected.** Justified only by slow/rate-limited/restart-surviving per-item calls. DPD bulk isn't that.
- **(b) Durable batch record — deferred on its own terms.** #964's partial-failure AC is met by per-order `Shipment` rows; a batch row would add navigate-away + batch-subset retry, which #964 doesn't require.
- **(c) Per-order-prepare / batched-execute split — named, not built.** v1 loops `dispatch()` (N sequential outbound calls); the long-term shape separates per-order prepare (routing + gate + `Shipment` row) from one batched adapter call (e.g. DPD `generatePackagesNumbers` with N packages).

## Alternatives considered

- **Async `BulkShipmentDispatchBatch` aggregate (bulk-offer clone)**: durable batch + worker fan-out + advancement gate + progress polling. Rejected — large, mostly-idle scaffold for a fast workload; it is the wrapper #831 adds later, around this seam.
- **Adapter-local batch (no core seam)**: rejected — duplicates routing/payment-gate/idempotency/`Shipment`-row logic in the adapter, and the protocol capability must be core anyway (carrier-neutral, #831 reuses it).
- **Batch-native single `generatePackagesNumbers` for v1**: deferred (decision (c)) — bypasses the per-order dispatch seam; the loop preserves all guarantees and the N≤25 cap bounds the cost.

## Consequences

**Pros:**
- Reuses every per-order guarantee with zero duplication; partial-failure isolation is a `try/catch`.
- No migration, no worker, no FE polling — M–L instead of L–XL.
- The synchronous service is the exact seam an async wrapper (#831) later calls — sync-now forecloses nothing.

**Cons / trade-offs:**
- v1 issues N sequential outbound calls in one request → a real request-timeout ceiling. Mitigated by the **N≤25** cap (vs bulk-offer's 100, which is safe only because it fans out to async workers).
- Trades DPD-native batch-create efficiency for per-order-seam reuse; the cap is removable once decision (b) or (c) lands.

**Migration path (if applicable):**
- (b)/(c) are additive: add `bulk_shipment_dispatch_batch` + `Shipment.bulkBatchId`, then move execution into a worker. The capability + service signatures stay; #831 is expected to drive this.

## References

- Related issues: #964, #831, #832, #938
- Related ADRs: [ADR-002](./002-capability-ports-with-sub-capabilities.md), [ADR-018](./018-dpd-polska-rest-api-over-soap.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
- Plan: [implementation-plan-964-dpd-bulk-protocol.md](../../plans/implementation-plan-964-dpd-bulk-protocol.md)
