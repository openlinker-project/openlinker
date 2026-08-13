# ADR-040: Order mutations as proposed-then-confirmed changesets

- **Status**: Proposed
- **Date**: 2026-08-13
- **Authors**: @piotrswierzy

## Context

OpenLinker is never the executor of an order mutation. Dispatching, cancelling, returning and writing
status back are all *requests to a marketplace or shop* that owns the truth and may reject them.
Today those paths mutate `OrderRecord` directly through five repository methods across three bounded
contexts, with at-most-once behaviour hand-rolled per call site (`Shipment.waybillRelayedAt`,
`isFirstDispatchTransition`, `cancelledAt` COALESCE).

The consequences are concrete: no preview of what an action will do, no record of who requested
versus who confirmed, and no uniform way to make a retry idempotent — each site reinvents it.

A separate requirement points the same way. Dry-run is the clearest differentiator available (no
surveyed competitor offers one, and the market leader's rule engine has a dedicated "why didn't my
rule fire" support article). Dry-run is cheap only if applying and previewing share one code path.

## Decision

Model every order mutation as a **changeset**: `order_changes`
(`PENDING | REQUESTED → CONFIRMED | DECLINED | CANCELED`, with `requested_by`, `confirmed_by`,
`declined_reason` and timestamps) plus `order_change_actions` — append-only, `ordering`-sequenced,
each carrying an `applied` boolean and a polymorphic `reference` / `reference_id`.

Action types register into an open `{ validate, operation }` registry rather than a `switch`.
**One replay function produces both the preview and the applied result**; preview writes nothing.

Two departures from the reference implementation this is modelled on: "one open change per order" is
enforced by a **partial unique index** rather than application code, because OL runs concurrent
workers; and the replay window is **capped** rather than replaying unbounded history.

## Alternatives considered

- **Keep direct mutation, add an audit table**: rejected — gives history but no preview, and leaves
  at-most-once logic scattered per call site.
- **Event-source the whole order**: rejected — OL does not own order composition (the marketplace
  does), so the aggregate would be sourced almost entirely from foreign observations.
- **A generic outbox for outbound calls**: rejected as a substitute — it solves delivery, not proposal
  semantics, preview, or operator audit. It remains complementary (see the ledger-as-outbox decision
  in the plan).

## Consequences

**Pros:**
- `applied: boolean` generalises the three existing bespoke at-most-once claims into one primitive.
- Preview and dry-run fall out of the model rather than being built.
- Operator audit (`requested_by` / `confirmed_by` / `declined_reason`) becomes uniform.
- A declined remote response is a first-class outcome, not an error swallowed at a call site.

**Cons / trade-offs:**
- Indirection on every mutation path; dispatch and cancel must be rewritten to append actions.
- Replay cost grows with changeset length — hence the cap.
- A second concept to learn alongside the axis ledger ([ADR-039](./039-order-lifecycle-derived-from-fact-ledger.md)).

**Migration path:**
- Additive tables. Existing mutation paths move over one at a time; the ad-hoc claims are removed only
  in the same commit that routes their call site through the changeset.

## References

- Related issues: #1032, #1947
- Related ADRs: [ADR-039](./039-order-lifecycle-derived-from-fact-ledger.md), [ADR-027](./027-order-status-writeback-capability-and-relay.md), [ADR-005](./005-postgres-authoritative-job-dedup.md)
- Plan: [implementation-plan-1032-oms-module](../../plans/implementation-plan-1032-oms-module.md)
