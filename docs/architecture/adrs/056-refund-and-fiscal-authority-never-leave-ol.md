# ADR-056: Refund and fiscal authority never leave OpenLinker

- **Status**: Proposed
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

In the gateway posture an external OMS owns the order, but OL holds the marketplace credential
(refund execution) and the [ADR-041](./041-sales-document-routing-policy.md)-resolved invoicing/
fiscalization connection. Vendor research found **no precedent** reconciling "OMS owns the order,
platform owns the money and the fiscal document" — the least-precedented breakage mode of a
dual-posture design. Meanwhile #2047 established the asymmetry rule for fiscal acts: an unissued
document is recoverable by hand, two issued documents for one sale are not.

## Decision

Refund trigger (A6) and invoicing/fiscalization (A7) are **physically scoped and never
assignable**, in either posture. A refund is a call on a payment instrument only the credential
holder can make; a fiscal document is a legal act through a provider connection OL owns. Neither
follows from "owning the order". An external OMS therefore **supplies facts and requests, never
holds the authority**: a `refund-requested` fact (amount, lines, reason) that OL's `orders` context
executes or refuses under a per-order lock + persisted attempted-predicate (the
`InvoiceRecord.blocksIssuanceElsewhere` shape) — with the ordering that makes that shape safe
**restated, not inherited by analogy** (R1): the attempted-predicate is persisted **before** the
provider call, and `ReturnMoneyState.in_doubt` records a crossed-but-unconfirmed boundary,
blocking like `pending` and cleared only by a terminal observation, so a crash between the
marketplace's 200 and the predicate write cannot double-refund; and order transitions that feed
ADR-041's
`AutoIssueTriggerService` exactly as OL's own ingestion does — its inputs change in posture B, its
authority does not, and since it reports a `SalesDocumentBlockOutcome` for the caller in `orders`
to persist rather than writing one itself, **no new `orders` edge** appears. That is the property
`invoicing-auto-issue-boot.int-spec.ts` pins, and it survived #2156/#2173 giving that service
three unrelated new dependencies (`integrations`, the `sales-documents` rule service, a lazy
`ModuleRef` resolve of `IFiscalRegistrationService`).
Where no refund executor exists (true of every shipped adapter today), the trigger confirms to
`executedBy: 'operator_out_of_band'` — an honest description of who moves money.

## Alternatives considered

- **Delegate refund authority to the OMS**: it does not hold the credential; the delegation would
  be a proxy through OL anyway, minus the guard. Refused for the enterprise-DOMS archetype
  explicitly, since it is the one that asks.
- **Fiscal documents follow the order owner**: ADR-041's routing policy is per-order and
  OL-resolved; moving it per posture would fork the one-originating-document guard into two
  authorities — the #2047 defect reintroduced by configuration.
- **A shared "financial authority" the operator assigns**: invents an assignable right that no
  party other than the credential holder can exercise; misconfiguration produces double refunds,
  which are unrecoverable.

## Consequences

**Pros:**
- The orphaned-authority problem dissolves; posture B needs no new financial machinery.
- Double-refund and double-document impossibility keeps resting on shipped, tested guards.

**Cons / trade-offs:**
- An enterprise DOMS that insists on owning refunds cannot be accommodated; its adapter degrades
  to request-and-observe. Stated in the adapter guide rather than discovered in production.

*Reversal gate (prose-only):* an OMS that itself holds the payment-instrument credential (or the fiscal
provider connection) would shift the physical-scoping premise — that concrete case, and nothing
weaker, re-opens this ADR.

## References

- Related issues: #2047, #2156/#2173 (the gate's new dependencies; the `orders` edge still absent)
- Related ADRs: [ADR-041](./041-sales-document-routing-policy.md), [ADR-042](./042-fiscalization-capability.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §8
