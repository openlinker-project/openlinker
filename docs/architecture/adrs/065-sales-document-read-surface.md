# ADR-065: One per-order sales-document read, and no third state vocabulary

- **Status**: Proposed
- **Date**: 2026-08-26
- **Authors**: @norbert-kulus-blockydevs

## Context

Three surfaces answer the same question about one order - *which document does this sale get, and where is it?* - and each would assemble the answer differently. `/settings/sales-documents` shows what a market issues, the `/orders` row shows it per order, and the order-detail panel shows it in full.

The facts live in two aggregates with two vocabularies. An invoice carries `InvoiceStatus` **and**, separately, `RegulatoryStatus`. A fiscal registration carries `FiscalRegistrationStatus`, terminal at `registered`, with **no** authority rung at all ([ADR-042](./042-fiscalization-capability.md)). Why an order got no document is a third thing again: `salesDocumentBlockReason` / `salesDocumentUnresolvedReason`, persisted on `order_records` by [ADR-041](./041-sales-document-routing-policy.md) decision 11.

A design review of the redesign of all three surfaces (#2513) found two failure modes. First, a surface that re-derives a reason it could have read: a draft printed `no rule for PL` from the order's country while the persisted reason was something else entirely - a false statement about the operator's own configuration. Second, a surface that invents a fourth vocabulary: a draft collapsed the two invoice axes into one enum, which made *issued, then rejected by the authority* - the exact state `RegulatoryResubmitter` exists for - unrepresentable.

## Decision

**One neutral per-order projection is the only read these surfaces use**, and it composes the **existing** vocabularies rather than defining a new one.

The projection carries: the resolved `SalesDocumentKind`; the status on the axis belonging to that kind (both invoice axes, or the single fiscal axis); the identity fields a surface renders (document number, provider, timestamps); the persisted block and unresolved reasons **verbatim**; and the other connections holding a record for the order.

Two rules follow, and they are the load-bearing half:

1. **A surface never re-derives a fact the backend persists.** A reason is rendered from the persisted value or not at all.
2. **A fiscal receipt has no authority axis.** Nothing in the projection can express an authority answer for one, so no surface can render a confirmation that does not exist.

## Alternatives considered

- **One flattened status enum across both kinds.** Simplest for a table cell. Rejected: it cannot express *issued but rejected by the authority*, and `cleared` is meaningless on a receipt - a value that type-checks and means nothing is worse than two axes.
- **Each surface composes the two existing reads itself.** No new type. Rejected: it puts the classification logic in three places, and the review found the browser copy of it already producing a false claim.
- **A materialized read model.** Rejected at this volume, matching the reasoning in [ADR-036](./036-cross-context-read-model-joins.md) and [ADR-039](./039-order-analytics-read-model-persistence-strategy.md).

## Consequences

**Pros:**
- One shape, so the list and the detail page cannot disagree about the same order.
- The two-axis invoice survives, so a resend action has a state to attach to.
- The list read is batched, so rendering N rows costs one query, following the `getEarliestOrderDateByConnection` precedent (#2083).

**Cons / trade-offs:**
- A caller must know which axis belongs to which kind. The type makes the other axis unrepresentable rather than merely unset, which is the point.
- The projection is a read composed over two contexts, so a new document kind touches it.

**Migration path:**
- Additive. Existing invoice and fiscal reads keep their callers; the projection is a new read consumed by the three redesigned surfaces.

## References

- Related issues: #2501, #2513, #2514, #2515, #2516, #2517
- Related ADRs: [ADR-041](./041-sales-document-routing-policy.md), [ADR-042](./042-fiscalization-capability.md), [ADR-036](./036-cross-context-read-model-joins.md)
- Vocabulary source of truth: `apps/web/src/features/invoicing/components/invoice-status-badge.tsx`, `.../regulatory-status-badge.tsx`, `apps/web/src/features/fiscalization/components/fiscal-receipt-status-badge.tsx`
- UX mockup: [`docs/plans/mockups/sales-document-routing.html`](../../plans/mockups/sales-document-routing.html)
