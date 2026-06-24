# ADR-028: Order-cancellation-observe hook → marketplace stock-restore

- **Status**: Proposed
- **Date**: 2026-06-22
- **Authors**: @norbert-kulus-blockydevs

## Context

Some marketplaces auto-decrement an offer's stock on purchase but do **not**
restore it on cancellation (Erli — ADR-025 §4a). The compensating mechanism
(`ErliOfferManagerAdapter.restoreStockOnCancellation`, #997) existed but was
wired to no trigger: `OrderProcessorManagerPort` exposes only `createOrder`, and
`OrderIngestionService` persists a `cancelled` status without emitting any
status-change signal. The gap is marketplace-agnostic — any future adapter with
the same asymmetric-stock behaviour needs the same trigger + orchestration.

## Decision

Add a **marketplace-neutral `OfferStockRestorer` sub-capability** of
`OfferManagerPort` (`restoreStockOnCancellation(targets: readonly
OfferStockRestoreTarget[])`), and a **cancellation-observe hook** in
`OrderIngestionService.syncOrderFromSource`: on the `→ cancelled` transition
(prior business status read from the pre-persist record), enqueue a
`marketplace.offer.stockRestore` sync job. A thin worker handler delegates to the
core `OfferStockRestoreService` (listings context), which loads the order's
resolved variant ids, resolves their distinct external offer ids + the absolute
master-inventory target per variant, and dispatches the source connection's
`OfferStockRestorer` (no-op when the capability is absent).

**Core resolves availability and passes plain `{ externalOfferId, quantity }`
targets** — the adapter never receives a core inventory service and never reads
back marketplace stock.

## Alternatives considered

- **In-process call inside ingestion (no job)**: rejected — couples `orders` →
  `inventory`/`listings` at runtime in the hot ingestion path and isn't
  independently retry-safe.
- **Extend `OrderProcessorManagerPort` with cancel/restore**: rejected — restore
  is an offer/stock concern (`OfferManager`), not destination order-processing.
- **Redis-streams `order.cancelled` domain event + listings listener**: viable
  and more decoupled, but heavier than the existing `marketplace.offer.*` job
  idiom for a single consumer; revisit if more cancellation consumers appear.

## Consequences

**Pros:**
- Marketplace-agnostic seam — any future adapter declares `OfferStockRestorer`.
- Idempotent: transition-gate + per-`(connection, order)` dedupe key + the
  absolute-set restore (re-runnable by construction) ⇒ at-most-once, harmless if
  it runs twice.
- Plugin contract stays free of any core inventory service.

**Cons / trade-offs:**
- New cross-context edge `listings → orders` (via `IOrderRecordService`,
  token/interface-only — within the cross-context contract). Not cyclic: orders
  does not import listings.
- A frozen-stock offer (Erli #1066) is skipped by the restore — a seller who
  froze stock owns it.

**Migration path:**
- The #997 `restoreStockOnCancellation(variantOfferIds, inventoryQuery)`
  signature is refactored to `(targets)`. Unreleased ⇒ no compat break.

## References

- Related PRs: #1146, #997
- Related issues: #1146
- Related ADRs: [ADR-025](./025-erli-marketplace-adapter.md), [ADR-002](./002-capability-ports-with-sub-capabilities.md), [ADR-010](./010-variant-keyed-master-inventory.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
