# ADR-043: Order lifecycle as a derived projection over a per-axis fact ledger

- **Status**: **Proposed** — see *Why this is not Accepted* below
- **Date**: 2026-08-13
- **Authors**: @piotrswierzy

## Why this is not Accepted

This ADR **never merged in an Accepted state**, so the append-only rule in the ADR README is not
engaged and nothing is being rewritten — it is simply proposed and not adopted. An adversarial stress
test found it unsupported on three counts before it landed:

1. **The rejected alternative is the one OL has shipped three times.** This ADR rejects "recompute on
   read with no materialised column" because list filtering and sorting needs an indexable column.
   But `canonicalState` reduces to a pure function of `fulfillmentState` and `cancelledAt` — two
   columns already in the same row, already filtered and sorted in SQL via `FULFILLMENT_ORDINAL`,
   `HEALTH_ORDINAL` and `applySlaFilter`. An expression index or a CASE does the job.
2. **The vocabulary is never defined.** The plan specifies `UNIQUE (internalOrderId, axis, causeType,
   causeId)` and `NOT NULL` for a table whose axis names and canonical-state values it never
   enumerates. Downstream, `order_stages.canonicalState` would be operator-authored data keyed on an
   undefined enum.
3. **Two existing canonical vocabularies go unmentioned.** `OrderStatus` (persisted as
   `order_state_mappings.olStatus`, the only outbound translation surface OL has) and the five-bucket
   `OrderHealth` partition (whose comment declares itself "the single source of truth", encoded three
   times, existing so the KPI cards sum to total). `canonicalState` is nullable with no backfill,
   which reintroduces the uncounted-rows bug that partition exists to prevent.

**Preconditions before this returns to Accepted:** the enumerated vocabularies; a stated relationship
to `OrderStatus` / `order_state_mapping`; a stated relationship to the `OrderHealth` partition and the
list badge; and a named producer in existing code for every `causeId` — including a `waybill` cause
type, which the current table lacks and which the most load-bearing relay in the codebase needs.

## Context

OpenLinker owns no order-status transitions today: the lifecycle status is copied from the source
marketplace into `orderSnapshot` and never advanced, reconciled or guarded (#1032). An OMS needs to
answer "what is the real state of this order?" across a source, N destinations, a shipment lifecycle
and an SLA.

Two constraints shape the answer. Every fact OL holds is an *observation* reported by a system it
does not control, frequently arriving late or out of order. And the facts are not independent:
cancel-after-dispatch is a real spanning invariant with two uncoordinated writers today
(`OrderIngestionService.handleSourceCancellation` writes `cancelledAt` with no knowledge of shipment
state).

The spec's Phase C adversarial review refuted both "orthogonal axes ⇒ no conflict" and
"guarded-monotonic single value". The codebase already agrees: `cancelledAt` is deliberately *not* on
the `recordStatus` axis, because an order can be `ready` and cancelled at once.

## Decision

Persist a **per-axis fact ledger** — `order_axis_states` (current value per order×axis) plus
`order_axis_transitions` (append-only) — and compute the canonical lifecycle as a **pure, lossy,
documented-precedence projection** over it. Materialise the result onto `order_records.canonicalState`
only for SQL filter and sort.

Guardrails belong to the ledger, not the status: idempotency keyed on
`(internalOrderId, axis, originConnectionId, sourceEventId)`, and monotonic enforcement as a
conditional `UPDATE … WHERE ordinal < $new`.

`recordStatus` (an ingest-resolution gate) and `syncStatus[]` (a transport ledger) are **not**
lifecycle axes and are not folded in.

## Alternatives considered

- **Stored canonical scalar with guarded monotonic transitions**: rejected — retraction facts (cancel,
  return) are not monotonic, and flattening progressive and retraction axes into one enum produces
  illegal-looking-but-necessary edges. Vendure's own FSM permits `Shipped → PartiallyDelivered` for
  exactly this reason.
- **Independent per-axis writers with no coordinator**: rejected — cancel-after-dispatch is a real
  cross-axis invariant; "orthogonal" is false here.
- **Recompute on read with no materialised column**: rejected — list filtering and sorting needs an
  indexable column. The materialisation is a cache, not the truth.

## Consequences

**Pros:**
- Late and out-of-order events are absorbed: an observation that does not change the facts does not
  change the projection.
- The precedence rule is one pure function, testable without I/O.
- Follows house pattern (`deriveSlaState`, `deriveOrderHealth`, `fulfillmentState`).

**Cons / trade-offs:**
- The materialised column is a cache with an invalidation obligation, owned by one service.
- Every new axis needs an explicit precedence decision; the projection is deliberately lossy.
- The ledger grows unboundedly and will need a retention policy.

**Migration path:**
- New tables plus a nullable `canonicalState`; no backfill — orders converge on their next transition,
  mirroring the `fulfillmentState` precedent.

## References

- Related issues: #1032, #1916, #1947
- Related ADRs: [ADR-012](./012-branch-1-fulfillment-modeling.md), [ADR-027](./027-order-status-writeback-capability-and-relay.md), [ADR-044](./044-order-changeset-proposed-then-confirmed.md)
- Plan: [ANALYSIS-1032-oms-module](../../plans/analysis/ANALYSIS-1032-oms-module.md)
