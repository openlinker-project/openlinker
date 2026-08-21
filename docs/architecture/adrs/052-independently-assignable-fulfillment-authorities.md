# ADR-052: Independently assignable, physically scoped fulfilment authorities

- **Status**: Proposed — draft (brainstorm output; number provisional, re-verify against the README
  reserved-numbers note and open PRs before filing)
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

OpenLinker is gaining a full OMS (multi-location inventory/ATP, sourcing, execution, lifecycle,
returns) that must ship as a first-party plugin while a third-party OMS can plug into the same
seams. Two integration postures exist: OL-as-orchestrator and OL-as-channel-gateway (an external
OMS owns orders; OL supplies channel connectivity + fiscal documents). Vendor research found no
platform serving both postures with one symmetric contract, and four documented breakage modes when
one tries (state-machine inversion, circular availability, idempotency-key direction, orphaned
refund/fiscal authority). The one verified pattern that composes is Shopify's fulfillment-service
model: authority delegated per *what a party physically controls*, granted and revoked by
handshake — never "who owns the Order".

## Decision

"OMS" is modelled as **six independently assignable authorities** — availability/ATP (per
location), sourcing/routing (per order, configured per channel), fulfillment execution (per work
object, by handshake), order lifecycle (per order, as fact producer), returns disposition (per
return), refund trigger (per payment instrument, **never assignable away from OL**) — with
invoicing/fiscalization integrated as already resolved by [ADR-041](./041-sales-document-routing-policy.md).
Each authority's default holder is **today's shipped behaviour, reachable with zero config**; each
conflict resolves to **inert-and-reported ambiguity** (the #2047 rule: an unrouted order is
recoverable, a double-shipped one is not). The two postures ship as two named **presets** writing
the same per-authority flags — one build, one contract, no mode switch.

## Alternatives considered

- **A single `OmsPort` an OMS either holds or not**: fails the mid-market archetype (stock master,
  weak routing) and the 3PL archetype (execution for one location only); recreates order-ownership
  and with it the orphaned-refund problem that has no precedent.
- **Two builds / two contracts per posture**: posture B reuses the shipped ingestion pipeline
  almost entirely; a second contract would duplicate `OrderIngestionService` to change one
  predicate.
- **A global "order owner" setting**: every breakage mode the research documented follows from
  exactly this shape; refund/fiscal authority cannot follow the order owner because only the
  credential holder can act.

## Consequences

**Pros:**
- Zero-config installs are byte-identical; every authority degrades to current behaviour.
- The gateway posture costs ~5% of the build (an `OrderSource` adapter + a fact-producer seam +
  the [ADR-057](./057-adr-017-authoritative-reingestion-amendment.md) predicate).
- The orphaned refund/fiscal problem dissolves: A6/A7 are physically scoped and never move.

**Cons / trade-offs:**
- Six flags are a misconfiguration surface — mitigated by presets as the product UX.
- Enforcement is distributed across owning contexts (see [ADR-053](./053-fulfillment-authority-vocabulary-leaf.md)),
  not centralised.

## References

- Related issues: #1032, #2047
- Related ADRs: [ADR-041](./041-sales-document-routing-policy.md), [ADR-044](./044-order-changeset-proposed-then-confirmed.md), [ADR-053](./053-fulfillment-authority-vocabulary-leaf.md), [ADR-057](./057-adr-017-authoritative-reingestion-amendment.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md)
