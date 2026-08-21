# ADR-059: Order lifecycle phase as a derived projection over persisted facts

- **Status**: Proposed.
  Successor to [ADR-043](./043-order-lifecycle-derived-from-fact-ledger.md)'s reverted proposal;
  upholds its materialised-column and vocabulary-relationship findings and retires its
  pure-function claim.
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

ADR-043 was reverted on findings referenced here by content (its numbering differs): a
materialised `canonicalState` buys nothing over the shipped `CASE`+ordinal pattern, and the state
reduces to a pure function of `fulfillmentState` + `cancelledAt`; the vocabulary was never
defined; and the relationship to the existing canonical vocabularies (`OrderStatus`,
`order_state_mappings`) was never stated. The OMS introduces facts that expire the pure-function
claim:
a **held** order and an **amendment-in-flight** order are `not-shipped` + `cancelledAt IS NULL` —
byte-identical to an ordinary order in every existing column — and that difference is the
operational point. `order_records` already carries six quasi-status axes, each with a single
writer, excluded from `toOrm`, written by narrow conditional UPDATEs.

## Decision

**Persist the new facts, never a canonical state; derive the phase.** New facts, each at its own
grain with one writer: `order_holds` (partial unique on the open row; place/release both
double-call-safe) + a denormalised `order_records.activeHoldReason`; ADR-044's `order_changes`
with an `OrderAmendmentKind`; posture-B `vendorLifecycleLabel/ObservedAt` (timestamp-guarded
newest-wins). The derived **`OrderLifecyclePhase`** has nine defined values with a precedence table
(`cancelled` › `vendor_authoritative` › `delivered` › `in_transit` › `fulfillment_failed` › `held`
› `amending` › `blocked` › `ready`), computed by a pure function mirrored by a repository `CASE`
and a mirror-check script — no clock input, no materialised column, and it is a second orthogonal
partition beside `OrderHealth`, never a sixth health bucket. **The relationship to the existing
canonical vocabularies is stated** (the revert's precondition): `OrderStatus` stays the transport
vocabulary for `OrderCreate`/`OrderFulfillmentUpdater`; the phase projects one-way onto it via a
defined `phaseToOrderStatus` mapping and never reads back; `order_state_mappings` (the operator-
configured destination translation) stays transport-layer and never feeds the derivation.
Vocabulary lives in a new
dependency-free leaf `order-lifecycle` (the `sales-documents` pattern), including the single merged
hold-reason union used at both order and fulfillment-work grains. The **relay** union gains exactly
one member (`amended`); all other OMS facts form an internal-only `OmsLifecycleFact` union that
never crosses an adapter boundary. The cancellation window is closed by **downstream documents**
(dispatched shipment; fiscal registration; `blocksIssuanceElsewhere`; accepted work = soft close),
never by a clock; source-reported cancels are observations and are never gated. Posture B: adapters
optionally declare their state graph (`LifecycleAuthorityProvider`); no declared transitions ⇒ no
validation (the commercetools escape hatch); an undeclared state renders the vendor's label
verbatim as `vendor_authoritative` — OL never fabricates a phase, and plugins can never add a
state ("actions yes, states no").

## Alternatives considered

- **The per-axis fact ledger (ADR-043 as written)**: every new fact has a better-typed home at its
  own grain; the ledger cannot express claim-then-release.
- **A materialised canonical column**: six inputs written by five contexts is an invalidation
  surface; the `CASE`+ordinal pattern has shipped three times.
- **An open, operator-defined vocabulary (BaseLinker parity)**: an open axis can never be closed;
  operator stage labels may map one-way onto the phase but never feed the derivation.

## Consequences

**Pros:** the operator's actual question ("what is this order waiting on, and who holds it up")
gets a defined answer; every input is recomputable from the row. **Cons:** nine phases and their
precedence are now contract; the FE/SQL mirrors add a second guarded vocabulary. **Preconditions
(ship first):** the `WHERE cancelledAt IS NULL` provisioning predicate; `never`-defaults on the
five existing event consumers; the ingestion line-diff.

## Supersedes

- [ADR-043](./043-order-lifecycle-derived-from-fact-ledger.md) — superseded because this ADR is
  the settled answer to the same question (043 was Proposed-and-reverted; leaving both Proposed
  would put two live proposals on one subject in the index). Set ADR-043's status to
  `Superseded by ADR-059` when this merges.

**Reversal gate**: a demonstrated operator-facing state the derivation cannot express (the
ADR-043 test, re-applied) re-opens the persisted-state question; operator demand for custom stage
labels re-opens only a one-way label overlay, never the derivation.

## References

- Related issues: #1032
- Related ADRs: [ADR-043](./043-order-lifecycle-derived-from-fact-ledger.md), [ADR-044](./044-order-changeset-proposed-then-confirmed.md), [ADR-027](./027-order-status-writeback-capability-and-relay.md), [ADR-041](./041-sales-document-routing-policy.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §6
