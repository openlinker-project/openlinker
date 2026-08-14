# ADR-044: Order mutations as proposed-then-confirmed changes

- **Status**: **Proposed.** `order_changes` does not exist — zero occurrences of `order_changes` /
  `OrderChange` in `libs/` or `apps/`. The table is net-new and additive; nothing may describe it as
  existing until it ships.
- **Date**: 2026-08-13
- **Authors**: @piotrswierzy

## Context

OpenLinker is never the executor of an order mutation. Dispatching, cancelling, returning and writing
status back are all *requests to a marketplace or shop* that owns the truth and may reject them.
Today those paths mutate `OrderRecord` directly through five repository methods across three bounded
contexts, with at-most-once behaviour hand-rolled per call site (`Shipment.waybillRelayedAt`,
`isFirstDispatchTransition`, `cancelledAt` COALESCE). There is no record of who requested versus who
confirmed, and a remote refusal is swallowed at whichever call site received it.

A stronger constraint shapes the answer. **OpenLinker cannot change an order's composition.** The
marketplace owns order identity, and `identifier_mappings` enforces that as a **bijection per
connection** — `UNIQUE (entityType, platformType, connectionId, externalId)` and
`UNIQUE (entityType, connectionId, internalId)`. Splitting an order needs 1→N; merging needs N→1.
Neither index is relaxable: the second exists so one internal id can carry different external ids
across *different* connections, which is what makes cross-destination routing work.

This was verified by working both scenarios through. Splitting produces a child order that is
permanently unmappable on its origin connection, so a marketplace cancellation resolves to the parent
and **leaves the child live and shippable**. Merging fails on the second index outright; skipping the
remap leaves the loser order mapped, and the next poll refreshes its snapshot with the lines that
moved — the merge un-merges itself.

The reference implementation this pattern comes from (Medusa's `order_change` /
`order_change_action`) exists to serve order **editing**, returns, claims and exchanges — mutations of
composition — and notably ships **no split or merge action** among its 23. Those are precisely the
mutations OpenLinker is forbidden from. The pattern therefore arrives without most of its use case.

## Decision

Adopt the **proposal record** and reject the composition machinery.

`order_changes` carries `PENDING | REQUESTED → CONFIRMED | DECLINED | CANCELED`, with `requested_by`,
`confirmed_by`, `declined_reason` and timestamps, plus an `applied` boolean and a **partial unique
index** enforcing one open change per order (OL runs concurrent workers, so an application-code guard
would be a race).

`applied` becomes the single at-most-once primitive, replacing the three hand-rolled claims above.

**Defer** `order_change_actions`, the `{ validate, operation }` action registry, and the replay
function until a genuine multi-action composition appears in scope. Every mutation OL can actually
perform — dispatch, cancel, status write-back, issue invoice, issue correction, stock restore, return
acceptance — is a **single action against a single reference**. `ordering`, replay and a polymorphic
`reference` pair exist to serve compositions that do not exist here.

Dry-run does **not** belong to this ADR. What operators mean by dry-run is "why didn't my rule fire" —
evaluation of the rules engine's condition AST, a pure predicate over already-loaded state. That is
delivered by the rules-engine purity constraint, independently.

## Alternatives considered

- **Full changeset with actions + replay (the reference shape)**: rejected — its justifying use cases
  (edit, split, merge) are structurally unavailable, and replay-produces-preview does not survive
  anyway, because `internalOrderId` is minted as a side effect of the mapping INSERT, so previewing a
  new entity would have to write.
- **Keep direct mutation, add an audit table**: rejected — gives history but not a declined-as-outcome
  record, and leaves at-most-once logic scattered per call site.
- **Event-source the whole order**: rejected — OL does not own order composition, so the aggregate
  would be sourced almost entirely from foreign observations.

## Consequences

**Pros:**
- `applied` generalises three bespoke at-most-once claims into one primitive.
- A remote refusal becomes a first-class, queryable outcome instead of a swallowed error.
- Uniform operator audit (`requested_by` / `confirmed_by` / `declined_reason`).
- Cost is one table, not two plus a registry plus a replay path on every mutation.

**Cons / trade-offs:**
- No multi-action composition. If partial cancellation ("cancel 2 of 5 lines") proves supported by
  Allegro or Erli, that is the first real composition and this decision should be revisited.
- No preview of a mutation's projected effect; only of a rule's evaluation.

**Migration path:**
- Additive table. Existing mutation paths move over one at a time; each ad-hoc claim is removed only
  in the same commit that routes its call site through the change record.

## References

- Related issues: #1032, #1947
- Related ADRs: [ADR-043](./043-order-lifecycle-derived-from-fact-ledger.md), [ADR-014](./014-source-authoritative-order-pricing.md), [ADR-017](./017-cross-origin-order-reingestion-guard.md)
- Plan: [ANALYSIS-1032-oms-module](../../plans/analysis/ANALYSIS-1032-oms-module.md)
- Grain decision: [DECISION-oms-fulfilment-grain](../../plans/analysis/DECISION-oms-fulfilment-grain.md)
